import type { Project } from '@/types';

export type SelectionSnapshot = {
  selectedSceneId: string | null;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
};

type HistoryEntry = {
  project: Project | null;
  selection: SelectionSnapshot;
  projectStamp: number | null;
  selectionStamp: string;
};

type ProjectGetter = () => Project | null;
type ProjectApplier = (project: Project | null) => void;
type SelectionGetter = () => SelectionSnapshot;
type SelectionApplier = (selection: SelectionSnapshot) => void;

type RecordOptions = {
  source: string;
  allowMerge?: boolean;
  mergeWindowMs?: number;
};

const HISTORY_LIMIT = 200;
const DEFAULT_MERGE_WINDOW_MS = 300;

const state: {
  projectGetter: ProjectGetter | null;
  projectApplier: ProjectApplier | null;
  selectionGetter: SelectionGetter | null;
  selectionApplier: SelectionApplier | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastKnown: HistoryEntry | null;
  lastCommitSource: string | null;
  lastCommitAt: number;
  isApplyingHistory: boolean;
  transactionDepth: number;
  transactionStart: HistoryEntry | null;
  transactionSource: string | null;
} = {
  projectGetter: null,
  projectApplier: null,
  selectionGetter: null,
  selectionApplier: null,
  past: [],
  future: [],
  lastKnown: null,
  lastCommitSource: null,
  lastCommitAt: 0,
  isApplyingHistory: false,
  transactionDepth: 0,
  transactionStart: null,
  transactionSource: null,
};

function cloneProject(project: Project | null): Project | null {
  if (!project) return null;
  return structuredClone(project);
}

function cloneSelection(selection: SelectionSnapshot): SelectionSnapshot {
  return {
    selectedSceneId: selection.selectedSceneId,
    selectedObjectId: selection.selectedObjectId,
    selectedObjectIds: [...selection.selectedObjectIds],
  };
}

function getProjectStamp(project: Project | null): number | null {
  if (!project) return null;
  return project.updatedAt instanceof Date ? project.updatedAt.getTime() : null;
}

function getSelectionStamp(selection: SelectionSnapshot): string {
  return [
    selection.selectedSceneId ?? '',
    selection.selectedObjectId ?? '',
    selection.selectedObjectIds.join(','),
  ].join('|');
}

function captureEntry(): HistoryEntry | null {
  if (!state.projectGetter || !state.selectionGetter) return null;

  const project = state.projectGetter();
  const selection = state.selectionGetter();
  const clonedSelection = cloneSelection(selection);

  return {
    // Project store updates are immutable, so keeping snapshot references here is safe and
    // avoids deep-cloning the full project on every single history record.
    project,
    selection: clonedSelection,
    projectStamp: getProjectStamp(project),
    selectionStamp: getSelectionStamp(clonedSelection),
  };
}

function entriesEqual(a: HistoryEntry, b: HistoryEntry): boolean {
  return a.projectStamp === b.projectStamp && a.selectionStamp === b.selectionStamp;
}

function ensureLastKnown(): void {
  if (state.lastKnown) return;
  state.lastKnown = captureEntry();
}

function pushPast(entry: HistoryEntry): void {
  state.past.push(entry);
  if (state.past.length > HISTORY_LIMIT) {
    state.past.splice(0, state.past.length - HISTORY_LIMIT);
  }
}

function commit(fromEntry: HistoryEntry, toEntry: HistoryEntry, options: RecordOptions): void {
  const allowMerge = options.allowMerge ?? false;
  const mergeWindowMs = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
  const now = Date.now();

  const shouldMerge =
    allowMerge &&
    state.lastCommitSource === options.source &&
    now - state.lastCommitAt <= mergeWindowMs &&
    state.past.length > 0;

  if (!shouldMerge) {
    pushPast(fromEntry);
  }

  state.future = [];
  state.lastKnown = toEntry;
  state.lastCommitSource = options.source;
  state.lastCommitAt = now;
}

function applyEntry(entry: HistoryEntry): void {
  if (!state.projectApplier || !state.selectionApplier) return;

  state.isApplyingHistory = true;
  try {
    state.projectApplier(cloneProject(entry.project));
    state.selectionApplier(cloneSelection(entry.selection));
  } finally {
    state.isApplyingHistory = false;
  }
}

export function registerProjectHistoryBridge(getter: ProjectGetter, applier: ProjectApplier): void {
  state.projectGetter = getter;
  state.projectApplier = applier;
  if (state.selectionGetter) {
    syncHistorySnapshot();
  }
}

export function registerSelectionHistoryBridge(getter: SelectionGetter, applier: SelectionApplier): void {
  state.selectionGetter = getter;
  state.selectionApplier = applier;
  if (state.projectGetter) {
    syncHistorySnapshot();
  }
}

export function syncHistorySnapshot(): void {
  state.lastKnown = captureEntry();
}

export function resetHistory(): void {
  state.past = [];
  state.future = [];
  state.lastCommitSource = null;
  state.lastCommitAt = 0;
  state.transactionDepth = 0;
  state.transactionStart = null;
  state.transactionSource = null;
  syncHistorySnapshot();
}

export function recordHistoryChange(options: RecordOptions): void {
  if (state.isApplyingHistory) return;
  if (state.transactionDepth > 0) return;

  ensureLastKnown();

  const current = captureEntry();
  const previous = state.lastKnown;
  if (!current || !previous) return;
  if (entriesEqual(current, previous)) return;

  commit(previous, current, options);
}

export function beginHistoryTransaction(source = 'transaction'): void {
  if (state.isApplyingHistory) return;

  ensureLastKnown();

  state.transactionDepth += 1;
  if (state.transactionDepth === 1) {
    state.transactionStart = state.lastKnown;
    state.transactionSource = source;
  }
}

export function endHistoryTransaction(source = 'transaction'): void {
  if (state.isApplyingHistory) return;
  if (state.transactionDepth === 0) return;

  state.transactionDepth -= 1;
  if (state.transactionDepth > 0) return;

  const start = state.transactionStart;
  const transactionSource = state.transactionSource ?? source;
  state.transactionStart = null;
  state.transactionSource = null;

  ensureLastKnown();

  const current = captureEntry();
  if (!current) return;

  if (!start) {
    state.lastKnown = current;
    return;
  }

  if (entriesEqual(current, start)) {
    state.lastKnown = current;
    return;
  }

  commit(start, current, {
    source: transactionSource,
    allowMerge: false,
  });
}

export function runInHistoryTransaction(source: string, fn: () => void): void {
  beginHistoryTransaction(source);
  try {
    fn();
  } finally {
    endHistoryTransaction(source);
  }
}

export function canUndoHistory(): boolean {
  return state.past.length > 0;
}

export function canRedoHistory(): boolean {
  return state.future.length > 0;
}

export function undoHistory(): boolean {
  if (!state.projectApplier || !state.selectionApplier) return false;
  if (state.transactionDepth > 0) return false;

  const current = captureEntry();
  const previous = state.past.pop();
  if (!current || !previous) return false;

  state.future.push(current);
  applyEntry(previous);
  state.lastKnown = previous;
  state.lastCommitSource = null;
  state.lastCommitAt = 0;
  return true;
}

export function redoHistory(): boolean {
  if (!state.projectApplier || !state.selectionApplier) return false;
  if (state.transactionDepth > 0) return false;

  const current = captureEntry();
  const next = state.future.pop();
  if (!current || !next) return false;

  pushPast(current);
  applyEntry(next);
  state.lastKnown = next;
  state.lastCommitSource = null;
  state.lastCommitAt = 0;
  return true;
}
