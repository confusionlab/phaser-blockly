import { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAction } from 'convex/react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { api } from '../../../convex/_generated/api';
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

const CHAT_HISTORY_VERSION = 1;
const MAX_CHAT_MESSAGES = 50;

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

function makeMessageId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
  return null;
}

export function BlocklyAssistantPanel({ scope }: BlocklyAssistantPanelProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<RequestState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<OrchestratedCandidate | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [allowComponentPropagation, setAllowComponentPropagation] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [candidateDebugInfo, setCandidateDebugInfo] = useState<CandidateDebugInfo | null>(null);

  const { project, addMessage, addGlobalVariable, addLocalVariable, updateObject, updateComponent } = useProjectStore();
  const { undo } = useEditorStore();
  const assistantTurnAction = useAction(api.llm.assistantTurn);

  const canApply = !!candidate && candidate.validation.pass;
  const validationErrors = candidate?.validation.errors || [];
  const validationWarnings = candidate?.validation.warnings || [];

  const propagationRequired = useMemo(
    () => !!candidate?.context.isComponentInstanceSelection,
    [candidate?.context.isComponentInstanceSelection],
  );
  const chatStorageKey = useMemo(() => {
    if (!project) return null;
    const scopeKey = getScopeStorageKey(scope);
    if (!scopeKey) return null;
    return `pochacoding:blockly-assistant-chat:v${CHAT_HISTORY_VERSION}:${project.id}:${scopeKey}`;
  }, [project, scope]);

  useEffect(() => {
    if (!chatStorageKey || typeof window === 'undefined') {
      setChatMessages([]);
      return;
    }

    const raw = window.sessionStorage.getItem(chatStorageKey);
    if (!raw) {
      setChatMessages([]);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { messages?: unknown };
      if (!Array.isArray(parsed.messages)) {
        setChatMessages([]);
        return;
      }
      const safeMessages = parsed.messages
        .filter((msg): msg is ChatMessage => {
          return (
            typeof msg === 'object' &&
            msg !== null &&
            'id' in msg &&
            'role' in msg &&
            'content' in msg &&
            'createdAt' in msg &&
            typeof (msg as ChatMessage).id === 'string' &&
            ((msg as ChatMessage).role === 'user' || (msg as ChatMessage).role === 'assistant') &&
            typeof (msg as ChatMessage).content === 'string' &&
            typeof (msg as ChatMessage).createdAt === 'string'
          );
        })
        .slice(-MAX_CHAT_MESSAGES);
      setChatMessages(safeMessages);
    } catch {
      setChatMessages([]);
    }
  }, [chatStorageKey]);

  useEffect(() => {
    if (!chatStorageKey || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(chatStorageKey, JSON.stringify({ version: CHAT_HISTORY_VERSION, messages: chatMessages }));
    } catch {
      // Ignore storage write failures.
    }
  }, [chatMessages, chatStorageKey]);

  const appendChatMessage = (message: ChatMessage) => {
    setChatMessages((prev) => [...prev, message].slice(-MAX_CHAT_MESSAGES));
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

    setStatus('loading');
    setErrorMessage(null);
    setStatusMessage(null);
    const userIntent = prompt.trim();
    const startedAt = new Date().toISOString();
    appendChatMessage({
      id: makeMessageId(),
      role: 'user',
      content: userIntent,
      createdAt: new Date().toISOString(),
    });
    setPrompt('');

    try {
      const capabilities = getLlmExposedBlocklyCapabilities();
      const context = buildProgramContext(project, scope);
      const programRead = readProgramSummary(context);
      const projectSnapshot = buildProjectSnapshot(project);
      const turn = await assistantTurnAction({
        userIntent,
        chatHistory: chatMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        capabilities,
        context,
        programRead,
        projectSnapshot,
      });
      const turnCompletedAt = new Date().toISOString();

      if (turn.mode === 'chat') {
        const chatAnswer = (turn.answer || '').trim();
        if (!chatAnswer) {
          throw new Error('Assistant returned an empty chat response.');
        }
        appendChatMessage({
          id: makeMessageId(),
          role: 'assistant',
          content: chatAnswer,
          createdAt: turnCompletedAt,
          meta: `Provider: convex:${turn.provider}/${turn.model} · Latency: ${formatDuration(startedAt, turnCompletedAt)}`,
        });
        setCandidateDebugInfo(null);
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
        appendChatMessage({
          id: makeMessageId(),
          role: 'assistant',
          content: `I proposed edits, but validation failed with ${result.validation.errors.length} issue(s). Review the validation panel before applying.`,
          createdAt: new Date().toISOString(),
          meta: `Provider: ${result.providerName}/${result.model} · Latency: ${formatDuration(result.requestStartedAt, result.requestCompletedAt)}`,
        });
      } else {
        setStatusMessage(intentMismatchWarning ? `Candidate is ready to apply. Warning: ${intentMismatchWarning}` : 'Candidate is ready to apply.');
        appendChatMessage({
          id: makeMessageId(),
          role: 'assistant',
          content: `${result.proposedEdits.intentSummary}\n\n${result.build.diff.summaryLines.join('\n')}`,
          createdAt: new Date().toISOString(),
          meta: `Provider: convex:${turn.provider}/${turn.model} · Model latency: ${modelLatency} · Compile/validate: ${compileLatency}`,
        });
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to run assistant request.');
    }
  };

  const applyCandidate = () => {
    if (!candidate || !project) return;
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
    setChatMessages([]);
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

          <div className="h-44 overflow-y-auto rounded-md border bg-background p-2 space-y-2">
            {chatMessages.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Ask questions about blocks or request edits. This chat is persisted for this browser session.
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
              disabled={status === 'loading' || !scope || !project}
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
                  Intent mismatch warning: {candidateDebugInfo.intentMismatchWarning}
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
                disabled={!canApply || (propagationRequired && !allowComponentPropagation)}
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
