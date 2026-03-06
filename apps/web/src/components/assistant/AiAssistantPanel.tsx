import { useEffect, useMemo, useRef, useState } from 'react';
import { useConvex } from 'convex/react';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ChatModelRunOptions,
  type ChatModelRunResult,
} from '@assistant-ui/react';
import { Composer, Thread, ThreadWelcome } from '@assistant-ui/react-ui';
import {
  Activity,
  Bot,
  CheckCircle2,
  LoaderCircle,
  Lock,
  Sparkles,
  TriangleAlert,
  WandSparkles,
  Wrench,
  X,
} from 'lucide-react';
import { api } from '@convex-generated/api';
import type { AssistantChangeSet } from '../../../../../packages/ui-shared/src/assistant';
import { Button } from '@/components/ui/button';
import {
  appendCompletedRunFeedItem,
  finishToolRunFeedItem,
  startToolRunFeedItem,
  type RunFeedItem,
} from '@/lib/assistant/runFeed';
import { extractAssistantThreadContext } from '@/lib/assistant/threadContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { createAssistantProjectSnapshot, projectContainsObject, projectContainsScene } from '@/lib/assistant/projectState';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';

type StatusTone = 'idle' | 'running' | 'success' | 'error';

const assistantApi = (api as any).assistant;

const PANEL_CARD_CLASS = [
  'rounded-[24px] border border-white/55 bg-white/70 p-4 backdrop-blur-xl',
  'shadow-[0_20px_45px_-36px_rgba(15,23,42,0.45)]',
  'dark:border-white/10 dark:bg-white/5',
].join(' ');

const WELCOME_SUGGESTIONS = [
  {
    text: 'Add a coin score system with a visible HUD.',
    prompt: 'Add a coin score system and show the score on screen.',
  },
  {
    text: 'Give the player a smoother jump and landing feel.',
    prompt: 'Improve the player movement with better jump and landing feel.',
  },
  {
    text: 'Create a parallax background that moves with the camera.',
    prompt: 'Add a parallax background that reacts to camera movement.',
  },
] as const;

function parseEventPayload(payloadJson: string): Record<string, unknown> | null {
  try {
    return JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }
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

function getStatusTone({
  assistantLockRunId,
  errorMessage,
  statusLabel,
}: {
  assistantLockRunId: string | null;
  errorMessage: string | null;
  statusLabel: string;
}): StatusTone {
  if (errorMessage) return 'error';
  if (assistantLockRunId) return 'running';
  if (statusLabel === 'Completed') return 'success';
  return 'idle';
}

export function AiAssistantPanel() {
  const convex = useConvex();
  const convexRef = useRef(convex);
  const project = useProjectStore((state) => state.project);
  const assistantLockRunId = useEditorStore((state) => state.assistantLockRunId);
  const assistantLockMessage = useEditorStore((state) => state.assistantLockMessage);
  const [isOpen, setIsOpen] = useState(false);
  const [recentFeed, setRecentFeed] = useState<RunFeedItem[]>([]);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [statusLabel, setStatusLabel] = useState<string>('Ready');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    convexRef.current = convex;
  }, [convex]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const runtime = useLocalRuntime(
    useMemo<ChatModelAdapter>(() => ({
      run: async function* ({ messages, abortSignal }: ChatModelRunOptions) {
        const { requestText: userPrompt, conversationHistory } = extractAssistantThreadContext(messages as never);
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
            conversationHistoryJson: JSON.stringify(conversationHistory),
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
            const feedUpdates: Array<(items: RunFeedItem[]) => RunFeedItem[]> = [];

            for (const event of events as Array<{ _id: string; type: string; payloadJson: string }>) {
              if (seenEventIds.has(String(event._id))) continue;
              seenEventIds.add(String(event._id));
              const payload = parseEventPayload(event.payloadJson);
              const eventId = String(event._id);

              switch (event.type) {
                case 'context_prepared':
                  assistantText = assistantText.includes('Prepared project context.')
                    ? assistantText
                    : `${assistantText}\nPrepared project context.`;
                  textChanged = true;
                  feedUpdates.push((items) => appendCompletedRunFeedItem(items, {
                    id: eventId,
                    label: 'Context prepared.',
                  }));
                  break;
                case 'reasoning_delta': {
                  const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
                  if (text) {
                    assistantText = `${assistantText}\n${text}`;
                    textChanged = true;
                    feedUpdates.push((items) => appendCompletedRunFeedItem(items, {
                      id: eventId,
                      label: text,
                    }));
                  }
                  break;
                }
                case 'tool_call_started': {
                  const tool = typeof payload?.tool === 'string' ? payload.tool : 'tool';
                  setCurrentTool(tool);
                  feedUpdates.push((items) => startToolRunFeedItem(items, {
                    id: eventId,
                    tool,
                  }));
                  break;
                }
                case 'tool_call_finished': {
                  const tool = typeof payload?.tool === 'string' ? payload.tool : 'tool';
                  const result = payload?.result as Record<string, unknown> | null | undefined;
                  const summary = summarizeToolResult(result ?? null);
                  setCurrentTool(null);
                  feedUpdates.push((items) => finishToolRunFeedItem(items, {
                    eventId,
                    tool,
                    label: summary ? `${tool}: ${summary}` : `${tool} finished.`,
                    tone: result?.ok === false ? 'warning' : 'normal',
                  }));
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
                  feedUpdates.push((items) => appendCompletedRunFeedItem(items, {
                    id: eventId,
                    label: warning,
                    tone: 'warning',
                  }));
                  break;
                }
                case 'run_completed': {
                  const summary = typeof payload?.summary === 'string' ? payload.summary.trim() : '';
                  if (summary) {
                    assistantText = `${assistantText}\n${summary}`;
                    textChanged = true;
                    feedUpdates.push((items) => appendCompletedRunFeedItem(items, {
                      id: eventId,
                      label: summary,
                    }));
                  }
                  break;
                }
                case 'run_failed': {
                  const failure = typeof payload?.errorMessage === 'string'
                    ? payload.errorMessage
                    : 'The assistant run failed.';
                  assistantText = `${assistantText}\nFailed: ${failure}`;
                  textChanged = true;
                  feedUpdates.push((items) => appendCompletedRunFeedItem(items, {
                    id: eventId,
                    label: failure,
                    tone: 'warning',
                  }));
                  break;
                }
                default:
                  break;
              }
            }

            if (feedUpdates.length > 0) {
              setRecentFeed((current) => feedUpdates.reduce((items, update) => update(items), current));
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

  const objectCount = useMemo(
    () => project?.scenes.reduce((total, scene) => total + scene.objects.length, 0) ?? 0,
    [project],
  );

  const statusTone = getStatusTone({ assistantLockRunId, errorMessage, statusLabel });

  const statusBadgeClass = cn(
    'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold',
    statusTone === 'running' && 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200',
    statusTone === 'success' && 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200',
    statusTone === 'error' && 'bg-red-100 text-red-900 dark:bg-red-400/15 dark:text-red-200',
    statusTone === 'idle' && 'bg-slate-900/6 text-slate-700 dark:bg-white/10 dark:text-slate-300',
  );

  const threadConfig = useMemo(
    () => ({
      assistantAvatar: { fallback: 'AI' },
      welcome: {
        message: project
          ? 'Describe a change for the open project. I will stream progress, validate the result, and apply the update automatically.'
          : 'Open a project first, then ask for scene, logic, art, or gameplay changes.',
        suggestions: project ? [...WELCOME_SUGGESTIONS] : undefined,
      },
      composer: {
        allowAttachments: false,
      },
      strings: {
        composer: {
          input: {
            placeholder: project
              ? 'Describe the change you want to make...'
              : 'Open a project to start using the assistant...',
          },
        },
        thread: {
          scrollToBottom: {
            tooltip: 'Jump to latest reply',
          },
        },
      },
    }),
    [project],
  );

  return (
    <>
      {!isOpen ? (
        <Button
          className={cn(
            'fixed bottom-5 right-5 z-[100320] h-auto max-w-[calc(100vw-2rem)] rounded-full px-3 py-3 text-left',
            'border border-slate-950/10 bg-slate-950 text-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.8)]',
            'hover:bg-slate-900 dark:border-white/10 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100',
          )}
          onClick={() => setIsOpen(true)}
          title="Open AI assistant"
          aria-expanded={isOpen}
        >
          <span className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/12 dark:bg-slate-900/8">
              {assistantLockRunId ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <WandSparkles className="size-4" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Assistant</span>
              <span className="block truncate text-[11px] text-white/75 dark:text-slate-950/65">
                {assistantLockRunId ? currentTool ?? 'Updating the project...' : 'Polished workspace for AI edits'}
              </span>
            </span>
          </span>
        </Button>
      ) : null}

      {isOpen ? (
        <div className="fixed inset-0 z-[100330]">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/20 backdrop-blur-[3px]"
            onClick={() => setIsOpen(false)}
            aria-label="Close AI assistant"
          />

          <div className="absolute inset-3 animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-200 sm:inset-4">
            <AssistantRuntimeProvider runtime={runtime}>
              <Thread.Root
                config={threadConfig}
                className={cn(
                  'assistant-panel-theme assistant-panel-chrome h-full overflow-hidden rounded-[28px]',
                  'border border-white/60 shadow-[0_40px_120px_-48px_rgba(15,23,42,0.65)]',
                  'dark:border-white/10',
                )}
              >
                <div className="flex h-full min-h-0 flex-col">
                  <div className="border-b border-black/6 px-5 py-4 dark:border-white/10 sm:px-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex items-start gap-3">
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_18px_40px_-24px_rgba(15,23,42,0.8)] dark:bg-amber-300 dark:text-slate-950">
                          <Bot className="size-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-white/65 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-600 dark:bg-white/6 dark:text-slate-300">
                              AI Assistant
                            </span>
                            <span className={statusBadgeClass}>
                              {assistantLockRunId ? 'Live run' : statusLabel}
                            </span>
                          </div>
                          <h2 className="mt-3 text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
                            Build changes in natural language
                          </h2>
                          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                            {project
                              ? 'Describe the change you want. The assistant streams progress, edits the open project, and applies the result automatically.'
                              : 'Open a project first, then describe the scene, logic, or asset changes you want.'}
                          </p>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="icon-sm"
                        className="shrink-0 rounded-full bg-white/60 dark:bg-white/6"
                        onClick={() => setIsOpen(false)}
                        aria-label="Close AI assistant"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid min-h-0 flex-1 gap-4 p-4 sm:p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                    <aside className="flex min-h-0 flex-col gap-3">
                      <div className={PANEL_CARD_CLASS}>
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              'mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl',
                              statusTone === 'running' && 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200',
                              statusTone === 'success' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200',
                              statusTone === 'error' && 'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-200',
                              statusTone === 'idle' && 'bg-slate-900/6 text-slate-700 dark:bg-white/10 dark:text-slate-300',
                            )}
                          >
                            {statusTone === 'running' ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : statusTone === 'success' ? (
                              <CheckCircle2 className="size-4" />
                            ) : statusTone === 'error' ? (
                              <TriangleAlert className="size-4" />
                            ) : (
                              <WandSparkles className="size-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                              Run status
                            </div>
                            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-white">
                              {assistantLockRunId ? assistantLockMessage ?? 'Assistant is updating the project...' : statusLabel}
                            </div>
                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                              {assistantLockRunId
                                ? 'The editor is temporarily locked until this run finishes.'
                                : project
                                  ? 'Ready for the next request.'
                                  : 'Open a project before asking for edits.'}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <div className="rounded-2xl bg-black/5 p-3 dark:bg-white/5">
                            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                              Current tool
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                              <Wrench className="size-3.5" />
                              <span className="truncate">{currentTool ?? 'Idle'}</span>
                            </div>
                          </div>
                          <div className="rounded-2xl bg-black/5 p-3 dark:bg-white/5">
                            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                              Apply mode
                            </div>
                            <div className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                              Auto-apply
                            </div>
                          </div>
                        </div>

                        {assistantLockRunId ? (
                          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-300/70 bg-amber-50/90 p-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
                            <Lock className="mt-0.5 size-4 shrink-0" />
                            <span>{assistantLockMessage ?? 'The editor is locked while the assistant run is active.'}</span>
                          </div>
                        ) : null}
                      </div>

                      <div className={PANEL_CARD_CLASS}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                              Open project
                            </div>
                            <div className="mt-1 truncate text-base font-semibold text-slate-950 dark:text-white">
                              {project?.name ?? 'No project open'}
                            </div>
                          </div>
                          <Sparkles className="mt-1 size-4 shrink-0 text-amber-500" />
                        </div>

                        {project ? (
                          <div className="mt-4 grid grid-cols-3 gap-2">
                            <div className="rounded-2xl bg-black/5 p-3 text-center dark:bg-white/5">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Scenes</div>
                              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{project.scenes.length}</div>
                            </div>
                            <div className="rounded-2xl bg-black/5 p-3 text-center dark:bg-white/5">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Objects</div>
                              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{objectCount}</div>
                            </div>
                            <div className="rounded-2xl bg-black/5 p-3 text-center dark:bg-white/5">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Messages</div>
                              <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{project.messages.length}</div>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                            The assistant needs an open project before it can stage and apply changes.
                          </p>
                        )}
                      </div>

                      <div className={cn(PANEL_CARD_CLASS, 'flex min-h-0 flex-1 flex-col')}>
                        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                          <Activity className="size-4" />
                          Recent activity
                        </div>
                        <ScrollArea className="min-h-0 flex-1 pr-2">
                          {recentFeed.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-300/80 p-4 text-sm text-slate-500 dark:border-white/12 dark:text-slate-400">
                              Run the assistant to see context loading, tool calls, validation warnings, and the final apply summary here.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {recentFeed.map((item) => {
                                const running = item.status === 'running';
                                const warning = item.tone === 'warning';
                                return (
                                  <div key={item.id} className="flex gap-3" title={item.label}>
                                    <div
                                      className={cn(
                                        'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                                        warning && 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200',
                                        running && !warning && 'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200',
                                        !warning && !running && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200',
                                      )}
                                    >
                                      {warning ? (
                                        <TriangleAlert className="size-3.5" />
                                      ) : running ? (
                                        <LoaderCircle className="size-3.5 animate-spin" />
                                      ) : (
                                        <CheckCircle2 className="size-3.5" />
                                      )}
                                    </div>
                                    <div className="min-w-0 pt-0.5 text-sm leading-5 text-slate-700 dark:text-slate-300">
                                      {item.label}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </ScrollArea>
                      </div>

                      {errorMessage ? (
                        <div className="rounded-[24px] border border-red-200 bg-red-50/95 p-4 text-sm text-red-800 shadow-[0_20px_45px_-36px_rgba(127,29,29,0.35)] dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">
                          {errorMessage}
                        </div>
                      ) : null}
                    </aside>

                    <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/60 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_30px_60px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/55">
                      <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3 dark:border-white/10 sm:px-5">
                        <div>
                          <div className="text-sm font-semibold text-slate-950 dark:text-white">Conversation</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            Mutations are applied automatically after validation.
                          </div>
                        </div>
                        <div className="hidden items-center gap-2 text-xs text-slate-500 dark:text-slate-400 sm:flex">
                          <Wrench className="size-3.5" />
                          <span className="max-w-[220px] truncate">{currentTool ?? 'Waiting for the next step'}</span>
                        </div>
                      </div>

                      <Thread.Viewport className="min-h-0 flex-1 px-4 pt-5 sm:px-6 sm:pt-6">
                        <ThreadWelcome />
                        <Thread.Messages />
                        <Thread.FollowupSuggestions />
                        <Thread.ViewportFooter className="px-1 pt-6 sm:px-2">
                          <Thread.ScrollToBottom className="border border-black/10 bg-white/90 text-slate-700 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-900/90 dark:text-slate-200" />
                          <Composer />
                        </Thread.ViewportFooter>
                      </Thread.Viewport>
                    </section>
                  </div>
                </div>
              </Thread.Root>
            </AssistantRuntimeProvider>
          </div>
        </div>
      ) : null}
    </>
  );
}
