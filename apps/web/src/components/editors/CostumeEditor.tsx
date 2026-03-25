import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore, type UndoRedoHandler } from '@/store/editorStore';
import { CostumeList } from './costume/CostumeList';
import { CostumeLayerPanel } from './costume/CostumeLayerPanel';
import {
  CostumeCanvas,
  DEFAULT_COSTUME_PREVIEW_SCALE,
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
import type { Costume, ColliderConfig, CostumeDocument, CostumeEditorMode } from '@/types';
import {
  areCostumeBoundsEqual,
  areCostumeDocumentsEqual,
  createCostumeEditorSession,
  resolveCostumeEditorPersistedState,
  type CostumeEditorObjectTarget,
  type CostumeEditorOperation,
  type CostumeEditorPersistedSession,
  type CostumeEditorPersistedState,
  type CostumeEditorSession,
  type CostumeEditorTarget,
  resolveCostumeEditorTarget,
} from '@/lib/editor/costumeEditorSession';
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
  moveCostumeLayer,
  removeCostumeLayer,
  setActiveCostumeLayer,
  setCostumeLayerVisibility,
  updateCostumeLayer,
  type ActiveLayerCanvasState,
} from '@/lib/costume/costumeDocument';
import {
  renderCostumeDocumentPreview,
  renderCostumeLayerStackToDataUrl,
} from '@/lib/costume/costumeDocumentRender';

const VECTOR_TOOLS = new Set<DrawingTool>(['select', 'pen', 'brush', 'rectangle', 'circle', 'triangle', 'star', 'line', 'text', 'collider']);
const BITMAP_TOOLS = new Set<DrawingTool>(['select', 'brush', 'eraser', 'fill', 'circle', 'rectangle', 'triangle', 'star', 'line', 'collider']);
const MAX_DOCUMENT_HISTORY_ENTRIES = 100;

function clonePersistedState(
  state: CostumeEditorPersistedState | null | undefined,
): CostumeEditorPersistedState | null {
  if (!state) {
    return null;
  }

  return {
    assetId: state.assetId,
    bounds: state.bounds ? { ...state.bounds } : undefined,
    document: cloneCostumeDocument(state.document),
  };
}

function arePersistedStatesEqual(
  a: CostumeEditorPersistedState | null | undefined,
  b: CostumeEditorPersistedState | null | undefined,
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return (
    a.assetId === b.assetId &&
    areCostumeBoundsEqual(a.bounds, b.bounds) &&
    areCostumeDocumentsEqual(a.document, b.document)
  );
}

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
  const workingPersistedStateSessionKeyRef = useRef<string | null>(null);
  const loadingOverlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flattenedPreviewRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(true);
  const loadedSessionRef = useRef<CostumeEditorSession | null>(null);
  const currentSessionRef = useRef<CostumeEditorSession | null>(null);
  const documentHistoryRef = useRef<CostumeDocument[]>([]);
  const documentHistoryIndexRef = useRef(-1);
  const workingPersistedStateRef = useRef<CostumeEditorPersistedState | null>(null);
  const documentMutationChainRef = useRef<Promise<void>>(Promise.resolve());
  const flattenedPreviewRefreshIdRef = useRef(0);
  const scheduleFlattenedPreviewRefreshRef = useRef((
    _session: CostumeEditorSession,
    _document: CostumeEditorPersistedState['document'],
  ) => {});
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
  const currentWorkingPersistedState = currentSession && workingPersistedStateSessionKeyRef.current === currentSession.key
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

  const setWorkingPersistedState = useCallback((
    session: CostumeEditorSession | null,
    state: CostumeEditorPersistedState | null | undefined,
  ) => {
    const nextState = clonePersistedState(state);
    const nextSessionKey = session?.key ?? null;
    if (
      workingPersistedStateSessionKeyRef.current === nextSessionKey &&
      arePersistedStatesEqual(workingPersistedStateRef.current, nextState)
    ) {
      return;
    }
    workingPersistedStateSessionKeyRef.current = nextSessionKey;
    workingPersistedStateRef.current = nextState;
    setWorkingPersistedStateState(nextState);
  }, []);

  const createPersistedStateFromCostume = useCallback((
    costume: Costume | null | undefined,
  ): CostumeEditorPersistedState | null => {
    if (!costume) {
      return null;
    }

    return {
      assetId: costume.assetId,
      bounds: costume.bounds ? { ...costume.bounds } : undefined,
      document: cloneCostumeDocument(costume.document),
    };
  }, []);

  const resolvePersistedStateWithCanvasState = useCallback((
    liveCanvasState: ActiveLayerCanvasState | null | undefined,
    baseState?: CostumeEditorPersistedState | null,
  ): CostumeEditorPersistedState | null => {
    if (!liveCanvasState) {
      return clonePersistedState(baseState)
        ?? createPersistedStateFromCostume(currentCostumeRef.current ?? null);
    }

    return resolveCostumeEditorPersistedState({
      workingState: baseState ?? workingPersistedStateRef.current,
      costume: currentCostumeRef.current ?? null,
      liveCanvasState,
    });
  }, [createPersistedStateFromCostume]);

  const getWorkingPersistedState = useCallback((): CostumeEditorPersistedState | null => {
    const session = currentSessionRef.current;
    const workingState = session && workingPersistedStateSessionKeyRef.current === session.key
      ? workingPersistedStateRef.current
      : null;

    return clonePersistedState(workingState)
      ?? createPersistedStateFromCostume(currentCostumeRef.current ?? null);
  }, [createPersistedStateFromCostume]);

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
      vectorDocument: state.vectorDocument,
    }, getWorkingPersistedState());
  }, [getWorkingPersistedState, resolvePersistedStateWithCanvasState]);

  const createPersistedStateFromDocument = useCallback((
    document: CostumeDocument | null | undefined,
  ): CostumeEditorPersistedState | null => {
    if (!document) {
      return null;
    }

    const workingState = getWorkingPersistedState();
    const fallbackCostume = currentCostumeRef.current;
    const assetId = workingState?.assetId ?? fallbackCostume?.assetId;
    if (!assetId) {
      return null;
    }

    return {
      assetId,
      bounds: workingState?.bounds
        ? { ...workingState.bounds }
        : fallbackCostume?.bounds
          ? { ...fallbackCostume.bounds }
          : undefined,
      document: cloneCostumeDocument(document),
    };
  }, [getWorkingPersistedState]);

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

  const syncDocumentHistoryFlags = useCallback(() => {
    setCanUndo(documentHistoryIndexRef.current > 0);
    setCanRedo(documentHistoryIndexRef.current >= 0 && documentHistoryIndexRef.current < documentHistoryRef.current.length - 1);
  }, []);

  const resetDocumentHistory = useCallback((state: CostumeEditorPersistedState | null) => {
    setWorkingPersistedState(currentSessionRef.current, state);
    documentHistoryRef.current = state ? [cloneCostumeDocument(state.document)] : [];
    documentHistoryIndexRef.current = state ? 0 : -1;
    syncDocumentHistoryFlags();
  }, [setWorkingPersistedState, syncDocumentHistoryFlags]);

  const replaceDocumentHistoryHead = useCallback((document: CostumeDocument) => {
    if (documentHistoryIndexRef.current < 0) {
      documentHistoryRef.current = [cloneCostumeDocument(document)];
      documentHistoryIndexRef.current = 0;
      syncDocumentHistoryFlags();
      return;
    }

    const nextHistory = [...documentHistoryRef.current];
    nextHistory[documentHistoryIndexRef.current] = cloneCostumeDocument(document);
    documentHistoryRef.current = nextHistory;
    syncDocumentHistoryFlags();
  }, [syncDocumentHistoryFlags]);

  const pushDocumentHistory = useCallback((document: CostumeDocument) => {
    const current = documentHistoryRef.current[documentHistoryIndexRef.current] ?? null;
    if (areCostumeDocumentsEqual(current, document)) {
      syncDocumentHistoryFlags();
      return;
    }

    const nextHistory = documentHistoryRef.current
      .slice(0, documentHistoryIndexRef.current + 1)
      .concat([cloneCostumeDocument(document)]);
    const trimmedHistory = nextHistory.length > MAX_DOCUMENT_HISTORY_ENTRIES
      ? nextHistory.slice(nextHistory.length - MAX_DOCUMENT_HISTORY_ENTRIES)
      : nextHistory;
    documentHistoryRef.current = trimmedHistory;
    documentHistoryIndexRef.current = trimmedHistory.length - 1;
    syncDocumentHistoryFlags();
  }, [syncDocumentHistoryFlags]);

  const persistCanvasStateToSession = useCallback((
    session: CostumeEditorSession | null,
    options: { skipLoadingGuard?: boolean; recordHistory?: boolean } = {}
  ): boolean => {
    if (!session || !canvasRef.current) return false;
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
    setWorkingPersistedState(session, persistedState);
    canvasRef.current.markPersisted(session.key);
    scheduleFlattenedPreviewRefreshRef.current(session, persistedState.document);
    return true;
  }, [getCanvasPersistedStateForSession, setWorkingPersistedState, updateCostumeFromEditor]);

  const applyDocumentHistoryState = useCallback((
    session: CostumeEditorSession | null,
    state: CostumeEditorPersistedState | null | undefined,
    options: { recordHistory?: boolean; forceReload?: boolean; refreshRuntimePreview?: boolean } = {},
  ) => {
    if (!session || !state) {
      return false;
    }

    if (options.forceReload) {
      currentCostumeIdRef.current = null;
    }

    const didUpdate = updateCostumeFromEditor(session, state, {
      recordHistory: options.recordHistory,
    });
    if (didUpdate) {
      setWorkingPersistedState(session, state);
      if (options.refreshRuntimePreview === true) {
        scheduleFlattenedPreviewRefreshRef.current(session, state.document);
      }
    }
    return didUpdate;
  }, [setWorkingPersistedState, updateCostumeFromEditor]);

  const scheduleFlattenedPreviewRefresh = useCallback((
    session: CostumeEditorSession,
    document: CostumeEditorPersistedState['document'],
  ) => {
    const requestId = ++flattenedPreviewRefreshIdRef.current;
    const nextDocument = cloneCostumeDocument(document);

    if (flattenedPreviewRefreshTimeoutRef.current) {
      clearTimeout(flattenedPreviewRefreshTimeoutRef.current);
    }

    flattenedPreviewRefreshTimeoutRef.current = setTimeout(() => {
      flattenedPreviewRefreshTimeoutRef.current = null;

      void renderCostumeDocumentPreview(nextDocument).then((rendered) => {
        if (flattenedPreviewRefreshIdRef.current !== requestId) {
          return;
        }

        const project = useProjectStore.getState().project;
        if (!project) {
          return;
        }

        const resolvedTarget = resolveCostumeEditorTarget(project, session);
        if (!resolvedTarget || !areCostumeDocumentsEqual(resolvedTarget.costume.document, nextDocument)) {
          return;
        }

        const refreshedState: CostumeEditorPersistedState = {
          assetId: rendered.dataUrl,
          bounds: rendered.bounds ?? undefined,
          document: nextDocument,
        };

        const didApply = updateCostumeFromEditor(session, refreshedState, {
          recordHistory: false,
        });
        if (!didApply) {
          return;
        }

        const currentHistoryDocument = documentHistoryRef.current[documentHistoryIndexRef.current] ?? null;
        if (
          currentSessionRef.current?.key === session.key &&
          currentHistoryDocument &&
          areCostumeDocumentsEqual(currentHistoryDocument, nextDocument)
        ) {
          setWorkingPersistedState(session, refreshedState);
        }
      }).catch((error) => {
        console.warn('Failed to refresh flattened costume preview after document update.', error);
      });
    }, 90);
  }, [setWorkingPersistedState, updateCostumeFromEditor]);
  scheduleFlattenedPreviewRefreshRef.current = scheduleFlattenedPreviewRefresh;

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

      if (options.recordHistory === false) {
        if (options.replaceCurrentHistoryState) {
          replaceDocumentHistoryHead(nextDocument);
        }
      } else {
        pushDocumentHistory(nextDocument);
      }

      const didApply = applyDocumentHistoryState(latestSession, resolvedNextState, {
        recordHistory: options.recordHistory,
        forceReload: false,
      });
      if (!didApply) {
        return false;
      }

      if (shouldReloadCanvas && canvasRef.current && currentCostumeRef.current) {
        currentCostumeIdRef.current = `${currentCostumeRef.current.id}:${nextDocument.activeLayerId}`;
        await canvasRef.current.loadDocument(latestSession.key, cloneCostumeDocument(nextDocument));
        loadedSessionRef.current = latestSession;
        const resolvedMode = canvasRef.current.getEditorMode();
        setCanvasEditorMode(resolvedMode);
        setActiveTool((prev) => ensureToolForMode(resolvedMode, prev));
      }

      if (options.skipRuntimePreviewRefresh !== true) {
        scheduleFlattenedPreviewRefresh(latestSession, nextDocument);
      }

      return true;
    };

    const queuedCommit = documentMutationChainRef.current.then(runCommit, runCommit);
    documentMutationChainRef.current = queuedCommit.then(() => undefined, () => undefined);
    return queuedCommit;
  }, [applyDocumentHistoryState, getWorkingPersistedState, pushDocumentHistory, replaceDocumentHistoryHead, scheduleFlattenedPreviewRefresh]);

  useEffect(() => {
    const handler: UndoRedoHandler = {
      undo: () => {
        const session = loadedSessionRef.current;
        if (!session || documentHistoryIndexRef.current <= 0) {
          return;
        }
        documentHistoryIndexRef.current -= 1;
        const snapshot = documentHistoryRef.current[documentHistoryIndexRef.current];
        const state = createPersistedStateFromDocument(snapshot);
        syncDocumentHistoryFlags();
        applyDocumentHistoryState(session, state, {
          recordHistory: false,
          forceReload: true,
          refreshRuntimePreview: true,
        });
      },
      redo: () => {
        const session = loadedSessionRef.current;
        if (!session || documentHistoryIndexRef.current >= documentHistoryRef.current.length - 1) {
          return;
        }
        documentHistoryIndexRef.current += 1;
        const snapshot = documentHistoryRef.current[documentHistoryIndexRef.current];
        const state = createPersistedStateFromDocument(snapshot);
        syncDocumentHistoryFlags();
        applyDocumentHistoryState(session, state, {
          recordHistory: false,
          forceReload: true,
          refreshRuntimePreview: true,
        });
      },
      canUndo: () => documentHistoryIndexRef.current > 0,
      canRedo: () => documentHistoryIndexRef.current >= 0 && documentHistoryIndexRef.current < documentHistoryRef.current.length - 1,
      beforeSelectionChange: ({ recordHistory }) => {
        persistCanvasStateToSession(loadedSessionRef.current, {
          skipLoadingGuard: true,
          recordHistory,
        });
      },
      deleteSelection: () => canvasRef.current?.deleteSelection() ?? false,
      duplicateSelection: () => canvasRef.current?.duplicateSelection() ?? false,
      isTextEditing: () => canvasRef.current?.isTextEditing() ?? false,
    };
    registerCostumeUndo(handler);
    return () => registerCostumeUndo(null);
  }, [applyDocumentHistoryState, createPersistedStateFromDocument, persistCanvasStateToSession, registerCostumeUndo, syncDocumentHistoryFlags]);

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

    const workingState = workingPersistedStateSessionKeyRef.current === session.key
      ? workingPersistedStateRef.current
      : null;
    const fallbackState = clonePersistedState(workingState)
      ?? createPersistedStateFromCostume(currentCostumeRef.current ?? null);
    if (!fallbackState) {
      return undefined;
    }

    return {
      target: session,
      state: fallbackState,
    };
  }, [createPersistedStateFromCostume, getCanvasPersistedStateForSession, isCanvasReadyForSession]);

  const applyOperationToCurrentObject = useCallback((operation: CostumeEditorOperation): boolean => {
    if (!currentObjectTarget) {
      return false;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

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
    }
    return didApply;
  }, [applyCostumeEditorOperation, currentObjectTarget, resolvePersistedSessionForObjectOperation]);

  useEffect(() => {
    const previousSelection = previousSelectionRef.current;
    const selectionChanged =
      previousSelection.sceneId !== selectedSceneId ||
      previousSelection.objectId !== selectedObjectId;

    if (selectionChanged) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      loadRequestIdRef.current += 1;
      currentCostumeIdRef.current = null;
      beginSessionLoad(!!selectedObjectId);
    }

    previousSelectionRef.current = {
      sceneId: selectedSceneId,
      objectId: selectedObjectId,
    };
  }, [beginSessionLoad, selectedSceneId, selectedObjectId]);

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
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (flattenedPreviewRefreshTimeoutRef.current) {
        clearTimeout(flattenedPreviewRefreshTimeoutRef.current);
      }
      persistCanvasStateToSession(loadedSessionRef.current, {
        skipLoadingGuard: true,
      });
    };
  }, [clearLoadingOverlayDelay, persistCanvasStateToSession]);

  const handleHistoryChange = useCallback((liveCanvasState: ActiveLayerCanvasState) => {
    if (isLoadingRef.current) {
      return;
    }

    const loadedSession = loadedSessionRef.current;
    if (!loadedSession || !isCanvasReadyForSession(loadedSession)) {
      return;
    }

    const persistedState = resolvePersistedStateWithCanvasState(
      liveCanvasState,
      getWorkingPersistedState(),
    );
    if (!persistedState) {
      return;
    }

    pushDocumentHistory(persistedState.document);
    const didPersist = applyDocumentHistoryState(loadedSession, persistedState, {
      recordHistory: true,
    });
    if (didPersist) {
      canvasRef.current?.markPersisted(loadedSession.key);
      scheduleFlattenedPreviewRefreshRef.current(loadedSession, persistedState.document);
    }
  }, [applyDocumentHistoryState, getWorkingPersistedState, isCanvasReadyForSession, pushDocumentHistory, resolvePersistedStateWithCanvasState]);

  const handleSelectCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId) return;

    const nextCostume = costumes[index];
    if (!nextCostume) return;

    applyOperationToCurrentObject({
      type: 'select',
      costumeId: nextCostume.id,
    });
  }, [applyOperationToCurrentObject, costumes, selectedObjectId, selectedSceneId]);

  const handleAddCostume = useCallback((costume: Costume) => {
    if (!selectedSceneId || !selectedObjectId) return;

    applyOperationToCurrentObject({
      type: 'add',
      costume,
    });
  }, [applyOperationToCurrentObject, selectedObjectId, selectedSceneId]);

  const handleDeleteCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId) return;

    const costume = costumes[index];
    if (!costume) return;

    applyOperationToCurrentObject({
      type: 'remove',
      costumeId: costume.id,
    });
  }, [applyOperationToCurrentObject, costumes, selectedObjectId, selectedSceneId]);

  const handleRenameCostume = useCallback((index: number, name: string) => {
    if (!selectedSceneId || !selectedObjectId) return;

    const costume = costumes[index];
    if (!costume) return;

    applyOperationToCurrentObject({
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

  const handleMoveLayer = useCallback((layerId: string, direction: 'up' | 'down') => {
    void commitDocumentMutation((working) => moveCostumeLayer(working.document, layerId, direction), {
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

      const rasterizedDataUrl = await renderCostumeLayerStackToDataUrl([layer]);
      const nextDocument = updateCostumeLayer(working.document, layerId, {});
      if (!nextDocument) {
        return null;
      }
      const layerIndex = getCostumeLayerIndex(nextDocument, layerId);
      if (layerIndex < 0) {
        return null;
      }
      nextDocument.layers[layerIndex] = {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        mask: null,
        effects: [...layer.effects],
        kind: 'bitmap',
        width: 1024,
        height: 1024,
        bitmap: {
          assetId: rasterizedDataUrl,
        },
      };
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

      let mergedLayer: typeof lowerLayer;
      if (isVectorCostumeLayer(lowerLayer) && isVectorCostumeLayer(upperLayer)) {
        const lowerJson = JSON.parse(lowerLayer.vector.fabricJson) as { objects?: unknown[]; [key: string]: unknown };
        const upperJson = JSON.parse(upperLayer.vector.fabricJson) as { objects?: unknown[]; [key: string]: unknown };
        mergedLayer = {
          ...lowerLayer,
          vector: {
            engine: 'fabric',
            version: 1,
            fabricJson: JSON.stringify({
              ...lowerJson,
              objects: [...(Array.isArray(lowerJson.objects) ? lowerJson.objects : []), ...(Array.isArray(upperJson.objects) ? upperJson.objects : [])],
            }),
          },
        };
      } else {
        const mergedDataUrl = await renderCostumeLayerStackToDataUrl([lowerLayer, upperLayer]);
        mergedLayer = {
          id: lowerLayer.id,
          name: lowerLayer.name,
          visible: lowerLayer.visible,
          locked: lowerLayer.locked,
          opacity: lowerLayer.opacity,
          blendMode: lowerLayer.blendMode,
          mask: null,
          effects: [...lowerLayer.effects],
          kind: 'bitmap',
          width: 1024,
          height: 1024,
          bitmap: {
            assetId: mergedDataUrl,
          },
        };
      }

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

  const handleUndo = useCallback(() => {
    const session = loadedSessionRef.current;
    if (isLoadingRef.current || !session || documentHistoryIndexRef.current <= 0) {
      return;
    }
    documentHistoryIndexRef.current -= 1;
    const snapshot = documentHistoryRef.current[documentHistoryIndexRef.current];
    const state = createPersistedStateFromDocument(snapshot);
    syncDocumentHistoryFlags();
    applyDocumentHistoryState(session, state, {
      recordHistory: false,
      forceReload: true,
      refreshRuntimePreview: true,
    });
  }, [applyDocumentHistoryState, createPersistedStateFromDocument, syncDocumentHistoryFlags]);

  const handleRedo = useCallback(() => {
    const session = loadedSessionRef.current;
    if (
      isLoadingRef.current ||
      !session ||
      documentHistoryIndexRef.current < 0 ||
      documentHistoryIndexRef.current >= documentHistoryRef.current.length - 1
    ) {
      return;
    }
    documentHistoryIndexRef.current += 1;
    const snapshot = documentHistoryRef.current[documentHistoryIndexRef.current];
    const state = createPersistedStateFromDocument(snapshot);
    syncDocumentHistoryFlags();
    applyDocumentHistoryState(session, state, {
      recordHistory: false,
      forceReload: true,
      refreshRuntimePreview: true,
    });
  }, [applyDocumentHistoryState, createPersistedStateFromDocument, syncDocumentHistoryFlags]);

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
            onBitmapBrushKindChange={setBitmapBrushKind}
            onBrushSizeChange={setBrushSize}
            onBitmapFillStyleChange={handleBitmapFillStyleChange}
            onBitmapShapeStyleChange={handleBitmapShapeStyleChange}
            onTextStyleChange={handleTextStyleChange}
            onVectorStyleChange={handleVectorStyleChange}
          />
        ) : null}

        <CostumeCanvas
          ref={canvasRef}
          costumeDocument={editorCostume?.document ?? null}
          initialEditorMode={initialEditorMode}
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
      </div>

      {editorCostume ? (
        <CostumeLayerPanel
          document={editorCostume.document}
          activeLayer={activeLayer}
          onSelectLayer={handleSelectLayer}
          onAddBitmapLayer={handleAddBitmapLayer}
          onAddVectorLayer={handleAddVectorLayer}
          onDuplicateLayer={handleDuplicateLayer}
          onDeleteLayer={handleDeleteLayer}
          onMoveLayer={handleMoveLayer}
          onToggleVisibility={handleToggleLayerVisibility}
          onToggleLocked={handleToggleLayerLocked}
          onRenameLayer={handleRenameLayer}
          onOpacityChange={handleLayerOpacityChange}
          onMergeDown={handleMergeLayerDown}
          onRasterizeLayer={handleRasterizeLayer}
        />
      ) : null}

      {isSessionLoading && (
        <div className={`absolute inset-0 z-20 ${showSessionLoadingOverlay ? 'flex items-center justify-center bg-background/70 text-sm text-muted-foreground backdrop-blur-[1px]' : 'bg-transparent'}`}>
          {showSessionLoadingOverlay ? 'Switching costume editor to the selected object...' : null}
        </div>
      )}
    </div>
  );
}
