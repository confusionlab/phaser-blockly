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
import { useAuth } from '@clerk/clerk-react';
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
  getAssistantThreadProviderMode,
  listAssistantMessages,
  setAssistantThreadProviderMode,
  type AssistantProviderMode,
} from '@/db/assistantChatDb';
import {
  applyProjectOps,
  applyOrchestratedCandidate,
  buildAssistantProjectSnapshot,
  buildProgramContext,
  getLlmExposedBlocklyCapabilities,
  readProgramSummary,
  runLlmBlocklyOrchestration,
  summarizeProjectOps,
  validateSemanticOpsPayload,
} from '@/lib/llm';
import { createTraceRecorder } from '@/lib/llm/liveTrace';
import type { BlocklyEditScope, LLMProvider, OrchestratedCandidate, ProjectOp } from '@/lib/llm';
import { buildModelEditOverviewLines } from '@/lib/llm/traceSummary';

type ProviderStatusSnapshot = {
  hasCodexToken: boolean;
  codexAvailable: boolean;
  codexAuthMethod: 'chatgpt' | 'api_key' | 'unknown' | null;
  codexEmail: string | null;
  codexPlanType: string | null;
  codexLoginInProgress: boolean;
  codexStatusMessage: string | null;
};

type CandidateDebugInfo = {
  userIntent: string;
  modelProvider: string;
  modelName: string;
  modelLatency: string;
  compileLatency: string;
  trace: unknown;
  intentMismatchWarning: string | null;
};

type PersistedChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ProjectOpsCandidate = {
  projectOps: ProjectOp[];
  summaryLines: string[];
};

const DEFAULT_PROVIDER_STATUS: ProviderStatusSnapshot = {
  hasCodexToken: false,
  codexAvailable: false,
  codexAuthMethod: null,
  codexEmail: null,
  codexPlanType: null,
  codexLoginInProgress: false,
  codexStatusMessage: null,
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

function mapProviderStatus(status: {
  hasCodexToken: boolean;
  codexAvailable: boolean;
  codexAuthMethod?: 'chatgpt' | 'api_key' | 'unknown' | null;
  codexEmail?: string | null;
  codexPlanType?: string | null;
  codexLoginInProgress?: boolean;
  codexStatusMessage?: string | null;
}): ProviderStatusSnapshot {
  return {
    hasCodexToken: status.hasCodexToken,
    codexAvailable: status.codexAvailable,
    codexAuthMethod: status.codexAuthMethod ?? null,
    codexEmail: status.codexEmail ?? null,
    codexPlanType: status.codexPlanType ?? null,
    codexLoginInProgress: status.codexLoginInProgress ?? false,
    codexStatusMessage: status.codexStatusMessage ?? null,
  };
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
  const { userId } = useAuth();
  const isE2EAuthBypass = import.meta.env.VITE_E2E_AUTH_BYPASS === '1';
  const runtimeUserId = userId ?? (import.meta.env.VITE_E2E_AUTH_BYPASS_USER_ID?.trim() || null);
  const isDesktopRuntime = typeof window !== 'undefined' && !!window.desktopAssistant;
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [scopeKey, setScopeKey] = useState<string | null>(null);
  const [providerMode, setProviderMode] = useState<AssistantProviderMode>('managed');
  const [providerStatus, setProviderStatus] = useState<ProviderStatusSnapshot>(DEFAULT_PROVIDER_STATUS);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persistedMessages, setPersistedMessages] = useState<PersistedChatMessage[]>([]);
  const [candidate, setCandidate] = useState<OrchestratedCandidate | null>(null);
  const [projectOpsCandidate, setProjectOpsCandidate] = useState<ProjectOpsCandidate | null>(null);
  const [candidateDebugInfo, setCandidateDebugInfo] = useState<CandidateDebugInfo | null>(null);

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
  const managedCreditsBlocked =
    providerMode === 'managed'
    && walletSummary !== undefined
    && !walletSummary.canRunManagedAssistant;

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

        const persistedMode = await getAssistantThreadProviderMode(thread.id);
        if (cancelled) return;
        const nextMode = !isDesktopRuntime ? 'managed' : persistedMode;
        setProviderMode(nextMode);
        if (persistedMode !== nextMode) {
          await setAssistantThreadProviderMode(thread.id, nextMode);
        }

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
  }, [assistantScope, isDesktopRuntime, project]);

  useEffect(() => {
    if (!isDesktopRuntime || !runtimeUserId || !window.desktopAssistant) {
      setProviderStatus(DEFAULT_PROVIDER_STATUS);
      return;
    }
    const desktopAssistant = window.desktopAssistant;
    void desktopAssistant.provider.status(runtimeUserId)
      .then((status) => {
        setProviderStatus(mapProviderStatus(status));
      })
      .catch(() => {
        setProviderStatus(DEFAULT_PROVIDER_STATUS);
      });

    return desktopAssistant.onProviderEvent((event) => {
      if (event.type.startsWith('assistant-turn-')) {
        return;
      }
      if (event.message) {
        setStatusMessage(event.message);
      }
      void desktopAssistant.provider.status(runtimeUserId)
        .then((status) => {
          setProviderStatus(mapProviderStatus(status));
        })
        .catch(() => {
          setProviderStatus(DEFAULT_PROVIDER_STATUS);
        });
    });
  }, [isDesktopRuntime, runtimeUserId]);

  const adapter = useMemo<ChatModelAdapter>(() => ({
    run: (options) => (async function* () {
      if (!project) {
        throw new Error('Open a project first.');
      }
      if (!threadId || !scopeKey) {
        throw new Error('Assistant thread is not ready yet.');
      }
      if (!isDesktopRuntime && providerMode !== 'managed') {
        throw new Error('Web runtime only supports managed mode.');
      }
      if (managedCreditsBlocked) {
        throw new Error('Out of credits. Open Billing to upgrade or manage your plan.');
      }
      if (providerMode === 'codex_oauth' && !providerStatus.hasCodexToken) {
        throw new Error('Codex mode selected but not signed in. Click Login with ChatGPT.');
      }
      if (providerMode === 'codex_oauth' && !providerStatus.codexAvailable) {
        throw new Error(providerStatus.codexStatusMessage || 'Codex mode is unavailable.');
      }

      setErrorMessage(null);
      setStatusMessage(null);
      setCandidate(null);
      setProjectOpsCandidate(null);
      setCandidateDebugInfo(null);

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
      traceRecorder.push(`Turn started in ${providerMode} mode.`, { phase: 'start' });

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
        let unsubscribeTrace: (() => void) | null = null;
        const stopTraceSubscription = () => {
          unsubscribeTrace?.();
          unsubscribeTrace = null;
        };
        options.abortSignal.addEventListener('abort', stopTraceSubscription, { once: true });

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
          pushTrace(
            providerMode === 'codex_oauth'
              ? 'Submitting request through the desktop Codex provider.'
              : `Submitting request through ${providerMode} provider mode.`,
            { phase: 'request' },
          );

          if (providerMode === 'codex_oauth' && isDesktopRuntime && window.desktopAssistant) {
            unsubscribeTrace = window.desktopAssistant.onProviderEvent((event) => {
              const added = traceRecorder.pushProviderEvent(event, threadId);
              if (added) {
                flush();
              }
            });
          }

          const turn = await (providerMode === 'codex_oauth'
            ? (() => {
                if (!isDesktopRuntime || !window.desktopAssistant) {
                  throw new Error('Codex mode requires desktop app runtime.');
                }
                if (!runtimeUserId) {
                  throw new Error('Missing signed-in user context for desktop provider.');
                }
                return window.desktopAssistant.provider.assistantTurn({
                  userIntent,
                  chatHistory: historyForTurn,
                  capabilities,
                  context,
                  programRead,
                  projectSnapshot,
                  threadContext,
                }, runtimeUserId);
              })()
            : (() => {
                return (async () => {
                  return assistantTurnAction({
                    userIntent,
                    chatHistory: historyForTurn,
                    providerMode,
                    threadContext,
                    capabilities,
                    context,
                    programRead,
                    projectSnapshot,
                  });
                })();
              })());
          stopTraceSubscription();

          const turnCompletedAt = new Date().toISOString();
          const turnProviderLabel = providerMode === 'codex_oauth' ? `desktop:${turn.provider}` : `convex:${turn.provider}`;
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
              meta: `Provider mode: ${providerMode} · Provider: ${turnProviderLabel}/${turn.model} · Latency: ${formatDuration(startedAt, turnCompletedAt)}`,
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

          const parsedProposedEdits = validateSemanticOpsPayload(turn.proposedEdits);
          if (!parsedProposedEdits.ok) {
            const validationSummary = parsedProposedEdits.errors.slice(0, 4).join('; ');
            const validationSuffix = parsedProposedEdits.errors.length > 4 ? '; ...' : '';
            const fallbackMessage = [
              'I could not generate executable edits because the model returned an invalid operation payload.',
              `Validation: ${validationSummary}${validationSuffix}`,
              'Please retry with concrete scene/object names (or IDs).',
            ].join('\n');

            setStatusMessage('Assistant returned an invalid edit payload. Showing guidance instead of applying edits.');
            pushTrace('Panel-side proposed-edits validation failed.', { phase: 'validation' });
            const assistantText = traceRecorder.render({
              finalLabel: 'Assistant response',
              finalBody: fallbackMessage,
            });

            await appendAssistantMessage({
              threadId,
              role: 'assistant',
              content: assistantText,
              createdAt: turnCompletedAt,
              meta: `Provider mode: ${providerMode} · Provider: ${turnProviderLabel}/${turn.model} · Latency: ${formatDuration(startedAt, turnCompletedAt)}`,
            });
            await appendAssistantTurn({
              threadId,
              userIntent,
              mode: 'error',
              provider: turn.provider,
              model: turn.model,
              debugTraceJson: JSON.stringify({
                validationErrors: parsedProposedEdits.errors,
                upstreamTrace: turn.debugTrace ?? null,
              }),
              createdAt: turnCompletedAt,
            });

            finalizeTrace('Assistant response', fallbackMessage);
            return;
          }

          const proposedEdits = parsedProposedEdits.value;
          const modelLatency = formatDuration(startedAt, turnCompletedAt);
          let compileLatency = '-';
          let intentMismatchWarning: string | null = null;

          let semanticCandidate: OrchestratedCandidate | null = null;
          if (proposedEdits.semanticOps.length > 0) {
            if (assistantScope) {
              const convexProvider: LLMProvider = {
                name: `convex:${turn.provider}`,
                model: turn.model,
                proposeEdits: async () => proposedEdits,
              };

              pushTrace('Compiling Blockly diff candidate from semantic ops.', {
                phase: 'compile',
              });
              semanticCandidate = await runLlmBlocklyOrchestration({
                project,
                scope: assistantScope,
                userIntent,
                provider: convexProvider,
              });
              compileLatency = formatDuration(semanticCandidate.requestStartedAt, semanticCandidate.requestCompletedAt);
              intentMismatchWarning = detectIntentMismatchWarning(userIntent, semanticCandidate);
              setCandidate(semanticCandidate);
              pushTrace('Blockly diff compilation finished.', { phase: 'compile' });
            } else {
              setCandidate(null);
            }
          } else {
            setCandidate(null);
          }

          const nextProjectOpsCandidate = proposedEdits.projectOps.length > 0
            ? {
                projectOps: proposedEdits.projectOps,
                summaryLines: summarizeProjectOps(proposedEdits.projectOps),
              }
            : null;
          setProjectOpsCandidate(nextProjectOpsCandidate);

          setCandidateDebugInfo({
            userIntent,
            modelProvider: turn.provider,
            modelName: turn.model,
            modelLatency,
            compileLatency,
            trace: turn.debugTrace ?? null,
            intentMismatchWarning,
          });

          const responseLines: string[] = [];
          const modelEditOverview = buildModelEditOverviewLines(proposedEdits);
          responseLines.push(...modelEditOverview);
          if (semanticCandidate) {
            responseLines.push('', 'Compiled diff summary:', ...semanticCandidate.build.diff.summaryLines);
            if (!semanticCandidate.validation.pass) {
              responseLines.push(
                '',
                `Blockly validation failed with ${semanticCandidate.validation.errors.length} issue(s). Review before applying.`,
              );
              pushTrace(`Blockly validation failed with ${semanticCandidate.validation.errors.length} issue(s).`, {
                phase: 'validation',
              });
            } else if (intentMismatchWarning) {
              responseLines.push('', `Apply blocked by intent mismatch: ${intentMismatchWarning}`);
              pushTrace(`Intent mismatch blocked apply: ${intentMismatchWarning}`, {
                phase: 'validation',
              });
            }
          } else if (proposedEdits.semanticOps.length > 0 && !assistantScope) {
            responseLines.push(
              '',
              'Blockly edits were proposed, but no object/component is selected. Select scope and ask again to apply code edits.',
            );
          }

          if (nextProjectOpsCandidate) {
            responseLines.push('', 'Resolved project-op plan:', ...nextProjectOpsCandidate.summaryLines);
          }

          if (!semanticCandidate && !nextProjectOpsCandidate) {
            responseLines.push('', 'No executable edits were returned.');
          }

          const assistantText = traceRecorder.render({
            finalLabel: 'Prepared edits',
            finalBody: responseLines.join('\n'),
          });

          await appendAssistantMessage({
            threadId,
            role: 'assistant',
            content: assistantText,
            createdAt: new Date().toISOString(),
            meta: `Provider mode: ${providerMode} · Provider: ${turnProviderLabel}/${turn.model} · Model latency: ${modelLatency} · Compile/validate: ${compileLatency}`,
          });
          await appendAssistantTurn({
            threadId,
            userIntent,
            mode: 'edit',
            provider: turn.provider,
            model: turn.model,
            debugTraceJson: JSON.stringify(turn.debugTrace ?? null),
            createdAt: new Date().toISOString(),
          });

          finalizeTrace('Prepared edits', responseLines.join('\n'));
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
            meta: `Provider mode: ${providerMode}`,
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
        } finally {
          stopTraceSubscription();
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
  }), [assistantScope, assistantTurnAction, isDesktopRuntime, managedCreditsBlocked, project, providerMode, providerStatus, runtimeUserId, scopeKey, threadId]);

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

  const canApply =
    (!!candidate || !!projectOpsCandidate) &&
    (!candidate || (candidate.validation.pass && !candidateDebugInfo?.intentMismatchWarning));

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

  const applyCandidate = async () => {
    if (!candidate && !projectOpsCandidate) return;
    if (candidate && !candidate.validation.pass) {
      setErrorMessage('Candidate is not valid yet.');
      return;
    }
    if (candidateDebugInfo?.intentMismatchWarning) {
      setErrorMessage(`Apply blocked: ${candidateDebugInfo.intentMismatchWarning}`);
      return;
    }

    const statusParts: string[] = [];
    const errorParts: string[] = [];

    if (candidate) {
      const semanticResult = applyOrchestratedCandidate({
        orchestrated: candidate,
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

    if (projectOpsCandidate) {
      const projectResult = await applyProjectOps({
        projectOps: projectOpsCandidate.projectOps,
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
        `Applied ${projectResult.appliedOpCount}/${projectOpsCandidate.projectOps.length} project op(s).`,
      );
      if (projectResult.validationIssueCount > 0) {
        statusParts.push(`Validation reported ${projectResult.validationIssueCount} issue(s).`);
      }
      if (projectResult.errors.length > 0) {
        errorParts.push(...projectResult.errors);
      }
    }

    setStatusMessage(statusParts.join(' '));
    setErrorMessage(errorParts.length > 0 ? errorParts.join('\n') : null);
    setCandidate(null);
    setProjectOpsCandidate(null);
  };

  const rollback = () => {
    undo();
    setStatusMessage('Undid last change. If apply was the most recent edit, it has been rolled back.');
  };

  const updateProviderMode = async (nextMode: AssistantProviderMode) => {
    if (!threadId) return;
    if (!isDesktopRuntime && nextMode !== 'managed') {
      setErrorMessage('Web runtime only supports managed mode.');
      return;
    }

    try {
      setProviderMode(nextMode);
      await setAssistantThreadProviderMode(threadId, nextMode);
      if (isDesktopRuntime && window.desktopAssistant) {
        if (!runtimeUserId) {
          throw new Error('Missing signed-in user context for desktop provider.');
        }
        const status = await window.desktopAssistant.provider.setMode(nextMode, runtimeUserId);
        setProviderStatus(mapProviderStatus(status));
        setProviderMode(status.mode);
        await setAssistantThreadProviderMode(threadId, status.mode);
      }
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to switch provider mode.');
    }
  };

  const loginCodexProvider = async () => {
    if (!isDesktopRuntime || !window.desktopAssistant) {
      setErrorMessage('Codex login is only available in desktop app.');
      return;
    }
    if (!runtimeUserId) {
      setErrorMessage('Missing signed-in user context for desktop provider.');
      return;
    }

    try {
      setStatusMessage('Opening ChatGPT login in browser...');
      const status = await window.desktopAssistant.provider.loginCodex(runtimeUserId);
      setProviderStatus(mapProviderStatus(status));
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start ChatGPT login.');
    }
  };

  const logoutCodexProvider = async () => {
    if (!isDesktopRuntime || !window.desktopAssistant) {
      setErrorMessage('Codex logout is only available in desktop app.');
      return;
    }
    if (!runtimeUserId) {
      setErrorMessage('Missing signed-in user context for desktop provider.');
      return;
    }

    try {
      const status = await window.desktopAssistant.provider.logoutCodex(runtimeUserId);
      setProviderStatus(mapProviderStatus(status));
      setStatusMessage('Logged out from ChatGPT.');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to log out from ChatGPT.');
    }
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
                <div className="space-y-2 rounded-md border bg-background p-2">
                  <div className="text-[11px] text-muted-foreground">Provider mode</div>
                  <select
                    value={providerMode}
                    onChange={(event) => {
                      void updateProviderMode(event.target.value as AssistantProviderMode);
                    }}
                    className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
                  disabled={!isDesktopRuntime}
                >
                  <option value="managed">Managed credits</option>
                  {isDesktopRuntime ? (
                    <option value="codex_oauth">
                      Codex / ChatGPT login
                    </option>
                  ) : null}
                </select>

                  {isDesktopRuntime && providerMode === 'codex_oauth' ? (
                    <div className="space-y-2">
                      {!providerStatus.hasCodexToken ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void loginCodexProvider()}
                          disabled={providerStatus.codexLoginInProgress}
                        >
                          {providerStatus.codexLoginInProgress ? 'Waiting for login...' : 'Login with ChatGPT'}
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => void logoutCodexProvider()}>
                          Logout ChatGPT
                        </Button>
                      )}

                      <div className="text-[11px] text-muted-foreground">
                        Auth: {providerStatus.codexAuthMethod || 'none'}
                        {providerStatus.codexEmail ? ` · ${providerStatus.codexEmail}` : ''}
                        {providerStatus.codexPlanType ? ` · plan: ${providerStatus.codexPlanType}` : ''}
                      </div>
                    </div>
                  ) : null}
                </div>

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
                  <Button size="sm" variant="secondary" onClick={applyCandidate} disabled={!canApply || managedCreditsBlocked}>
                    Apply Candidate
                  </Button>
                  <Button size="sm" variant="ghost" onClick={rollback}>
                    Rollback
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearChat}>
                    Clear chat
                  </Button>
                </div>

                {candidateDebugInfo?.intentMismatchWarning ? (
                  <p className="text-xs text-amber-600">
                    Intent mismatch blocked apply: {candidateDebugInfo.intentMismatchWarning}
                  </p>
                ) : null}

                {projectOpsCandidate ? (
                  <div className="rounded-md border bg-background p-2 text-xs">
                    <div className="font-medium">Project Ops</div>
                    <div className="text-muted-foreground">
                      {projectOpsCandidate.projectOps.length} op(s) ready
                    </div>
                  </div>
                ) : null}
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
