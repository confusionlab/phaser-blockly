import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore, type UndoRedoHandler } from '@/store/editorStore';
import {
  canRedoHistory,
  canUndoHistory,
  redoHistory,
  subscribeToHistoryChanges,
  undoHistory,
} from '@/store/universalHistory';
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
  type VectorToolStyleMixedState,
  type VectorToolStyleSelectionSnapshot,
  type VectorToolStyle,
} from './costume/CostumeToolbar';
import {
  areVectorToolStylesEqual,
  areVectorToolStyleMixedStatesEqual,
  clearVectorToolStyleMixedState,
} from './costume/costumeCanvasShared';
import { resolveCostumeToolShortcut } from './costume/costumeToolShortcuts';
import { getEffectiveObjectProps } from '@/types';
import type { Costume, ColliderConfig, CostumeEditorMode } from '@/types';
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
  reorderCostumeLayer,
  removeCostumeLayer,
  setActiveCostumeLayer,
  setCostumeLayerVisibility,
  updateCostumeLayer,
  type ActiveLayerCanvasState,
} from '@/lib/costume/costumeDocument';
import {
  areCostumeAssetFramesEqual,
  cloneCostumeAssetFrame,
} from '@/lib/costume/costumeAssetFrame';
import {
  renderCostumeDocument,
} from '@/lib/costume/costumeDocumentRender';
import {
  mergeCostumeLayers,
  rasterizeCostumeLayer,
} from '@/lib/costume/costumeLayerOperations';
import {
  handleSelectionClipboardShortcuts,
  handleSelectionDeleteShortcut,
  handleSelectionNudgeShortcut,
  handleToolSwitchShortcut,
} from '@/lib/editor/editorSurfaceShortcuts';
import type { FinishPendingEditsOptions } from '@/lib/editor/interactionSurface';
import { useBulkAssetSelection } from './shared/useBulkAssetSelection';

const VECTOR_TOOLS = new Set<DrawingTool>(['select', 'pen', 'brush', 'rectangle', 'circle', 'triangle', 'star', 'line', 'text', 'collider']);
const BITMAP_TOOLS = new Set<DrawingTool>(['select', 'brush', 'eraser', 'fill', 'circle', 'rectangle', 'triangle', 'star', 'line', 'collider']);
function clonePersistedState(
  state: CostumeEditorPersistedState | null | undefined,
): CostumeEditorPersistedState | null {
  if (!state) {
    return null;
  }

  return {
    assetId: state.assetId,
    bounds: state.bounds ? { ...state.bounds } : undefined,
    assetFrame: cloneCostumeAssetFrame(state.assetFrame),
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
    areCostumeAssetFramesEqual(a.assetFrame, b.assetFrame) &&
    areCostumeDocumentsEqual(a.document, b.document)
  );
}

function resolveCostumePendingEditOptionsForKey(key: string): FinishPendingEditsOptions {
  return {
    bitmapFloatingSelectionBehavior: key === 'Escape' ? 'revert' : 'commit',
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
  componentId: string | null,
  costumeId: string | null,
): CostumeEditorTarget | null {
  if (componentId && costumeId) {
    return {
      componentId,
      costumeId,
    };
  }

  if (sceneId && objectId && costumeId) {
    return {
      sceneId,
      objectId,
      costumeId,
    };
  }

  return null;
}

function createCostumeObjectTarget(
  sceneId: string | null,
  objectId: string | null,
  componentId: string | null,
): CostumeEditorObjectTarget | null {
  if (componentId) {
    return {
      componentId,
    };
  }

  if (sceneId && objectId) {
    return {
      sceneId,
      objectId,
    };
  }

  return null;
}

function doCostumeTargetsMatch(a: CostumeEditorTarget, b: CostumeEditorTarget): boolean {
  return 'componentId' in a || 'componentId' in b
    ? ('componentId' in a && 'componentId' in b && a.componentId === b.componentId && a.costumeId === b.costumeId)
    : a.sceneId === b.sceneId && a.objectId === b.objectId && a.costumeId === b.costumeId;
}

export function CostumeEditor() {
  const canvasRef = useRef<CostumeCanvasHandle>(null);
  const {
    project,
    updateObject,
    updateComponent,
    updateCostumeFromEditor,
    applyCostumeEditorOperation,
  } = useProjectStore();
  const {
    selectedSceneId,
    selectedObjectId,
    selectedComponentId,
    registerCostumeUndo,
    activeObjectTab,
    costumeColliderEditorRequest,
    consumeCostumeColliderEditorRequest,
  } = useEditorStore();

  const currentCostumeIdRef = useRef<string | null>(null);
  const currentCostumeRef = useRef<Costume | undefined>(undefined);
  const previousSelectionRef = useRef<{ sceneId: string | null; objectId: string | null; componentId: string | null }>({
    sceneId: null,
    objectId: null,
    componentId: null,
  });
  const loadRequestIdRef = useRef(0);
  const workingPersistedStateSessionKeyRef = useRef<string | null>(null);
  const loadingOverlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flattenedPreviewRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(true);
  const loadedSessionRef = useRef<CostumeEditorSession | null>(null);
  const currentSessionRef = useRef<CostumeEditorSession | null>(null);
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
  const component = (project?.components || []).find((candidate) => candidate.id === selectedComponentId);

  const effectiveProps = useMemo(() => {
    if (component) {
      return {
        blocklyXml: component.blocklyXml,
        costumes: component.costumes,
        currentCostumeIndex: component.currentCostumeIndex,
        physics: component.physics,
        collider: component.collider,
        sounds: component.sounds,
      };
    }
    if (!object || !project) return null;
    return getEffectiveObjectProps(object, project.components || []);
  }, [component, object, project]);

  const costumes = useMemo(() => effectiveProps?.costumes || [], [effectiveProps]);
  const orderedCostumeIds = useMemo(() => costumes.map((costume) => costume.id), [costumes]);
  const currentCostumeIndex = effectiveProps?.currentCostumeIndex ?? 0;
  const collider = effectiveProps?.collider ?? null;
  const currentCostume = costumes[currentCostumeIndex];
  const activeCostumeId = currentCostume?.id ?? null;
  const currentSession = useMemo(() => {
    const target = createCostumeTarget(selectedSceneId, selectedObjectId, selectedComponentId, currentCostume?.id ?? null);
    return target ? createCostumeEditorSession(target) : null;
  }, [currentCostume?.id, selectedComponentId, selectedObjectId, selectedSceneId]);
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
    () => createCostumeObjectTarget(selectedSceneId, selectedObjectId, selectedComponentId),
    [selectedComponentId, selectedObjectId, selectedSceneId],
  );
  const {
    selectedIds: selectedCostumeIds,
    replaceSelection: replaceSelectedCostumeIds,
    handleItemClick: handleCostumeListClick,
    prepareDragSelection: prepareCostumeDragSelection,
  } = useBulkAssetSelection({
    orderedIds: orderedCostumeIds,
    activeId: activeCostumeId,
    onActivate: (costumeId) => {
      if (!currentObjectTarget) {
        return;
      }

      applyOperationToCurrentObject({
        type: 'select',
        costumeId,
      });
    },
  });
  currentSessionRef.current = currentSession;
  const initialEditorMode: CostumeEditorMode = editorCostume
    ? getInitialCostumeEditorMode(editorCostume)
    : 'bitmap';

  const [canvasEditorMode, setCanvasEditorMode] = useState<CostumeEditorMode>(initialEditorMode);
  const [activeTool, setActiveTool] = useState<DrawingTool>('select');
  const [bitmapBrushKind, setBitmapBrushKind] = useState<BitmapBrushKind>('hard-round');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushOpacity, setBrushOpacity] = useState(1);
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
    fillOpacity: 1,
    strokeColor: '#000000',
    strokeOpacity: 1,
    strokeWidth: 1,
    strokeBrushId: DEFAULT_VECTOR_STROKE_BRUSH_ID,
  });
  const [vectorStyleCapabilities, setVectorStyleCapabilities] = useState<VectorStyleCapabilities>({
    supportsFill: true,
  });
  const [vectorStyleMixedState, setVectorStyleMixedState] = useState<VectorToolStyleMixedState>({});
  const [vectorStyleChangeRevision, setVectorStyleChangeRevision] = useState(0);
  const [latestVectorStyleUpdates, setLatestVectorStyleUpdates] = useState<Partial<VectorToolStyle>>({});
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
  const vectorStyleRef = useRef(vectorStyle);
  const vectorStyleMixedStateRef = useRef(vectorStyleMixedState);
  const editorMode: CostumeEditorMode = activeLayer
    ? getActiveCostumeLayerKind(editorCostume?.document ?? null)
    : canvasEditorMode;

  vectorStyleRef.current = vectorStyle;
  vectorStyleMixedStateRef.current = vectorStyleMixedState;

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
      assetFrame: cloneCostumeAssetFrame(costume.assetFrame),
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
      bitmapAssetFrame: state.bitmapAssetFrame,
      vectorDocument: state.vectorDocument,
    }, getWorkingPersistedState());
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

  const syncGlobalHistoryFlags = useCallback(() => {
    setCanUndo(canUndoHistory());
    setCanRedo(canRedoHistory());
  }, []);

  useEffect(() => {
    syncGlobalHistoryFlags();
    return subscribeToHistoryChanges(syncGlobalHistoryFlags);
  }, [syncGlobalHistoryFlags]);

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
    options: {
      recordHistory?: boolean;
      forceReload?: boolean;
      refreshRuntimePreview?: boolean;
      history?: { source: string; allowMerge?: boolean; mergeWindowMs?: number };
    } = {},
  ) => {
    if (!session || !state) {
      return false;
    }

    if (options.forceReload) {
      currentCostumeIdRef.current = null;
    }

    const previousState = getWorkingPersistedState();
    // Drive the editor UI from the next working state before the store round-trip
    // so layer selection and mode switches do not briefly render the old layer.
    setWorkingPersistedState(session, state);

    const didUpdate = updateCostumeFromEditor(session, state, {
      recordHistory: options.recordHistory,
      history: options.history,
    });
    if (!didUpdate) {
      setWorkingPersistedState(session, previousState);
      return false;
    }

    if (options.refreshRuntimePreview === true) {
      scheduleFlattenedPreviewRefreshRef.current(session, state.document);
    }
    return true;
  }, [getWorkingPersistedState, setWorkingPersistedState, updateCostumeFromEditor]);

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

      void renderCostumeDocument(nextDocument).then((rendered) => {
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
          assetFrame: cloneCostumeAssetFrame(rendered.assetFrame),
          document: nextDocument,
        };

        const didApply = updateCostumeFromEditor(session, refreshedState, {
          recordHistory: false,
        });
        if (!didApply) {
          return;
        }

        const workingState = getWorkingPersistedState();
        if (
          currentSessionRef.current?.key === session.key &&
          workingState?.document &&
          areCostumeDocumentsEqual(workingState.document, nextDocument)
        ) {
          setWorkingPersistedState(session, refreshedState);
        }
      }).catch((error) => {
        console.warn('Failed to refresh flattened costume preview after document update.', error);
      });
    }, 90);
  }, [getWorkingPersistedState, setWorkingPersistedState, updateCostumeFromEditor]);
  scheduleFlattenedPreviewRefreshRef.current = scheduleFlattenedPreviewRefresh;

  const cancelFlattenedPreviewRefresh = useCallback(() => {
    flattenedPreviewRefreshIdRef.current += 1;
    if (flattenedPreviewRefreshTimeoutRef.current) {
      clearTimeout(flattenedPreviewRefreshTimeoutRef.current);
      flattenedPreviewRefreshTimeoutRef.current = null;
    }
  }, []);

  const prepareCostumeStateForPlay = useCallback(async () => {
    const session = currentSessionRef.current;
    const canvas = canvasRef.current;
    if (!session || !canvas) {
      return;
    }

    await canvas.flushPendingEdits();

    if (isLoadingRef.current) {
      return;
    }

    const latestSession = currentSessionRef.current;
    if (!latestSession || latestSession.key !== session.key) {
      return;
    }

    const hasPendingPreviewRefresh = flattenedPreviewRefreshTimeoutRef.current !== null;
    const hasDirtyCanvasState = canvas.hasUnsavedChanges(latestSession.key);
    if (!hasPendingPreviewRefresh && !hasDirtyCanvasState) {
      return;
    }

    const liveCanvasState = hasDirtyCanvasState
      ? getCanvasPersistedStateForSession(latestSession, { skipLoadingGuard: true })
      : null;
    const baseState = liveCanvasState ?? getWorkingPersistedState();
    if (!baseState) {
      return;
    }

    cancelFlattenedPreviewRefresh();
    const rendered = await renderCostumeDocument(baseState.document);

    const currentSession = currentSessionRef.current;
    if (!currentSession || currentSession.key !== latestSession.key) {
      return;
    }

    const runtimeReadyState: CostumeEditorPersistedState = {
      assetId: rendered.dataUrl,
      bounds: rendered.bounds ?? undefined,
      assetFrame: cloneCostumeAssetFrame(rendered.assetFrame),
      document: cloneCostumeDocument(baseState.document),
    };

    updateCostumeFromEditor(currentSession, runtimeReadyState, {
      recordHistory: false,
    });
    setWorkingPersistedState(currentSession, runtimeReadyState);
    canvas.markPersisted(currentSession.key);
  }, [
    cancelFlattenedPreviewRefresh,
    getCanvasPersistedStateForSession,
    getWorkingPersistedState,
    setWorkingPersistedState,
    updateCostumeFromEditor,
  ]);

  const commitDocumentMutation = useCallback((
    mutate: (
      state: CostumeEditorPersistedState,
    ) => Promise<CostumeEditorPersistedState['document'] | null> | CostumeEditorPersistedState['document'] | null,
    options: {
      forceReload?: boolean;
      recordHistory?: boolean;
      skipRuntimePreviewRefresh?: boolean;
      history?: { source: string; allowMerge?: boolean; mergeWindowMs?: number };
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

      const didApply = applyDocumentHistoryState(latestSession, resolvedNextState, {
        recordHistory: options.recordHistory,
        forceReload: false,
        history: options.recordHistory === false
          ? undefined
          : (options.history ?? {
            source: 'costume:mutation',
            allowMerge: false,
          }),
      });
      if (!didApply) {
        return false;
      }

      if (shouldReloadCanvas) {
        await loadPersistedStateIntoCanvas(latestSession, resolvedNextState);
      }

      if (options.skipRuntimePreviewRefresh !== true) {
        scheduleFlattenedPreviewRefresh(latestSession, nextDocument);
      }

      return true;
    };

    const queuedCommit = documentMutationChainRef.current.then(runCommit, runCommit);
    documentMutationChainRef.current = queuedCommit.then(() => undefined, () => undefined);
    return queuedCommit;
  }, [applyDocumentHistoryState, scheduleFlattenedPreviewRefresh]);

  const performHistoryStep = useCallback((direction: 'undo' | 'redo') => {
    const runStep = async () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return false;
      }

      await canvas.flushPendingBitmapCommits();
      if (isLoadingRef.current) {
        return false;
      }

      const handledPendingEdits = await canvas.flushPendingEdits({
        bitmapFloatingSelectionBehavior: direction === 'undo' ? 'revert' : 'commit',
      });
      if (handledPendingEdits) {
        return true;
      }

      return direction === 'undo' ? undoHistory() : redoHistory();
    };

    void runStep();
  }, []);

  useEffect(() => {
    const copySelection = () => canvasRef.current?.copySelection() ?? false;
    const cutSelection = () => canvasRef.current?.cutSelection() ?? false;
    const deleteSelection = () => canvasRef.current?.deleteSelection() ?? false;
    const duplicateSelection = () => canvasRef.current?.duplicateSelection() ?? false;
    const pasteSelection = () => canvasRef.current?.pasteSelection() ?? false;
    const nudgeSelection = (dx: number, dy: number) => canvasRef.current?.nudgeSelection(dx, dy) ?? false;
    const handler: UndoRedoHandler = {
      undo: () => {
        performHistoryStep('undo');
      },
      redo: () => {
        performHistoryStep('redo');
      },
      canUndo: () => canUndoHistory(),
      canRedo: () => canRedoHistory(),
      beforeSelectionChange: ({ recordHistory }) => {
        persistCanvasStateToSession(loadedSessionRef.current, {
          skipLoadingGuard: true,
          recordHistory,
        });
      },
      prepareForPlay: async () => {
        await prepareCostumeStateForPlay();
      },
      copySelection,
      cutSelection,
      deleteSelection,
      duplicateSelection,
      pasteSelection,
      nudgeSelection,
      isTextEditing: () => canvasRef.current?.isTextEditing() ?? false,
      handleKeyDown: (event) => {
        if (!activeLayer || activeLayer.visible === false) {
          return false;
        }
        if (isLoadingRef.current) {
          return false;
        }
        if (canvasRef.current?.isTextEditing()) {
          if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            void canvasRef.current?.flushPendingEdits(resolveCostumePendingEditOptionsForKey(event.key));
            return true;
          }
          return false;
        }
        if (shouldIgnoreGlobalKeyboardEvent(event)) {
          return false;
        }

        if (
          (event.key === 'Escape' || event.key === 'Enter') &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          const canvas = canvasRef.current;
          if (!canvas) {
            return false;
          }
          if (canvas.hasActiveInteraction()) {
            event.preventDefault();
            void canvas.flushPendingEdits(resolveCostumePendingEditOptionsForKey(event.key));
            return true;
          }
          if (event.key === 'Escape') {
            const didClearSelection = canvas.clearSelection();
            if (didClearSelection) {
              event.preventDefault();
              return true;
            }
          }
          return false;
        }

        if (handleSelectionClipboardShortcuts(event, {
          duplicateSelection,
          copySelection,
          pasteSelection,
          cutSelection,
        }, 'costume')) {
          return true;
        }

        if (handleSelectionNudgeShortcut(event, nudgeSelection)) {
          return true;
        }

        if (handleSelectionDeleteShortcut(event, deleteSelection)) {
          return true;
        }

        if (event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }

        return handleToolSwitchShortcut(
          event,
          (key) => resolveCostumeToolShortcut(key, editorMode),
          (nextTool) => {
            setActiveTool((prev) => {
              const resolvedTool = ensureToolForMode(editorMode, nextTool);
              return prev === resolvedTool ? prev : resolvedTool;
            });
          },
        );
      },
    };
    registerCostumeUndo(handler);
    return () => registerCostumeUndo(null);
  }, [activeLayer, editorMode, performHistoryStep, persistCanvasStateToSession, prepareCostumeStateForPlay, registerCostumeUndo]);

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
      doCostumeTargetsMatch(persistedSession.target, loadedSession)
    ) {
      canvasRef.current?.markPersisted(loadedSession.key);
    }
    return didApply;
  }, [applyCostumeEditorOperation, currentObjectTarget, resolvePersistedSessionForObjectOperation]);

  useEffect(() => {
    const previousSelection = previousSelectionRef.current;
    const selectionChanged =
      previousSelection.sceneId !== selectedSceneId ||
      previousSelection.objectId !== selectedObjectId ||
      previousSelection.componentId !== selectedComponentId;

    if (selectionChanged) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      loadRequestIdRef.current += 1;
      currentCostumeIdRef.current = null;
      beginSessionLoad(!!currentObjectTarget);
    }

    previousSelectionRef.current = {
      sceneId: selectedSceneId,
      objectId: selectedObjectId,
      componentId: selectedComponentId,
    };
  }, [beginSessionLoad, currentObjectTarget, selectedComponentId, selectedObjectId, selectedSceneId]);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (!editorCostume || !currentSession) {
      currentCostumeIdRef.current = null;
      const requestId = ++loadRequestIdRef.current;
      beginSessionLoad(!!currentObjectTarget);
      const fallbackMode: CostumeEditorMode = 'bitmap';
      setCanvasEditorMode(fallbackMode);
      setActiveTool((prev) => ensureToolForMode(fallbackMode, prev));

      canvasRef.current.loadFromDataURL('', null).finally(() => {
        if (loadRequestIdRef.current !== requestId) return;
        loadedSessionRef.current = null;
        setWorkingPersistedState(null, null);
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
        setWorkingPersistedState(currentSession, {
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
  }, [beginSessionLoad, currentCostumeLoadKey, currentSession, editorCostume, finishSessionLoad, selectedObjectId]);

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

    const didPersist = applyDocumentHistoryState(loadedSession, persistedState, {
      recordHistory: true,
      history: {
        source: 'costume:document-change',
        allowMerge: false,
      },
    });
    if (didPersist) {
      canvasRef.current?.markPersisted(loadedSession.key, liveCanvasState);
      scheduleFlattenedPreviewRefreshRef.current(loadedSession, persistedState.document);
    }
  }, [
    applyDocumentHistoryState,
    getWorkingPersistedState,
    isCanvasReadyForSession,
    resolvePersistedStateWithCanvasState,
  ]);

  const handleAddCostume = useCallback((costume: Costume) => {
    if (!currentObjectTarget) return;

    replaceSelectedCostumeIds([costume.id], { anchorId: costume.id });
    applyOperationToCurrentObject({
      type: 'add',
      costume,
    });
  }, [applyOperationToCurrentObject, currentObjectTarget, replaceSelectedCostumeIds]);

  const handleDeleteCostumes = useCallback((costumeIds: string[]) => {
    if (!currentObjectTarget) return;
    if (costumeIds.length === 0) return;

    applyOperationToCurrentObject({
      type: 'removeMany',
      costumeIds,
    });
  }, [applyOperationToCurrentObject, currentObjectTarget]);

  const handleRenameCostume = useCallback((costumeId: string, name: string) => {
    if (!currentObjectTarget) return;

    applyOperationToCurrentObject({
      type: 'rename',
      costumeId,
      name,
    });
  }, [applyOperationToCurrentObject, currentObjectTarget]);

  const handleReorderCostumes = useCallback((costumeIds: string[], targetIndex: number) => {
    if (!currentObjectTarget) return;
    if (costumeIds.length === 0) return;

    applyOperationToCurrentObject({
      type: 'reorder',
      costumeIds,
      targetIndex,
    });
  }, [applyOperationToCurrentObject, currentObjectTarget]);

  const handleReplaceCostumes = useCallback((
    nextCostumes: Costume[],
    nextActiveCostumeId: string | null,
    nextSelectedCostumeIds: string[],
  ) => {
    const resolvedActiveCostumeId = nextActiveCostumeId ?? nextCostumes[0]?.id ?? null;
    const nextCostumeIndex = resolvedActiveCostumeId
      ? Math.max(0, nextCostumes.findIndex((costume) => costume.id === resolvedActiveCostumeId))
      : 0;

    if (selectedComponentId) {
      updateComponent(selectedComponentId, {
        costumes: nextCostumes,
        currentCostumeIndex: nextCostumeIndex,
      });
    } else if (selectedSceneId && selectedObjectId) {
      updateObject(selectedSceneId, selectedObjectId, {
        costumes: nextCostumes,
        currentCostumeIndex: nextCostumeIndex,
      });
    } else {
      return;
    }

    replaceSelectedCostumeIds(
      nextSelectedCostumeIds,
      { anchorId: nextSelectedCostumeIds[0] ?? resolvedActiveCostumeId },
    );
  }, [
    replaceSelectedCostumeIds,
    selectedComponentId,
    selectedObjectId,
    selectedSceneId,
    updateComponent,
    updateObject,
  ]);

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
    if (!state.hasSelection) {
      setVectorStyleMixedState({});
    }
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
    setLatestVectorStyleUpdates(updates);
    setVectorStyleChangeRevision((revision) => revision + 1);
    setVectorStyleMixedState((prev) => clearVectorToolStyleMixedState(prev, updates));
    setVectorStyle((prev) => {
      const next = { ...prev, ...updates };
      if (
        next.fillColor === prev.fillColor &&
        next.fillTextureId === prev.fillTextureId &&
        next.fillOpacity === prev.fillOpacity &&
        next.strokeColor === prev.strokeColor &&
        next.strokeOpacity === prev.strokeOpacity &&
        next.strokeWidth === prev.strokeWidth &&
        next.strokeBrushId === prev.strokeBrushId
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const handleVectorStyleSync = useCallback((snapshot: VectorToolStyleSelectionSnapshot) => {
    const nextStyle = { ...vectorStyleRef.current, ...snapshot.style };
    const didStyleChange = !areVectorToolStylesEqual(vectorStyleRef.current, nextStyle);
    const didMixedStateChange = !areVectorToolStyleMixedStatesEqual(vectorStyleMixedStateRef.current, snapshot.mixed);

    if (!didStyleChange && !didMixedStateChange) {
      return false;
    }

    if (didStyleChange) {
      setVectorStyle(nextStyle);
    }
    if (didMixedStateChange) {
      setVectorStyleMixedState(snapshot.mixed);
    }
    return didStyleChange;
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
    if ('componentId' in loadedSession) {
      return;
    }

    updateObject(loadedSession.sceneId, loadedSession.objectId, { collider: newCollider });
  }, [isCanvasReadyForSession, updateObject]);

  const handleUndo = useCallback(() => {
    performHistoryStep('undo');
  }, [performHistoryStep]);

  const handleRedo = useCallback(() => {
    performHistoryStep('redo');
  }, [performHistoryStep]);

  if (!object && !component) {
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
        activeCostumeId={activeCostumeId}
        selectedCostumeIds={selectedCostumeIds}
        onSelectCostume={handleCostumeListClick}
        onAddCostume={handleAddCostume}
        onDeleteCostumes={handleDeleteCostumes}
        onRenameCostume={handleRenameCostume}
        onReplaceCostumes={handleReplaceCostumes}
        onPrepareCostumeDrag={prepareCostumeDragSelection}
        onReorderCostumes={handleReorderCostumes}
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
            brushOpacity={brushOpacity}
            brushSize={brushSize}
            bitmapFillStyle={bitmapFillStyle}
            bitmapShapeStyle={bitmapShapeStyle}
            textStyle={textStyle}
            vectorStyle={vectorStyle}
            vectorStyleMixedState={vectorStyleMixedState}
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
            onBrushOpacityChange={setBrushOpacity}
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
            costumeDocument={editorCostume?.document ?? null}
            initialEditorMode={initialEditorMode}
            isVisible={activeObjectTab === 'costumes'}
            activeTool={activeTool}
            bitmapBrushKind={bitmapBrushKind}
            brushColor={brushColor}
            brushOpacity={brushOpacity}
            brushSize={brushSize}
            bitmapFillStyle={bitmapFillStyle}
            bitmapShapeStyle={bitmapShapeStyle}
            vectorHandleMode={vectorHandleMode}
            textStyle={textStyle}
            vectorStyle={vectorStyle}
            vectorStyleChangeRevision={vectorStyleChangeRevision}
            latestVectorStyleUpdates={latestVectorStyleUpdates}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            collider={collider}
            onHistoryChange={handleHistoryChange}
            onColliderChange={handleColliderChange}
            onModeChange={handleCanvasModeChange}
            onTextStyleSync={handleTextStyleChange}
            onVectorStyleSync={handleVectorStyleSync}
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
        <div className={`absolute inset-0 z-20 ${showSessionLoadingOverlay ? 'flex items-center justify-center bg-surface-wash text-sm text-muted-foreground backdrop-blur-[1px]' : 'bg-transparent'}`}>
          {showSessionLoadingOverlay ? 'Switching costume editor to the selected object...' : null}
        </div>
      )}
    </div>
  );
}
