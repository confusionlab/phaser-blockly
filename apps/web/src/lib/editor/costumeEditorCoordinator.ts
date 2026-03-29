import {
  markCostumeCommitPerfPreviewReady,
  markCostumeCommitPerfStateReady,
  recordCostumeCommitPerfPhase,
} from '@/lib/perf/costumeCommitPerformance';
import { cloneCostumeDocument } from '@/lib/costume/costumeDocument';
import { renderCostumeDocument } from '@/lib/costume/costumeDocumentRender';
import { cloneCostumeAssetFrame } from '@/lib/costume/costumeAssetFrame';
import {
  areCostumeDocumentsEqual,
  areCostumeEditorPersistedStatesEqual,
  cloneCostumeEditorPersistedState,
  type CostumeEditorPersistedState,
  type CostumeEditorPreviewSyncMode,
  type CostumeEditorSession,
} from './costumeEditorSession';

const MAX_DOCUMENT_HISTORY_ENTRIES = 100;
const RENDER_RUNTIME_SYNC_DELAY_MS = 90;
const STATE_ONLY_RUNTIME_SYNC_DELAY_MS = 240;

export type CostumeRuntimeSyncMode = CostumeEditorPreviewSyncMode;
export type CostumeRuntimeHistoryAction = 'push' | 'replace' | 'none';

export interface CostumeRuntimeStateEntry {
  revision: number;
  session: CostumeEditorSession;
  state: CostumeEditorPersistedState;
  syncMode: CostumeRuntimeSyncMode;
  traceId: string | null;
}

export interface CostumeHistoryNavigationTarget {
  fromIndex: number;
  toIndex: number;
  snapshot: CostumeEditorPersistedState;
}

interface PersistRuntimeStateOptions {
  recordHistory?: boolean;
  renderedPreview?: boolean;
}

interface CostumeEditorCoordinatorCallbacks {
  onHistoryFlagsChange?: (flags: { canRedo: boolean; canUndo: boolean }) => void;
  onWorkingStateChange?: (
    session: CostumeEditorSession | null,
    state: CostumeEditorPersistedState | null,
  ) => void;
  persistStateToStore?: (
    entry: CostumeRuntimeStateEntry,
    state: CostumeEditorPersistedState,
    options: PersistRuntimeStateOptions,
  ) => boolean;
}

function mergeRuntimeSyncMode(
  current: CostumeRuntimeSyncMode | null | undefined,
  next: CostumeRuntimeSyncMode,
): CostumeRuntimeSyncMode {
  if (current === 'render' || next === 'render') {
    return 'render';
  }
  return 'stateOnly';
}

export class CostumeEditorCoordinator {
  private callbacks: CostumeEditorCoordinatorCallbacks = {};

  private documentHistory: CostumeEditorPersistedState[] = [];

  private documentHistoryIndex = -1;

  private workingPersistedState: CostumeEditorPersistedState | null = null;

  private workingSessionKey: string | null = null;

  private runtimeStateRevision = 0;

  private latestRuntimeState: CostumeRuntimeStateEntry | null = null;

  private latestFlushedRuntimeRevision = 0;

  private latestRenderedRuntimeState: CostumeRuntimeStateEntry | null = null;

  private pendingRuntimeSyncMode: CostumeRuntimeSyncMode | null = null;

  private runtimeSyncTimeout: ReturnType<typeof setTimeout> | null = null;

  setCallbacks(callbacks: CostumeEditorCoordinatorCallbacks) {
    this.callbacks = callbacks;
  }

  dispose() {
    this.clearScheduledRuntimeSync();
    this.callbacks = {};
  }

  canUndo(): boolean {
    return this.documentHistoryIndex > 0;
  }

  canRedo(): boolean {
    return this.documentHistoryIndex >= 0 && this.documentHistoryIndex < this.documentHistory.length - 1;
  }

  getHistoryIndex(): number {
    return this.documentHistoryIndex;
  }

  getHistorySnapshot(index: number): CostumeEditorPersistedState | null {
    return cloneCostumeEditorPersistedState(this.documentHistory[index]);
  }

  getCurrentHistorySnapshot(): CostumeEditorPersistedState | null {
    return this.getHistorySnapshot(this.documentHistoryIndex);
  }

  setHistoryIndex(index: number): boolean {
    if (index < 0 || index >= this.documentHistory.length) {
      return false;
    }
    this.documentHistoryIndex = index;
    this.syncHistoryFlags();
    return true;
  }

  peekHistoryNavigation(
    stepDelta: -1 | 1,
    options: { indexOffset?: number } = {},
  ): CostumeHistoryNavigationTarget | null {
    const fromIndex = this.documentHistoryIndex + (options.indexOffset ?? 0);
    const toIndex = fromIndex + stepDelta;
    if (
      fromIndex < 0
      || fromIndex >= this.documentHistory.length
      || toIndex < 0
      || toIndex >= this.documentHistory.length
    ) {
      return null;
    }

    const snapshot = cloneCostumeEditorPersistedState(this.documentHistory[toIndex]);
    if (!snapshot) {
      return null;
    }

    return {
      fromIndex,
      toIndex,
      snapshot,
    };
  }

  commitHistoryNavigation(
    session: CostumeEditorSession | null,
    navigation: CostumeHistoryNavigationTarget | null | undefined,
    state: CostumeEditorPersistedState | null | undefined,
    options: {
      syncMode?: CostumeRuntimeSyncMode;
      traceId?: string | null;
    } = {},
  ): CostumeRuntimeStateEntry | null {
    if (!session || !navigation || !state) {
      return null;
    }

    const nextState = cloneCostumeEditorPersistedState(state);
    const expectedSnapshot = cloneCostumeEditorPersistedState(this.documentHistory[navigation.toIndex]);
    if (!nextState || !expectedSnapshot) {
      return null;
    }

    if (
      this.documentHistoryIndex !== navigation.fromIndex
      || !areCostumeEditorPersistedStatesEqual(expectedSnapshot, navigation.snapshot)
    ) {
      return null;
    }

    this.documentHistoryIndex = navigation.toIndex;
    this.syncHistoryFlags();
    this.setWorkingPersistedState(session, nextState);

    const revision = this.runtimeStateRevision + 1;
    this.runtimeStateRevision = revision;
    const entry: CostumeRuntimeStateEntry = {
      revision,
      session: { ...session },
      state: nextState,
      syncMode: options.syncMode ?? 'render',
      traceId: options.traceId ?? null,
    };
    this.latestRuntimeState = this.cloneRuntimeStateEntry(entry);
    return entry;
  }

  getWorkingPersistedStateForSession(
    session: CostumeEditorSession | null | undefined,
  ): CostumeEditorPersistedState | null {
    if (!session || this.workingSessionKey !== session.key) {
      return null;
    }
    return cloneCostumeEditorPersistedState(this.workingPersistedState);
  }

  syncWorkingPersistedState(
    session: CostumeEditorSession | null,
    state: CostumeEditorPersistedState | null | undefined,
  ) {
    this.setWorkingPersistedState(session, state);
  }

  getLatestRuntimeStateEntry(): CostumeRuntimeStateEntry | null {
    return this.cloneRuntimeStateEntry(this.latestRuntimeState);
  }

  getLatestRenderedRuntimeStateEntry(): CostumeRuntimeStateEntry | null {
    return this.cloneRuntimeStateEntry(this.latestRenderedRuntimeState);
  }

  clearScheduledRuntimeSync() {
    if (this.runtimeSyncTimeout) {
      clearTimeout(this.runtimeSyncTimeout);
      this.runtimeSyncTimeout = null;
    }
    this.pendingRuntimeSyncMode = null;
  }

  resetRuntimePersistenceState(
    session: CostumeEditorSession | null,
    state: CostumeEditorPersistedState | null | undefined,
  ) {
    this.clearScheduledRuntimeSync();

    const nextState = cloneCostumeEditorPersistedState(state);
    if (!session || !nextState) {
      this.latestRuntimeState = null;
      this.latestRenderedRuntimeState = null;
      this.latestFlushedRuntimeRevision = this.runtimeStateRevision;
      return;
    }

    const revision = this.runtimeStateRevision + 1;
    this.runtimeStateRevision = revision;
    const entry: CostumeRuntimeStateEntry = {
      revision,
      session: { ...session },
      state: nextState,
      syncMode: 'stateOnly',
      traceId: null,
    };
    this.latestRuntimeState = this.cloneRuntimeStateEntry(entry);
    this.latestRenderedRuntimeState = this.cloneRuntimeStateEntry(entry);
    this.latestFlushedRuntimeRevision = revision;
  }

  resetDocumentHistory(
    session: CostumeEditorSession | null,
    state: CostumeEditorPersistedState | null | undefined,
  ) {
    const nextState = cloneCostumeEditorPersistedState(state);
    this.setWorkingPersistedState(session, nextState);
    this.documentHistory = nextState ? [nextState] : [];
    this.documentHistoryIndex = nextState ? 0 : -1;
    this.resetRuntimePersistenceState(session, nextState);
    this.syncHistoryFlags();
  }

  commitRuntimeState(
    session: CostumeEditorSession | null,
    state: CostumeEditorPersistedState | null | undefined,
    options: {
      historyAction?: CostumeRuntimeHistoryAction;
      syncMode?: CostumeRuntimeSyncMode;
      traceId?: string | null;
    } = {},
  ): CostumeRuntimeStateEntry | null {
    if (!session || !state) {
      return null;
    }

    const nextState = cloneCostumeEditorPersistedState(state);
    if (!nextState) {
      return null;
    }

    if (options.historyAction === 'replace') {
      this.replaceDocumentHistoryHead(nextState);
    } else if (options.historyAction !== 'none') {
      this.pushDocumentHistory(nextState);
    }

    this.setWorkingPersistedState(session, nextState);

    const revision = this.runtimeStateRevision + 1;
    this.runtimeStateRevision = revision;
    const entry: CostumeRuntimeStateEntry = {
      revision,
      session: { ...session },
      state: nextState,
      syncMode: options.syncMode ?? 'render',
      traceId: options.traceId ?? null,
    };
    this.latestRuntimeState = this.cloneRuntimeStateEntry(entry);
    return entry;
  }

  flushPendingRuntimeStateSync(
    options: { recordHistory?: boolean; session?: CostumeEditorSession | null } = {},
  ): boolean {
    this.clearScheduledRuntimeSync();

    const entry = this.cloneRuntimeStateEntry(this.latestRuntimeState);
    if (!entry) {
      return false;
    }
    if (options.session && entry.session.key !== options.session.key) {
      return false;
    }
    if (this.latestFlushedRuntimeRevision >= entry.revision) {
      return false;
    }

    return this.persistRuntimeStateToStore(entry, entry.state, {
      recordHistory: options.recordHistory,
      renderedPreview: false,
    });
  }

  async flushPendingRuntimeState(
    options: {
      includePreview?: boolean;
      recordHistory?: boolean;
      session?: CostumeEditorSession | null;
    } = {},
  ): Promise<boolean> {
    this.clearScheduledRuntimeSync();

    const entry = this.cloneRuntimeStateEntry(this.latestRuntimeState);
    if (!entry) {
      return false;
    }
    if (options.session && entry.session.key !== options.session.key) {
      return false;
    }

    const needsPreview = options.includePreview === true;
    let stateToPersist = cloneCostumeEditorPersistedState(entry.state);
    if (!stateToPersist) {
      return false;
    }

    if (needsPreview) {
      const renderedEntry = this.latestRenderedRuntimeState;
      if (
        renderedEntry
        && renderedEntry.revision === entry.revision
        && renderedEntry.session.key === entry.session.key
      ) {
        stateToPersist = cloneCostumeEditorPersistedState(renderedEntry.state) ?? stateToPersist;
      } else {
        const previewRenderStartMs = entry.traceId ? performance.now() : 0;
        const rendered = await renderCostumeDocument(entry.state.document);
        if (entry.traceId) {
          recordCostumeCommitPerfPhase(entry.traceId, 'previewRenderMs', performance.now() - previewRenderStartMs);
        }

        const latestEntry = this.latestRuntimeState;
        if (
          latestEntry
          && latestEntry.session.key === entry.session.key
          && latestEntry.revision !== entry.revision
        ) {
          return this.flushPendingRuntimeState(options);
        }

        stateToPersist = {
          assetId: rendered.dataUrl,
          bounds: rendered.bounds ?? undefined,
          assetFrame: cloneCostumeAssetFrame(rendered.assetFrame),
          document: cloneCostumeDocument(entry.state.document),
        };
      }
    }

    const previewSyncStartMs = entry.traceId ? performance.now() : 0;
    const didPersist = this.persistRuntimeStateToStore(entry, stateToPersist, {
      recordHistory: options.recordHistory,
      renderedPreview: needsPreview,
    });
    if (didPersist && needsPreview && entry.traceId) {
      recordCostumeCommitPerfPhase(entry.traceId, 'previewStoreSyncMs', performance.now() - previewSyncStartMs);
      markCostumeCommitPerfPreviewReady(entry.traceId);
    }
    return didPersist;
  }

  scheduleRuntimeStateSync(entry: CostumeRuntimeStateEntry | null) {
    if (!entry) {
      return;
    }
    if (
      !this.latestRuntimeState
      || this.latestRuntimeState.revision !== entry.revision
      || this.latestRuntimeState.session.key !== entry.session.key
    ) {
      return;
    }

    if (entry.syncMode === 'stateOnly') {
      if (entry.traceId) {
        recordCostumeCommitPerfPhase(entry.traceId, 'stateStoreSyncMs', 0);
        markCostumeCommitPerfStateReady(entry.traceId);
        markCostumeCommitPerfPreviewReady(entry.traceId);
      }
    } else if (this.latestFlushedRuntimeRevision < entry.revision) {
      const stateSyncStartMs = entry.traceId ? performance.now() : 0;
      const didPersistState = this.persistRuntimeStateToStore(entry, entry.state, {
        recordHistory: false,
        renderedPreview: false,
      });
      if (didPersistState && entry.traceId) {
        recordCostumeCommitPerfPhase(entry.traceId, 'stateStoreSyncMs', performance.now() - stateSyncStartMs);
        markCostumeCommitPerfStateReady(entry.traceId);
      }
    }

    this.pendingRuntimeSyncMode = mergeRuntimeSyncMode(this.pendingRuntimeSyncMode, entry.syncMode);
    const pendingSyncMode = this.pendingRuntimeSyncMode;

    if (this.runtimeSyncTimeout) {
      clearTimeout(this.runtimeSyncTimeout);
    }

    this.runtimeSyncTimeout = setTimeout(() => {
      this.runtimeSyncTimeout = null;
      const includePreview = this.pendingRuntimeSyncMode === 'render';
      this.pendingRuntimeSyncMode = null;
      void this.flushPendingRuntimeState({
        includePreview,
        recordHistory: false,
        session: entry.session,
      });
    }, pendingSyncMode === 'render' ? RENDER_RUNTIME_SYNC_DELAY_MS : STATE_ONLY_RUNTIME_SYNC_DELAY_MS);
  }

  private cloneRuntimeStateEntry(
    entry: CostumeRuntimeStateEntry | null | undefined,
  ): CostumeRuntimeStateEntry | null {
    if (!entry) {
      return null;
    }

    const nextState = cloneCostumeEditorPersistedState(entry.state);
    if (!nextState) {
      return null;
    }

    return {
      revision: entry.revision,
      session: { ...entry.session },
      state: nextState,
      syncMode: entry.syncMode,
      traceId: entry.traceId,
    };
  }

  private setWorkingPersistedState(
    session: CostumeEditorSession | null,
    state: CostumeEditorPersistedState | null | undefined,
  ) {
    const nextState = cloneCostumeEditorPersistedState(state);
    const nextSessionKey = session?.key ?? null;
    if (
      this.workingSessionKey === nextSessionKey
      && areCostumeEditorPersistedStatesEqual(this.workingPersistedState, nextState)
    ) {
      return;
    }

    this.workingSessionKey = nextSessionKey;
    this.workingPersistedState = nextState;
    this.callbacks.onWorkingStateChange?.(
      session ? { ...session } : null,
      cloneCostumeEditorPersistedState(nextState),
    );
  }

  private syncHistoryFlags() {
    this.callbacks.onHistoryFlagsChange?.({
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
  }

  private replaceDocumentHistoryHead(state: CostumeEditorPersistedState) {
    const nextState = cloneCostumeEditorPersistedState(state);
    if (!nextState) {
      return;
    }

    if (this.documentHistoryIndex < 0) {
      this.documentHistory = [nextState];
      this.documentHistoryIndex = 0;
      this.syncHistoryFlags();
      return;
    }

    const nextHistory = [...this.documentHistory];
    nextHistory[this.documentHistoryIndex] = nextState;
    this.documentHistory = nextHistory;
    this.syncHistoryFlags();
  }

  private pushDocumentHistory(state: CostumeEditorPersistedState) {
    const nextState = cloneCostumeEditorPersistedState(state);
    if (!nextState) {
      return;
    }

    const current = this.documentHistory[this.documentHistoryIndex] ?? null;
    if (areCostumeEditorPersistedStatesEqual(current, nextState)) {
      this.syncHistoryFlags();
      return;
    }

    const nextHistory = this.documentHistory
      .slice(0, this.documentHistoryIndex + 1)
      .concat([nextState]);
    const trimmedHistory = nextHistory.length > MAX_DOCUMENT_HISTORY_ENTRIES
      ? nextHistory.slice(nextHistory.length - MAX_DOCUMENT_HISTORY_ENTRIES)
      : nextHistory;
    this.documentHistory = trimmedHistory;
    this.documentHistoryIndex = trimmedHistory.length - 1;
    this.syncHistoryFlags();
  }

  private hydrateCurrentHistoryState(
    session: CostumeEditorSession,
    state: CostumeEditorPersistedState,
  ) {
    if (this.workingSessionKey !== session.key || this.documentHistoryIndex < 0) {
      return;
    }

    const nextState = cloneCostumeEditorPersistedState(state);
    if (!nextState) {
      return;
    }

    const currentHistoryState = this.documentHistory[this.documentHistoryIndex] ?? null;
    if (!currentHistoryState || !areCostumeDocumentsEqual(currentHistoryState.document, nextState.document)) {
      return;
    }

    const nextHistory = [...this.documentHistory];
    nextHistory[this.documentHistoryIndex] = nextState;
    this.documentHistory = nextHistory;
  }

  private persistRuntimeStateToStore(
    entry: CostumeRuntimeStateEntry,
    state: CostumeEditorPersistedState,
    options: PersistRuntimeStateOptions = {},
  ): boolean {
    const nextState = cloneCostumeEditorPersistedState(state);
    if (!nextState) {
      return false;
    }

    const didPersist = this.callbacks.persistStateToStore?.(entry, nextState, options) ?? false;
    if (!didPersist) {
      return false;
    }

    this.latestFlushedRuntimeRevision = Math.max(this.latestFlushedRuntimeRevision, entry.revision);
    if (options.renderedPreview === true) {
      this.latestRenderedRuntimeState = {
        revision: entry.revision,
        session: { ...entry.session },
        state: cloneCostumeEditorPersistedState(nextState)!,
        syncMode: 'render',
        traceId: entry.traceId,
      };
    }

    const currentRuntimeEntry = this.latestRuntimeState;
    if (
      currentRuntimeEntry
      && currentRuntimeEntry.revision === entry.revision
      && currentRuntimeEntry.session.key === entry.session.key
      && options.renderedPreview === true
    ) {
      this.latestRuntimeState = {
        ...currentRuntimeEntry,
        state: cloneCostumeEditorPersistedState(nextState)!,
      };
    }

    if (options.renderedPreview === true) {
      this.hydrateCurrentHistoryState(entry.session, nextState);
    }

    const currentHistoryState = this.documentHistory[this.documentHistoryIndex] ?? null;
    if (
      this.workingSessionKey === entry.session.key
      && currentHistoryState
      && areCostumeEditorPersistedStatesEqual(currentHistoryState, nextState)
    ) {
      this.setWorkingPersistedState(entry.session, nextState);
    }

    return true;
  }
}
