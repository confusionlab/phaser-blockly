import { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAction, useQuery } from 'convex/react';
import { Link } from 'react-router-dom';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { api } from '@convex-generated/api';
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
import type { BlocklyEditScope, OrchestratedCandidate } from '@/lib/llm';
import { createTraceRecorder } from '@/lib/llm/liveTrace';
import { buildModelEditOverviewLines } from '@/lib/llm/traceSummary';
import {
  appendAssistantMessage,
  appendAssistantTurn,
  clearAssistantThreadMessages,
  ensureAssistantThread,
  listAssistantMessages,
} from '@/db/assistantChatDb';

type BlocklyAssistantPanelProps = {
  scope: BlocklyEditScope | null;
};

type RequestState = 'idle' | 'loading' | 'ready' | 'error';
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  meta?: string;
};
const MAX_CHAT_MESSAGES = 50;

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

export function BlocklyAssistantPanel({ scope }: BlocklyAssistantPanelProps) {
  const isE2EAuthBypass = import.meta.env.VITE_E2E_AUTH_BYPASS === '1';
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<RequestState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);

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
  const { undo } = useEditorStore();
  const assistantTurnAction = useAction(api.llm.assistantTurn);
  const walletSummary = useQuery(api.billing.getWalletSummary, isE2EAuthBypass ? 'skip' : {});

  const managedCreditsBlocked = walletSummary !== undefined && !walletSummary.canRunManagedAssistant;
  const scopeKey = useMemo(() => {
    if (!project) return null;
    return getScopeStorageKey(scope);
  }, [project, scope]);

  useEffect(() => {
    let cancelled = false;

    if (!project || !scopeKey) {
      setThreadId(null);
      setChatMessages([]);
      return;
    }

    void (async () => {
      try {
        const thread = await ensureAssistantThread(project.id, scopeKey);
        if (cancelled) return;
        setThreadId(thread.id);

        const messages = await listAssistantMessages(thread.id);
        if (cancelled) return;
        setChatMessages(messages.slice(-MAX_CHAT_MESSAGES));
      } catch {
        if (cancelled) return;
        setThreadId(null);
        setChatMessages([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project, scopeKey]);

  const appendChatMessage = async (message: Omit<ChatMessage, 'id'>) => {
    if (!threadId) return;
    const stored = await appendAssistantMessage({
      threadId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      meta: message.meta,
    });
    setChatMessages((prev) => [...prev, stored].slice(-MAX_CHAT_MESSAGES));
  };

  const upsertTransientChatMessage = (message: ChatMessage) => {
    setChatMessages((prev) => {
      const index = prev.findIndex((entry) => entry.id === message.id);
      if (index < 0) {
        return [...prev, message].slice(-MAX_CHAT_MESSAGES);
      }
      const next = [...prev];
      next[index] = message;
      return next.slice(-MAX_CHAT_MESSAGES);
    });
  };

  const removeTransientChatMessage = (messageId: string) => {
    setChatMessages((prev) => prev.filter((entry) => entry.id !== messageId));
  };

  const runAssistantTurn = async () => {
    if (!project) {
      setStatus('error');
      setErrorMessage('Open a project first.');
      return;
    }
    if (!scope) {
      setStatus('error');
      setErrorMessage('Select an object or component to edit.');
      return;
    }
    if (!prompt.trim()) {
      setStatus('error');
      setErrorMessage('Enter a message first.');
      return;
    }
    if (!threadId || !scopeKey) {
      setStatus('error');
      setErrorMessage('Assistant thread is not ready yet. Try again in a moment.');
      return;
    }
    if (managedCreditsBlocked) {
      setStatus('error');
      setErrorMessage('Out of credits. Open Billing to upgrade or manage your plan.');
      return;
    }

    setStatus('loading');
    setErrorMessage(null);
    setStatusMessage(null);
    const userIntent = prompt.trim();
    const startedAt = new Date().toISOString();
    const traceMessageId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const traceMessageCreatedAt = new Date().toISOString();
    const traceRecorder = createTraceRecorder();
    const updateTraceMessage = (options: { finalBody?: string | null; finalLabel?: string } = {}) => {
      upsertTransientChatMessage({
        id: traceMessageId,
        role: 'assistant',
        content: traceRecorder.render({
          ...options,
          runningLabel: options.finalBody ? null : 'Waiting for assistant response...',
        }),
        createdAt: traceMessageCreatedAt,
        meta: options.finalBody ? 'Agent trace' : 'Agent trace (live)',
      });
    };
    const historyForTurn = chatMessages.map((message) => ({ role: message.role, content: message.content }));
    await appendChatMessage({
      role: 'user',
      content: userIntent,
      createdAt: new Date().toISOString(),
    });
    setPrompt('');
    traceRecorder.push('Turn started in managed mode.', { phase: 'start' });
    updateTraceMessage();

    try {
      const capabilities = getLlmExposedBlocklyCapabilities();
      const context = buildProgramContext(project, scope);
      const programRead = readProgramSummary(context);
      const threadContext = {
        threadId,
        scopeKey,
      };

      const projectSnapshot = buildAssistantProjectSnapshot(project);
      traceRecorder.push('Prepared Blockly capabilities, scope context, and project snapshot.', {
        phase: 'context',
      });
      traceRecorder.push('Submitting request through the managed Convex provider.', { phase: 'request' });
      updateTraceMessage();

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
      traceRecorder.push('Received assistant turn response payload.', { phase: 'response' });
      traceRecorder.pushDebugTrace(turn.debugTrace);
      updateTraceMessage();

      const turnProviderLabel = `convex:${turn.provider}`;

      if (turn.mode === 'chat') {
        if ((turn as { errorCode?: string }).errorCode === 'credits_exhausted') {
          setErrorMessage('Out of credits. Open Billing to upgrade or manage your plan.');
        }
        const chatAnswer = (turn.answer || '').trim();
        if (!chatAnswer) {
          throw new Error('Assistant returned an empty chat response.');
        }
        const chatAnswerWithTrace = traceRecorder.render({
          finalLabel: 'Assistant response',
          finalBody: chatAnswer,
        });
        removeTransientChatMessage(traceMessageId);
        await appendChatMessage({
          role: 'assistant',
          content: chatAnswerWithTrace,
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
        setStatus('idle');
        return;
      }

      const proposedEdits = turn.proposedEdits;
      if (proposedEdits.semanticOps.length === 0 && proposedEdits.projectOps.length === 0) {
        throw new Error('Assistant returned edit mode without any executable operations.');
      }

      const semanticCandidate = proposedEdits.semanticOps.length > 0
        ? await runLlmBlocklyOrchestration({
            project,
            scope,
            userIntent,
            provider: {
              name: turnProviderLabel,
              model: turn.model,
              proposeEdits: async () => proposedEdits,
            },
          })
        : null;
      const projectPreview = await previewProjectOps({
        project,
        projectOps: proposedEdits.projectOps,
      });

      const modelLatency = formatDuration(startedAt, turnCompletedAt);
      const compileLatency = semanticCandidate
        ? formatDuration(semanticCandidate.requestStartedAt, semanticCandidate.requestCompletedAt)
        : '-';
      const intentMismatchWarning = semanticCandidate
        ? detectIntentMismatchWarning(userIntent, semanticCandidate)
        : null;

      const validationIssues = [
        ...(semanticCandidate?.validation.errors ?? []),
        ...projectPreview.errors,
        ...projectPreview.validationIssueSample.map((issue: string) => `[Project validation] ${issue}`),
      ];
      if (validationIssues.length > 0) {
        setStatus('error');
        setStatusMessage('Assistant produced an invalid edit plan.');
        validationIssues.forEach((issue) => {
          traceRecorder.push(issue, { phase: 'validation' });
        });
        const assistantContent = traceRecorder.render({
          finalLabel: 'Assistant response',
          finalBody: `I proposed edits, but validation failed.\n\n${validationIssues.slice(0, 8).join('\n')}`,
        });
        removeTransientChatMessage(traceMessageId);
        await appendChatMessage({
          role: 'assistant',
          content: assistantContent,
          createdAt: turnCompletedAt,
          meta: `Provider: ${turnProviderLabel}/${turn.model} · Model latency: ${modelLatency} · Compile/validate: ${compileLatency}`,
        });
        await appendAssistantTurn({
          threadId,
          userIntent,
          mode: 'error',
          provider: turn.provider,
          model: turn.model,
          debugTraceJson: JSON.stringify(turn.debugTrace ?? null),
          createdAt: turnCompletedAt,
        });
        return;
      }

      if (intentMismatchWarning) {
        setStatus('error');
        setStatusMessage(`Auto-apply blocked by quality gate: ${intentMismatchWarning}`);
        traceRecorder.push(`Intent mismatch blocked auto-apply: ${intentMismatchWarning}`, {
          phase: 'validation',
        });
        const fallbackContent = traceRecorder.render({
          finalLabel: 'Assistant response',
          finalBody: `I generated a valid edit plan, but blocked auto-apply because intent and diff do not match.\n\n${intentMismatchWarning}`,
        });
        removeTransientChatMessage(traceMessageId);
        await appendChatMessage({
          role: 'assistant',
          content: fallbackContent,
          createdAt: turnCompletedAt,
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
        return;
      }

      const semanticResult = semanticCandidate
        ? applyOrchestratedCandidate({
            orchestrated: semanticCandidate,
            bindings: {
              getProject: () => useProjectStore.getState().project,
              addMessage,
              addGlobalVariable,
              addLocalVariable,
              updateObject,
              updateComponent,
            },
          })
        : null;

      const projectResult = proposedEdits.projectOps.length > 0
        ? await applyProjectOps({
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
          })
        : null;

      setStatus('idle');
      const responseLines: string[] = [
        ...buildModelEditOverviewLines(proposedEdits),
      ];
      if (semanticCandidate) {
        responseLines.push('', 'Compiled diff summary:', ...semanticCandidate.build.diff.summaryLines);
      }
      if (semanticResult) {
        responseLines.push('', `${semanticResult.message} Added ${semanticResult.createdMessageCount} message(s) and ${semanticResult.createdVariableCount} variable(s).`);
      }
      if (projectResult) {
        responseLines.push('', `Applied ${projectResult.appliedOpCount}/${proposedEdits.projectOps.length} project op(s).`);
        if (projectResult.validationIssueCount > 0) {
          responseLines.push(`Project validation reported ${projectResult.validationIssueCount} issue(s).`);
        }
      }
      responseLines.push('', 'Use Undo to roll back if the result is wrong.');
      traceRecorder.push('Applied validated edits automatically.', { phase: 'result' });
      const assistantContent = traceRecorder.render({
        finalLabel: 'Applied edits',
        finalBody: responseLines.join('\n'),
      });
      removeTransientChatMessage(traceMessageId);
      await appendChatMessage({
        role: 'assistant',
        content: assistantContent,
        createdAt: new Date().toISOString(),
        meta: `Provider: ${turnProviderLabel}/${turn.model} · Model latency: ${modelLatency} · Compile/validate: ${compileLatency}`,
      });
      setStatusMessage(
        [
          semanticResult ? `${semanticResult.message} Added ${semanticResult.createdMessageCount} message(s) and ${semanticResult.createdVariableCount} variable(s).` : null,
          projectResult ? `Applied ${projectResult.appliedOpCount}/${proposedEdits.projectOps.length} project op(s).` : null,
        ].filter((value): value is string => typeof value === 'string').join(' '),
      );
      await appendAssistantTurn({
        threadId,
        userIntent,
        mode: 'edit',
        provider: turn.provider,
        model: turn.model,
        debugTraceJson: JSON.stringify(turn.debugTrace ?? null),
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      setStatus('error');
      const errorText = error instanceof Error ? error.message : 'Failed to run assistant request.';
      setErrorMessage(errorText);
      traceRecorder.push(errorText, { phase: 'error' });
      removeTransientChatMessage(traceMessageId);
      if (threadId) {
        await appendChatMessage({
          role: 'assistant',
          content: traceRecorder.render({
            finalLabel: 'Assistant error',
            finalBody: errorText,
          }),
          createdAt: new Date().toISOString(),
          meta: 'Provider: convex',
        });
      }
      await appendAssistantTurn({
        threadId,
        userIntent,
        mode: 'error',
        provider: 'convex',
        model: 'unknown',
        debugTraceJson: JSON.stringify({ error: errorText }),
        createdAt: new Date().toISOString(),
      });
    }
  };

  const rollback = () => {
    undo();
    setStatusMessage('Undid last change. If the LLM apply was the most recent edit, it has been rolled back.');
  };

  const clearChat = () => {
    if (!threadId) return;
    void clearAssistantThreadMessages(threadId)
      .then(() => {
        setChatMessages([]);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to clear chat history.');
      });
  };

  return (
    <div className="absolute top-3 right-3 z-30 w-[360px] max-w-[calc(100%-24px)]">
      {!open ? (
        <Button
          size="sm"
          className="ml-auto flex gap-2 shadow-md"
          onClick={() => setOpen(true)}
          title="Open Blockly assistant"
        >
          <Bot className="size-4" />
          Assistant
        </Button>
      ) : (
        <div className="rounded-lg border bg-card/95 backdrop-blur p-3 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4" />
              Blockly Assistant
            </div>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
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

          <div className="h-44 overflow-y-auto rounded-md border bg-background p-2 space-y-2">
            {chatMessages.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Ask questions about blocks or request edits. This thread is persisted locally.
              </p>
            ) : (
              chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-md px-2 py-1 text-xs whitespace-pre-wrap ${
                    message.role === 'user'
                      ? 'bg-primary/10 border border-primary/20'
                      : 'bg-muted'
                  }`}
                >
                  <div className="font-medium mb-1">{message.role === 'user' ? 'You' : 'Assistant'}</div>
                  <div>{message.content}</div>
                  {message.meta ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">{message.meta}</div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder='Ask or request edits. Intent is detected automatically.'
            className="w-full h-20 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => void runAssistantTurn()}
              disabled={status === 'loading' || !scope || !project || managedCreditsBlocked}
            >
              {status === 'loading' ? <Loader2 className="size-4 animate-spin" /> : null}
              Send
            </Button>
            <Button size="sm" variant="ghost" onClick={clearChat}>
              Clear chat
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={rollback}>
              <RotateCcw className="size-4" />
              Rollback
            </Button>
          </div>

          {!scope ? <p className="text-xs text-amber-600">Select an object or component first.</p> : null}

          {errorMessage ? <p className="text-xs text-red-600 whitespace-pre-wrap">{errorMessage}</p> : null}
          {statusMessage ? <p className="text-xs text-muted-foreground whitespace-pre-wrap">{statusMessage}</p> : null}
          {managedCreditsBlocked ? (
            <p className="text-xs text-red-600">
              Managed assistant is blocked at zero credits. Open <Link to="/billing" className="underline">Billing</Link> to upgrade.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
