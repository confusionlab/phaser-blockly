import type { ProposedEdits } from '@/lib/llm/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stringifyPreview(value: unknown, maxChars: number): string {
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    return truncateText(normalizeWhitespace(raw || ''), maxChars);
  } catch {
    return '';
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function buildAgentActivityLines(trace: unknown): string[] {
  if (!isRecord(trace)) return [];

  const lines: string[] = ['Agent activity:'];
  const modelRounds = typeof trace.modelRounds === 'number' ? trace.modelRounds : null;
  const maxToolRounds = typeof trace.maxToolRounds === 'number' ? trace.maxToolRounds : null;
  const finalVerdict = typeof trace.finalVerdict === 'string' ? trace.finalVerdict : null;
  const transport = typeof trace.transport === 'string' ? trace.transport : null;
  const fallbackReason = typeof trace.fallbackReason === 'string'
    ? trace.fallbackReason
    : (typeof trace.fallbackReasonCode === 'string' ? trace.fallbackReasonCode : null);

  if (modelRounds !== null) lines.push(`- Model rounds: ${modelRounds}`);
  if (maxToolRounds !== null) lines.push(`- Max tool rounds: ${maxToolRounds}`);
  if (finalVerdict) lines.push(`- Final verdict: ${finalVerdict}`);
  if (transport) lines.push(`- Transport: ${transport}`);
  if (fallbackReason) lines.push(`- Fallback reason: ${fallbackReason}`);

  const toolCallsRaw = Array.isArray(trace.toolCalls) ? trace.toolCalls : [];
  const toolCalls = toolCallsRaw.filter(isRecord);
  if (toolCalls.length > 0) {
    lines.push(`- Tool calls (${toolCalls.length}):`);
    const maxShown = 6;
    for (let index = 0; index < Math.min(toolCalls.length, maxShown); index += 1) {
      const call = toolCalls[index];
      const name = typeof call.name === 'string' && call.name.trim().length > 0 ? call.name : 'unknown_tool';
      const round = typeof call.round === 'number' ? `round ${call.round}` : `step ${index + 1}`;
      const argsPreview = stringifyPreview(call.args, 180);
      const resultPreview = stringifyPreview(call.resultPreview, 220);
      lines.push(`  ${index + 1}. [${round}] ${name}${argsPreview ? ` args=${argsPreview}` : ''}`);
      if (resultPreview) {
        lines.push(`     -> ${resultPreview}`);
      }
    }
    if (toolCalls.length > maxShown) {
      lines.push(`  ... ${toolCalls.length - maxShown} more tool call(s)`);
    }
  } else {
    lines.push('- Tool calls: none');
  }

  const validationErrors = readStringArray(trace.validationErrors);
  if (validationErrors.length > 0) {
    lines.push('- Validation notes:');
    validationErrors.slice(0, 4).forEach((entry) => lines.push(`  - ${entry}`));
    if (validationErrors.length > 4) {
      lines.push(`  - ... ${validationErrors.length - 4} more`);
    }
  }

  const finalResponsePreview = typeof trace.finalResponsePreview === 'string'
    ? normalizeWhitespace(trace.finalResponsePreview)
    : '';
  if (finalResponsePreview) {
    lines.push('- Raw model output preview:');
    lines.push(`  ${truncateText(finalResponsePreview, 420)}`);
  }

  return lines;
}

export function buildModelEditOverviewLines(proposedEdits: ProposedEdits): string[] {
  const lines: string[] = [`Model intent: ${proposedEdits.intentSummary}`];

  if (proposedEdits.assumptions.length > 0) {
    lines.push('Model assumptions:');
    proposedEdits.assumptions.slice(0, 6).forEach((item) => lines.push(`- ${item}`));
    if (proposedEdits.assumptions.length > 6) {
      lines.push(`- ... ${proposedEdits.assumptions.length - 6} more`);
    }
  }

  if (proposedEdits.semanticOps.length > 0) {
    lines.push(`Model semantic ops (${proposedEdits.semanticOps.length}): ${proposedEdits.semanticOps.map((op) => op.op).join(', ')}`);
  }
  if (proposedEdits.projectOps.length > 0) {
    lines.push(`Model project ops (${proposedEdits.projectOps.length}): ${proposedEdits.projectOps.map((op) => op.op).join(', ')}`);
  }

  return lines;
}
