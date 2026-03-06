import { runLlmBlocklyOrchestration } from '@/lib/llm/orchestrator';
import { previewProjectOps, type ProjectOpsPreviewResult } from '@/lib/llm/projectOps';
import { validateSemanticOpsPayload } from '@/lib/llm/semanticOps';
import type { BlocklyEditScope, OrchestratedCandidate, ProposedEdits } from '@/lib/llm/types';
import type { Project } from '@/types';

export type ManagedAssistantTurn = {
  provider: string;
  model: string;
  mode: 'chat' | 'edit';
  answer?: string;
  errorCode?: string;
  proposedEdits?: unknown;
  debugTrace?: unknown;
};

export type ManagedRepairAttempt = {
  attempt: number;
  issues: string[];
  repairHints: string[];
  proposedEdits: ProposedEdits | null;
};

export type ManagedRepairLoopResult =
  | {
      kind: 'chat';
      turn: ManagedAssistantTurn;
      attemptCount: number;
      attempts: ManagedRepairAttempt[];
    }
  | {
      kind: 'edit';
      turn: ManagedAssistantTurn;
      proposedEdits: ProposedEdits;
      orchestrated: OrchestratedCandidate | null;
      projectPreview: ProjectOpsPreviewResult;
      attemptCount: number;
      attempts: ManagedRepairAttempt[];
    }
  | {
      kind: 'failed';
      turn: ManagedAssistantTurn | null;
      attemptCount: number;
      attempts: ManagedRepairAttempt[];
      message: string;
    };

function truncate(value: string, maxLength = 1200): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function summarizeProposedEdits(proposedEdits: ProposedEdits | null): string {
  if (!proposedEdits) return 'No valid structured edits were produced.';
  const semanticSummary = proposedEdits.semanticOps.length > 0
    ? `semanticOps: ${proposedEdits.semanticOps.map((op) => op.op).join(', ')}`
    : 'semanticOps: none';
  const projectSummary = proposedEdits.projectOps.length > 0
    ? `projectOps: ${proposedEdits.projectOps.map((op) => op.op).join(', ')}`
    : 'projectOps: none';
  return `${semanticSummary}; ${projectSummary}`;
}

function buildRepairUserIntent(args: {
  userIntent: string;
  previousAttempt: ManagedRepairAttempt | null;
}): string {
  const { userIntent, previousAttempt } = args;
  if (!previousAttempt) return userIntent;

  const issueLines = previousAttempt.issues.slice(0, 8).map((issue) => `- ${issue}`);
  const repairHintLines = previousAttempt.repairHints.slice(0, 6).map((hint) => `- ${hint}`);

  const sections = [
    userIntent,
    '',
    'Repair feedback from the previous invalid attempt:',
    ...issueLines,
    repairHintLines.length > 0 ? '' : null,
    ...(repairHintLines.length > 0 ? ['Repair hints:', ...repairHintLines] : []),
    '',
    `Previous edit summary: ${summarizeProposedEdits(previousAttempt.proposedEdits)}`,
    'Return corrected executable edits that satisfy the validation feedback.',
  ].filter((value): value is string => typeof value === 'string');

  return truncate(sections.join('\n'));
}

function buildFailureMessage(attempts: ManagedRepairAttempt[]): string {
  if (attempts.length === 0) {
    return 'Assistant request failed before any repair attempt could complete.';
  }
  const lastAttempt = attempts[attempts.length - 1];
  const issueSummary = lastAttempt.issues.slice(0, 6).join('; ');
  const hintSummary = lastAttempt.repairHints.slice(0, 4).join('; ');
  const lines = [
    `Assistant could not produce a valid edit plan after ${attempts.length} attempt(s).`,
    issueSummary ? `Latest issues: ${issueSummary}` : null,
    hintSummary ? `Repair hints: ${hintSummary}` : null,
  ].filter((value): value is string => typeof value === 'string');
  return lines.join('\n\n');
}

export async function runManagedAssistantRepairLoop(args: {
  project: Project;
  scope: BlocklyEditScope | null;
  userIntent: string;
  requestTurn: (args: { effectiveUserIntent: string; attempt: number }) => Promise<ManagedAssistantTurn>;
  maxAttempts?: number;
}): Promise<ManagedRepairLoopResult> {
  const maxAttempts = Math.max(1, Math.min(args.maxAttempts ?? 4, 6));
  const attempts: ManagedRepairAttempt[] = [];
  let lastTurn: ManagedAssistantTurn | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const previousAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
    const effectiveUserIntent = buildRepairUserIntent({
      userIntent: args.userIntent,
      previousAttempt,
    });
    const turn = await args.requestTurn({ effectiveUserIntent, attempt });
    lastTurn = turn;

    if (turn.mode === 'chat') {
      return {
        kind: 'chat',
        turn,
        attemptCount: attempt,
        attempts,
      };
    }

    const parsed = validateSemanticOpsPayload(turn.proposedEdits);
    if (!parsed.ok) {
      attempts.push({
        attempt,
        issues: parsed.errors,
        repairHints: [
          'Return a valid structured payload with semanticOps and projectOps arrays.',
          'Use only supported op names and concrete required fields.',
        ],
        proposedEdits: null,
      });
      continue;
    }

    const proposedEdits = parsed.value;
    let orchestrated: OrchestratedCandidate | null = null;
    const semanticIssues: string[] = [];
    const semanticRepairHints: string[] = [];
    if (proposedEdits.semanticOps.length > 0) {
      if (!args.scope) {
        semanticIssues.push('Blockly edits require an object or component to be selected.');
        semanticRepairHints.push('Select an object or component before asking for Blockly code changes.');
      } else {
        const staticProvider = {
          name: `convex:${turn.provider}`,
          model: turn.model,
          proposeEdits: async () => proposedEdits,
        };
        orchestrated = await runLlmBlocklyOrchestration({
          project: args.project,
          scope: args.scope,
          userIntent: args.userIntent,
          provider: staticProvider,
        });
      }
    }
    const projectPreview = await previewProjectOps({
      project: args.project,
      projectOps: proposedEdits.projectOps,
    });

    const issues = [
      ...semanticIssues,
      ...(orchestrated ? orchestrated.validation.errors : []),
      ...projectPreview.errors,
      ...projectPreview.validationIssueSample.map((issue) => `[Project validation] ${issue}`),
    ];
    const repairHints = [
      ...semanticRepairHints,
      ...(orchestrated ? orchestrated.validation.repairHints : []),
      ...(projectPreview.errors.length > 0
        ? ['Use concrete scene/object/costume references that resolve in the current project state.']
        : []),
      ...(projectPreview.validationIssueCount > 0
        ? ['Return project edits that keep the project playable under pre-play validation.']
        : []),
    ];

    if (issues.length === 0) {
      return {
        kind: 'edit',
        turn,
        proposedEdits,
        orchestrated,
        projectPreview,
        attemptCount: attempt,
        attempts,
      };
    }

    attempts.push({
      attempt,
      issues,
      repairHints: Array.from(new Set(repairHints)),
      proposedEdits,
    });
  }

  return {
    kind: 'failed',
    turn: lastTurn,
    attemptCount: attempts.length,
    attempts,
    message: buildFailureMessage(attempts),
  };
}
