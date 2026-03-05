import { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAction, useQuery } from 'convex/react';
import { useAuth } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { api } from '@convex-generated/api';
import {
  applyOrchestratedCandidate,
  buildProgramContext,
  getLlmExposedBlocklyCapabilities,
  readProgramSummary,
  runLlmBlocklyOrchestration,
  validateSemanticOpsPayload,
} from '@/lib/llm';
import type { BlocklyEditScope, LLMProvider, OrchestratedCandidate } from '@/lib/llm';
import type { Project } from '@/types';
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
type CandidateDebugInfo = {
  userIntent: string;
  modelProvider: string;
  modelName: string;
  modelLatency: string;
  compileLatency: string;
  trace: unknown;
  intentMismatchWarning: string | null;
};
type ProviderCredentials = {
  openRouterApiKey?: string;
  codexToken?: string;
};
type ProviderStatusSnapshot = {
  hasByokKey: boolean;
  hasCodexToken: boolean;
  codexAvailable: boolean;
  codexAuthMethod: 'chatgpt' | 'api_key' | 'unknown' | null;
  codexEmail: string | null;
  codexPlanType: string | null;
  codexLoginInProgress: boolean;
  codexStatusMessage: string | null;
};

const MAX_CHAT_MESSAGES = 50;
const DEFAULT_PROVIDER_STATUS: ProviderStatusSnapshot = {
  hasByokKey: false,
  hasCodexToken: false,
  codexAvailable: false,
  codexAuthMethod: null,
  codexEmail: null,
  codexPlanType: null,
  codexLoginInProgress: false,
  codexStatusMessage: null,
};

function buildProjectSnapshot(project: Project) {
  return {
    id: project.id,
    name: project.name,
    scenes: project.scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      order: scene.order,
      ground: scene.ground
        ? {
            enabled: scene.ground.enabled,
            y: scene.ground.y,
            color: scene.ground.color,
          }
        : null,
      cameraConfig: scene.cameraConfig
        ? {
            followTarget: scene.cameraConfig.followTarget,
            bounds: scene.cameraConfig.bounds,
            zoom: scene.cameraConfig.zoom,
          }
        : null,
      objects: scene.objects.map((object) => ({
        id: object.id,
        name: object.name,
        componentId: object.componentId || null,
        x: object.x,
        y: object.y,
        scaleX: object.scaleX,
        scaleY: object.scaleY,
        rotation: object.rotation,
        visible: object.visible,
        physics: object.physics,
        collider: object.collider,
        blocklyXml: object.blocklyXml || '',
        localVariables: (object.localVariables || []).map((variable) => ({
          id: variable.id,
          name: variable.name,
          type: variable.type,
          scope: variable.scope,
          defaultValue: variable.defaultValue,
        })),
        sounds: (object.sounds || []).map((sound) => ({
          id: sound.id,
          name: sound.name,
        })),
      })),
    })),
    components: (project.components || []).map((component) => ({
      id: component.id,
      name: component.name,
      physics: component.physics,
      collider: component.collider,
      blocklyXml: component.blocklyXml || '',
      localVariables: (component.localVariables || []).map((variable) => ({
        id: variable.id,
        name: variable.name,
        type: variable.type,
        scope: variable.scope,
        defaultValue: variable.defaultValue,
      })),
      sounds: (component.sounds || []).map((sound) => ({
        id: sound.id,
        name: sound.name,
      })),
    })),
    messages: (project.messages || []).map((message) => ({
      id: message.id,
      name: message.name,
    })),
    globalVariables: (project.globalVariables || []).map((variable) => ({
      id: variable.id,
      name: variable.name,
      type: variable.type,
      scope: variable.scope,
      defaultValue: variable.defaultValue,
    })),
  };
}

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
  hasByokKey: boolean;
  hasCodexToken: boolean;
  codexAvailable: boolean;
  codexAuthMethod?: 'chatgpt' | 'api_key' | 'unknown' | null;
  codexEmail?: string | null;
  codexPlanType?: string | null;
  codexLoginInProgress?: boolean;
  codexStatusMessage?: string | null;
}): ProviderStatusSnapshot {
  return {
    hasByokKey: status.hasByokKey,
    hasCodexToken: status.hasCodexToken,
    codexAvailable: status.codexAvailable,
    codexAuthMethod: status.codexAuthMethod ?? null,
    codexEmail: status.codexEmail ?? null,
    codexPlanType: status.codexPlanType ?? null,
    codexLoginInProgress: status.codexLoginInProgress ?? false,
    codexStatusMessage: status.codexStatusMessage ?? null,
  };
}

export function BlocklyAssistantPanel({ scope }: BlocklyAssistantPanelProps) {
  const { userId } = useAuth();
  const isDesktopRuntime = typeof window !== 'undefined' && !!window.desktopAssistant;
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<RequestState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<OrchestratedCandidate | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [allowComponentPropagation, setAllowComponentPropagation] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [candidateDebugInfo, setCandidateDebugInfo] = useState<CandidateDebugInfo | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [providerMode, setProviderMode] = useState<AssistantProviderMode>('managed');
  const [providerStatus, setProviderStatus] = useState<ProviderStatusSnapshot | null>(null);
  const [providerSecretInput, setProviderSecretInput] = useState('');

  const { project, addMessage, addGlobalVariable, addLocalVariable, updateObject, updateComponent } = useProjectStore();
  const { undo } = useEditorStore();
  const assistantTurnAction = useAction(api.llm.assistantTurn);
  const walletSummary = useQuery(api.billing.getWalletSummary);

  const canApply = !!candidate && candidate.validation.pass && !candidateDebugInfo?.intentMismatchWarning;
  const managedCreditsBlocked =
    providerMode === 'managed'
    && walletSummary !== undefined
    && !walletSummary.canRunManagedAssistant;
  const validationErrors = candidate?.validation.errors || [];
  const validationWarnings = candidate?.validation.warnings || [];

  const propagationRequired = useMemo(
    () => !!candidate?.context.isComponentInstanceSelection,
    [candidate?.context.isComponentInstanceSelection],
  );
  const scopeKey = useMemo(() => {
    if (!project) return null;
    return getScopeStorageKey(scope);
  }, [project, scope]);

  useEffect(() => {
    let cancelled = false;

    if (!project || !scopeKey) {
      setThreadId(null);
      setChatMessages([]);
      setProviderMode('managed');
      setProviderStatus(null);
      return;
    }

    void (async () => {
      try {
        const thread = await ensureAssistantThread(project.id, scopeKey);
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
        setChatMessages(messages.slice(-MAX_CHAT_MESSAGES));

        if (isDesktopRuntime && window.desktopAssistant && userId) {
          const status = await window.desktopAssistant.provider.status(userId);
          if (cancelled) return;
          setProviderStatus(mapProviderStatus(status));
          const shouldForceManaged = nextMode === 'codex_oauth' && !status.codexAvailable;
          const preferredMode = shouldForceManaged ? 'managed' : nextMode;
          if (preferredMode !== nextMode) {
            await setAssistantThreadProviderMode(thread.id, preferredMode);
          }

          if (status.mode !== preferredMode) {
            const syncedStatus = await window.desktopAssistant.provider.setMode(preferredMode, userId);
            if (cancelled) return;
            setProviderStatus(mapProviderStatus(syncedStatus));
            setProviderMode(syncedStatus.mode);
            await setAssistantThreadProviderMode(thread.id, syncedStatus.mode);
          } else {
            setProviderMode(preferredMode);
          }
        } else {
          if (nextMode !== 'managed') {
            setProviderMode('managed');
            await setAssistantThreadProviderMode(thread.id, 'managed');
          }
          setProviderStatus(DEFAULT_PROVIDER_STATUS);
        }
      } catch {
        if (cancelled) return;
        setThreadId(null);
        setChatMessages([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isDesktopRuntime, project, scopeKey, userId]);

  useEffect(() => {
    if (!isDesktopRuntime || !userId || !window.desktopAssistant) return;
    const desktopAssistant = window.desktopAssistant;
    return desktopAssistant.onProviderEvent((event) => {
      if (event.message) {
        setStatusMessage(event.message);
      }
      void desktopAssistant.provider.status(userId)
        .then((status) => {
          setProviderStatus(mapProviderStatus(status));
        })
        .catch(() => {
          setProviderStatus(DEFAULT_PROVIDER_STATUS);
        });
    });
  }, [isDesktopRuntime, userId]);

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
    if (!isDesktopRuntime && providerMode !== 'managed') {
      setStatus('error');
      setErrorMessage('Web runtime only supports managed mode.');
      return;
    }
    if (managedCreditsBlocked) {
      setStatus('error');
      setErrorMessage('Out of credits. Open Billing to upgrade or manage your plan.');
      return;
    }
    if (providerMode === 'byok' && !(providerStatus?.hasByokKey || false)) {
      setStatus('error');
      setErrorMessage('BYOK mode selected but no key is configured.');
      return;
    }
    if (providerMode === 'codex_oauth' && !(providerStatus?.hasCodexToken || false)) {
      setStatus('error');
      setErrorMessage('Codex mode selected but not signed in. Click Login with ChatGPT.');
      return;
    }
    if (providerMode === 'codex_oauth' && providerStatus && !providerStatus.codexAvailable) {
      setStatus('error');
      setErrorMessage(providerStatus.codexStatusMessage || 'Codex mode is not available in this runtime yet.');
      return;
    }

    setStatus('loading');
    setErrorMessage(null);
    setStatusMessage(null);
    setCandidate(null);
    setCandidateDebugInfo(null);
    const userIntent = prompt.trim();
    const startedAt = new Date().toISOString();
    const historyForTurn = chatMessages.map((message) => ({ role: message.role, content: message.content }));
    await appendChatMessage({
      role: 'user',
      content: userIntent,
      createdAt: new Date().toISOString(),
    });
    setPrompt('');

    try {
      const capabilities = getLlmExposedBlocklyCapabilities();
      const context = buildProgramContext(project, scope);
      const programRead = readProgramSummary(context);
      const threadContext = {
        threadId,
        scopeKey,
      };

      const turn = await (providerMode === 'codex_oauth'
        ? (() => {
            if (!isDesktopRuntime || !window.desktopAssistant) {
              throw new Error('Codex mode requires the desktop app runtime.');
            }
            if (!userId) {
              throw new Error('Missing signed-in user context for desktop provider.');
            }
            return window.desktopAssistant.provider.assistantTurn({
              userIntent,
              chatHistory: historyForTurn,
              capabilities,
              context,
              programRead,
              threadContext,
            }, userId);
          })()
        : (() => {
            const projectSnapshot = buildProjectSnapshot(project);
            return (async () => {
              const desktopCredentials =
                isDesktopRuntime && window.desktopAssistant && providerMode === 'byok' && userId
                  ? await window.desktopAssistant.provider.getCredentials(userId)
                  : undefined;
              const providerCredentials: ProviderCredentials | undefined = desktopCredentials
                ? { openRouterApiKey: desktopCredentials.openRouterApiKey || undefined }
                : undefined;
              return assistantTurnAction({
                userIntent,
                chatHistory: historyForTurn,
                providerMode,
                providerCredentials,
                threadContext,
                capabilities,
                context,
                programRead,
                projectSnapshot,
              });
            })();
          })());
      const turnCompletedAt = new Date().toISOString();
      const turnProviderLabel = providerMode === 'codex_oauth' ? `desktop:${turn.provider}` : `convex:${turn.provider}`;

      if (turn.mode === 'chat') {
        if ((turn as { errorCode?: string }).errorCode === 'credits_exhausted') {
          setErrorMessage('Out of credits. Open Billing to upgrade or manage your plan.');
        }
        const chatAnswer = (turn.answer || '').trim();
        if (!chatAnswer) {
          throw new Error('Assistant returned an empty chat response.');
        }
        await appendChatMessage({
          role: 'assistant',
          content: chatAnswer,
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
        setCandidate(null);
        setStatus('idle');
        return;
      }

      const parsedProposedEdits = validateSemanticOpsPayload(turn.proposedEdits);
      if (!parsedProposedEdits.ok) {
        throw new Error(`Server response validation failed: ${parsedProposedEdits.errors.join('; ')}`);
      }
      const proposedEdits = parsedProposedEdits.value;
      const convexProvider: LLMProvider = {
        name: `convex:${turn.provider}`,
        model: turn.model,
        proposeEdits: async () => proposedEdits,
      };

      const result = await runLlmBlocklyOrchestration({
        project,
        scope,
        userIntent,
        provider: convexProvider,
      });
      setCandidate(result);
      setStatus('ready');
      setAllowComponentPropagation(false);
      const modelLatency = formatDuration(startedAt, turnCompletedAt);
      const compileLatency = formatDuration(result.requestStartedAt, result.requestCompletedAt);
      const intentMismatchWarning = detectIntentMismatchWarning(userIntent, result);
      setCandidateDebugInfo({
        userIntent,
        modelProvider: turn.provider,
        modelName: turn.model,
        modelLatency,
        compileLatency,
        trace: turn.debugTrace ?? null,
        intentMismatchWarning,
      });
      if (!result.validation.pass) {
        setStatusMessage(`Generated a candidate, but validation failed with ${result.validation.errors.length} issue(s).`);
        await appendChatMessage({
          role: 'assistant',
          content: `I proposed edits, but validation failed with ${result.validation.errors.length} issue(s). Review the validation panel before applying.`,
          createdAt: new Date().toISOString(),
          meta: `Provider mode: ${providerMode} · Provider: ${result.providerName}/${result.model} · Latency: ${formatDuration(result.requestStartedAt, result.requestCompletedAt)}`,
        });
      } else if (intentMismatchWarning) {
        setStatusMessage(`Candidate blocked by quality gate: ${intentMismatchWarning}`);
        await appendChatMessage({
          role: 'assistant',
          content: `I generated a candidate, but blocked auto-apply because intent and diff do not match.\n\n${intentMismatchWarning}`,
          createdAt: new Date().toISOString(),
          meta: `Provider mode: ${providerMode} · Provider: ${turnProviderLabel}/${turn.model} · Model latency: ${modelLatency} · Compile/validate: ${compileLatency}`,
        });
      } else {
        setStatusMessage('Candidate is ready to apply.');
        await appendChatMessage({
          role: 'assistant',
          content: `${result.proposedEdits.intentSummary}\n\n${result.build.diff.summaryLines.join('\n')}`,
          createdAt: new Date().toISOString(),
          meta: `Provider mode: ${providerMode} · Provider: ${turnProviderLabel}/${turn.model} · Model latency: ${modelLatency} · Compile/validate: ${compileLatency}`,
        });
      }
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
      setErrorMessage(error instanceof Error ? error.message : 'Failed to run assistant request.');
      await appendAssistantTurn({
        threadId,
        userIntent,
        mode: 'error',
        provider: 'convex',
        model: 'unknown',
        debugTraceJson: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        createdAt: new Date().toISOString(),
      });
    }
  };

  const applyCandidate = () => {
    if (!candidate || !project) return;
    if (candidateDebugInfo?.intentMismatchWarning) {
      setErrorMessage(`Apply blocked: ${candidateDebugInfo.intentMismatchWarning}`);
      return;
    }
    if (!candidate.validation.pass) {
      setErrorMessage('Candidate is not valid yet.');
      return;
    }
    if (propagationRequired && !allowComponentPropagation) {
      setErrorMessage('Confirm component-wide propagation before applying.');
      return;
    }

    const result = applyOrchestratedCandidate({
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

    setStatusMessage(
      `${result.message} Added ${result.createdMessageCount} message(s) and ${result.createdVariableCount} variable(s).`
    );
    setErrorMessage(null);
  };

  const rollback = () => {
    undo();
    setStatusMessage('Undid last change. If the LLM apply was the most recent edit, it has been rolled back.');
  };

  const cancelCandidate = () => {
    setCandidate(null);
    setStatus('idle');
    setStatusMessage('Candidate discarded.');
    setErrorMessage(null);
    setAllowComponentPropagation(false);
    setCandidateDebugInfo(null);
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

  const updateProviderMode = async (nextMode: AssistantProviderMode) => {
    if (!threadId) return;
    if (!isDesktopRuntime && nextMode !== 'managed') {
      setErrorMessage('Web runtime only supports managed mode.');
      return;
    }
    const previousMode = providerMode;
    if (nextMode === 'codex_oauth' && providerStatus && !providerStatus.codexAvailable) {
      setErrorMessage(providerStatus.codexStatusMessage || 'Codex mode is currently unavailable in this runtime.');
      return;
    }
    try {
      setProviderMode(nextMode);
      await setAssistantThreadProviderMode(threadId, nextMode);
      if (isDesktopRuntime && window.desktopAssistant) {
        if (!userId) {
          throw new Error('Missing signed-in user context for desktop provider.');
        }
        const status = await window.desktopAssistant.provider.setMode(nextMode, userId);
        setProviderStatus(mapProviderStatus(status));
        setProviderMode(status.mode);
        await setAssistantThreadProviderMode(threadId, status.mode);
      }
      setErrorMessage(null);
    } catch (error) {
      setProviderMode(previousMode);
      void setAssistantThreadProviderMode(threadId, previousMode);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to switch provider mode.');
    }
  };

  const saveByokSecret = async () => {
    if (!isDesktopRuntime || !window.desktopAssistant) {
      setErrorMessage('Provider secrets can only be configured in the desktop app.');
      return;
    }
    if (!userId) {
      setErrorMessage('Missing signed-in user context for desktop provider.');
      return;
    }
    if (providerMode !== 'byok') {
      setErrorMessage('BYOK secret save is only available in BYOK mode.');
      return;
    }
    if (!providerSecretInput.trim()) {
      setErrorMessage('Enter an OpenRouter key first.');
      return;
    }
    try {
      const status = await window.desktopAssistant.provider.setByokKey(providerSecretInput.trim(), userId);
      setProviderStatus(mapProviderStatus(status));
      setProviderSecretInput('');
      setStatusMessage('Credential saved to OS keychain.');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save credential.');
    }
  };

  const loginCodexProvider = async () => {
    if (!isDesktopRuntime || !window.desktopAssistant) {
      setErrorMessage('Codex login is only available in the desktop app.');
      return;
    }
    if (!userId) {
      setErrorMessage('Missing signed-in user context for desktop provider.');
      return;
    }
    try {
      setStatusMessage('Opening ChatGPT login in browser...');
      const status = await window.desktopAssistant.provider.loginCodex(userId);
      setProviderStatus(mapProviderStatus(status));
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start ChatGPT login.');
    }
  };

  const logoutCodexProvider = async () => {
    if (!isDesktopRuntime || !window.desktopAssistant) {
      setErrorMessage('Codex logout is only available in the desktop app.');
      return;
    }
    if (!userId) {
      setErrorMessage('Missing signed-in user context for desktop provider.');
      return;
    }
    try {
      const status = await window.desktopAssistant.provider.logoutCodex(userId);
      setProviderStatus(mapProviderStatus(status));
      setStatusMessage('Logged out from ChatGPT.');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to log out from ChatGPT.');
    }
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
                <>
                  <option value="byok">BYO key</option>
                  <option value="codex_oauth" disabled={providerStatus?.codexAvailable === false}>
                    Codex / ChatGPT login
                  </option>
                </>
              ) : null}
            </select>
            {isDesktopRuntime && providerMode === 'byok' ? (
              <div className="flex items-center gap-2">
                <input
                  value={providerSecretInput}
                  onChange={(event) => setProviderSecretInput(event.target.value)}
                  placeholder="Paste OpenRouter key"
                  className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
                />
                <Button size="sm" variant="secondary" onClick={() => void saveByokSecret()}>
                  Save
                </Button>
              </div>
            ) : null}
            {isDesktopRuntime && providerMode === 'codex_oauth' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {!providerStatus?.hasCodexToken ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void loginCodexProvider()}
                      disabled={providerStatus?.codexLoginInProgress || providerStatus?.codexAvailable === false}
                    >
                      {providerStatus?.codexLoginInProgress ? 'Waiting for login...' : 'Login with ChatGPT'}
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => void logoutCodexProvider()}>
                      Logout ChatGPT
                    </Button>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Auth: {providerStatus?.codexAuthMethod || 'none'}
                  {providerStatus?.codexEmail ? ` · ${providerStatus.codexEmail}` : ''}
                  {providerStatus?.codexPlanType ? ` · plan: ${providerStatus.codexPlanType}` : ''}
                </div>
                {providerStatus?.codexStatusMessage ? (
                  <div className="text-[11px] text-muted-foreground whitespace-pre-wrap">
                    {providerStatus.codexStatusMessage}
                  </div>
                ) : null}
              </div>
            ) : null}
            {isDesktopRuntime ? (
              <div className="text-[11px] text-muted-foreground">
                BYOK: {providerStatus?.hasByokKey ? 'configured' : 'missing'} · Codex: {providerStatus?.hasCodexToken ? 'configured' : 'missing'}
                {providerMode === 'codex_oauth' && providerStatus && !providerStatus.codexAvailable ? ' · Codex unavailable on this runtime' : ''}
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
            {candidate ? (
              <Button size="sm" variant="secondary" onClick={cancelCandidate}>
                Cancel
              </Button>
            ) : null}
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

          {candidate ? (
            <div className="space-y-2 rounded-md border bg-background p-2 text-xs">
              <div>
                <p className="font-medium">Intent</p>
                <p className="text-muted-foreground">{candidate.proposedEdits.intentSummary}</p>
              </div>

              <div>
                <p className="font-medium">Diff</p>
                <ul className="list-disc pl-4 text-muted-foreground">
                  {candidate.build.diff.summaryLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>

              <div className="text-muted-foreground">
                Provider: convex:{candidateDebugInfo?.modelProvider || candidate.providerName}/{candidateDebugInfo?.modelName || candidate.model}
                {' '}· Model latency: {candidateDebugInfo?.modelLatency || '-'}
                {' '}· Compile/validate: {candidateDebugInfo?.compileLatency || formatDuration(candidate.requestStartedAt, candidate.requestCompletedAt)}
              </div>

              {candidateDebugInfo?.intentMismatchWarning ? (
                <p className="text-amber-600">
                  Intent mismatch blocked apply: {candidateDebugInfo.intentMismatchWarning}
                </p>
              ) : null}

              <div>
                <p className="font-medium">Validation</p>
                <p className={candidate.validation.pass ? 'text-emerald-600' : 'text-red-600'}>
                  {candidate.validation.pass ? 'Pass' : `Failed (${validationErrors.length} errors)`}
                </p>
                {validationErrors.length > 0 ? (
                  <ul className="list-disc pl-4 text-red-600">
                    {validationErrors.slice(0, 6).map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                ) : null}
                {validationWarnings.length > 0 ? (
                  <ul className="list-disc pl-4 text-amber-600">
                    {validationWarnings.slice(0, 4).map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {propagationRequired ? (
                <label className="flex items-start gap-2 text-amber-700">
                  <input
                    type="checkbox"
                    checked={allowComponentPropagation}
                    onChange={(event) => setAllowComponentPropagation(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>This object is a component instance. Apply will update all instances of that component.</span>
                </label>
              ) : null}

              <Button
                size="sm"
                onClick={applyCandidate}
                disabled={!canApply || managedCreditsBlocked || (propagationRequired && !allowComponentPropagation)}
              >
                Apply
              </Button>

              <details className="rounded border p-2 bg-muted/30">
                <summary className="cursor-pointer font-medium">Debug Trace</summary>
                <div className="mt-2 space-y-2">
                  <div className="text-muted-foreground">User intent: {candidateDebugInfo?.userIntent || '(unknown)'}</div>
                  <div>
                    <p className="font-medium">Semantic ops</p>
                    <pre className="max-h-44 overflow-auto rounded bg-background p-2 text-[11px]">
                      {JSON.stringify(candidate.proposedEdits.semanticOps, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="font-medium">Assistant turn trace</p>
                    <pre className="max-h-64 overflow-auto rounded bg-background p-2 text-[11px]">
                      {JSON.stringify(candidateDebugInfo?.trace ?? null, null, 2)}
                    </pre>
                  </div>
                </div>
              </details>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
