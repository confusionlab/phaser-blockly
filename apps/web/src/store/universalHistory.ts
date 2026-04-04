import type { Project } from '@/types';

export type SelectionSnapshot = {
  selectedSceneId: string | null;
  selectedSceneIds: string[];
  selectedFolderId: string | null;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  selectedComponentId: string | null;
  selectedComponentIds: string[];
};

export type UiHistorySnapshot = {
  activeInspectorTab: string;
  activeHierarchyTab: string;
  activeObjectTab: string;
  backgroundEditorOpen: boolean;
  backgroundEditorSceneId: string | null;
  worldBoundaryEditorOpen: boolean;
  worldBoundaryEditorSceneId: string | null;
};

type HistoryEntry = {
  project: Project | null;
  selection: SelectionSnapshot;
  ui: UiHistorySnapshot | null;
  projectStamp: number | null;
  selectionStamp: string;
  uiStamp: string;
};

type HistoryStep = {
  before: HistoryEntry;
  after: HistoryEntry;
  source: string;
};

type ProjectGetter = () => Project | null;
type ProjectApplier = (project: Project | null) => void;
type SelectionGetter = () => SelectionSnapshot;
type SelectionApplier = (selection: SelectionSnapshot) => void;
type UiGetter = () => UiHistorySnapshot;
type UiApplier = (ui: UiHistorySnapshot) => void;

export type HistoryRecordOptions = {
  source: string;
  allowMerge?: boolean;
  mergeWindowMs?: number;
};

export type HistoryAnchor = {
  entry: HistoryEntry;
  pastLength: number;
};

const HISTORY_LIMIT = 200;
const DEFAULT_MERGE_WINDOW_MS = 300;

const state: {
  projectGetter: ProjectGetter | null;
  projectApplier: ProjectApplier | null;
  selectionGetter: SelectionGetter | null;
  selectionApplier: SelectionApplier | null;
  uiGetter: UiGetter | null;
  uiApplier: UiApplier | null;
  past: HistoryStep[];
  future: HistoryStep[];
  currentSnapshot: HistoryEntry | null;
  appliedEntry: HistoryEntry | null;
  lastCommitSource: string | null;
  lastCommitAt: number;
  isApplyingHistory: boolean;
  transactionDepth: number;
  transactionStart: HistoryEntry | null;
  transactionSource: string | null;
  listeners: Set<() => void>;
} = {
  projectGetter: null,
  projectApplier: null,
  selectionGetter: null,
  selectionApplier: null,
  uiGetter: null,
  uiApplier: null,
  past: [],
  future: [],
  currentSnapshot: null,
  appliedEntry: null,
  lastCommitSource: null,
  lastCommitAt: 0,
  isApplyingHistory: false,
  transactionDepth: 0,
  transactionStart: null,
  transactionSource: null,
  listeners: new Set(),
};

function cloneProject(project: Project | null): Project | null {
  if (!project) return null;
  return structuredClone(project);
}

function cloneSelection(selection: SelectionSnapshot): SelectionSnapshot {
  return {
    selectedSceneId: selection.selectedSceneId,
    selectedSceneIds: [...selection.selectedSceneIds],
    selectedFolderId: selection.selectedFolderId,
    selectedObjectId: selection.selectedObjectId,
    selectedObjectIds: [...selection.selectedObjectIds],
    selectedComponentId: selection.selectedComponentId,
    selectedComponentIds: [...selection.selectedComponentIds],
  };
}

function cloneUiSnapshot(ui: UiHistorySnapshot | null): UiHistorySnapshot | null {
  if (!ui) {
    return null;
  }

  return {
    activeInspectorTab: ui.activeInspectorTab,
    activeHierarchyTab: ui.activeHierarchyTab,
    activeObjectTab: ui.activeObjectTab,
    backgroundEditorOpen: ui.backgroundEditorOpen,
    backgroundEditorSceneId: ui.backgroundEditorSceneId,
    worldBoundaryEditorOpen: ui.worldBoundaryEditorOpen,
    worldBoundaryEditorSceneId: ui.worldBoundaryEditorSceneId,
  };
}

function cloneEntry(entry: HistoryEntry): HistoryEntry {
  return {
    project: entry.project,
    selection: cloneSelection(entry.selection),
    ui: cloneUiSnapshot(entry.ui),
    projectStamp: entry.projectStamp,
    selectionStamp: entry.selectionStamp,
    uiStamp: entry.uiStamp,
  };
}

function cloneStep(step: HistoryStep): HistoryStep {
  return {
    before: cloneEntry(step.before),
    after: cloneEntry(step.after),
    source: step.source,
  };
}

function getProjectStamp(project: Project | null): number | null {
  if (!project) return null;
  return project.updatedAt instanceof Date ? project.updatedAt.getTime() : null;
}

function getSelectionStamp(selection: SelectionSnapshot): string {
  return [
    selection.selectedSceneId ?? '',
    selection.selectedSceneIds.join(','),
    selection.selectedFolderId ?? '',
    selection.selectedObjectId ?? '',
    selection.selectedObjectIds.join(','),
    selection.selectedComponentId ?? '',
    selection.selectedComponentIds.join(','),
  ].join('|');
}

function getUiStamp(ui: UiHistorySnapshot | null): string {
  if (!ui) {
    return 'none';
  }

  return [
    ui.activeInspectorTab,
    ui.activeHierarchyTab,
    ui.activeObjectTab,
    ui.backgroundEditorOpen ? '1' : '0',
    ui.backgroundEditorSceneId ?? '',
    ui.worldBoundaryEditorOpen ? '1' : '0',
    ui.worldBoundaryEditorSceneId ?? '',
  ].join('|');
}

function emitHistoryChange(): void {
  state.listeners.forEach((listener) => {
    listener();
  });
}

function captureEntry(): HistoryEntry | null {
  if (!state.projectGetter || !state.selectionGetter) return null;

  const project = state.projectGetter();
  const selection = cloneSelection(state.selectionGetter());
  const ui = state.uiGetter ? cloneUiSnapshot(state.uiGetter()) : null;

  return {
    // Project store updates are immutable, so keeping snapshot references here is safe and
    // avoids deep-cloning the full project on every single history record.
    project,
    selection,
    ui,
    projectStamp: getProjectStamp(project),
    selectionStamp: getSelectionStamp(selection),
    uiStamp: getUiStamp(ui),
  };
}

function entriesEqual(a: HistoryEntry, b: HistoryEntry): boolean {
  return (
    a.projectStamp === b.projectStamp &&
    a.selectionStamp === b.selectionStamp &&
    a.uiStamp === b.uiStamp
  );
}

function ensureLastKnown(): void {
  if (state.currentSnapshot && state.appliedEntry) return;

  const entry = captureEntry();
  if (!entry) {
    return;
  }

  state.currentSnapshot = cloneEntry(entry);
  state.appliedEntry = cloneEntry(entry);
}

function pushPast(step: HistoryStep): void {
  state.past.push(cloneStep(step));
  if (state.past.length > HISTORY_LIMIT) {
    state.past.splice(0, state.past.length - HISTORY_LIMIT);
  }
}

function commit(fromEntry: HistoryEntry, toEntry: HistoryEntry, options: HistoryRecordOptions): void {
  const allowMerge = options.allowMerge ?? false;
  const mergeWindowMs = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
  const now = Date.now();

  const shouldMerge =
    allowMerge &&
    state.lastCommitSource === options.source &&
    now - state.lastCommitAt <= mergeWindowMs &&
    state.past.length > 0;

  if (shouldMerge) {
    const previousStep = state.past[state.past.length - 1];
    if (previousStep) {
      previousStep.after = cloneEntry(toEntry);
    }
  } else {
    pushPast({
      before: fromEntry,
      after: toEntry,
      source: options.source,
    });
  }

  state.future = [];
  state.appliedEntry = cloneEntry(toEntry);
  state.currentSnapshot = cloneEntry(toEntry);
  state.lastCommitSource = options.source;
  state.lastCommitAt = now;
  emitHistoryChange();
}

function applyEntry(entry: HistoryEntry): void {
  if (!state.projectApplier || !state.selectionApplier) return;

  state.isApplyingHistory = true;
  try {
    state.projectApplier(cloneProject(entry.project));
    state.selectionApplier(cloneSelection(entry.selection));
    if (state.uiApplier && entry.ui) {
      state.uiApplier(cloneUiSnapshot(entry.ui)!);
    }
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

export function registerUiHistoryBridge(getter: UiGetter, applier: UiApplier): void {
  state.uiGetter = getter;
  state.uiApplier = applier;
  if (state.projectGetter && state.selectionGetter) {
    syncHistorySnapshot();
  }
}

export function subscribeToHistoryChanges(listener: () => void): () => void {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

export function syncHistorySnapshot(): void {
  const entry = captureEntry();
  if (!entry) {
    return;
  }

  state.currentSnapshot = cloneEntry(entry);
  if (!state.appliedEntry) {
    state.appliedEntry = cloneEntry(entry);
  }
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
  emitHistoryChange();
}

export function recordHistoryChange(options: HistoryRecordOptions): void {
  if (state.isApplyingHistory) return;
  if (state.transactionDepth > 0) return;

  ensureLastKnown();

  const current = captureEntry();
  const previous = state.currentSnapshot;
  if (!current || !previous) return;
  if (entriesEqual(current, previous)) return;

  commit(previous, current, options);
}

export function beginHistoryTransaction(source = 'transaction'): void {
  if (state.isApplyingHistory) return;

  ensureLastKnown();

  state.transactionDepth += 1;
  if (state.transactionDepth === 1) {
    state.transactionStart = state.currentSnapshot ? cloneEntry(state.currentSnapshot) : null;
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
    state.appliedEntry = cloneEntry(current);
    state.currentSnapshot = cloneEntry(current);
    return;
  }

  if (entriesEqual(current, start)) {
    state.appliedEntry = cloneEntry(current);
    state.currentSnapshot = cloneEntry(current);
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

export function createHistoryAnchor(): HistoryAnchor | null {
  ensureLastKnown();
  if (!state.currentSnapshot) {
    return null;
  }

  return {
    entry: cloneEntry(state.currentSnapshot),
    pastLength: state.past.length,
  };
}

export function hasHistoryChangesSinceAnchor(anchor: HistoryAnchor | null): boolean {
  if (!anchor) {
    return false;
  }

  const current = captureEntry();
  if (!current) {
    return false;
  }

  return state.past.length !== anchor.pastLength || !entriesEqual(current, anchor.entry);
}

export function revertHistoryToAnchor(anchor: HistoryAnchor | null): boolean {
  if (!anchor) {
    return false;
  }
  if (state.transactionDepth > 0) {
    return false;
  }

  applyEntry(anchor.entry);
  state.past = state.past.slice(0, anchor.pastLength);
  state.future = [];
  state.appliedEntry = cloneEntry(anchor.entry);
  state.currentSnapshot = cloneEntry(anchor.entry);
  state.lastCommitSource = null;
  state.lastCommitAt = 0;
  emitHistoryChange();
  return true;
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

  const current = state.appliedEntry ? cloneEntry(state.appliedEntry) : captureEntry();
  const step = state.past.pop();
  if (!current || !step) return false;

  state.future.push(cloneStep(step));
  applyEntry(step.before);
  state.appliedEntry = cloneEntry(step.before);
  state.currentSnapshot = cloneEntry(step.before);
  state.lastCommitSource = null;
  state.lastCommitAt = 0;
  emitHistoryChange();
  return true;
}

export function redoHistory(): boolean {
  if (!state.projectApplier || !state.selectionApplier) return false;
  if (state.transactionDepth > 0) return false;

  const current = state.appliedEntry ? cloneEntry(state.appliedEntry) : captureEntry();
  const step = state.future.pop();
  if (!current || !step) return false;

  pushPast(step);
  applyEntry(step.after);
  state.appliedEntry = cloneEntry(step.after);
  state.currentSnapshot = cloneEntry(step.after);
  state.lastCommitSource = null;
  state.lastCommitAt = 0;
  emitHistoryChange();
  return true;
}
