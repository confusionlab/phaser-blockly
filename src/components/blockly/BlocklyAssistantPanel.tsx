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

const CHAT_HISTORY_VERSION = 1;
const MAX_CHAT_MESSAGES = 50;

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

export function BlocklyAssistantPanel({ scope }: BlocklyAssistantPanelProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<RequestState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<OrchestratedCandidate | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [allowComponentPropagation, setAllowComponentPropagation] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

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
      const turn = await assistantTurnAction({
        userIntent,
        chatHistory: chatMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        capabilities,
        context,
        programRead,
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
        setStatusMessage('Candidate is ready to apply.');
        appendChatMessage({
          id: makeMessageId(),
          role: 'assistant',
          content: `${result.proposedEdits.intentSummary}\n\n${result.build.diff.summaryLines.join('\n')}`,
          createdAt: new Date().toISOString(),
          meta: `Provider: ${result.providerName}/${result.model} · Latency: ${formatDuration(result.requestStartedAt, result.requestCompletedAt)}`,
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
                Provider: {candidate.providerName}/{candidate.model} · Latency:{' '}
                {formatDuration(candidate.requestStartedAt, candidate.requestCompletedAt)}
              </div>

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
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
