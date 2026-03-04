import { useMemo, useState } from 'react';
import { Bot, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAction } from 'convex/react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { api } from '../../../convex/_generated/api';
import {
  applyOrchestratedCandidate,
  runLlmBlocklyOrchestration,
  validateSemanticOpsPayload,
} from '@/lib/llm';
import type { BlocklyEditScope, LLMProvider, OrchestratedCandidate } from '@/lib/llm';

type BlocklyAssistantPanelProps = {
  scope: BlocklyEditScope | null;
};

type RequestState = 'idle' | 'loading' | 'ready' | 'error';

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

  const { project, addMessage, addGlobalVariable, addLocalVariable, updateObject, updateComponent } = useProjectStore();
  const { undo } = useEditorStore();
  const proposeEditsAction = useAction(api.llm.proposeEdits);

  const canApply = !!candidate && candidate.validation.pass;
  const validationErrors = candidate?.validation.errors || [];
  const validationWarnings = candidate?.validation.warnings || [];

  const propagationRequired = useMemo(
    () => !!candidate?.context.isComponentInstanceSelection,
    [candidate?.context.isComponentInstanceSelection],
  );

  const runProposal = async () => {
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
      setErrorMessage('Enter an instruction first.');
      return;
    }

    setStatus('loading');
    setErrorMessage(null);
    setStatusMessage(null);
    setAllowComponentPropagation(false);

    try {
      const convexProvider: LLMProvider = {
        name: 'convex:openrouter',
        model: 'server-managed',
        proposeEdits: async (providerArgs) => {
          const response = await proposeEditsAction({
            userIntent: providerArgs.userIntent,
            capabilities: providerArgs.capabilities,
            context: providerArgs.context,
            programRead: providerArgs.programRead,
          });
          convexProvider.name = `convex:${response.provider}`;
          convexProvider.model = response.model;
          const parsed = validateSemanticOpsPayload(response.proposedEdits);
          if (!parsed.ok) {
            throw new Error(`Server response validation failed: ${parsed.errors.join('; ')}`);
          }
          return parsed.value;
        },
      };

      const result = await runLlmBlocklyOrchestration({
        project,
        scope,
        userIntent: prompt.trim(),
        provider: convexProvider,
      });
      setCandidate(result);
      setStatus('ready');
      if (!result.validation.pass) {
        setStatusMessage(`Generated a candidate, but validation failed with ${result.validation.errors.length} issue(s).`);
      } else {
        setStatusMessage('Candidate is ready to apply.');
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

          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder='e.g. "When game starts, move right 10 and play jump sound"'
            className="w-full h-24 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => void runProposal()}
              disabled={status === 'loading' || !scope || !project}
            >
              {status === 'loading' ? <Loader2 className="size-4 animate-spin" /> : null}
              {candidate ? 'Regenerate' : 'Propose'}
            </Button>
            {candidate ? (
              <Button size="sm" variant="secondary" onClick={cancelCandidate}>
                Cancel
              </Button>
            ) : null}
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
