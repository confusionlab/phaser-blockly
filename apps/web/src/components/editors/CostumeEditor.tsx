import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore, type UndoRedoHandler } from '@/store/editorStore';
import {
  clearCostumeRuntimePreview,
  getCostumeRuntimePreviewKeyForTarget,
} from '@/store/costumeRuntimePreviewStore';
import { syncHistorySnapshot } from '@/store/universalHistory';
import {
  consumeActiveCostumeCommitPerfTrace,
  recordCostumeCommitPerfPhase,
} from '@/lib/perf/costumeCommitPerformance';
import { CostumeList } from './costume/CostumeList';
import { CostumeLayerPanel } from './costume/CostumeLayerPanel';
import {
  CostumeCanvas,
  DEFAULT_COSTUME_PREVIEW_SCALE,
  type CostumeCanvasHistoryChange,
  type CostumeCanvasHandle,
} from './costume/CostumeCanvas';
import {
  type BitmapFillStyle,
  type BitmapShapeStyle,
  CostumeToolbar,
  type AlignAction,
  type DrawingTool,
  type MoveOrderAction,
  type SelectionFlipAxis,
  type TextToolStyle,
  type VectorHandleMode,
  type VectorStyleCapabilities,
  type VectorToolStyle,
} from './costume/CostumeToolbar';
import { resolveCostumeToolShortcut } from './costume/costumeToolShortcuts';
import { getEffectiveObjectProps } from '@/types';
import type { Costume, ColliderConfig, CostumeEditorMode } from '@/types';
import {
  areCostumeEditorPersistedStatesEqual,
  cloneCostumeEditorPersistedState,
  createCostumeEditorPersistedStateFromCostume,
  createCostumeEditorSession,
  resolveCostumeEditorPersistedStateWithSyncMode,
  type CostumeEditorObjectTarget,
  type CostumeEditorOperation,
  type CostumeEditorPersistedSession,
  type CostumeEditorPersistedState,
  type CostumeEditorPreviewSyncMode,
  type CostumeEditorSession,
  type CostumeEditorTarget,
  resolveCostumeEditorTarget,
} from '@/lib/editor/costumeEditorSession';
import {
  CostumeEditorCoordinator,
  type CostumeRuntimeStateEntry,
} from '@/lib/editor/costumeEditorCoordinator';
import { publishCostumeRuntimePreviewFromCanvas } from '@/lib/editor/costumeRuntimePreview';
import { NO_OBJECT_SELECTED_MESSAGE } from '@/lib/selectionMessages';
import { shouldIgnoreGlobalKeyboardEvent } from '@/utils/keyboard';
import type { BitmapBrushKind } from '@/lib/background/brushCore';
import { DEFAULT_BITMAP_FILL_TEXTURE_ID } from '@/lib/background/bitmapFillCore';
import { DEFAULT_VECTOR_STROKE_BRUSH_ID } from '@/lib/vector/vectorStrokeBrushCore';
import { DEFAULT_VECTOR_FILL_TEXTURE_ID } from '@/lib/vector/vectorFillTextureCore';
import {
  cloneCostumeDocument,
  createBitmapLayer,
  createVectorLayer,
  duplicateCostumeLayer,
  getActiveCostumeLayer,
  getActiveCostumeLayerKind,
  getCostumeLayerById,
  getCostumeLayerIndex,
  insertCostumeLayerAfterActive,
  isVectorCostumeLayer,
  reorderCostumeLayer,
  removeCostumeLayer,
  setActiveCostumeLayer,
  setCostumeLayerVisibility,
  updateCostumeLayer,
  type ActiveLayerCanvasState,
} from '@/lib/costume/costumeDocument';
import { cloneCostumeAssetFrame } from '@/lib/costume/costumeAssetFrame';
import {
  mergeCostumeLayers,
  rasterizeCostumeLayer,
} from '@/lib/costume/costumeLayerOperations';

const VECTOR_TOOLS = new Set<DrawingTool>(['select', 'pen', 'brush', 'rectangle', 'circle', 'triangle', 'star', 'line', 'text', 'collider']);
const BITMAP_TOOLS = new Set<DrawingTool>(['select', 'brush', 'eraser', 'fill', 'circle', 'rectangle', 'triangle', 'star', 'line', 'collider']);

function ensureToolForMode(mode: CostumeEditorMode, tool: DrawingTool): DrawingTool {
  if (mode === 'vector') {
    return VECTOR_TOOLS.has(tool) ? tool : 'select';
  }
  return BITMAP_TOOLS.has(tool) ? tool : 'select';
}

function getInitialCostumeEditorMode(costume: Costume | undefined): CostumeEditorMode {
  return costume ? getActiveCostumeLayerKind(costume.document) : 'vector';
}

function getLayerCanvasSourceSignature(layer: ReturnType<typeof getActiveCostumeLayer>): string {
  if (!layer) {
    return 'none';
  }
  if (layer.kind === 'bitmap') {
    return `bitmap:${layer.bitmap.assetId ?? ''}`;
  }
  return `vector:${layer.vector.fabricJson}`;
}

function createCostumeTarget(
  sceneId: string | null,
  objectId: string | null,
  costumeId: string | null,
): CostumeEditorTarget | null {
  if (!sceneId || !objectId || !costumeId) {
    return null;
  }

  return {
    sceneId,
    objectId,
    costumeId,
  };
}

function createCostumeObjectTarget(
  sceneId: string | null,
  objectId: string | null,
): CostumeEditorObjectTarget | null {
  if (!sceneId || !objectId) {
    return null;
  }

  return {
    sceneId,
    objectId,
  };
}

export function CostumeEditor() {
  const canvasRef = useRef<CostumeCanvasHandle>(null);
  const {
    project,
    updateObject,
    updateCostumeFromEditor,
    applyCostumeEditorOperation,
  } = useProjectStore();
  const {
    selectedSceneId,
    selectedObjectId,
    registerCostumeUndo,
    activeObjectTab,
    costumeColliderEditorRequest,
    consumeCostumeColliderEditorRequest,
  } = useEditorStore();

  const currentCostumeIdRef = useRef<string | null>(null);
  const currentCostumeRef = useRef<Costume | undefined>(undefined);
  const previousSelectionRef = useRef<{ sceneId: string | null; objectId: string | null }>({
    sceneId: null,
    objectId: null,
  });
  const loadRequestIdRef = useRef(0);
  const loadingOverlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(true);
  const loadedSessionRef = useRef<CostumeEditorSession | null>(null);
  const currentSessionRef = useRef<CostumeEditorSession | null>(null);
  const documentMutationChainRef = useRef<Promise<void>>(Promise.resolve());
  const publishedRuntimePreviewSessionKeyRef = useRef<string | null>(null);
  const coordinatorRef = useRef<CostumeEditorCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new CostumeEditorCoordinator();
  }
  const coordinator = coordinatorRef.current;
  const [workingPersistedStateSessionKey, setWorkingPersistedStateSessionKey] = useState<string | null>(null);
  const [workingPersistedState, setWorkingPersistedStateState] = useState<CostumeEditorPersistedState | null>(null);

  const scene = project?.scenes.find((candidate) => candidate.id === selectedSceneId);
  const object = scene?.objects.find((candidate) => candidate.id === selectedObjectId);

  const effectiveProps = useMemo(() => {
    if (!object || !project) return null;
    return getEffectiveObjectProps(object, project.components || []);
  }, [object, project]);

  const costumes = useMemo(() => effectiveProps?.costumes || [], [effectiveProps]);
  const currentCostumeIndex = effectiveProps?.currentCostumeIndex ?? 0;
  const collider = effectiveProps?.collider ?? null;
  const currentCostume = costumes[currentCostumeIndex];
  const currentSession = useMemo(() => {
    const target = createCostumeTarget(selectedSceneId, selectedObjectId, currentCostume?.id ?? null);
    return target ? createCostumeEditorSession(target) : null;
  }, [currentCostume?.id, selectedObjectId, selectedSceneId]);
  const currentWorkingPersistedState = currentSession && workingPersistedStateSessionKey === currentSession.key
    ? workingPersistedState
    : null;
  const editorCostume = useMemo(() => {
    if (!currentCostume) {
      return undefined;
    }
    if (!currentWorkingPersistedState) {
      return currentCostume;
    }
    return {
      ...currentCostume,
      assetId: currentWorkingPersistedState.assetId,
      bounds: currentWorkingPersistedState.bounds,
      assetFrame: cloneCostumeAssetFrame(currentWorkingPersistedState.assetFrame),
      document: currentWorkingPersistedState.document,
    };
  }, [currentCostume, currentWorkingPersistedState]);
  currentCostumeRef.current = editorCostume;
  const activeLayer = editorCostume ? getActiveCostumeLayer(editorCostume.document) : null;
  const currentCostumeLoadKey = editorCostume
    ? `${editorCostume.id}:${editorCostume.document.activeLayerId}`
    : null;
  const currentObjectTarget = useMemo(
    () => createCostumeObjectTarget(selectedSceneId, selectedObjectId),
    [selectedObjectId, selectedSceneId],
  );
  currentSessionRef.current = currentSession;
  const initialEditorMode: CostumeEditorMode = editorCostume
    ? getInitialCostumeEditorMode(editorCostume)
    : 'bitmap';

  const [canvasEditorMode, setCanvasEditorMode] = useState<CostumeEditorMode>(initialEditorMode);
  const [activeTool, setActiveTool] = useState<DrawingTool>('select');
  const [bitmapBrushKind, setBitmapBrushKind] = useState<BitmapBrushKind>('hard-round');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [bitmapFillStyle, setBitmapFillStyle] = useState<BitmapFillStyle>({
    textureId: DEFAULT_BITMAP_FILL_TEXTURE_ID,
  });
  const [bitmapShapeStyle, setBitmapShapeStyle] = useState<BitmapShapeStyle>({
    fillColor: '#000000',
    strokeColor: '#000000',
    strokeWidth: 5,
  });
  const [vectorHandleMode, setVectorHandleMode] = useState<VectorHandleMode>('linear');
  const [textStyle, setTextStyle] = useState<TextToolStyle>({
    fontFamily: 'Arial',
    fontSize: 32,
    fontWeight: 'normal',
    fontStyle: 'normal',
    underline: false,
    textAlign: 'left',
    opacity: 1,
  });
  const [vectorStyle, setVectorStyle] = useState<VectorToolStyle>({
    fillColor: '#000000',
    fillTextureId: DEFAULT_VECTOR_FILL_TEXTURE_ID,
    strokeColor: '#000000',
    strokeWidth: 1,
    strokeBrushId: DEFAULT_VECTOR_STROKE_BRUSH_ID,
  });
  const [vectorStyleCapabilities, setVectorStyleCapabilities] = useState<VectorStyleCapabilities>({
    supportsFill: true,
  });
  const [isVectorPointEditing, setIsVectorPointEditing] = useState(false);
  const [hasSelectedVectorPoints, setHasSelectedVectorPoints] = useState(false);
  const [hasTextSelection, setHasTextSelection] = useState(false);
  const [activeStyleCommitRequest, setActiveStyleCommitRequest] = useState(0);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasCanvasSelection, setHasCanvasSelection] = useState(false);
  const [hasBitmapFloatingSelection, setHasBitmapFloatingSelection] = useState(false);
  const [canvasPreviewScale, setCanvasPreviewScale] = useState(DEFAULT_COSTUME_PREVIEW_SCALE);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [showSessionLoadingOverlay, setShowSessionLoadingOverlay] = useState(false);
  const editorMode: CostumeEditorMode = activeLayer
    ? getActiveCostumeLayerKind(editorCostume?.document ?? null)
    : canvasEditorMode;

  useEffect(() => {
    const nextSessionKey = currentSession?.key ?? null;
    const previousSessionKey = publishedRuntimePreviewSessionKeyRef.current;
    if (previousSessionKey && previousSessionKey !== nextSessionKey) {
      clearCostumeRuntimePreview(previousSessionKey);
      publishedRuntimePreviewSessionKeyRef.current = null;
    }

    return () => {
      if (publishedRuntimePreviewSessionKeyRef.current) {
        clearCostumeRuntimePreview(publishedRuntimePreviewSessionKeyRef.current);
        publishedRuntimePreviewSessionKeyRef.current = null;
      }
    };
  }, [currentSession?.key]);

  useEffect(() => {
    setCanvasEditorMode((prev) => {
      if (prev === initialEditorMode) return prev;
      return currentCostumeIdRef.current === null ? initialEditorMode : prev;
    });
    setActiveTool((prev) => {
      if (currentCostumeIdRef.current !== null) return prev;
      return ensureToolForMode(initialEditorMode, prev);
    });
  }, [initialEditorMode]);

  const isCanvasReadyForSession = useCallback((session: CostumeEditorSession | null): boolean => {
    if (!canvasRef.current || !session) {
      return false;
    }
    return canvasRef.current.getLoadedSessionKey() === session.key;
  }, []);

  const clearScheduledRuntimeSync = useCallback(() => {
    coordinator.clearScheduledRuntimeSync();
  }, [coordinator]);

  const clearPublishedRuntimePreview = useCallback((session?: CostumeEditorSession | null) => {
    const targetKey = session
      ? getCostumeRuntimePreviewKeyForTarget(session)
      : publishedRuntimePreviewSessionKeyRef.current;
    if (!targetKey) {
      return;
    }

    clearCostumeRuntimePreview(targetKey);
    if (!session || session.key === publishedRuntimePreviewSessionKeyRef.current) {
      publishedRuntimePreviewSessionKeyRef.current = null;
    }
  }, []);

  const publishRuntimePreview = useCallback((
    session: CostumeEditorSession,
    revision: number,
    liveCanvasState: ActiveLayerCanvasState,
    syncMode: CostumeEditorPreviewSyncMode,
  ) => {
    const didPublish = publishCostumeRuntimePreviewFromCanvas({
      canvasSource: canvasRef.current,
      liveCanvasState,
      revision,
      session,
      syncMode,
    });
    if (!didPublish) {
      clearPublishedRuntimePreview(session);
      return;
    }
    publishedRuntimePreviewSessionKeyRef.current = session.key;
  }, [clearPublishedRuntimePreview]);

  const persistRuntimeStateToStore = useCallback((
    entry: CostumeRuntimeStateEntry,
    state: CostumeEditorPersistedState,
    options: { recordHistory?: boolean; renderedPreview?: boolean } = {},
  ): boolean => {
    const nextState = cloneCostumeEditorPersistedState(state);
    if (!nextState) {
      return false;
    }

    const currentProject = useProjectStore.getState().project;
    const currentTarget = currentProject
      ? resolveCostumeEditorTarget(currentProject, entry.session)
      : null;
    const storeAlreadyMatches = areCostumeEditorPersistedStatesEqual(
      createCostumeEditorPersistedStateFromCostume(currentTarget?.costume ?? null),
      nextState,
    );

    const didUpdate = updateCostumeFromEditor(entry.session, nextState, {
      recordHistory: options.recordHistory,
    });
    return didUpdate || storeAlreadyMatches;
  }, [updateCostumeFromEditor]);

  useEffect(() => {
    coordinator.setCallbacks({
      onHistoryFlagsChange: ({ canRedo: nextCanRedo, canUndo: nextCanUndo }) => {
        setCanUndo(nextCanUndo);
        setCanRedo(nextCanRedo);
      },
      onWorkingStateChange: (session, state) => {
        setWorkingPersistedStateSessionKey(session?.key ?? null);
        setWorkingPersistedStateState(state);
      },
      persistStateToStore: persistRuntimeStateToStore,
    });

    return () => {
      coordinator.setCallbacks({});
    };
  }, [coordinator, persistRuntimeStateToStore]);

  const resolvePersistedStateWithCanvasState = useCallback((
    liveCanvasState: ActiveLayerCanvasState | null | undefined,
    baseState?: CostumeEditorPersistedState | null,
  ): { state: CostumeEditorPersistedState; syncMode: CostumeEditorPreviewSyncMode } | null => {
    if (!liveCanvasState) {
      const fallbackState = cloneCostumeEditorPersistedState(baseState)
        ?? createCostumeEditorPersistedStateFromCostume(currentCostumeRef.current ?? null);
      return fallbackState
        ? { state: fallbackState, syncMode: 'render' }
        : null;
    }

    return resolveCostumeEditorPersistedStateWithSyncMode({
      workingState: baseState ?? coordinator.getWorkingPersistedStateForSession(currentSessionRef.current),
      costume: currentCostumeRef.current ?? null,
      liveCanvasState,
    });
  }, [coordinator]);

  const getWorkingPersistedState = useCallback((): CostumeEditorPersistedState | null => {
    return coordinator.getWorkingPersistedStateForSession(currentSessionRef.current)
      ?? createCostumeEditorPersistedStateFromCostume(currentCostumeRef.current ?? null);
  }, [coordinator]);

  const getCanvasPersistedStateForSession = useCallback((
    session: CostumeEditorSession | null,
    options: { skipLoadingGuard?: boolean } = {}
  ): CostumeEditorPersistedState | null => {
    if (!canvasRef.current || !session) return null;
    if (!options.skipLoadingGuard && isLoadingRef.current) return null;

    const state = canvasRef.current.exportCostumeState(session.key);
    if (!state?.activeLayerDataUrl) return null;

    return resolvePersistedStateWithCanvasState({
      editorMode: state.editorMode,
      dataUrl: state.activeLayerDataUrl,
      bitmapAssetFrame: state.bitmapAssetFrame,
      bitmapBounds: state.bitmapBounds,
      vectorDocument: state.vectorDocument,
    }, getWorkingPersistedState())?.state ?? null;
  }, [getWorkingPersistedState, resolvePersistedStateWithCanvasState]);

  const clearLoadingOverlayDelay = useCallback(() => {
    if (loadingOverlayTimeoutRef.current) {
      clearTimeout(loadingOverlayTimeoutRef.current);
      loadingOverlayTimeoutRef.current = null;
    }
  }, []);

  const beginSessionLoad = useCallback((showBlocker: boolean) => {
    clearLoadingOverlayDelay();
    isLoadingRef.current = true;
    setIsSessionLoading(showBlocker);
    setShowSessionLoadingOverlay(false);

    if (!showBlocker) {
      return;
    }

    const requestId = loadRequestIdRef.current;
    loadingOverlayTimeoutRef.current = setTimeout(() => {
      if (!isLoadingRef.current || loadRequestIdRef.current !== requestId) {
        return;
      }
      setShowSessionLoadingOverlay(true);
    }, 120);
  }, [clearLoadingOverlayDelay]);

  const finishSessionLoad = useCallback(() => {
    clearLoadingOverlayDelay();
    isLoadingRef.current = false;
    setIsSessionLoading(false);
    setShowSessionLoadingOverlay(false);
  }, [clearLoadingOverlayDelay]);

  const resetRuntimePersistenceState = useCallback((
    session: CostumeEditorSession | null,
    state: CostumeEditorPersistedState | null | undefined,
  ) => {
    coordinator.resetRuntimePersistenceState(session, state);
  }, [coordinator]);

  const resetDocumentHistory = useCallback((state: CostumeEditorPersistedState | null) => {
    coordinator.resetDocumentHistory(currentSessionRef.current, state);
  }, [coordinator]);

  const commitRuntimeState = useCallback((
    session: CostumeEditorSession | null,
    state: CostumeEditorPersistedState | null | undefined,
    options: {
      historyAction?: 'push' | 'replace' | 'none';
      syncMode?: CostumeEditorPreviewSyncMode;
      traceId?: string | null;
    } = {},
  ): CostumeRuntimeStateEntry | null => {
    return coordinator.commitRuntimeState(session, state, options);
  }, [coordinator]);

  const flushPendingRuntimeStateSync = useCallback((
    options: { recordHistory?: boolean; session?: CostumeEditorSession | null } = {},
  ): boolean => {
    return coordinator.flushPendingRuntimeStateSync(options);
  }, [coordinator]);

  const flushPendingRuntimeState = useCallback(async (
    options: {
      includePreview?: boolean;
      recordHistory?: boolean;
      session?: CostumeEditorSession | null;
    } = {},
  ): Promise<boolean> => {
    return coordinator.flushPendingRuntimeState(options);
  }, [coordinator]);

  const scheduleRuntimeStateSync = useCallback((entry: CostumeRuntimeStateEntry | null) => {
    coordinator.scheduleRuntimeStateSync(entry);
  }, [coordinator]);

  const persistCanvasStateToSession = useCallback((
    session: CostumeEditorSession | null,
    options: { skipLoadingGuard?: boolean; recordHistory?: boolean } = {}
  ): boolean => {
    if (!session) return false;

    if (flushPendingRuntimeStateSync({
      recordHistory: options.recordHistory,
      session,
    })) {
      return true;
    }
    if (!canvasRef.current) return false;
    if (!canvasRef.current.hasUnsavedChanges(session.key)) {
      return false;
    }

    const persistedState = getCanvasPersistedStateForSession(session, options);
    if (!persistedState) {
      return false;
    }

    const didPersist = updateCostumeFromEditor(session, persistedState, {
      recordHistory: options.recordHistory,
    });
    if (!didPersist) {
      return false;
    }
    coordinator.syncWorkingPersistedState(session, persistedState);
    canvasRef.current.markPersisted(session.key);
    resetRuntimePersistenceState(session, persistedState);
    return true;
  }, [
    coordinator,
    flushPendingRuntimeStateSync,
    getCanvasPersistedStateForSession,
    resetRuntimePersistenceState,
    updateCostumeFromEditor,
  ]);

  const commitDocumentMutation = useCallback((
    mutate: (
      state: CostumeEditorPersistedState,
    ) => Promise<CostumeEditorPersistedState['document'] | null> | CostumeEditorPersistedState['document'] | null,
    options: {
      forceReload?: boolean;
      recordHistory?: boolean;
      replaceCurrentHistoryState?: boolean;
      skipRuntimePreviewRefresh?: boolean;
    } = {},
  ) => {
    const queuedSessionKey = currentSessionRef.current?.key ?? null;
    if (!queuedSessionKey) {
      return Promise.resolve(false);
    }

    const loadPersistedStateIntoCanvas = async (
      session: CostumeEditorSession,
      state: CostumeEditorPersistedState,
    ): Promise<boolean> => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return false;
      }

      currentCostumeIdRef.current = `${session.costumeId}:${state.document.activeLayerId}`;
      await canvas.loadDocument(session.key, cloneCostumeDocument(state.document));

      const latestSession = currentSessionRef.current;
      if (!latestSession || latestSession.key !== session.key) {
        return false;
      }

      loadedSessionRef.current = latestSession;
      const resolvedMode = canvas.getEditorMode();
      setCanvasEditorMode(resolvedMode);
      setActiveTool((prev) => ensureToolForMode(resolvedMode, prev));
      return true;
    };

    const runCommit = async () => {
      const session = currentSessionRef.current;
      if (!session || session.key !== queuedSessionKey) {
        return false;
      }

      const baseState = getWorkingPersistedState();
      if (!baseState) {
        return false;
      }

      const nextDocument = await mutate(baseState);
      if (!nextDocument) {
        return false;
      }

      const resolvedNextState: CostumeEditorPersistedState = {
        assetId: baseState.assetId,
        bounds: baseState.bounds ? { ...baseState.bounds } : undefined,
        assetFrame: cloneCostumeAssetFrame(baseState.assetFrame),
        document: nextDocument,
      };

      const latestSession = currentSessionRef.current;
      if (!latestSession || latestSession.key !== queuedSessionKey) {
        return false;
      }

      const baseActiveLayer = getActiveCostumeLayer(baseState.document);
      const nextActiveLayer = getActiveCostumeLayer(nextDocument);
      const shouldReloadCanvas =
        options.forceReload === true ||
        baseState.document.activeLayerId !== nextDocument.activeLayerId ||
        getLayerCanvasSourceSignature(baseActiveLayer) !== getLayerCanvasSourceSignature(nextActiveLayer);

      const entry = commitRuntimeState(latestSession, resolvedNextState, {
        historyAction: options.recordHistory === false
          ? (options.replaceCurrentHistoryState ? 'replace' : 'none')
          : 'push',
        syncMode: options.skipRuntimePreviewRefresh === true ? 'stateOnly' : 'render',
      });
      if (!entry) {
        return false;
      }

      if (shouldReloadCanvas) {
        await loadPersistedStateIntoCanvas(latestSession, resolvedNextState);
      }

      scheduleRuntimeStateSync(entry);

      return true;
    };

    const queuedCommit = documentMutationChainRef.current.then(runCommit, runCommit);
    documentMutationChainRef.current = queuedCommit.then(() => undefined, () => undefined);
    return queuedCommit;
  }, [commitRuntimeState, getWorkingPersistedState, scheduleRuntimeStateSync]);

  const navigateDocumentHistory = useCallback((direction: 'undo' | 'redo') => {
    const queuedSessionKey = loadedSessionRef.current?.key ?? null;
    if (!queuedSessionKey) {
      return Promise.resolve(false);
    }

    const runNavigation = async () => {
      await canvasRef.current?.flushPendingBitmapCommits();
      await flushPendingRuntimeState({
        includePreview: false,
        session: loadedSessionRef.current,
      });

      if (isLoadingRef.current) {
        return false;
      }

      const session = loadedSessionRef.current;
      if (!session || session.key !== queuedSessionKey) {
        return false;
      }

      const currentIndex = coordinator.getHistoryIndex();
      const nextIndex = direction === 'undo'
        ? currentIndex - 1
        : currentIndex + 1;
      const nextSnapshot = coordinator.getHistorySnapshot(nextIndex);
      if (!nextSnapshot) {
        return false;
      }

      const previousIndex = currentIndex;
      coordinator.setHistoryIndex(nextIndex);
      const entry = commitRuntimeState(session, nextSnapshot, {
        historyAction: 'none',
        syncMode: 'render',
      });
      if (!entry) {
        coordinator.setHistoryIndex(previousIndex);
        return false;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        return true;
      }

      currentCostumeIdRef.current = `${session.costumeId}:${nextSnapshot.document.activeLayerId}`;
      await canvas.loadDocument(session.key, cloneCostumeDocument(nextSnapshot.document));

      const latestSession = currentSessionRef.current;
      if (!latestSession || latestSession.key !== session.key) {
        return false;
      }

      loadedSessionRef.current = latestSession;
      const resolvedMode = canvas.getEditorMode();
      setCanvasEditorMode(resolvedMode);
      setActiveTool((prev) => ensureToolForMode(resolvedMode, prev));
      scheduleRuntimeStateSync(entry);
      return true;
    };

    const queuedNavigation = documentMutationChainRef.current.then(runNavigation, runNavigation);
    documentMutationChainRef.current = queuedNavigation.then(() => undefined, () => undefined);
    return queuedNavigation;
  }, [
    coordinator,
    commitRuntimeState,
    flushPendingRuntimeState,
    scheduleRuntimeStateSync,
  ]);

  useEffect(() => {
    const handler: UndoRedoHandler = {
      undo: () => {
        void navigateDocumentHistory('undo');
      },
      redo: () => {
        void navigateDocumentHistory('redo');
      },
      canUndo: () => {
        if (coordinator.canUndo()) {
          return true;
        }
        const loadedSession = loadedSessionRef.current;
        return !!loadedSession && !!canvasRef.current?.hasUnsavedChanges(loadedSession.key);
      },
      canRedo: () => coordinator.canRedo(),
      beforeSelectionChange: ({ recordHistory }) => {
        persistCanvasStateToSession(loadedSessionRef.current, {
          skipLoadingGuard: true,
          recordHistory,
        });
      },
      flushPendingState: async (options) => {
        await canvasRef.current?.flushPendingBitmapCommits();
        persistCanvasStateToSession(loadedSessionRef.current, {
          skipLoadingGuard: true,
        });
        await flushPendingRuntimeState({
          includePreview: options?.includePreview ?? false,
          session: loadedSessionRef.current,
        });
        if (options?.settleHistory) {
          syncHistorySnapshot();
        }
      },
      deleteSelection: () => canvasRef.current?.deleteSelection() ?? false,
      duplicateSelection: () => canvasRef.current?.duplicateSelection() ?? false,
      isTextEditing: () => canvasRef.current?.isTextEditing() ?? false,
    };
    registerCostumeUndo(handler);
    return () => registerCostumeUndo(null);
  }, [coordinator, flushPendingRuntimeState, navigateDocumentHistory, persistCanvasStateToSession, registerCostumeUndo]);

  const resolvePersistedSessionForObjectOperation = useCallback((): CostumeEditorPersistedSession | undefined => {
    const session = currentSessionRef.current;
    if (!session) {
      return undefined;
    }

    const loadedSession = loadedSessionRef.current;
    if (
      loadedSession?.key === session.key &&
      isCanvasReadyForSession(loadedSession) &&
      canvasRef.current?.hasUnsavedChanges(loadedSession.key)
    ) {
      const persistedState = getCanvasPersistedStateForSession(loadedSession, { skipLoadingGuard: true });
      if (persistedState) {
        return {
          target: loadedSession,
          state: persistedState,
        };
      }
    }

    const fallbackState = coordinator.getWorkingPersistedStateForSession(session)
      ?? createCostumeEditorPersistedStateFromCostume(currentCostumeRef.current ?? null);
    if (!fallbackState) {
      return undefined;
    }

    return {
      target: session,
      state: fallbackState,
    };
  }, [coordinator, getCanvasPersistedStateForSession, isCanvasReadyForSession]);

  const applyOperationToCurrentObject = useCallback(async (operation: CostumeEditorOperation): Promise<boolean> => {
    if (!currentObjectTarget) {
      return false;
    }

    await canvasRef.current?.flushPendingBitmapCommits();
    persistCanvasStateToSession(loadedSessionRef.current, {
      skipLoadingGuard: true,
    });
    await flushPendingRuntimeState({
      includePreview: true,
      session: loadedSessionRef.current,
    });
    clearScheduledRuntimeSync();

    const loadedSession = loadedSessionRef.current;
    const persistedSession = resolvePersistedSessionForObjectOperation();

    const didApply = applyCostumeEditorOperation(currentObjectTarget, {
      persistedSession,
      operation,
    });
    if (
      didApply &&
      loadedSession &&
      persistedSession &&
      persistedSession.target.sceneId === loadedSession.sceneId &&
      persistedSession.target.objectId === loadedSession.objectId &&
      persistedSession.target.costumeId === loadedSession.costumeId
    ) {
      canvasRef.current?.markPersisted(loadedSession.key);
      resetRuntimePersistenceState(loadedSession, persistedSession.state);
    }
    return didApply;
  }, [
    applyCostumeEditorOperation,
    clearScheduledRuntimeSync,
    currentObjectTarget,
    flushPendingRuntimeState,
    persistCanvasStateToSession,
    resetRuntimePersistenceState,
    resolvePersistedSessionForObjectOperation,
  ]);

  useEffect(() => {
    const previousSelection = previousSelectionRef.current;
    const selectionChanged =
      previousSelection.sceneId !== selectedSceneId ||
      previousSelection.objectId !== selectedObjectId;

    if (selectionChanged) {
      const pendingRuntimeEntry = coordinator.getLatestRuntimeStateEntry();
      const pendingRenderedEntry = coordinator.getLatestRenderedRuntimeStateEntry();
      if (
        pendingRuntimeEntry
        && (!pendingRenderedEntry
          || pendingRenderedEntry.session.key !== pendingRuntimeEntry.session.key
          || pendingRenderedEntry.revision !== pendingRuntimeEntry.revision)
      ) {
        void flushPendingRuntimeState({
          includePreview: true,
          session: pendingRuntimeEntry.session,
        });
      } else {
        clearScheduledRuntimeSync();
      }

      loadRequestIdRef.current += 1;
      currentCostumeIdRef.current = null;
      beginSessionLoad(!!selectedObjectId);
    }

    previousSelectionRef.current = {
      sceneId: selectedSceneId,
      objectId: selectedObjectId,
    };
  }, [
    beginSessionLoad,
    clearScheduledRuntimeSync,
    coordinator,
    flushPendingRuntimeState,
    selectedSceneId,
    selectedObjectId,
  ]);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (!editorCostume || !currentSession) {
      currentCostumeIdRef.current = null;
      const requestId = ++loadRequestIdRef.current;
      beginSessionLoad(!!selectedObjectId);
      const fallbackMode: CostumeEditorMode = 'bitmap';
      setCanvasEditorMode(fallbackMode);
      setActiveTool((prev) => ensureToolForMode(fallbackMode, prev));

      canvasRef.current.loadFromDataURL('', null).finally(() => {
        if (loadRequestIdRef.current !== requestId) return;
        loadedSessionRef.current = null;
        resetDocumentHistory(null);
        finishSessionLoad();
        const resolvedMode = canvasRef.current?.getEditorMode() ?? fallbackMode;
        setCanvasEditorMode(resolvedMode);
        setActiveTool((prev) => ensureToolForMode(resolvedMode, prev));
      });
      return;
    }

    const loadedSessionKey = canvasRef.current.getLoadedSessionKey();
    if (currentCostumeIdRef.current !== currentCostumeLoadKey || loadedSessionKey !== currentSession.key) {
      currentCostumeIdRef.current = currentCostumeLoadKey;
      const requestId = ++loadRequestIdRef.current;
      beginSessionLoad(true);

      const nextMode = getInitialCostumeEditorMode(editorCostume);
      setCanvasEditorMode(nextMode);
      setActiveTool((prev) => ensureToolForMode(nextMode, prev));

      canvasRef.current.loadDocument(currentSession.key, cloneCostumeDocument(editorCostume.document)).finally(() => {
        if (loadRequestIdRef.current !== requestId) return;
        loadedSessionRef.current = currentSession;
        resetDocumentHistory({
          assetId: editorCostume.assetId,
          bounds: editorCostume.bounds,
          assetFrame: cloneCostumeAssetFrame(editorCostume.assetFrame),
          document: editorCostume.document,
        });
        finishSessionLoad();
        const resolvedMode = canvasRef.current?.getEditorMode() ?? nextMode;
        setCanvasEditorMode(resolvedMode);
        setActiveTool((prev) => ensureToolForMode(resolvedMode, prev));
      });
    }
  }, [beginSessionLoad, currentCostumeLoadKey, currentSession, editorCostume, finishSessionLoad, resetDocumentHistory, selectedObjectId]);

  useEffect(() => {
    return () => {
      clearLoadingOverlayDelay();
      clearScheduledRuntimeSync();
      persistCanvasStateToSession(loadedSessionRef.current, {
        skipLoadingGuard: true,
      });
    };
  }, [clearLoadingOverlayDelay, clearScheduledRuntimeSync, persistCanvasStateToSession]);

  const handleHistoryChange = useCallback((change: CostumeCanvasHistoryChange) => {
    if (isLoadingRef.current) {
      return;
    }

    const liveCanvasState = change.state;
    const loadedSession = loadedSessionRef.current;
    if (!loadedSession || !isCanvasReadyForSession(loadedSession)) {
      return;
    }
    if (canvasRef.current?.getHistoryGeneration() !== change.generation) {
      return;
    }

    const traceId = consumeActiveCostumeCommitPerfTrace();
    const handleHistoryChangeStartMs = traceId ? performance.now() : 0;
    const resolvedPersistedState = resolvePersistedStateWithCanvasState(
      liveCanvasState,
      getWorkingPersistedState(),
    );
    if (!resolvedPersistedState) {
      return;
    }

    const entry = commitRuntimeState(loadedSession, resolvedPersistedState.state, {
      historyAction: 'push',
      syncMode: resolvedPersistedState.syncMode,
      traceId,
    });
    if (entry) {
      canvasRef.current?.markPersisted(loadedSession.key, liveCanvasState);
      publishRuntimePreview(
        loadedSession,
        entry.revision,
        liveCanvasState,
        resolvedPersistedState.syncMode,
      );
      scheduleRuntimeStateSync(entry);
    }
    if (traceId) {
      recordCostumeCommitPerfPhase(traceId, 'handleHistoryChangeMs', performance.now() - handleHistoryChangeStartMs);
    }
  }, [
    commitRuntimeState,
    getWorkingPersistedState,
    isCanvasReadyForSession,
    publishRuntimePreview,
    resolvePersistedStateWithCanvasState,
    scheduleRuntimeStateSync,
  ]);

  const handleSelectCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId) return;

    const nextCostume = costumes[index];
    if (!nextCostume) return;

    void applyOperationToCurrentObject({
      type: 'select',
      costumeId: nextCostume.id,
    });
  }, [applyOperationToCurrentObject, costumes, selectedObjectId, selectedSceneId]);

  const handleAddCostume = useCallback((costume: Costume) => {
    if (!selectedSceneId || !selectedObjectId) return;

    void applyOperationToCurrentObject({
      type: 'add',
      costume,
    });
  }, [applyOperationToCurrentObject, selectedObjectId, selectedSceneId]);

  const handleDeleteCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId) return;

    const costume = costumes[index];
    if (!costume) return;

    void applyOperationToCurrentObject({
      type: 'remove',
      costumeId: costume.id,
    });
  }, [applyOperationToCurrentObject, costumes, selectedObjectId, selectedSceneId]);

  const handleRenameCostume = useCallback((index: number, name: string) => {
    if (!selectedSceneId || !selectedObjectId) return;

    const costume = costumes[index];
    if (!costume) return;

    void applyOperationToCurrentObject({
      type: 'rename',
      costumeId: costume.id,
      name,
    });
  }, [applyOperationToCurrentObject, costumes, selectedObjectId, selectedSceneId]);

  const handleSelectLayer = useCallback((layerId: string) => {
    if (isLoadingRef.current) {
      return;
    }

    void commitDocumentMutation((working) => {
      if (working.document.activeLayerId === layerId) {
        return null;
      }
      return setActiveCostumeLayer(working.document, layerId);
    }, {
      recordHistory: false,
      replaceCurrentHistoryState: true,
      skipRuntimePreviewRefresh: true,
    });
  }, [commitDocumentMutation]);

  const handleAddVectorLayer = useCallback(() => {
    if (isLoadingRef.current) {
      return;
    }

    void commitDocumentMutation((working) => insertCostumeLayerAfterActive(
      working.document,
      createVectorLayer({ name: `Layer ${working.document.layers.length + 1}` }),
    ));
  }, [commitDocumentMutation]);

  const handleAddBitmapLayer = useCallback(() => {
    if (isLoadingRef.current) {
      return;
    }

    void commitDocumentMutation((working) => insertCostumeLayerAfterActive(
      working.document,
      createBitmapLayer({ name: `Layer ${working.document.layers.length + 1}` }),
    ));
  }, [commitDocumentMutation]);

  const handleDuplicateLayer = useCallback((layerId: string) => {
    void commitDocumentMutation((working) => duplicateCostumeLayer(working.document, layerId));
  }, [commitDocumentMutation]);

  const handleDeleteLayer = useCallback((layerId: string) => {
    void commitDocumentMutation((working) => removeCostumeLayer(working.document, layerId));
  }, [commitDocumentMutation]);

  const handleReorderLayer = useCallback((layerId: string, targetIndex: number) => {
    void commitDocumentMutation((working) => reorderCostumeLayer(working.document, layerId, targetIndex), {
      forceReload: false,
    });
  }, [commitDocumentMutation]);

  const handleToggleLayerVisibility = useCallback((layerId: string) => {
    const currentDocument = currentCostumeRef.current?.document;
    const currentLayer = currentDocument ? getCostumeLayerById(currentDocument, layerId) : null;
    const nextVisible = currentLayer ? !currentLayer.visible : null;

    void commitDocumentMutation((working) => {
      const layer = getCostumeLayerById(working.document, layerId);
      const resolvedVisible = nextVisible ?? (layer ? !layer.visible : null);
      if (!layer || resolvedVisible === null) {
        return null;
      }
      return setCostumeLayerVisibility(working.document, layerId, resolvedVisible);
    });
  }, [commitDocumentMutation]);

  const handleToggleLayerLocked = useCallback((layerId: string) => {
    void commitDocumentMutation((working) => {
      const layer = getCostumeLayerById(working.document, layerId);
      if (!layer) {
        return null;
      }
      return updateCostumeLayer(working.document, layerId, {
        locked: !layer.locked,
      });
    }, {
      skipRuntimePreviewRefresh: true,
    });
  }, [commitDocumentMutation]);

  const handleRenameLayer = useCallback((layerId: string, name: string) => {
    void commitDocumentMutation((working) => updateCostumeLayer(working.document, layerId, { name }), {
      skipRuntimePreviewRefresh: true,
    });
  }, [commitDocumentMutation]);

  const handleLayerOpacityChange = useCallback((layerId: string, opacity: number) => {
    void commitDocumentMutation((working) => updateCostumeLayer(working.document, layerId, { opacity }), {
      forceReload: false,
    });
  }, [commitDocumentMutation]);

  const handleRasterizeLayer = useCallback((layerId: string) => {
    void commitDocumentMutation(async (working) => {
      const layer = getCostumeLayerById(working.document, layerId);
      if (!isVectorCostumeLayer(layer)) {
        return null;
      }

      const rasterizedLayer = await rasterizeCostumeLayer(layer);
      if (!rasterizedLayer) {
        return null;
      }
      const nextDocument = updateCostumeLayer(working.document, layerId, {});
      if (!nextDocument) {
        return null;
      }
      const layerIndex = getCostumeLayerIndex(nextDocument, layerId);
      if (layerIndex < 0) {
        return null;
      }
      nextDocument.layers[layerIndex] = rasterizedLayer;
      return nextDocument;
    });
  }, [commitDocumentMutation]);

  const handleMergeLayerDown = useCallback((layerId: string) => {
    void commitDocumentMutation(async (working) => {
      const upperIndex = getCostumeLayerIndex(working.document, layerId);
      if (upperIndex <= 0) {
        return null;
      }

      const lowerLayer = working.document.layers[upperIndex - 1];
      const upperLayer = working.document.layers[upperIndex];
      if (!lowerLayer || !upperLayer) {
        return null;
      }

      const mergedLayer = await mergeCostumeLayers(lowerLayer, upperLayer);

      const nextDocument = {
        ...working.document,
        activeLayerId: lowerLayer.id,
        layers: working.document.layers.filter((layer) => layer.id !== upperLayer.id),
      };
      const lowerIndex = getCostumeLayerIndex(nextDocument, lowerLayer.id);
      if (lowerIndex < 0) {
        return null;
      }
      nextDocument.layers = nextDocument.layers.map((layer, index) => index === lowerIndex ? mergedLayer : layer);
      return nextDocument;
    });
  }, [commitDocumentMutation]);

  const handleCanvasModeChange = useCallback((mode: CostumeEditorMode) => {
    setCanvasEditorMode(mode);
    setActiveTool((prev) => ensureToolForMode(mode, prev));
    if (mode !== 'vector') {
      setIsVectorPointEditing(false);
      setHasTextSelection(false);
    }
  }, []);

  const handleToolChange = useCallback((tool: DrawingTool) => {
    if (isLoadingRef.current || !activeLayer || activeLayer.visible === false) {
      return;
    }
    setActiveTool(ensureToolForMode(editorMode, tool));
  }, [activeLayer, editorMode]);

  useEffect(() => {
    setActiveTool((prev) => ensureToolForMode(editorMode, prev));
    if (editorMode !== 'vector') {
      setIsVectorPointEditing(false);
      setHasSelectedVectorPoints(false);
      setHasTextSelection(false);
    }
  }, [editorMode]);

  useEffect(() => {
    if (
      activeObjectTab !== 'costumes' ||
      !selectedSceneId ||
      !selectedObjectId ||
      !costumeColliderEditorRequest ||
      costumeColliderEditorRequest.sceneId !== selectedSceneId ||
      costumeColliderEditorRequest.objectId !== selectedObjectId ||
      !collider?.type ||
      collider.type === 'none'
    ) {
      return;
    }

    consumeCostumeColliderEditorRequest(selectedSceneId, selectedObjectId);
    setActiveTool('collider');
  }, [
    activeObjectTab,
    collider,
    consumeCostumeColliderEditorRequest,
    costumeColliderEditorRequest,
    selectedObjectId,
    selectedSceneId,
  ]);

  useEffect(() => {
    if (activeTool !== 'collider') {
      return;
    }
    if (collider?.type && collider.type !== 'none') {
      return;
    }
    setActiveTool(ensureToolForMode(editorMode, 'select'));
  }, [activeTool, collider, editorMode]);

  useEffect(() => {
    if (!activeLayer?.locked) {
      return;
    }
    if (activeTool === 'select') {
      return;
    }
    setActiveTool('select');
  }, [activeLayer?.locked, activeTool]);

  useEffect(() => {
    if (activeLayer?.visible !== false) {
      return;
    }
    setHasCanvasSelection(false);
    setHasBitmapFloatingSelection(false);
    setIsVectorPointEditing(false);
    setHasSelectedVectorPoints(false);
    setHasTextSelection(false);
    setActiveTool('select');
  }, [activeLayer]);

  useEffect(() => {
    if (activeObjectTab !== 'costumes') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!activeLayer || activeLayer.visible === false) {
        return;
      }
      if (isLoadingRef.current) {
        return;
      }
      if (shouldIgnoreGlobalKeyboardEvent(event)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (canvasRef.current?.isTextEditing()) {
        return;
      }

      const nextTool = resolveCostumeToolShortcut(event.key, editorMode);
      if (!nextTool) {
        return;
      }

      event.preventDefault();
      setActiveTool((prev) => {
        const resolvedTool = ensureToolForMode(editorMode, nextTool);
        return prev === resolvedTool ? prev : resolvedTool;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeLayer, activeObjectTab, editorMode]);

  const handleMoveOrder = useCallback((action: MoveOrderAction) => {
    if (isLoadingRef.current) {
      return;
    }
    canvasRef.current?.moveSelectionOrder(action);
  }, []);

  const handleAlign = useCallback((action: AlignAction) => {
    if (isLoadingRef.current) {
      return;
    }
    canvasRef.current?.alignSelection(action);
  }, []);

  const handleFlipSelection = useCallback((axis: SelectionFlipAxis) => {
    if (isLoadingRef.current) {
      return;
    }
    canvasRef.current?.flipSelection(axis);
  }, []);

  const handleRotateSelection = useCallback(() => {
    if (isLoadingRef.current) {
      return;
    }
    canvasRef.current?.rotateSelection();
  }, []);

  const handleSelectionStateChange = useCallback((state: { hasSelection: boolean; hasBitmapFloatingSelection: boolean }) => {
    setHasCanvasSelection(state.hasSelection);
    setHasBitmapFloatingSelection(state.hasBitmapFloatingSelection);
  }, []);

  const handleTextStyleChange = useCallback((updates: Partial<TextToolStyle>) => {
    setTextStyle((prev) => {
      const next = { ...prev, ...updates };
      if (
        next.fontFamily === prev.fontFamily &&
        next.fontSize === prev.fontSize &&
        next.fontWeight === prev.fontWeight &&
        next.fontStyle === prev.fontStyle &&
        next.underline === prev.underline &&
        next.textAlign === prev.textAlign &&
        next.opacity === prev.opacity
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const handleVectorStyleChange = useCallback((updates: Partial<VectorToolStyle>) => {
    setVectorStyle((prev) => {
      const next = { ...prev, ...updates };
      if (
        next.fillColor === prev.fillColor &&
        next.fillTextureId === prev.fillTextureId &&
        next.strokeColor === prev.strokeColor &&
        next.strokeWidth === prev.strokeWidth &&
        next.strokeBrushId === prev.strokeBrushId
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const handleBitmapShapeStyleChange = useCallback((updates: Partial<BitmapShapeStyle>) => {
    setBitmapShapeStyle((prev) => {
      const next = { ...prev, ...updates };
      if (
        next.fillColor === prev.fillColor &&
        next.strokeColor === prev.strokeColor &&
        next.strokeWidth === prev.strokeWidth
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const handleBitmapFillStyleChange = useCallback((updates: Partial<BitmapFillStyle>) => {
    setBitmapFillStyle((prev) => {
      const next = { ...prev, ...updates };
      if (next.textureId === prev.textureId) {
        return prev;
      }
      return next;
    });
  }, []);

  const handleColliderChange = useCallback((newCollider: ColliderConfig) => {
    const loadedSession = loadedSessionRef.current;
    if (!loadedSession || isLoadingRef.current || !isCanvasReadyForSession(loadedSession)) return;

    updateObject(loadedSession.sceneId, loadedSession.objectId, { collider: newCollider });
  }, [isCanvasReadyForSession, updateObject]);

  const requestActiveStyleCommit = useCallback(() => {
    setActiveStyleCommitRequest((prev) => prev + 1);
  }, []);

  const handleUndo = useCallback(() => {
    void navigateDocumentHistory('undo');
  }, [navigateDocumentHistory]);

  const handleRedo = useCallback(() => {
    void navigateDocumentHistory('redo');
  }, [navigateDocumentHistory]);

  if (!object) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        {NO_OBJECT_SELECTED_MESSAGE}
      </div>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      <CostumeList
        costumes={costumes}
        selectedIndex={currentCostumeIndex}
        onSelectCostume={handleSelectCostume}
        onAddCostume={handleAddCostume}
        onDeleteCostume={handleDeleteCostume}
        onRenameCostume={handleRenameCostume}
      />

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {activeLayer && activeLayer.visible ? (
          <CostumeToolbar
            editorMode={editorMode}
            activeTool={activeTool}
            hasActiveSelection={editorMode === 'bitmap' ? hasBitmapFloatingSelection : hasCanvasSelection}
            showTextControls={editorMode === 'vector' && (activeTool === 'text' || hasTextSelection)}
            isVectorPointEditing={isVectorPointEditing}
            hasSelectedVectorPoints={hasSelectedVectorPoints}
            bitmapBrushKind={bitmapBrushKind}
            brushColor={brushColor}
            brushSize={brushSize}
            bitmapFillStyle={bitmapFillStyle}
            bitmapShapeStyle={bitmapShapeStyle}
            textStyle={textStyle}
            vectorStyle={vectorStyle}
            vectorStyleCapabilities={vectorStyleCapabilities}
            previewScale={canvasPreviewScale}
            onToolChange={handleToolChange}
            onMoveOrder={handleMoveOrder}
            onFlipSelection={handleFlipSelection}
            onRotateSelection={handleRotateSelection}
            vectorHandleMode={vectorHandleMode}
            onVectorHandleModeChange={(mode) => setVectorHandleMode(mode)}
            onAlign={handleAlign}
            alignDisabled={editorMode === 'bitmap' ? !hasBitmapFloatingSelection : !hasCanvasSelection}
            onColorChange={setBrushColor}
            onActiveStyleCommit={requestActiveStyleCommit}
            onBitmapBrushKindChange={setBitmapBrushKind}
            onBrushSizeChange={setBrushSize}
            onBitmapFillStyleChange={handleBitmapFillStyleChange}
            onBitmapShapeStyleChange={handleBitmapShapeStyleChange}
            onTextStyleChange={handleTextStyleChange}
            onVectorStyleChange={handleVectorStyleChange}
          />
        ) : null}

        <div className="relative flex min-h-0 min-w-0 flex-1">
          <CostumeCanvas
            ref={canvasRef}
            activeStyleCommitRequest={activeStyleCommitRequest}
            costumeDocument={editorCostume?.document ?? null}
            initialEditorMode={initialEditorMode}
            isVisible={activeObjectTab === 'costumes'}
            activeTool={activeTool}
            bitmapBrushKind={bitmapBrushKind}
            brushColor={brushColor}
            brushSize={brushSize}
            bitmapFillStyle={bitmapFillStyle}
            bitmapShapeStyle={bitmapShapeStyle}
            vectorHandleMode={vectorHandleMode}
            textStyle={textStyle}
            vectorStyle={vectorStyle}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            collider={collider}
            onHistoryChange={handleHistoryChange}
            onColliderChange={handleColliderChange}
            onModeChange={handleCanvasModeChange}
            onTextStyleSync={handleTextStyleChange}
            onVectorStyleSync={handleVectorStyleChange}
            onVectorHandleModeSync={setVectorHandleMode}
            onVectorStyleCapabilitiesSync={setVectorStyleCapabilities}
            onVectorPointEditingChange={setIsVectorPointEditing}
            onVectorPointSelectionChange={setHasSelectedVectorPoints}
            onTextSelectionChange={setHasTextSelection}
            onSelectionStateChange={handleSelectionStateChange}
            onViewScaleChange={setCanvasPreviewScale}
          />
          {editorCostume ? (
            <CostumeLayerPanel
              document={editorCostume.document}
              activeLayer={activeLayer}
              onSelectLayer={handleSelectLayer}
              onAddBitmapLayer={handleAddBitmapLayer}
              onAddVectorLayer={handleAddVectorLayer}
              onDuplicateLayer={handleDuplicateLayer}
              onDeleteLayer={handleDeleteLayer}
              onReorderLayer={handleReorderLayer}
              onToggleVisibility={handleToggleLayerVisibility}
              onToggleLocked={handleToggleLayerLocked}
              onRenameLayer={handleRenameLayer}
              onOpacityChange={handleLayerOpacityChange}
              onMergeDown={handleMergeLayerDown}
              onRasterizeLayer={handleRasterizeLayer}
            />
          ) : null}
        </div>
      </div>

      {isSessionLoading && (
        <div className={`absolute inset-0 z-20 ${showSessionLoadingOverlay ? 'flex items-center justify-center bg-background/70 text-sm text-muted-foreground backdrop-blur-[1px]' : 'bg-transparent'}`}>
          {showSessionLoadingOverlay ? 'Switching costume editor to the selected object...' : null}
        </div>
      )}
    </div>
  );
}
