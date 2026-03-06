import { useEffect, useMemo, useRef, useState } from 'react';
import { useConvex } from 'convex/react';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ChatModelRunOptions,
  type ChatModelRunResult,
} from '@assistant-ui/react';
import { Thread } from '@assistant-ui/react-ui';
import { api } from '@convex-generated/api';
import { Bot, LoaderCircle, Lock, WandSparkles, Wrench, X } from 'lucide-react';
import type { AssistantChangeSet } from '../../../../../packages/ui-shared/src/assistant';
import { Button } from '@/components/ui/button';
import { createAssistantProjectSnapshot, projectContainsObject, projectContainsScene } from '@/lib/assistant/projectState';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';

type RunFeedItem = {
  id: string;
  label: string;
  tone?: 'normal' | 'warning';
};

const assistantApi = (api as any).assistant;

function parseEventPayload(payloadJson: string): Record<string, unknown> | null {
  try {
    return JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractLatestUserText(messages: readonly { role: string; content: readonly { type: string; text?: string }[] }[]) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  if (!latestUserMessage) return '';
  return latestUserMessage.content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
}

function summarizeToolResult(result: Record<string, unknown> | null): string | null {
  if (!result) return null;
  if (result.ok === false) {
    const error = result.error as Record<string, unknown> | undefined;
    return typeof error?.message === 'string' ? error.message : 'Tool returned an error.';
  }

  const createdEntities = Array.isArray(result.createdEntities)
    ? result.createdEntities as Array<Record<string, unknown>>
    : [];
  if (createdEntities.length > 0) {
    return createdEntities
      .map((entity) => `${String(entity.type ?? 'entity')}: ${String(entity.name ?? entity.id ?? 'created')}`)
      .join(', ');
  }

  const affectedEntityIds = Array.isArray(result.affectedEntityIds)
    ? result.affectedEntityIds as string[]
    : [];
  if (affectedEntityIds.length > 0) {
    return `Affected ${affectedEntityIds.length} item(s).`;
  }

  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function AiAssistantPanel() {
  const convex = useConvex();
  const convexRef = useRef(convex);
  const project = useProjectStore((state) => state.project);
  const assistantLockRunId = useEditorStore((state) => state.assistantLockRunId);
  const [isOpen, setIsOpen] = useState(false);
  const [recentFeed, setRecentFeed] = useState<RunFeedItem[]>([]);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [statusLabel, setStatusLabel] = useState<string>('Ready');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    convexRef.current = convex;
  }, [convex]);

  const runtime = useLocalRuntime(
    useMemo<ChatModelAdapter>(() => ({
      run: async function* ({ messages, abortSignal }: ChatModelRunOptions) {
        const userPrompt = extractLatestUserText(messages as never);
        if (!userPrompt) {
          yield {
            content: [{ type: 'text', text: 'Enter a request first.' }],
            status: { type: 'complete', reason: 'stop' },
          } satisfies ChatModelRunResult;
          return;
        }

        if (activeRunIdRef.current) {
          yield {
            content: [{ type: 'text', text: 'Wait for the current assistant run to finish.' }],
            status: { type: 'incomplete', reason: 'error', error: 'run_in_progress' },
          } satisfies ChatModelRunResult;
          return;
        }

        const latestProject = useProjectStore.getState().project;
        if (!latestProject) {
          yield {
            content: [{ type: 'text', text: 'Open a project first.' }],
            status: { type: 'incomplete', reason: 'error', error: 'missing_project' },
          } satisfies ChatModelRunResult;
          return;
        }

        setErrorMessage(null);
        setRecentFeed([]);
        setCurrentTool(null);
        setStatusLabel('Preparing');
        useEditorStore.getState().setAssistantLock('pending', 'Preparing assistant context...');

        let assistantText = 'Preparing run...';
        yield {
          content: [{ type: 'text', text: assistantText }],
        };

        try {
          const convexClient = convexRef.current;
          const snapshot = createAssistantProjectSnapshot(latestProject);
          const created = await convexClient.mutation(assistantApi.createRun, {
            projectId: latestProject.id,
            mode: 'mutate',
            requestText: userPrompt,
            projectVersion: snapshot.projectVersion,
            snapshotJson: JSON.stringify(snapshot),
          });

          const runId = String(created.runId);
          activeRunIdRef.current = runId;
          useEditorStore.getState().setAssistantLock(runId, 'Assistant is updating the project...');
          setStatusLabel('Working');

          const seenEventIds = new Set<string>();
          while (true) {
            if (abortSignal.aborted) {
              throw new Error('Assistant request was cancelled.');
            }

            const [run, events] = await Promise.all([
              convexClient.query(assistantApi.getRun, { runId: created.runId }),
              convexClient.query(assistantApi.listRunEvents, { runId: created.runId }),
            ]);

            let textChanged = false;
            const nextFeed: RunFeedItem[] = [];

            for (const event of events as Array<{ _id: string; type: string; payloadJson: string }>) {
              if (seenEventIds.has(String(event._id))) continue;
              seenEventIds.add(String(event._id));
              const payload = parseEventPayload(event.payloadJson);

              switch (event.type) {
                case 'context_prepared':
                  assistantText = assistantText.includes('Prepared project context.')
                    ? assistantText
                    : `${assistantText}\nPrepared project context.`;
                  textChanged = true;
                  nextFeed.push({ id: String(event._id), label: 'Context prepared.' });
                  break;
                case 'reasoning_delta': {
                  const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
                  if (text) {
                    assistantText = `${assistantText}\n${text}`;
                    textChanged = true;
                    nextFeed.push({ id: String(event._id), label: text });
                  }
                  break;
                }
                case 'tool_call_started': {
                  const tool = typeof payload?.tool === 'string' ? payload.tool : 'tool';
                  setCurrentTool(tool);
                  nextFeed.push({ id: String(event._id), label: `Running ${tool}...` });
                  break;
                }
                case 'tool_call_finished': {
                  const tool = typeof payload?.tool === 'string' ? payload.tool : 'tool';
                  const result = payload?.result as Record<string, unknown> | null | undefined;
                  const summary = summarizeToolResult(result ?? null);
                  setCurrentTool(null);
                  nextFeed.push({
                    id: String(event._id),
                    label: summary ? `${tool}: ${summary}` : `${tool} finished.`,
                    tone: result?.ok === false ? 'warning' : 'normal',
                  });
                  break;
                }
                case 'validation_failed': {
                  const result = payload?.result as Record<string, unknown> | undefined;
                  const error = result?.error as Record<string, unknown> | undefined;
                  const warning = typeof error?.message === 'string'
                    ? error.message
                    : 'Validation failed during staging.';
                  assistantText = `${assistantText}\nWarning: ${warning}`;
                  textChanged = true;
                  nextFeed.push({ id: String(event._id), label: warning, tone: 'warning' });
                  break;
                }
                case 'run_completed': {
                  const summary = typeof payload?.summary === 'string' ? payload.summary.trim() : '';
                  if (summary) {
                    assistantText = `${assistantText}\n${summary}`;
                    textChanged = true;
                    nextFeed.push({ id: String(event._id), label: summary });
                  }
                  break;
                }
                case 'run_failed': {
                  const failure = typeof payload?.errorMessage === 'string'
                    ? payload.errorMessage
                    : 'The assistant run failed.';
                  assistantText = `${assistantText}\nFailed: ${failure}`;
                  textChanged = true;
                  nextFeed.push({ id: String(event._id), label: failure, tone: 'warning' });
                  break;
                }
                default:
                  break;
              }
            }

            if (nextFeed.length > 0) {
              setRecentFeed((current) => [...current, ...nextFeed].slice(-12));
            }

            if (textChanged) {
              yield {
                content: [{ type: 'text', text: assistantText.trim() }],
              };
            }

            if (!run) {
              throw new Error('Assistant run disappeared before completion.');
            }

            if (run.status === 'failed') {
              setStatusLabel('Failed');
              setErrorMessage(run.errorMessage ?? 'Assistant run failed.');
              useEditorStore.getState().setAssistantLock(null);
              activeRunIdRef.current = null;
              yield {
                content: [{ type: 'text', text: assistantText.trim() }],
                status: { type: 'incomplete', reason: 'error', error: run.errorMessage ?? 'run_failed' },
              } satisfies ChatModelRunResult;
              return;
            }

            if (run.status === 'completed') {
              setStatusLabel('Completed');
              if (run.changeSetJson) {
                const changeSet = JSON.parse(run.changeSetJson) as AssistantChangeSet;
                const nextProject = useProjectStore.getState().applyAssistantChangeSet(changeSet);
                if (!nextProject) {
                  throw new Error('No open project was available when applying the assistant change-set.');
                }

                const editorState = useEditorStore.getState();
                const nextSelectedSceneId = projectContainsScene(nextProject, editorState.selectedSceneId)
                  ? editorState.selectedSceneId
                  : nextProject.scenes[0]?.id ?? null;
                const nextSelectedObjectId = projectContainsObject(
                  nextProject,
                  nextSelectedSceneId,
                  editorState.selectedObjectId,
                )
                  ? editorState.selectedObjectId
                  : null;

                useEditorStore.setState({
                  selectedSceneId: nextSelectedSceneId,
                  selectedObjectId: nextSelectedObjectId,
                  selectedObjectIds: nextSelectedObjectId ? [nextSelectedObjectId] : [],
                });

                await convexClient.mutation(assistantApi.markRunApplied, { runId: created.runId });
                assistantText = `${assistantText}\nChanges applied.`;
                yield {
                  content: [{ type: 'text', text: assistantText.trim() }],
                };
              }

              useEditorStore.getState().setAssistantLock(null);
              activeRunIdRef.current = null;
              yield {
                content: [{ type: 'text', text: assistantText.trim() }],
                status: { type: 'complete', reason: 'stop' },
              } satisfies ChatModelRunResult;
              return;
            }

            await sleep(450);
          }

          yield {
            content: [{ type: 'text', text: assistantText.trim() }],
            status: { type: 'incomplete', reason: 'error', error: 'unexpected_exit' },
          } satisfies ChatModelRunResult;
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Assistant run failed.';
          setStatusLabel('Failed');
          setErrorMessage(message);
          useEditorStore.getState().setAssistantLock(null);
          activeRunIdRef.current = null;
          assistantText = `${assistantText}\nFailed: ${message}`;
          yield {
            content: [{ type: 'text', text: assistantText.trim() }],
            status: { type: 'incomplete', reason: 'error', error: message },
          } satisfies ChatModelRunResult;
          return;
        }
      },
    }), []),
  );

  return (
    <>
      <Button
        className="fixed bottom-5 right-5 z-[100320] rounded-full px-4 py-2 shadow-xl"
        onClick={() => setIsOpen((current) => !current)}
        title="Open AI assistant"
      >
        <WandSparkles className="size-4" />
        Assistant
      </Button>

      {isOpen ? (
        <div className="fixed inset-3 z-[100330] overflow-hidden rounded-2xl border bg-card shadow-2xl">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Bot className="size-4" />
                AI Assistant
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[300px_1fr]">
              <div className="overflow-y-auto border-r p-3">
                <div className="space-y-3 text-xs">
                  <div className="rounded-lg border bg-background p-3">
                    <div className="mb-1 font-medium">Status</div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {assistantLockRunId ? <LoaderCircle className="size-3 animate-spin" /> : null}
                      {statusLabel}
                    </div>
                    {assistantLockRunId ? (
                      <div className="mt-2 flex items-start gap-2 text-amber-700">
                        <Lock className="mt-0.5 size-3 shrink-0" />
                        <span>The editor is locked while the assistant run is active.</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-lg border bg-background p-3">
                    <div className="mb-1 font-medium">Current Tool</div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Wrench className="size-3" />
                      {currentTool ?? 'Idle'}
                    </div>
                  </div>

                  <div className="rounded-lg border bg-background p-3">
                    <div className="mb-2 font-medium">Recent Activity</div>
                    <div className="space-y-2">
                      {recentFeed.length === 0 ? (
                        <div className="text-muted-foreground">No activity yet.</div>
                      ) : recentFeed.map((item) => (
                        <div
                          key={item.id}
                          className={item.tone === 'warning' ? 'text-amber-700' : 'text-muted-foreground'}
                        >
                          {item.label}
                        </div>
                      ))}
                    </div>
                  </div>

                  {errorMessage ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                      {errorMessage}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 p-3">
                <AssistantRuntimeProvider runtime={runtime}>
                  <Thread
                    welcome={{
                      message: project
                        ? 'Ask for changes to the open project. The assistant will stream progress and auto-apply the result.'
                        : 'Open a project first to use the assistant.',
                    }}
                    composer={{
                      allowAttachments: false,
                    }}
                  />
                </AssistantRuntimeProvider>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
