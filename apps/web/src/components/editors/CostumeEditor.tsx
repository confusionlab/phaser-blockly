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
import type { Costume, ColliderConfig, CostumeEditorMode } from '@/types';
import {
  areCostumeBoundsEqual,
  areCostumeDocumentsEqual,
  createCostumeEditorSession,
  type CostumeEditorObjectTarget,
  type CostumeEditorOperation,
  type CostumeEditorPersistedSession,
  type CostumeEditorPersistedState,
  type CostumeEditorSession,
  type CostumeEditorTarget,
} from '@/lib/editor/costumeEditorSession';
import { NO_OBJECT_SELECTED_MESSAGE } from '@/lib/selectionMessages';
import { shouldIgnoreGlobalKeyboardEvent } from '@/utils/keyboard';
import type { BitmapBrushKind } from '@/lib/background/brushCore';
import { DEFAULT_BITMAP_FILL_TEXTURE_ID } from '@/lib/background/bitmapFillCore';
import { DEFAULT_VECTOR_STROKE_BRUSH_ID } from '@/lib/vector/vectorStrokeBrushCore';
import { DEFAULT_VECTOR_FILL_TEXTURE_ID } from '@/lib/vector/vectorFillTextureCore';
import {
  applyCanvasStateToCostumeDocument,
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
} from '@/lib/costume/costumeDocument';
import {
  renderCostumeDocument,
  renderCostumeDocumentSlice,
  renderCostumeLayerStackToCanvas,
  renderCostumeLayerStackToDataUrl,
} from '@/lib/costume/costumeDocumentRender';

const VECTOR_TOOLS = new Set<DrawingTool>(['select', 'pen', 'brush', 'rectangle', 'circle', 'triangle', 'star', 'line', 'text', 'collider']);
const BITMAP_TOOLS = new Set<DrawingTool>(['select', 'box-select', 'brush', 'eraser', 'fill', 'circle', 'rectangle', 'triangle', 'star', 'line', 'collider']);

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

function ensureToolForMode(mode: CostumeEditorMode, tool: DrawingTool): DrawingTool {
  if (mode === 'vector') {
    return VECTOR_TOOLS.has(tool) ? tool : 'select';
  }
  return BITMAP_TOOLS.has(tool) ? tool : 'select';
}

function getInitialCostumeEditorMode(costume: Costume | undefined): CostumeEditorMode {
  return costume ? getActiveCostumeLayerKind(costume.document) : 'vector';
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
  const previousSelectionRef = useRef<{ sceneId: string | null; objectId: string | null }>({
    sceneId: null,
    objectId: null,
  });
  const loadRequestIdRef = useRef(0);
  const loadingOverlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(true);
  const loadedSessionRef = useRef<CostumeEditorSession | null>(null);
  const currentSessionRef = useRef<CostumeEditorSession | null>(null);
  const documentHistoryRef = useRef<CostumeEditorPersistedState[]>([]);
  const documentHistoryIndexRef = useRef(-1);
  const workingPersistedStateRef = useRef<CostumeEditorPersistedState | null>(null);
  const documentMutationChainRef = useRef<Promise<void>>(Promise.resolve());

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
  const activeLayer = currentCostume ? getActiveCostumeLayer(currentCostume.document) : null;
  const currentCostumeLoadKey = currentCostume
    ? `${currentCostume.id}:${currentCostume.document.activeLayerId}`
    : null;
  const currentSession = useMemo(() => {
    const target = createCostumeTarget(selectedSceneId, selectedObjectId, currentCostume?.id ?? null);
    return target ? createCostumeEditorSession(target) : null;
  }, [currentCostume?.id, selectedObjectId, selectedSceneId]);
  const currentObjectTarget = useMemo(
    () => createCostumeObjectTarget(selectedSceneId, selectedObjectId),
    [selectedObjectId, selectedSceneId],
  );
  currentSessionRef.current = currentSession;
  const initialEditorMode: CostumeEditorMode = currentCostume
    ? getInitialCostumeEditorMode(currentCostume)
    : 'bitmap';

  const [editorMode, setEditorMode] = useState<CostumeEditorMode>(initialEditorMode);
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
  const [underlaySrc, setUnderlaySrc] = useState<string | null>(null);
  const [overlaySrc, setOverlaySrc] = useState<string | null>(null);

  useEffect(() => {
    setEditorMode((prev) => {
      if (prev === initialEditorMode) return prev;
      return currentCostumeIdRef.current === null ? initialEditorMode : prev;
    });
    setActiveTool((prev) => {
      if (currentCostumeIdRef.current !== null) return prev;
      return ensureToolForMode(initialEditorMode, prev);
    });
  }, [initialEditorMode]);

  useEffect(() => {
    let cancelled = false;

    const renderLayerSlices = async () => {
      if (!currentCostume) {
        setUnderlaySrc(null);
        setOverlaySrc(null);
        return;
      }

      const [nextUnderlay, nextOverlay] = await Promise.all([
        renderCostumeDocumentSlice(currentCostume.document, {
          activeLayerId: currentCostume.document.activeLayerId,
          placement: 'below',
        }),
        renderCostumeDocumentSlice(currentCostume.document, {
          activeLayerId: currentCostume.document.activeLayerId,
          placement: 'above',
        }),
      ]);

      if (cancelled) {
        return;
      }

      setUnderlaySrc(nextUnderlay);
      setOverlaySrc(nextOverlay);
    };

    void renderLayerSlices();

    return () => {
      cancelled = true;
    };
  }, [currentCostume, currentCostumeLoadKey]);

  const isCanvasReadyForSession = useCallback((session: CostumeEditorSession | null): boolean => {
    if (!canvasRef.current || !session) {
      return false;
    }
    return canvasRef.current.getLoadedSessionKey() === session.key;
  }, []);

  const getCanvasPersistedStateForSession = useCallback((
    session: CostumeEditorSession | null,
    options: { skipLoadingGuard?: boolean } = {}
  ): CostumeEditorPersistedState | null => {
    if (!canvasRef.current || !session) return null;
    if (!options.skipLoadingGuard && isLoadingRef.current) return null;

    const state = canvasRef.current.exportCostumeState(session.key);
    if (!state?.dataUrl) return null;

    if (!currentCostume) {
      return null;
    }

    return {
      assetId: state.dataUrl,
      bounds: state.bounds ?? undefined,
      document: applyCanvasStateToCostumeDocument(currentCostume.document, {
        ...state,
        dataUrl: state.activeLayerDataUrl,
      }),
    };
  }, [currentCostume]);

  const getWorkingPersistedState = useCallback((): CostumeEditorPersistedState | null => {
    const workingPersistedState = clonePersistedState(workingPersistedStateRef.current);
    if (workingPersistedState) {
      return workingPersistedState;
    }

    if (currentSession && isCanvasReadyForSession(currentSession)) {
      return getCanvasPersistedStateForSession(currentSession, { skipLoadingGuard: true });
    }
    if (!currentCostume) {
      return null;
    }
    return {
      assetId: currentCostume.assetId,
      bounds: currentCostume.bounds,
      document: currentCostume.document,
    };
  }, [currentCostume, currentSession, getCanvasPersistedStateForSession, isCanvasReadyForSession]);

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
    workingPersistedStateRef.current = clonePersistedState(state);
    documentHistoryRef.current = state ? [state] : [];
    documentHistoryIndexRef.current = state ? 0 : -1;
    syncDocumentHistoryFlags();
  }, [syncDocumentHistoryFlags]);

  const replaceDocumentHistoryHead = useCallback((state: CostumeEditorPersistedState) => {
    if (documentHistoryIndexRef.current < 0) {
      documentHistoryRef.current = [state];
      documentHistoryIndexRef.current = 0;
      syncDocumentHistoryFlags();
      return;
    }

    const nextHistory = [...documentHistoryRef.current];
    nextHistory[documentHistoryIndexRef.current] = state;
    documentHistoryRef.current = nextHistory;
    syncDocumentHistoryFlags();
  }, [syncDocumentHistoryFlags]);

  const arePersistedStatesEqual = useCallback((
    a: CostumeEditorPersistedState | null | undefined,
    b: CostumeEditorPersistedState | null | undefined,
  ) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
      a.assetId === b.assetId &&
      areCostumeBoundsEqual(a.bounds, b.bounds) &&
      areCostumeDocumentsEqual(a.document, b.document)
    );
  }, []);

  const pushDocumentHistory = useCallback((state: CostumeEditorPersistedState) => {
    const current = documentHistoryRef.current[documentHistoryIndexRef.current] ?? null;
    if (arePersistedStatesEqual(current, state)) {
      syncDocumentHistoryFlags();
      return;
    }

    const nextHistory = documentHistoryRef.current
      .slice(0, documentHistoryIndexRef.current + 1)
      .concat([state]);
    documentHistoryRef.current = nextHistory;
    documentHistoryIndexRef.current = nextHistory.length - 1;
    syncDocumentHistoryFlags();
  }, [arePersistedStatesEqual, syncDocumentHistoryFlags]);

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
    workingPersistedStateRef.current = clonePersistedState(persistedState);
    canvasRef.current.markPersisted(session.key);
    return true;
  }, [getCanvasPersistedStateForSession, updateCostumeFromEditor]);

  const applyDocumentHistoryState = useCallback((
    session: CostumeEditorSession | null,
    state: CostumeEditorPersistedState | null | undefined,
    options: { recordHistory?: boolean; forceReload?: boolean } = {},
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
      workingPersistedStateRef.current = clonePersistedState(state);
    }
    return didUpdate;
  }, [updateCostumeFromEditor]);

  const commitDocumentMutation = useCallback((
    mutate: (
      state: CostumeEditorPersistedState,
    ) => Promise<CostumeEditorPersistedState['document'] | null> | CostumeEditorPersistedState['document'] | null,
    options: {
      forceReload?: boolean;
      recordHistory?: boolean;
      renderDocument?: boolean;
      replaceCurrentHistoryState?: boolean;
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

      let resolvedNextState: CostumeEditorPersistedState;
      if (options.renderDocument === false) {
        resolvedNextState = {
          assetId: baseState.assetId,
          bounds: baseState.bounds ? { ...baseState.bounds } : undefined,
          document: nextDocument,
        };
      } else {
        const rendered = await renderCostumeDocument(nextDocument);
        resolvedNextState = {
          assetId: rendered.dataUrl,
          bounds: rendered.bounds ?? undefined,
          document: nextDocument,
        };
      }

      const latestSession = currentSessionRef.current;
      if (!latestSession || latestSession.key !== queuedSessionKey) {
        return false;
      }

      if (options.recordHistory === false) {
        if (options.replaceCurrentHistoryState) {
          replaceDocumentHistoryHead(resolvedNextState);
        }
      } else {
        pushDocumentHistory(resolvedNextState);
      }

      return applyDocumentHistoryState(latestSession, resolvedNextState, {
        recordHistory: options.recordHistory,
        forceReload: options.forceReload,
      });
    };

    const queuedCommit = documentMutationChainRef.current.then(runCommit, runCommit);
    documentMutationChainRef.current = queuedCommit.then(() => undefined, () => undefined);
    return queuedCommit;
  }, [applyDocumentHistoryState, getWorkingPersistedState, pushDocumentHistory, replaceDocumentHistoryHead]);

  useEffect(() => {
    const handler: UndoRedoHandler = {
      undo: () => {
        const session = loadedSessionRef.current;
        if (!session || documentHistoryIndexRef.current <= 0) {
          return;
        }
        documentHistoryIndexRef.current -= 1;
        const snapshot = documentHistoryRef.current[documentHistoryIndexRef.current];
        syncDocumentHistoryFlags();
        applyDocumentHistoryState(session, snapshot, {
          recordHistory: false,
          forceReload: true,
        });
      },
      redo: () => {
        const session = loadedSessionRef.current;
        if (!session || documentHistoryIndexRef.current >= documentHistoryRef.current.length - 1) {
          return;
        }
        documentHistoryIndexRef.current += 1;
        const snapshot = documentHistoryRef.current[documentHistoryIndexRef.current];
        syncDocumentHistoryFlags();
        applyDocumentHistoryState(session, snapshot, {
          recordHistory: false,
          forceReload: true,
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
  }, [applyDocumentHistoryState, persistCanvasStateToSession, registerCostumeUndo, syncDocumentHistoryFlags]);

  const applyOperationToCurrentObject = useCallback((operation: CostumeEditorOperation): boolean => {
    if (isLoadingRef.current || !currentObjectTarget) {
      return false;
    }

    const loadedSession = loadedSessionRef.current;
    if (loadedSession && !isCanvasReadyForSession(loadedSession)) {
      return false;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const canPersistLoadedSession =
      !!loadedSession &&
      !!canvasRef.current?.hasUnsavedChanges(loadedSession.key);
    const persistedState = canPersistLoadedSession
      ? getCanvasPersistedStateForSession(loadedSession)
      : null;
    const persistedSession: CostumeEditorPersistedSession | undefined =
      loadedSession && persistedState
        ? {
            target: loadedSession,
            state: persistedState,
          }
        : undefined;

    const didApply = applyCostumeEditorOperation(currentObjectTarget, {
      persistedSession,
      operation,
    });
    if (didApply && loadedSession && persistedSession) {
      canvasRef.current?.markPersisted(loadedSession.key);
    }
    return didApply;
  }, [applyCostumeEditorOperation, currentObjectTarget, getCanvasPersistedStateForSession, isCanvasReadyForSession]);

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

    if (!currentCostume || !currentSession) {
      currentCostumeIdRef.current = null;
      const requestId = ++loadRequestIdRef.current;
      beginSessionLoad(!!selectedObjectId);
      const fallbackMode: CostumeEditorMode = 'bitmap';
      setEditorMode(fallbackMode);
      setActiveTool((prev) => ensureToolForMode(fallbackMode, prev));

      canvasRef.current.loadFromDataURL('', null).finally(() => {
        if (loadRequestIdRef.current !== requestId) return;
        loadedSessionRef.current = null;
        resetDocumentHistory(null);
        finishSessionLoad();
        const resolvedMode = canvasRef.current?.getEditorMode() ?? fallbackMode;
        setEditorMode(resolvedMode);
        setActiveTool((prev) => ensureToolForMode(resolvedMode, prev));
      });
      return;
    }

    const loadedSessionKey = canvasRef.current.getLoadedSessionKey();
    if (currentCostumeIdRef.current !== currentCostumeLoadKey || loadedSessionKey !== currentSession.key) {
      currentCostumeIdRef.current = currentCostumeLoadKey;
      const requestId = ++loadRequestIdRef.current;
      beginSessionLoad(true);

      const nextMode = getInitialCostumeEditorMode(currentCostume);
      setEditorMode(nextMode);
      setActiveTool((prev) => ensureToolForMode(nextMode, prev));

      canvasRef.current.loadCostume(currentSession.key, currentCostume).finally(() => {
        if (loadRequestIdRef.current !== requestId) return;
        loadedSessionRef.current = currentSession;
        resetDocumentHistory({
          assetId: currentCostume.assetId,
          bounds: currentCostume.bounds,
          document: currentCostume.document,
        });
        finishSessionLoad();
        const resolvedMode = canvasRef.current?.getEditorMode() ?? nextMode;
        setEditorMode(resolvedMode);
        setActiveTool((prev) => ensureToolForMode(resolvedMode, prev));
      });
    }
  }, [beginSessionLoad, currentCostume, currentCostumeLoadKey, currentSession, finishSessionLoad, resetDocumentHistory, selectedObjectId]);

  useEffect(() => {
    return () => {
      clearLoadingOverlayDelay();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      persistCanvasStateToSession(loadedSessionRef.current, {
        skipLoadingGuard: true,
      });
    };
  }, [clearLoadingOverlayDelay, persistCanvasStateToSession]);

  const handleHistoryChange = useCallback(() => {
    if (isLoadingRef.current) {
      return;
    }

    const loadedSession = loadedSessionRef.current;
    if (!loadedSession || !isCanvasReadyForSession(loadedSession)) {
      return;
    }

    const persistedState = getCanvasPersistedStateForSession(loadedSession);
    if (!persistedState) {
      return;
    }

    pushDocumentHistory(persistedState);
    const didPersist = applyDocumentHistoryState(loadedSession, persistedState, {
      recordHistory: true,
    });
    if (didPersist) {
      canvasRef.current?.markPersisted(loadedSession.key);
    }
  }, [applyDocumentHistoryState, getCanvasPersistedStateForSession, isCanvasReadyForSession, pushDocumentHistory]);

  const handleSelectCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId || isLoadingRef.current) return;

    const nextCostume = costumes[index];
    if (!nextCostume) return;

    applyOperationToCurrentObject({
      type: 'select',
      costumeId: nextCostume.id,
    });
  }, [applyOperationToCurrentObject, costumes, selectedObjectId, selectedSceneId]);

  const handleAddCostume = useCallback((costume: Costume) => {
    if (!selectedSceneId || !selectedObjectId || isLoadingRef.current) return;

    applyOperationToCurrentObject({
      type: 'add',
      costume,
    });
  }, [applyOperationToCurrentObject, selectedObjectId, selectedSceneId]);

  const handleDeleteCostume = useCallback((index: number) => {
    if (!selectedSceneId || !selectedObjectId || isLoadingRef.current) return;

    const costume = costumes[index];
    if (!costume) return;

    applyOperationToCurrentObject({
      type: 'remove',
      costumeId: costume.id,
    });
  }, [applyOperationToCurrentObject, costumes, selectedObjectId, selectedSceneId]);

  const handleRenameCostume = useCallback((index: number, name: string) => {
    if (!selectedSceneId || !selectedObjectId || isLoadingRef.current) return;

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
      forceReload: true,
      recordHistory: false,
      renderDocument: false,
      replaceCurrentHistoryState: true,
    });
  }, [commitDocumentMutation]);

  const handleBitmapLayerPick = useCallback((point: { x: number; y: number }) => {
    if (editorMode !== 'bitmap' || activeTool !== 'select' || !currentCostume) {
      return;
    }

    void (async () => {
      const x = Math.max(0, Math.min(1023, Math.floor(point.x)));
      const y = Math.max(0, Math.min(1023, Math.floor(point.y)));

      for (let index = currentCostume.document.layers.length - 1; index >= 0; index -= 1) {
        const layer = currentCostume.document.layers[index];
        if (!layer.visible) {
          continue;
        }

        const canvas = await renderCostumeLayerStackToCanvas([layer]);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          continue;
        }
        const alpha = ctx.getImageData(x, y, 1, 1).data[3] ?? 0;
        if (alpha > 0) {
          handleSelectLayer(layer.id);
          return;
        }
      }
    })();
  }, [activeTool, currentCostume, editorMode, handleSelectLayer]);

  const handleAddVectorLayer = useCallback(() => {
    if (isLoadingRef.current) {
      return;
    }

    void commitDocumentMutation((working) => insertCostumeLayerAfterActive(
      working.document,
      createVectorLayer({ name: `Layer ${working.document.layers.length + 1}` }),
    ), { forceReload: true });
  }, [commitDocumentMutation]);

  const handleAddBitmapLayer = useCallback(() => {
    if (isLoadingRef.current) {
      return;
    }

    void commitDocumentMutation((working) => insertCostumeLayerAfterActive(
      working.document,
      createBitmapLayer({ name: `Layer ${working.document.layers.length + 1}` }),
    ), { forceReload: true });
  }, [commitDocumentMutation]);

  const handleDuplicateLayer = useCallback((layerId: string) => {
    void commitDocumentMutation((working) => duplicateCostumeLayer(working.document, layerId), {
      forceReload: true,
    });
  }, [commitDocumentMutation]);

  const handleDeleteLayer = useCallback((layerId: string) => {
    void commitDocumentMutation((working) => removeCostumeLayer(working.document, layerId), {
      forceReload: true,
    });
  }, [commitDocumentMutation]);

  const handleMoveLayer = useCallback((layerId: string, direction: 'up' | 'down') => {
    void commitDocumentMutation((working) => moveCostumeLayer(working.document, layerId, direction), {
      forceReload: false,
    });
  }, [commitDocumentMutation]);

  const handleToggleLayerVisibility = useCallback((layerId: string) => {
    void commitDocumentMutation((working) => {
      const layer = getCostumeLayerById(working.document, layerId);
      if (!layer) {
        return null;
      }
      return setCostumeLayerVisibility(working.document, layerId, !layer.visible);
    }, {
      forceReload: true,
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
      forceReload: true,
      renderDocument: false,
    });
  }, [commitDocumentMutation]);

  const handleRenameLayer = useCallback((layerId: string, name: string) => {
    void commitDocumentMutation((working) => updateCostumeLayer(working.document, layerId, { name }), {
      forceReload: false,
      renderDocument: false,
    });
  }, [commitDocumentMutation]);

  const handleLayerOpacityChange = useCallback((layerId: string, opacity: number) => {
    void commitDocumentMutation((working) => updateCostumeLayer(working.document, layerId, { opacity }), {
      forceReload: true,
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
    }, { forceReload: true });
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
    }, { forceReload: true });
  }, [commitDocumentMutation]);

  const handleCanvasModeChange = useCallback((mode: CostumeEditorMode) => {
    setEditorMode(mode);
    setActiveTool((prev) => ensureToolForMode(mode, prev));
    if (mode !== 'vector') {
      setIsVectorPointEditing(false);
      setHasTextSelection(false);
    }
  }, []);

  const handleToolChange = useCallback((tool: DrawingTool) => {
    if (isLoadingRef.current) {
      return;
    }
    setActiveTool(ensureToolForMode(editorMode, tool));
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
    if (activeObjectTab !== 'costumes') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
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
  }, [activeObjectTab, editorMode]);

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
    syncDocumentHistoryFlags();
    applyDocumentHistoryState(session, snapshot, {
      recordHistory: false,
      forceReload: true,
    });
  }, [applyDocumentHistoryState, syncDocumentHistoryFlags]);

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
    syncDocumentHistoryFlags();
    applyDocumentHistoryState(session, snapshot, {
      recordHistory: false,
      forceReload: true,
    });
  }, [applyDocumentHistoryState, syncDocumentHistoryFlags]);

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

        <CostumeCanvas
          ref={canvasRef}
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
          underlaySrc={underlaySrc}
          overlaySrc={overlaySrc}
          activeLayerOpacity={activeLayer?.opacity ?? 1}
          activeLayerVisible={activeLayer?.visible ?? true}
          activeLayerLocked={activeLayer?.locked ?? false}
          onBitmapLayerPick={handleBitmapLayerPick}
        />
      </div>

      {currentCostume && activeLayer ? (
        <CostumeLayerPanel
          document={currentCostume.document}
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
