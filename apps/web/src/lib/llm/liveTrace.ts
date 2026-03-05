type TraceEntrySource = 'local' | 'provider' | 'debug-trace';

export type AssistantTraceEntry = {
  id: string;
  sequence: number;
  timestamp: string;
  phase: string;
  message: string;
  detail?: string | null;
  source: TraceEntrySource;
};

type ProviderTurnEventLike = {
  type?: string;
  threadId?: string | null;
  turnId?: string | null;
  sequence?: number;
  timestamp?: string | null;
  phase?: string | null;
  message?: string | null;
  detail?: string | null;
};

type RenderTraceOptions = {
  finalBody?: string | null;
  finalLabel?: string;
  runningLabel?: string | null;
};

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanMultiline(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => truncateText(line, 240))
    .join('\n');
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = cleanMultiline(value);
  return normalized.length > 0 ? normalized : null;
}

function previewValue(value: unknown, maxChars: number): string | null {
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    const normalized = normalizeWhitespace(raw || '');
    return normalized.length > 0 ? truncateText(normalized, maxChars) : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function formatClock(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '--:--:--';
  return parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function makeEntryId(prefix: string, sequence: number): string {
  return `${prefix}_${sequence}`;
}

function makeDetailLines(detail: string): string[] {
  return detail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `   ${line}`);
}

function makeDebugTraceEntries(trace: unknown, startSequence: number): AssistantTraceEntry[] {
  if (!isRecord(trace)) return [];

  const entries: AssistantTraceEntry[] = [];
  let sequence = startSequence;
  const push = (phase: string, message: string, detail?: string | null) => {
    const cleanedMessage = cleanText(message);
    if (!cleanedMessage) return;
    const cleanedDetail = cleanText(detail ?? null);
    sequence += 1;
    entries.push({
      id: makeEntryId(`debug_${phase}`, sequence),
      sequence,
      timestamp: new Date().toISOString(),
      phase,
      message: cleanedMessage,
      detail: cleanedDetail,
      source: 'debug-trace',
    });
  };

  const transport = cleanText(trace.transport);
  if (transport) {
    push('transport', `Transport: ${transport}`);
  }

  const modelRounds = typeof trace.modelRounds === 'number' ? trace.modelRounds : null;
  if (modelRounds !== null) {
    push('model', `Model rounds: ${modelRounds}`);
  }

  const maxToolRounds = typeof trace.maxToolRounds === 'number' ? trace.maxToolRounds : null;
  if (maxToolRounds !== null) {
    push('model', `Max tool rounds: ${maxToolRounds}`);
  }

  const toolCalls = Array.isArray(trace.toolCalls) ? trace.toolCalls.filter(isRecord) : [];
  toolCalls.forEach((call, index) => {
    const name = cleanText(call.name) || 'unknown_tool';
    const round = typeof call.round === 'number' ? `round ${call.round}` : `step ${index + 1}`;
    const argsPreview = previewValue(call.args, 220);
    const resultPreview = previewValue(call.resultPreview, 260);
    push(
      'tool',
      `Tool call [${round}] ${name}${argsPreview ? ` args=${argsPreview}` : ''}`,
      resultPreview ? `result=${resultPreview}` : null,
    );
  });

  readStringArray(trace.validationErrors).forEach((entry) => {
    push('validation', `Validation: ${entry}`);
  });

  const fallbackReason = cleanText(
    typeof trace.fallbackReason === 'string'
      ? trace.fallbackReason
      : (typeof trace.fallbackReasonCode === 'string' ? trace.fallbackReasonCode : null),
  );
  if (fallbackReason) {
    push('fallback', `Fallback reason: ${fallbackReason}`);
  }

  const finalVerdict = cleanText(trace.finalVerdict);
  if (finalVerdict) {
    push('result', `Final verdict: ${finalVerdict}`);
  }

  const finalPreview = cleanText(trace.finalResponsePreview);
  if (finalPreview) {
    push('result', 'Raw model output preview', finalPreview);
  }

  return entries;
}

export function renderTraceTranscript(entries: AssistantTraceEntry[], options: RenderTraceOptions = {}): string {
  const lines: string[] = ['Agent trace'];

  for (const entry of [...entries].sort((left, right) => left.sequence - right.sequence)) {
    lines.push(`${entry.sequence}. [${formatClock(entry.timestamp)}] ${entry.message}`);
    if (entry.detail) {
      lines.push(...makeDetailLines(entry.detail));
    }
  }

  if (!options.finalBody && options.runningLabel) {
    lines.push('', options.runningLabel);
  }

  const finalBody = cleanText(options.finalBody ?? null);
  if (finalBody) {
    lines.push('', options.finalLabel || 'Assistant response', finalBody);
  }

  return lines.join('\n');
}

export function createTraceRecorder() {
  let sequence = 0;
  let entries: AssistantTraceEntry[] = [];

  const appendEntries = (nextEntries: AssistantTraceEntry[]): AssistantTraceEntry[] => {
    const added: AssistantTraceEntry[] = [];
    for (const entry of nextEntries) {
      const duplicate = entries.some((existing) => existing.id === entry.id);
      if (duplicate) continue;
      entries = [...entries, entry];
      sequence = Math.max(sequence, entry.sequence);
      added.push(entry);
    }
    return added;
  };

  return {
    getEntries(): AssistantTraceEntry[] {
      return [...entries];
    },
    push(message: string, options: { detail?: string | null; phase?: string; source?: TraceEntrySource; timestamp?: string } = {}) {
      const cleanedMessage = cleanText(message);
      if (!cleanedMessage) return null;
      sequence += 1;
      const entry: AssistantTraceEntry = {
        id: makeEntryId(options.phase || 'trace', sequence),
        sequence,
        timestamp: options.timestamp || new Date().toISOString(),
        phase: options.phase || 'progress',
        message: cleanedMessage,
        detail: cleanText(options.detail ?? null),
        source: options.source || 'local',
      };
      appendEntries([entry]);
      return entry;
    },
    pushProviderEvent(event: ProviderTurnEventLike, activeThreadId?: string | null) {
      if (!event || typeof event.type !== 'string' || !event.type.startsWith('assistant-turn-')) {
        return null;
      }
      if (activeThreadId && event.threadId && event.threadId !== activeThreadId) {
        return null;
      }
      const message = cleanText(event.message);
      if (!message) return null;
      const nextSequence = sequence + 1;
      const entry: AssistantTraceEntry = {
        id: makeEntryId(event.turnId || event.type, nextSequence),
        sequence: nextSequence,
        timestamp: cleanText(event.timestamp) || new Date().toISOString(),
        phase: cleanText(event.phase) || event.type,
        message,
        detail: cleanText(event.detail ?? null),
        source: 'provider',
      };
      const [added] = appendEntries([entry]);
      return added || null;
    },
    pushDebugTrace(trace: unknown) {
      return appendEntries(makeDebugTraceEntries(trace, sequence));
    },
    render(options: RenderTraceOptions = {}) {
      return renderTraceTranscript(entries, options);
    },
  };
}
