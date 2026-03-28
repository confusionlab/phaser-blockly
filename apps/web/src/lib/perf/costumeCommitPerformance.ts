import type { CostumeEditorMode } from '@/types';

export type CostumeCommitPerfPhase =
  | 'historySnapshotMs'
  | 'historyDispatchMs'
  | 'handleHistoryChangeMs'
  | 'stateStoreSyncMs'
  | 'previewRenderMs'
  | 'previewStoreSyncMs';

export interface CostumeCommitPerfRecord {
  id: string;
  sessionKey: string | null;
  mode: CostumeEditorMode;
  source: string;
  startedAtMs: number;
  stateReadyAtMs: number | null;
  previewReadyAtMs: number | null;
  completedAtMs: number | null;
  phases: Partial<Record<CostumeCommitPerfPhase, number>>;
}

interface CostumeCommitPerfStore {
  activeTraceId: string | null;
  records: CostumeCommitPerfRecord[];
}

type PerfWindow = Window & typeof globalThis & {
  __POCHA_COSTUME_COMMIT_PERF_ENABLED__?: boolean;
  __POCHA_COSTUME_COMMIT_PERF__?: CostumeCommitPerfStore;
};

const MAX_RECORDS = 400;

function getPerfWindow(): PerfWindow | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window as PerfWindow;
}

function getPerfStore(): CostumeCommitPerfStore | null {
  const runtimeWindow = getPerfWindow();
  if (!runtimeWindow?.__POCHA_COSTUME_COMMIT_PERF_ENABLED__) {
    return null;
  }

  runtimeWindow.__POCHA_COSTUME_COMMIT_PERF__ ??= {
    activeTraceId: null,
    records: [],
  };
  return runtimeWindow.__POCHA_COSTUME_COMMIT_PERF__;
}

function findRecord(store: CostumeCommitPerfStore, traceId: string): CostumeCommitPerfRecord | null {
  return store.records.find((record) => record.id === traceId) ?? null;
}

function trimRecords(store: CostumeCommitPerfStore): void {
  if (store.records.length <= MAX_RECORDS) {
    return;
  }
  store.records.splice(0, store.records.length - MAX_RECORDS);
}

export function beginCostumeCommitPerfTrace(input: {
  sessionKey: string | null;
  mode: CostumeEditorMode;
  source: string;
}, startedAtMs: number = performance.now()): string | null {
  const store = getPerfStore();
  if (!store) {
    return null;
  }

  const traceId = crypto.randomUUID();
  store.records.push({
    id: traceId,
    sessionKey: input.sessionKey,
    mode: input.mode,
    source: input.source,
    startedAtMs,
    stateReadyAtMs: null,
    previewReadyAtMs: null,
    completedAtMs: null,
    phases: {},
  });
  trimRecords(store);
  return traceId;
}

export function setActiveCostumeCommitPerfTrace(traceId: string | null): void {
  const store = getPerfStore();
  if (!store) {
    return;
  }
  store.activeTraceId = traceId;
}

export function consumeActiveCostumeCommitPerfTrace(): string | null {
  const store = getPerfStore();
  if (!store) {
    return null;
  }

  const traceId = store.activeTraceId;
  store.activeTraceId = null;
  return traceId;
}

export function recordCostumeCommitPerfPhase(
  traceId: string | null | undefined,
  phase: CostumeCommitPerfPhase,
  durationMs: number,
): void {
  if (!traceId) {
    return;
  }

  const store = getPerfStore();
  if (!store) {
    return;
  }

  const record = findRecord(store, traceId);
  if (!record) {
    return;
  }

  record.phases[phase] = (record.phases[phase] ?? 0) + durationMs;
}

export function markCostumeCommitPerfStateReady(traceId: string | null | undefined): void {
  if (!traceId) {
    return;
  }

  const store = getPerfStore();
  if (!store) {
    return;
  }

  const record = findRecord(store, traceId);
  if (!record || record.stateReadyAtMs !== null) {
    return;
  }

  record.stateReadyAtMs = performance.now();
}

export function markCostumeCommitPerfPreviewReady(traceId: string | null | undefined): void {
  if (!traceId) {
    return;
  }

  const store = getPerfStore();
  if (!store) {
    return;
  }

  const record = findRecord(store, traceId);
  if (!record) {
    return;
  }

  const now = performance.now();
  if (record.stateReadyAtMs === null) {
    record.stateReadyAtMs = now;
  }
  record.previewReadyAtMs = now;
  record.completedAtMs = now;
}

export function clearCostumeCommitPerfRecords(): void {
  const store = getPerfStore();
  if (!store) {
    return;
  }

  store.activeTraceId = null;
  store.records = [];
}

export function getCostumeCommitPerfRecords(): CostumeCommitPerfRecord[] {
  const store = getPerfStore();
  if (!store) {
    return [];
  }

  return store.records.map((record) => ({
    ...record,
    phases: { ...record.phases },
  }));
}
