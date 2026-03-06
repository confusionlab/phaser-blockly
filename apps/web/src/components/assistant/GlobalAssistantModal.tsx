import { useEffect, useMemo, useState } from 'react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';
import { Bot, Loader2, Sparkles, X } from 'lucide-react';
import { useAction, useQuery } from 'convex/react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api } from '@convex-generated/api';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import {
  appendAssistantMessage,
  appendAssistantTurn,
  clearAssistantThreadMessages,
  ensureAssistantThread,
  listAssistantMessages,
} from '@/db/assistantChatDb';
import {
  applyProjectOps,
  applyOrchestratedCandidate,
  buildAssistantProjectSnapshot,
  buildProgramContext,
  getLlmExposedBlocklyCapabilities,
  previewProjectOps,
  readProgramSummary,
  runLlmBlocklyOrchestration,
} from '@/lib/llm';
import { createTraceRecorder } from '@/lib/llm/liveTrace';
import type { BlocklyEditScope, OrchestratedCandidate } from '@/lib/llm';
import { buildModelEditOverviewLines } from '@/lib/llm/traceSummary';

type PersistedChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function getScopeStorageKey(scope: BlocklyEditScope | null): string | null {
  if (!scope) return null;
  if (scope.scope === 'component') {
    return `component:${scope.componentId}`;
  }
  return `object:${scope.sceneId}:${scope.objectId}`;
}

function formatDuration(startIso: string, endIso: string): string {
  const durationMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return '-';
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function detectIntentMismatchWarning(userIntent: string, candidate: OrchestratedCandidate): string | null {
  const lower = userIntent.toLowerCase();
  const asksToAdd = /\b(add|create|insert|new)\b/.test(lower);
  const asksToRemove = /\b(remove|delete)\b/.test(lower);
  const asksToChange = /\b(change|set|update|edit|modify)\b/.test(lower);
  const asksForJump = /\bjump\b/.test(lower) && /\bspace\b/.test(lower);

  const diff = candidate.build.diff;
  if (asksToAdd && diff.addedBlockCount === 0) {
    return 'Intent looks additive, but no blocks were added.';
  }
  if (asksToRemove && diff.removedBlockCount === 0) {
    return 'Intent looks destructive, but no blocks were removed.';
  }
  if (asksToChange && diff.changedFieldCount === 0 && diff.changedConnectionCount === 0 && diff.addedBlockCount === 0) {
    return 'Intent looks like a change request, but diff appears empty.';
  }
  if (asksForJump && diff.addedBlockCount === 0 && diff.changedConnectionCount === 0) {
    return 'Jump intent detected, but no event/action structure was added.';
  }
  return null;
}

function extractMessageText(message: { content?: unknown }): string {
  const content = Array.isArray(message.content) ? message.content : [];
  const textParts = content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const typedPart = part as { type?: string; text?: string };
      if ((typedPart.type === 'text' || typedPart.type === 'reasoning') && typeof typedPart.text === 'string') {
        return typedPart.text;
      }
      return '';
    })
    .filter((value) => value.trim().length > 0);
  return textParts.join('\n').trim();
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="mb-3 flex justify-end">
      <div className="max-w-[75%] rounded-2xl bg-primary/15 px-3 py-2 text-sm whitespace-pre-wrap">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="mb-3 flex justify-start">
      <div className="max-w-[80%] rounded-2xl border bg-background px-3 py-2 text-sm whitespace-pre-wrap">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

export function GlobalAssistantModal() {
  const isE2EAuthBypass = import.meta.env.VITE_E2E_AUTH_BYPASS === '1';
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [scopeKey, setScopeKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persistedMessages, setPersistedMessages] = useState<PersistedChatMessage[]>([]);

  const {
    project,
    updateProjectName,
    addScene,
    reorderScenes,
    updateScene,
    addObject,
    addMessage,
    addGlobalVariable,
    addLocalVariable,
    updateObject,
    updateComponent,
  } = useProjectStore();

  const { selectedSceneId, selectedObjectId, selectedComponentId, undo } = useEditorStore();
  const assistantTurnAction = useAction(api.llm.assistantTurn);
  const walletSummary = useQuery(api.billing.getWalletSummary, isE2EAuthBypass ? 'skip' : {});
  const managedCreditsBlocked = walletSummary !== undefined && !walletSummary.canRunManagedAssistant;

  const assistantScope: BlocklyEditScope | null = useMemo(() => {
    if (!project) return null;
    if (selectedComponentId) {
      return {
        scope: 'component',
        componentId: selectedComponentId,
        selectedSceneId,
      };
    }
    if (selectedSceneId && selectedObjectId) {
      const scene = project.scenes.find((sceneItem) => sceneItem.id === selectedSceneId);
      const object = scene?.objects.find((objectItem) => objectItem.id === selectedObjectId);
      return {
        scope: 'object',
        sceneId: selectedSceneId,
        objectId: selectedObjectId,
        componentId: object?.componentId,
      };
    }
    return null;
  }, [project, selectedComponentId, selectedObjectId, selectedSceneId]);

  useEffect(() => {
    let cancelled = false;

    if (!project) {
      setThreadId(null);
      setScopeKey(null);
      setPersistedMessages([]);
      return;
    }

    const nextScopeKey = assistantScope ? getScopeStorageKey(assistantScope) : `project:${project.id}`;
    setScopeKey(nextScopeKey);

    if (!nextScopeKey) {
      setThreadId(null);
      setPersistedMessages([]);
      return;
    }

    void (async () => {
      try {
        const thread = await ensureAssistantThread(project.id, nextScopeKey);
        if (cancelled) return;
        setThreadId(thread.id);

        const messages = await listAssistantMessages(thread.id);
        if (cancelled) return;
        setPersistedMessages(
          messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        );
      } catch {
        if (cancelled) return;
        setThreadId(null);
        setScopeKey(null);
        setPersistedMessages([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assistantScope, project]);

  const adapter = useMemo<ChatModelAdapter>(() => ({
    run: (options) => (async function* () {
      if (!project) {
        throw new Error('Open a project first.');
      }
      if (!threadId || !scopeKey) {
        throw new Error('Assistant thread is not ready yet.');
      }
      if (managedCreditsBlocked) {
        throw new Error('Out of credits. Open Billing to upgrade or manage your plan.');
      }

      setErrorMessage(null);
      setStatusMessage(null);

      const messages = options.messages.filter((message) => message.role === 'user' || message.role === 'assistant');
      const historyForTurn = messages
        .map((message) => ({
          role: message.role,
          content: extractMessageText(message),
        }))
        .filter((message) => message.content.length > 0) as Array<{ role: 'user' | 'assistant'; content: string }>;

      const userIntent = [...historyForTurn].reverse().find((message) => message.role === 'user')?.content?.trim();
      if (!userIntent) {
        throw new Error('Failed to extract your prompt from chat state.');
      }

      const startedAt = new Date().toISOString();
      await appendAssistantMessage({
        threadId,
        role: 'user',
        content: userIntent,
        createdAt: new Date().toISOString(),
      });

      const traceRecorder = createTraceRecorder();
      traceRecorder.push('Turn started in managed mode.', { phase: 'start' });

      let renderedText = traceRecorder.render({
        runningLabel: 'Preparing request...',
      });
      let pendingYield = true;
      let finished = false;
      let requestError: Error | null = null;
      let finalResponseReady = false;
      let waiter: (() => void) | null = null;

      const flush = () => {
        pendingYield = true;
        renderedText = traceRecorder.render({
          runningLabel: finished ? null : 'Waiting for assistant response...',
        });
        if (waiter) {
          const resolve = waiter;
          waiter = null;
          resolve();
        }
      };

      const pushTrace = (
        message: string,
        entryOptions: { detail?: string | null; phase?: string } = {},
      ) => {
        traceRecorder.push(message, entryOptions);
        flush();
      };

      const finalizeTrace = (finalLabel: string, finalBody: string) => {
        renderedText = traceRecorder.render({
          finalLabel,
          finalBody,
        });
        pendingYield = true;
        finalResponseReady = true;
        finished = true;
        if (waiter) {
          const resolve = waiter;
          waiter = null;
          resolve();
        }
      };

      const turnTask = (async () => {
        try {
          const capabilities = getLlmExposedBlocklyCapabilities();
          let context: unknown;
          let programRead: unknown;
          if (assistantScope) {
            const scopedContext = buildProgramContext(project, assistantScope);
            context = scopedContext;
            programRead = readProgramSummary(scopedContext);
          } else {
            context = {
              scope: { scope: 'project' },
              summary: 'No object/component selected. Global chat mode.',
              scenes: project.scenes.map((scene) => ({ id: scene.id, name: scene.name })),
            };
            programRead = {
              summary: 'No scoped Blockly target selected.',
              eventFlows: [],
              warnings: ['Select an object/component to generate direct Blockly edits.'],
            };
          }
          const threadContext = { threadId, scopeKey };
          const projectSnapshot = buildAssistantProjectSnapshot(project);

          pushTrace('Prepared assistant capabilities, scope context, and project snapshot.', {
            phase: 'context',
          });
          pushTrace('Submitting request through the managed Convex provider.', { phase: 'request' });

          const turn = await assistantTurnAction({
            userIntent,
            chatHistory: historyForTurn,
            threadContext,
            capabilities,
            context,
            programRead,
            projectSnapshot,
          });
          const turnCompletedAt = new Date().toISOString();
          const turnProviderLabel = `convex:${turn.provider}`;

          pushTrace('Received assistant turn response payload.', { phase: 'response' });
          traceRecorder.pushDebugTrace(turn.debugTrace);
          flush();

          if (turn.mode === 'chat') {
            if ((turn as { errorCode?: string }).errorCode === 'credits_exhausted') {
              setErrorMessage('Out of credits. Open Billing to upgrade or manage your plan.');
            }
            const chatAnswer = (turn.answer || '').trim();
            if (!chatAnswer) {
              throw new Error('Assistant returned an empty response.');
            }
            const assistantText = traceRecorder.render({
              finalLabel: 'Assistant response',
              finalBody: chatAnswer,
            });

            await appendAssistantMessage({
              threadId,
              role: 'assistant',
              content: assistantText,
              createdAt: turnCompletedAt,
              meta: `Provider: ${turnProviderLabel}/${turn.model} · Latency: ${formatDuration(startedAt, turnCompletedAt)}`,
            });
            await appendAssistantTurn({
              threadId,
              userIntent,
              mode: 'chat',
              provider: turn.provider,
              model: turn.model,
              debugTraceJson: JSON.stringify(turn.debugTrace ?? null),
              createdAt: turnCompletedAt,
            });

            finalizeTrace('Assistant response', chatAnswer);
            return;
          }

          const proposedEdits = turn.proposedEdits;
          if (proposedEdits.semanticOps.length === 0 && proposedEdits.projectOps.length === 0) {
            throw new Error('Assistant returned edit mode without any executable operations.');
          }

          let semanticCandidate: OrchestratedCandidate | null = null;
          const semanticIssues: string[] = [];
          if (proposedEdits.semanticOps.length > 0) {
            if (!assistantScope) {
              semanticIssues.push('Blockly edits require an object or component to be selected.');
            } else {
              semanticCandidate = await runLlmBlocklyOrchestration({
                project,
                scope: assistantScope,
                userIntent,
                provider: {
                  name: turnProviderLabel,
                  model: turn.model,
                  proposeEdits: async () => proposedEdits,
                },
              });
            }
          }

          const projectPreview = await previewProjectOps({
            project,
            projectOps: proposedEdits.projectOps,
          });
          const modelLatency = formatDuration(startedAt, turnCompletedAt);
          const compileLatency = semanticCandidate
            ? formatDuration(semanticCandidate.requestStartedAt, semanticCandidate.requestCompletedAt)
            : '-';
          const validationIssues = [
            ...semanticIssues,
            ...(semanticCandidate?.validation.errors ?? []),
            ...projectPreview.errors,
            ...projectPreview.validationIssueSample.map((issue: string) => `[Project validation] ${issue}`),
          ];

          if (validationIssues.length > 0) {
            setStatusMessage('Assistant produced an invalid edit plan.');
            validationIssues.forEach((issue) => {
              pushTrace(issue, { phase: 'validation' });
            });
            const failureMessage = `I proposed edits, but validation failed.\n\n${validationIssues.slice(0, 8).join('\n')}`;
            const assistantText = traceRecorder.render({
              finalLabel: 'Assistant response',
              finalBody: failureMessage,
            });

            await appendAssistantMessage({
              threadId,
              role: 'assistant',
              content: assistantText,
              createdAt: new Date().toISOString(),
              meta: `Provider: ${turnProviderLabel}/${turn.model} · Model latency: ${modelLatency} · Compile/validate: ${compileLatency}`,
            });
            await appendAssistantTurn({
              threadId,
              userIntent,
              mode: 'error',
              provider: turn.provider,
              model: turn.model,
              debugTraceJson: JSON.stringify(turn.debugTrace ?? null),
              createdAt: new Date().toISOString(),
            });

            finalizeTrace('Assistant response', failureMessage);
            return;
          }

          const intentMismatchWarning = semanticCandidate
            ? detectIntentMismatchWarning(userIntent, semanticCandidate)
            : null;

          if (intentMismatchWarning) {
            const responseLines = [
              ...buildModelEditOverviewLines(proposedEdits),
              '',
              `Auto-apply blocked by intent mismatch: ${intentMismatchWarning}`,
            ];
            pushTrace(`Intent mismatch blocked auto-apply: ${intentMismatchWarning}`, {
              phase: 'validation',
            });
            const assistantText = traceRecorder.render({
              finalLabel: 'Assistant response',
              finalBody: responseLines.join('\n'),
            });

            await appendAssistantMessage({
              threadId,
              role: 'assistant',
              content: assistantText,
              createdAt: new Date().toISOString(),
              meta: `Provider: ${turnProviderLabel}/${turn.model} · Model latency: ${modelLatency} · Compile/validate: ${compileLatency}`,
            });
            await appendAssistantTurn({
              threadId,
              userIntent,
              mode: 'edit',
              provider: turn.provider,
              model: turn.model,
              debugTraceJson: JSON.stringify(turn.debugTrace ?? null),
              createdAt: turnCompletedAt,
            });

            finalizeTrace('Assistant response', responseLines.join('\n'));
            return;
          }

          const statusParts: string[] = [];
          const errorParts: string[] = [];

          if (semanticCandidate) {
            const semanticResult = applyOrchestratedCandidate({
              orchestrated: semanticCandidate,
              bindings: {
                getProject: () => useProjectStore.getState().project,
                addMessage,
                addGlobalVariable,
                addLocalVariable,
                updateObject,
                updateComponent,
              },
            });
            statusParts.push(
              `${semanticResult.message} Added ${semanticResult.createdMessageCount} message(s) and ${semanticResult.createdVariableCount} variable(s).`,
            );
          }

          if (proposedEdits.projectOps.length > 0) {
            const projectResult = await applyProjectOps({
              projectOps: proposedEdits.projectOps,
              bindings: {
                getProject: () => useProjectStore.getState().project,
                updateProjectName,
                addScene,
                reorderScenes,
                updateScene,
                addObject,
                updateObject,
              },
            });

            statusParts.push(
              `Applied ${projectResult.appliedOpCount}/${proposedEdits.projectOps.length} project op(s).`,
            );
            if (projectResult.validationIssueCount > 0) {
              statusParts.push(`Validation reported ${projectResult.validationIssueCount} issue(s).`);
            }
            if (projectResult.errors.length > 0) {
              errorParts.push(...projectResult.errors);
            }
          }

          const responseLines: string[] = [
            ...buildModelEditOverviewLines(proposedEdits),
          ];
          if (semanticCandidate) {
            responseLines.push('', 'Compiled diff summary:', ...semanticCandidate.build.diff.summaryLines);
          }
          if (statusParts.length > 0) {
            responseLines.push('', ...statusParts);
          }
          responseLines.push('', 'Use Undo to roll back if the result is wrong.');

          const assistantText = traceRecorder.render({
            finalLabel: 'Applied edits',
            finalBody: responseLines.join('\n'),
          });

          await appendAssistantMessage({
            threadId,
            role: 'assistant',
            content: assistantText,
            createdAt: new Date().toISOString(),
            meta: `Provider: ${turnProviderLabel}/${turn.model} · Model latency: ${modelLatency} · Compile/validate: ${compileLatency}`,
          });
          setStatusMessage(statusParts.join(' '));
          setErrorMessage(errorParts.length > 0 ? errorParts.join('\n') : null);
          await appendAssistantTurn({
            threadId,
            userIntent,
            mode: 'edit',
            provider: turn.provider,
            model: turn.model,
            debugTraceJson: JSON.stringify(turn.debugTrace ?? null),
            createdAt: turnCompletedAt,
          });

          finalizeTrace('Applied edits', responseLines.join('\n'));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to run assistant request.';
          setErrorMessage(message);
          traceRecorder.push(message, { phase: 'error' });
          const assistantText = traceRecorder.render({
            finalLabel: 'Assistant error',
            finalBody: message,
          });
          await appendAssistantMessage({
            threadId,
            role: 'assistant',
            content: assistantText,
            createdAt: new Date().toISOString(),
            meta: 'Provider: convex',
          });
          await appendAssistantTurn({
            threadId,
            userIntent,
            mode: 'error',
            provider: 'convex',
            model: 'unknown',
            debugTraceJson: JSON.stringify({ error: message }),
            createdAt: new Date().toISOString(),
          });
          requestError = error instanceof Error ? error : new Error(message);
          finalizeTrace('Assistant error', message);
        }
      })();

      while (!finished || pendingYield) {
        if (!pendingYield) {
          await new Promise<void>((resolve) => {
            waiter = resolve;
          });
        }
        if (!pendingYield) {
          continue;
        }
        pendingYield = false;
        yield {
          content: [{ type: 'text', text: renderedText }],
          ...(finalResponseReady && !requestError ? { status: { type: 'complete' as const, reason: 'stop' as const } } : {}),
        };
      }

      await turnTask;
      if (requestError) {
        throw requestError;
      }
    })(),
  }), [assistantScope, assistantTurnAction, managedCreditsBlocked, project, scopeKey, threadId]);

  const initialMessages = useMemo(
    () => persistedMessages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    [persistedMessages],
  );

  const runtime = useLocalRuntime(adapter, {
    initialMessages,
  });

  const clearChat = () => {
    if (!threadId) return;
    void clearAssistantThreadMessages(threadId)
      .then(() => {
        setPersistedMessages([]);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to clear chat history.');
      });
  };

  const rollback = () => {
    undo();
    setStatusMessage('Undid last change. If apply was the most recent edit, it has been rolled back.');
  };

  return (
    <>
      <Button
        className="fixed bottom-5 right-5 z-[100100] rounded-full px-4 py-2 shadow-xl"
        onClick={() => setOpen(true)}
        title="Open assistant"
      >
        <Bot className="size-4" />
        Assistant
      </Button>

      {open ? (
        <div className="fixed inset-3 z-[100200] rounded-2xl border bg-card shadow-2xl">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4" />
                Assistant
              </div>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>

            <div className="flex flex-1 min-h-0">
              <div className="w-[320px] border-r p-3 space-y-3 overflow-y-auto">
                <div className="space-y-2 rounded-md border bg-background p-2 text-xs">
                  <div className="font-medium">Credits</div>
                  {walletSummary === undefined ? (
                    <div className="text-muted-foreground">Loading credit balance...</div>
                  ) : (
                    <>
                      <div className="text-muted-foreground">
                        Plan: <span className="font-medium text-foreground">{walletSummary.planSlug}</span>
                      </div>
                      <div className="text-muted-foreground">
                        Remaining: <span className="font-medium text-foreground">{walletSummary.balanceCredits}</span>
                      </div>
                      <div className="text-muted-foreground">
                        Period end:{' '}
                        <span className="font-medium text-foreground">
                          {walletSummary.periodEndsAt
                            ? new Date(walletSummary.periodEndsAt).toLocaleString()
                            : 'monthly reset'}
                        </span>
                      </div>
                      {!walletSummary.canRunManagedAssistant ? (
                        <div className="text-red-600">Out of credits. Upgrade to continue managed assistant usage.</div>
                      ) : null}
                      <Button size="sm" variant="secondary" asChild>
                        <Link to="/billing">Upgrade / Manage</Link>
                      </Button>
                    </>
                  )}
                </div>

                <div className="space-y-2 rounded-md border bg-background p-2 text-xs">
                  <div className="font-medium">Scope</div>
                  <div className="text-muted-foreground">
                    {assistantScope
                      ? assistantScope.scope === 'component'
                        ? `Component: ${assistantScope.componentId}`
                        : `Object: ${assistantScope.objectId}`
                      : 'Project-wide chat mode (no object selected). Select an object/component to target edits.'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={rollback}>
                    Rollback
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearChat}>
                    Clear chat
                  </Button>
                </div>
              </div>

              <div className="flex-1 min-w-0 p-3">
                <AssistantRuntimeProvider runtime={runtime}>
                  <ThreadPrimitive.Root className="flex h-full flex-col rounded-xl border bg-background">
                    <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto p-3">
                      <ThreadPrimitive.Messages
                        components={{
                          Message: AssistantMessage,
                          UserMessage,
                          AssistantMessage,
                        }}
                      />
                    </ThreadPrimitive.Viewport>

                    <ComposerPrimitive.Root className="border-t p-3">
                      <div className="flex items-end gap-2">
                        <ComposerPrimitive.Input
                          className="max-h-36 min-h-[44px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          placeholder="Ask anything or request edits..."
                        />
                        <ComposerPrimitive.Send
                          disabled={managedCreditsBlocked}
                          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Send
                        </ComposerPrimitive.Send>
                      </div>
                    </ComposerPrimitive.Root>
                  </ThreadPrimitive.Root>
                </AssistantRuntimeProvider>
              </div>
            </div>

            {errorMessage ? <p className="px-4 pb-2 text-xs text-red-600 whitespace-pre-wrap">{errorMessage}</p> : null}
            {statusMessage ? (
              <p className="px-4 pb-3 text-xs text-muted-foreground whitespace-pre-wrap flex items-center gap-2">
                {statusMessage}
                {statusMessage.toLowerCase().includes('waiting') ? <Loader2 className="size-3 animate-spin" /> : null}
              </p>
            ) : null}
            {managedCreditsBlocked ? (
              <p className="px-4 pb-3 text-xs text-red-600">
                Managed assistant is blocked at zero credits. Open <Link to="/billing" className="underline">Billing</Link> to upgrade.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
