import { useEffect, useLayoutEffect, useRef, useCallback, forwardRef, useMemo, useState } from 'react';
import {
  Canvas as FabricCanvas,
  Control,
} from 'fabric';
import type {
  AlignAction,
  BitmapFillStyle,
  BitmapShapeStyle,
  DrawingTool,
  MoveOrderAction,
  SelectionFlipAxis,
  TextToolStyle,
  VectorHandleMode,
  VectorStyleCapabilities,
  VectorToolStyle,
} from './CostumeToolbar';
import type {
  CostumeAssetFrame,
  CostumeBounds,
  ColliderConfig,
  CostumeDocument,
  CostumeEditorMode,
  CostumeVectorDocument,
} from '@/types';
import { CostumeCanvasStage } from './CostumeCanvasStage';
import { type BitmapBrushKind } from '@/lib/background/brushCore';
import {
  getActiveCostumeLayer,
  type ActiveLayerCanvasState,
} from '@/lib/costume/costumeDocument';
import { renderVectorTextureOverlayForFabricCanvas } from '@/lib/costume/costumeVectorTextureRenderer';
import {
  CANVAS_SIZE,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  HANDLE_SIZE,
  VECTOR_SELECTION_BORDER_SCALE,
  OBJECT_SELECTION_CORNER_SIZE,
  OBJECT_SELECTION_PADDING,
  COSTUME_WORLD_RECT,
  type PathAnchorDragState,
  type PointSelectionTransformSession,
  type PointSelectionMarqueeSession,
  type PointSelectionTransformFrameState,
} from './costumeCanvasShared';
import { useCostumeCanvasColliderController } from './useCostumeCanvasColliderController';
import { useCostumeCanvasFabricHostController } from './useCostumeCanvasFabricHostController';
import { useCostumeCanvasHistoryController } from './useCostumeCanvasHistoryController';
import { useCostumeCanvasImperativeHandle } from './useCostumeCanvasImperativeHandle';
import { useCostumeCanvasBitmapSelectionController } from './useCostumeCanvasBitmapSelectionController';
import { useCostumeCanvasBitmapLayerController } from './useCostumeCanvasBitmapLayerController';
import { useCostumeCanvasCommandController } from './useCostumeCanvasCommandController';
import { useCostumeCanvasPenController } from './useCostumeCanvasPenController';
import { useCostumeCanvasPenHotkeys } from './useCostumeCanvasPenHotkeys';
import { useCostumeCanvasSelectionController } from './useCostumeCanvasSelectionController';
import { useCostumeCanvasToolController } from './useCostumeCanvasToolController';
import { useCostumeCanvasVectorHandleSync } from './useCostumeCanvasVectorHandleSync';
import { useCostumeCanvasVectorBrushRenderer } from './useCostumeCanvasVectorBrushRenderer';
import { useCostumeCanvasVectorObjectController } from './useCostumeCanvasVectorObjectController';
import { useCostumeCanvasVectorPathController } from './useCostumeCanvasVectorPathController';
import { useCostumeCanvasViewportController } from './useCostumeCanvasViewportController';

export { DEFAULT_COSTUME_PREVIEW_SCALE } from './costumeCanvasShared';

export interface CostumeCanvasExportState {
  activeLayerDataUrl: string;
  editorMode: CostumeEditorMode;
  bitmapAssetFrame?: CostumeAssetFrame | null;
  bitmapBounds?: CostumeBounds | null;
  vectorDocument?: CostumeVectorDocument;
}

export interface CostumeCanvasHandle {
  toDataURL: () => string;
  toDataURLWithBounds: () => { dataUrl: string; bounds: CostumeBounds | null };
  loadFromDataURL: (dataUrl: string, sessionKey?: string | null) => Promise<void>;
  loadDocument: (sessionKey: string, document: CostumeDocument) => Promise<void>;
  flushPendingBitmapCommits: () => Promise<void>;
  exportCostumeState: (sessionKey?: string | null) => CostumeCanvasExportState | null;
  hasUnsavedChanges: (sessionKey?: string | null) => boolean;
  markPersisted: (sessionKey?: string | null, state?: ActiveLayerCanvasState | null) => void;
  setEditorMode: (mode: CostumeEditorMode) => Promise<void>;
  getEditorMode: () => CostumeEditorMode;
  getLoadedSessionKey: () => string | null;
  deleteSelection: () => boolean;
  duplicateSelection: () => Promise<boolean>;
  moveSelectionOrder: (action: MoveOrderAction) => boolean;
  flipSelection: (axis: SelectionFlipAxis) => boolean;
  rotateSelection: () => boolean;
  alignSelection: (action: AlignAction) => boolean;
  isTextEditing: () => boolean;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

interface CostumeCanvasProps {
  costumeDocument: CostumeDocument | null;
  initialEditorMode: CostumeEditorMode;
  isVisible: boolean;
  activeTool: DrawingTool;
  bitmapBrushKind: BitmapBrushKind;
  brushColor: string;
  brushSize: number;
  bitmapFillStyle: BitmapFillStyle;
  bitmapShapeStyle: BitmapShapeStyle;
  vectorHandleMode: VectorHandleMode;
  textStyle: TextToolStyle;
  vectorStyle: VectorToolStyle;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  collider: ColliderConfig | null;
  onHistoryChange?: (state: ActiveLayerCanvasState) => void;
  onColliderChange?: (collider: ColliderConfig) => void;
  onModeChange?: (mode: CostumeEditorMode) => void;
  onTextStyleSync?: (updates: Partial<TextToolStyle>) => void;
  onVectorStyleSync?: (updates: Partial<VectorToolStyle>) => void;
  onVectorHandleModeSync?: (handleMode: VectorHandleMode) => void;
  onVectorStyleCapabilitiesSync?: (capabilities: VectorStyleCapabilities) => void;
  onVectorPointEditingChange?: (isEditing: boolean) => void;
  onVectorPointSelectionChange?: (hasSelectedPoints: boolean) => void;
  onTextSelectionChange?: (hasTextSelection: boolean) => void;
  onSelectionStateChange?: (state: { hasSelection: boolean; hasBitmapFloatingSelection: boolean }) => void;
  onViewScaleChange?: (scale: number) => void;
}

export const CostumeCanvas = forwardRef<CostumeCanvasHandle, CostumeCanvasProps>(({
  costumeDocument,
  initialEditorMode,
  isVisible,
  activeTool,
  bitmapBrushKind,
  brushColor,
  brushSize,
  bitmapFillStyle,
  bitmapShapeStyle,
  vectorHandleMode,
  textStyle,
  vectorStyle,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  collider,
  onHistoryChange,
  onColliderChange,
  onModeChange,
  onTextStyleSync,
  onVectorStyleSync,
  onVectorHandleModeSync,
  onVectorStyleCapabilitiesSync,
  onVectorPointEditingChange,
  onVectorPointSelectionChange,
  onTextSelectionChange,
  onSelectionStateChange,
  onViewScaleChange,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textEditingHostRef = useRef<HTMLDivElement>(null);
  const brushCursorOverlayRef = useRef<HTMLDivElement>(null);
  const fabricCanvasHostRef = useRef<HTMLDivElement | null>(null);
  const [fabricCanvasHostElement, setFabricCanvasHostElement] = useState<HTMLDivElement | null>(null);
  const fabricCanvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const layerSurfaceRefs = useRef(new Map<string, HTMLCanvasElement>());
  const vectorStrokeCanvasRef = useRef<HTMLCanvasElement>(null);
  const vectorGuideCanvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapSelectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const colliderCanvasRef = useRef<HTMLCanvasElement>(null);
  const vectorStrokeCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const vectorGuideCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const bitmapSelectionCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);
  const documentLayers = costumeDocument?.layers ?? [];
  const activeDocumentLayer = useMemo(() => getActiveCostumeLayer(costumeDocument), [costumeDocument]);
  const [hostedLayerIdState, setHostedLayerIdState] = useState<string | null>(null);
  const hostedLayerIdRef = useRef<string | null>(null);
  const [isHostedLayerReadyState, setIsHostedLayerReadyState] = useState(false);
  const isHostedLayerReadyRef = useRef(false);
  const fabricCanvasReadyResolversRef = useRef<Array<() => void>>([]);
  const setFabricCanvasHostNode = useCallback((node: HTMLDivElement | null) => {
    if (fabricCanvasHostRef.current === node) {
      return;
    }
    fabricCanvasHostRef.current = node;
    setFabricCanvasHostElement(node);
  }, []);
  const setHostedLayerId = useCallback((layerId: string | null) => {
    hostedLayerIdRef.current = layerId;
    setHostedLayerIdState(layerId);
  }, []);
  const setHostedLayerReady = useCallback((ready: boolean) => {
    isHostedLayerReadyRef.current = ready;
    setIsHostedLayerReadyState(ready);
  }, []);
  const resolveFabricCanvasReady = useCallback(() => {
    const pendingResolvers = fabricCanvasReadyResolversRef.current.splice(0);
    pendingResolvers.forEach((resolve) => resolve());
  }, []);
  const hostedDocumentLayer = useMemo(
    () => documentLayers.find((layer) => layer.id === hostedLayerIdState) ?? activeDocumentLayer ?? null,
    [activeDocumentLayer, documentLayers, hostedLayerIdState],
  );
  const activeLayerOpacity = hostedDocumentLayer?.opacity ?? 1;
  const activeLayerVisible = hostedDocumentLayer?.visible ?? true;
  const activeLayerLocked = hostedDocumentLayer?.locked ?? false;
  const [editorModeState, setEditorModeState] = useState<CostumeEditorMode>(initialEditorMode);
  const [hasBitmapFloatingSelection, setHasBitmapFloatingSelection] = useState(false);
  const [canZoomToSelection, setCanZoomToSelection] = useState(false);

  const editorModeRef = useRef<CostumeEditorMode>(initialEditorMode);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const activeLayerOpacityRef = useRef(activeLayerOpacity);
  activeLayerOpacityRef.current = activeLayerOpacity;
  const activeLayerVisibleRef = useRef(activeLayerVisible);
  activeLayerVisibleRef.current = activeLayerVisible;
  const activeLayerLockedRef = useRef(activeLayerLocked);
  activeLayerLockedRef.current = activeLayerLocked || !isHostedLayerReadyState;
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;
  const previousVisibilityRef = useRef(isVisible);
  const pendingVisibilityHostRenderRef = useRef(false);

  const bitmapBrushKindRef = useRef(bitmapBrushKind);
  bitmapBrushKindRef.current = bitmapBrushKind;

  const brushColorRef = useRef(brushColor);
  brushColorRef.current = brushColor;

  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;

  const bitmapFillStyleRef = useRef(bitmapFillStyle);
  bitmapFillStyleRef.current = bitmapFillStyle;

  const bitmapShapeStyleRef = useRef(bitmapShapeStyle);
  bitmapShapeStyleRef.current = bitmapShapeStyle;

  const vectorHandleModeRef = useRef<VectorHandleMode>(vectorHandleMode);
  vectorHandleModeRef.current = vectorHandleMode;
  const pendingSelectionSyncedVectorHandleModeRef = useRef<VectorHandleMode | null>(null);

  const textStyleRef = useRef(textStyle);
  textStyleRef.current = textStyle;

  const vectorStyleRef = useRef(vectorStyle);
  vectorStyleRef.current = vectorStyle;

  const onHistoryChangeRef = useRef(onHistoryChange);
  onHistoryChangeRef.current = onHistoryChange;

  const onColliderChangeRef = useRef(onColliderChange);
  onColliderChangeRef.current = onColliderChange;

  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;

  const onTextStyleSyncRef = useRef(onTextStyleSync);
  onTextStyleSyncRef.current = onTextStyleSync;

  const onVectorStyleSyncRef = useRef(onVectorStyleSync);
  onVectorStyleSyncRef.current = onVectorStyleSync;
  const onVectorHandleModeSyncRef = useRef(onVectorHandleModeSync);
  onVectorHandleModeSyncRef.current = onVectorHandleModeSync;

  const onVectorStyleCapabilitiesSyncRef = useRef(onVectorStyleCapabilitiesSync);
  onVectorStyleCapabilitiesSyncRef.current = onVectorStyleCapabilitiesSync;

  const onVectorPointEditingChangeRef = useRef(onVectorPointEditingChange);
  onVectorPointEditingChangeRef.current = onVectorPointEditingChange;
  const onVectorPointSelectionChangeRef = useRef(onVectorPointSelectionChange);
  onVectorPointSelectionChangeRef.current = onVectorPointSelectionChange;

  const onTextSelectionChangeRef = useRef(onTextSelectionChange);
  onTextSelectionChangeRef.current = onTextSelectionChange;
  const onSelectionStateChangeRef = useRef(onSelectionStateChange);
  onSelectionStateChangeRef.current = onSelectionStateChange;

  const suppressHistoryRef = useRef(false);
  const bitmapRasterCommitQueueRef = useRef<Promise<void>>(Promise.resolve());

  const shapeDraftRef = useRef<{
    type: 'rectangle' | 'circle' | 'triangle' | 'star' | 'line';
    startX: number;
    startY: number;
    object: any;
  } | null>(null);

  const bitmapFloatingObjectRef = useRef<any | null>(null);
  const bitmapSelectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const bitmapMarqueeRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const bitmapSelectionDragModeRef = useRef<'none' | 'marquee'>('none');
  const bitmapSelectionBusyRef = useRef(false);
  const suppressBitmapSelectionAutoCommitRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const loadedSessionKeyRef = useRef<string | null>(null);
  const {
    createSnapshot,
    lastCommittedSnapshotRef,
    markActiveLayerCanvasStatePersisted,
    markCurrentSnapshotPersisted,
    persistedSnapshotRef,
    saveHistory,
  } = useCostumeCanvasHistoryController({
    editorModeRef,
    fabricCanvasRef,
    loadedSessionKeyRef,
    onHistoryChangeRef,
    suppressHistoryRef,
  });
  const originalControlsRef = useRef<WeakMap<object, Record<string, Control> | undefined>>(new WeakMap());
  const activePathAnchorRef = useRef<{ path: any; anchorIndex: number } | null>(null);
  const selectedPathAnchorIndicesRef = useRef<number[]>([]);
  const vectorPointEditingTargetRef = useRef<any | null>(null);
  const insertedPathAnchorDragSessionRef = useRef<{
    path: any;
    anchorIndex: number;
    dragState: PathAnchorDragState;
  } | null>(null);
  const pointSelectionTransformFrameRef = useRef<PointSelectionTransformFrameState | null>(null);
  const pointSelectionTransformSessionRef = useRef<PointSelectionTransformSession | null>(null);
  const pointSelectionMarqueeSessionRef = useRef<PointSelectionMarqueeSession | null>(null);

  const {
    cameraCenter,
    getZoomInvariantMetric,
    isViewportPanning,
    refreshViewportSize,
    setZoomLevel,
    syncBrushCursorOverlay,
    viewportSize,
    zoom,
    zoomAroundViewportCenter,
    zoomRef,
    zoomToBounds,
  } = useCostumeCanvasViewportController({
    activeTool,
    activeToolRef,
    activeLayerLockedRef,
    activeLayerVisibleRef,
    bitmapBrushKind,
    bitmapBrushKindRef,
    brushColor,
    brushColorRef,
    brushCursorOverlayRef,
    brushSize,
    brushSizeRef,
    containerRef,
    editorModeRef,
    editorModeState,
    isVisible,
    onViewScaleChange,
  });

  const { drawCollider } = useCostumeCanvasColliderController({
    activeTool,
    collider,
    colliderCanvasRef,
    onColliderChange,
  });

  const {
    getSelectionBoundsSnapshot,
    restoreCanvasSelection,
    setVectorPointEditingTarget,
    syncSelectionState,
  } = useCostumeCanvasSelectionController({
    activeLayerVisibleRef,
    activePathAnchorRef,
    bitmapFloatingObjectRef,
    editorModeRef,
    fabricCanvasRef,
    insertedPathAnchorDragSessionRef,
    onSelectionStateChangeRef,
    onVectorPointEditingChangeRef,
    onVectorPointSelectionChangeRef,
    pendingSelectionSyncedVectorHandleModeRef,
    pointSelectionMarqueeSessionRef,
    pointSelectionTransformFrameRef,
    pointSelectionTransformSessionRef,
    selectedPathAnchorIndicesRef,
    setCanZoomToSelection,
    vectorPointEditingTargetRef,
  });

  const {
    commitCurrentPenPlacement,
    finalizePenDraft,
    penAnchorPlacementSessionRef,
    penDraftRef,
    penModifierStateRef,
    removeLastPenDraftAnchor,
    renderPenDraftGuide,
    setPenAnchorMoveMode,
    startPenAnchorPlacement,
    syncPenPlacementToAltModifier,
    updatePenAnchorPlacement,
  } = useCostumeCanvasPenController({
    activeToolRef,
    fabricCanvasRef,
    getZoomInvariantMetric,
    saveHistory,
    syncSelectionState,
    vectorStyleRef,
  });

  const syncActiveLayerCanvasVisibility = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current as (FabricCanvas & {
      wrapperEl?: HTMLDivElement;
      lowerCanvasEl?: HTMLCanvasElement;
      upperCanvasEl?: HTMLCanvasElement;
    }) | null;
    if (!fabricCanvas) {
      return;
    }

    const nextOpacity = isVisibleRef.current && isHostedLayerReadyRef.current && activeLayerVisibleRef.current
      ? String(activeLayerOpacityRef.current)
      : '0';
    if (fabricCanvas.wrapperEl) {
      fabricCanvas.wrapperEl.style.opacity = nextOpacity;
    }
    if (fabricCanvas.lowerCanvasEl) {
      fabricCanvas.lowerCanvasEl.style.opacity = nextOpacity;
    }
    if (fabricCanvas.upperCanvasEl) {
      fabricCanvas.upperCanvasEl.style.opacity = nextOpacity;
    }
  }, []);

  const setEditorMode = useCallback((mode: CostumeEditorMode) => {
    editorModeRef.current = mode;
    setEditorModeState(mode);
    onModeChangeRef.current?.(mode);
    if (mode !== 'vector') {
      setVectorPointEditingTarget(null);
      activePathAnchorRef.current = null;
      onTextSelectionChangeRef.current?.(false);
    }
    syncSelectionState();
  }, [setVectorPointEditingTarget, syncSelectionState]);

  const isLoadRequestActive = useCallback((requestId?: number) => {
    if (typeof requestId !== 'number') return true;
    return loadRequestIdRef.current === requestId;
  }, []);

  const waitForFabricCanvas = useCallback(async (requestId?: number): Promise<FabricCanvas | null> => {
    if (!isLoadRequestActive(requestId)) {
      return null;
    }

    if (fabricCanvasRef.current) {
      return fabricCanvasRef.current;
    }

    await new Promise<void>((resolve) => {
      fabricCanvasReadyResolversRef.current.push(resolve);
    });

    if (!isLoadRequestActive(requestId)) {
      return null;
    }

    return fabricCanvasRef.current;
  }, [isLoadRequestActive]);

  const drawBitmapSelectionOverlay = useCallback(() => {
    const overlayCtx = bitmapSelectionCtxRef.current;
    if (!overlayCtx) return;

    overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const marquee = bitmapMarqueeRectRef.current;
    if (marquee && bitmapSelectionDragModeRef.current === 'marquee') {
      overlayCtx.fillStyle = 'rgba(0, 102, 255, 0.1)';
      overlayCtx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height);
      overlayCtx.strokeStyle = '#0066ff';
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([6, 6]);
      overlayCtx.strokeRect(marquee.x, marquee.y, marquee.width, marquee.height);
      overlayCtx.setLineDash([]);
    }
  }, []);

  const {
    commitBitmapSelection,
    commitBitmapStampBrushStroke,
    flattenBitmapLayer,
    loadBitmapAsSingleVectorImage,
    loadBitmapLayer,
    normalizeCanvasVectorStrokeUniform,
  } = useCostumeCanvasBitmapLayerController({
    bitmapFloatingObjectRef,
    bitmapMarqueeRectRef,
    bitmapRasterCommitQueueRef,
    bitmapSelectionBusyRef,
    bitmapSelectionDragModeRef,
    bitmapSelectionStartRef,
    drawBitmapSelectionOverlay,
    editorModeRef,
    fabricCanvasRef,
    getLastCommittedSnapshot: () => lastCommittedSnapshotRef.current,
    isLoadRequestActive,
    saveHistory,
    setHasBitmapFloatingSelection,
    suppressHistoryRef,
    syncSelectionState,
    waitForFabricCanvas,
  });

  const {
    renderVectorBrushStrokeOverlay,
    resolveBitmapFillTextureSource,
  } = useCostumeCanvasVectorBrushRenderer({
    editorModeRef,
    fabricCanvasRef,
  });

  const getActiveLayerCanvasElement = useCallback((): HTMLCanvasElement => {
    const fabricCanvas = fabricCanvasRef.current;
    if (fabricCanvas) {
      return fabricCanvas.toCanvasElement(1);
    }

    const fallback = document.createElement('canvas');
    fallback.width = CANVAS_SIZE;
    fallback.height = CANVAS_SIZE;
    return fallback;
  }, []);

  const commitHostedLayerSurfaceSnapshot = useCallback((layerId: string | null) => {
    if (!layerId) {
      return;
    }

    const surface = layerSurfaceRefs.current.get(layerId);
    const fabricCanvas = fabricCanvasRef.current;
    if (!surface || !fabricCanvas) {
      return;
    }

    const ctx = surface.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, surface.width, surface.height);
    ctx.drawImage(fabricCanvas.toCanvasElement(1), 0, 0, surface.width, surface.height);
    if (editorModeRef.current === 'vector') {
      renderVectorTextureOverlayForFabricCanvas(ctx, fabricCanvas, {
        canvasSize: surface.width,
        clear: false,
      });
    }
  }, []);

  const {
    alignSelection,
    applyFill,
    deleteSelection,
    duplicateSelection,
    exportCostumeState,
    flipSelection,
    getComposedCanvasElement,
    getSelectionMousePos,
    isTextEditing,
    loadDocument,
    moveSelectionOrder,
    rotateSelection,
    switchEditorMode,
    syncActiveVectorStyle,
    syncTextSelectionState,
    syncTextStyleFromSelection,
    syncVectorStyleFromSelection,
  } = useCostumeCanvasCommandController({
    activeDocumentLayerId: activeDocumentLayer?.id,
    activeLayerOpacity,
    activeLayerVisible,
    bitmapFillStyleRef,
    bitmapFloatingObjectRef,
    bitmapMarqueeRectRef,
    bitmapSelectionCanvasRef,
    bitmapSelectionBusyRef,
    bitmapSelectionDragModeRef,
    bitmapSelectionStartRef,
    brushColorRef,
    commitHostedLayerSurfaceSnapshot,
    documentLayers,
    drawBitmapSelectionOverlay,
    editorModeRef,
    fabricCanvasRef,
    getActiveLayerCanvasElement,
    getSelectionBoundsSnapshot,
    hostedLayerIdRef,
    isLoadRequestActive,
    isHostedLayerReadyRef,
    lastCommittedSnapshotRef,
    layerSurfaceRefs,
    loadBitmapAsSingleVectorImage,
    loadBitmapLayer,
    loadRequestIdRef,
    loadedSessionKeyRef,
    markCurrentSnapshotPersisted,
    normalizeCanvasVectorStrokeUniform,
    onTextSelectionChangeRef,
    onTextStyleSyncRef,
    onVectorStyleCapabilitiesSyncRef,
    onVectorStyleSyncRef,
    renderVectorBrushStrokeOverlay,
    resolveBitmapFillTextureSource,
    restoreCanvasSelection,
    saveHistory,
    setEditorMode,
    setHasBitmapFloatingSelection,
    setHostedLayerId,
    setHostedLayerReady,
    suppressBitmapSelectionAutoCommitRef,
    suppressHistoryRef,
    syncSelectionState,
    textStyle,
    vectorStyle,
    waitForFabricCanvas,
  });

  const handleFabricCanvasAfterRender = useCallback(() => {
    if (!isVisibleRef.current || !pendingVisibilityHostRenderRef.current) {
      return;
    }

    pendingVisibilityHostRenderRef.current = false;
    setHostedLayerReady(true);
    syncActiveLayerCanvasVisibility();
  }, [setHostedLayerReady, syncActiveLayerCanvasVisibility]);

  const {
    applyPointSelectionMarqueeSession,
    applyPointSelectionTransformSession,
    beginPointSelectionTransformSession,
    buildPathDataFromPoints,
    clearSelectedPathAnchors,
    createFourPointEllipsePathData,
    enforcePathAnchorHandleType,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathAnchorDragState,
    getPathNodeHandleType,
    getPointSelectionTransformHandlePoints,
    getSceneRectFromPoints,
    getSelectedPathAnchorIndices,
    getSelectedPathAnchorTransformSnapshot,
    hasPointSelectionMarqueeExceededThreshold,
    hitPointSelectionTransform,
    insertPathPointAtScenePosition,
    isPointSelectionToggleModifierPressed,
    movePathAnchorByDelta,
    removeDuplicateClosedPathAnchorControl,
    resolveAnchorFromPathControlKey,
    restoreAllOriginalControls,
    restoreOriginalControls,
    setPathNodeHandleType,
    setSelectedPathAnchors,
    stabilizePathAfterAnchorMutation,
    syncPathAnchorSelectionAppearance,
    syncPathControlPointVisibility,
    syncVectorHandleModeFromSelection,
    toCanvasPoint,
    toPathCommandPoint,
  } = useCostumeCanvasVectorPathController({
    activePathAnchorRef,
    fabricCanvasRef,
    getZoomInvariantMetric,
    onVectorHandleModeSyncRef,
    onVectorPointSelectionChangeRef,
    originalControlsRef,
    pendingSelectionSyncedVectorHandleModeRef,
    pointSelectionTransformFrameRef,
    pointSelectionTransformSessionRef,
    selectedPathAnchorIndicesRef,
    vectorPointEditingTargetRef,
    zoomRef,
  });

  const {
    applyVectorPointControls,
    applyVectorPointEditingAppearance,
    ensurePathLikeObjectForVectorTool,
    renderVectorPointEditingGuide,
  } = useCostumeCanvasVectorObjectController({
    activePathAnchorRef,
    activeToolRef,
    buildPathDataFromPoints,
    createFourPointEllipsePathData,
    editorModeRef,
    enforcePathAnchorHandleType,
    fabricCanvasRef,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathAnchorDragState,
    getPathNodeHandleType,
    getPointSelectionTransformHandlePoints,
    getSceneRectFromPoints,
    getSelectedPathAnchorIndices,
    getSelectedPathAnchorTransformSnapshot,
    getZoomInvariantMetric,
    hasPointSelectionMarqueeExceededThreshold,
    isPointSelectionToggleModifierPressed,
    movePathAnchorByDelta,
    originalControlsRef,
    pointSelectionMarqueeSessionRef,
    removeDuplicateClosedPathAnchorControl,
    renderPenDraftGuide,
    resolveAnchorFromPathControlKey,
    restoreOriginalControls,
    setPathNodeHandleType,
    setSelectedPathAnchors,
    stabilizePathAfterAnchorMutation,
    syncPathAnchorSelectionAppearance,
    syncPathControlPointVisibility,
    syncVectorHandleModeFromSelection,
    toCanvasPoint,
    vectorGuideCtxRef,
    vectorHandleModeRef,
    vectorPointEditingTargetRef,
  });

  const {
    activateVectorPointEditing,
    configureCanvasForTool,
  } = useCostumeCanvasToolController({
    activeLayerLocked,
    activeLayerVisible,
    activeToolRef,
    applyVectorPointControls,
    applyVectorPointEditingAppearance,
    bitmapBrushKindRef,
    bitmapFloatingObjectRef,
    brushColorRef,
    brushSizeRef,
    commitBitmapStampBrushStroke,
    editorModeRef,
    ensurePathLikeObjectForVectorTool,
    fabricCanvasRef,
    getZoomInvariantMetric,
    normalizeCanvasVectorStrokeUniform,
    restoreAllOriginalControls,
    restoreOriginalControls,
    saveHistory,
    setVectorPointEditingTarget,
    syncBrushCursorOverlay,
    syncSelectionState,
    textEditingHostRef,
    vectorPointEditingTargetRef,
    vectorStyleRef,
  });

  useCostumeCanvasFabricHostController({
    activeLayerLockedRef,
    activeLayerVisibleRef,
    activePathAnchorRef,
    activeToolRef,
    activateVectorPointEditing,
    applyFill,
    applyPointSelectionMarqueeSession,
    applyPointSelectionTransformSession,
    applyVectorPointControls,
    applyVectorPointEditingAppearance,
    beginPointSelectionTransformSession,
    bitmapFloatingObjectRef,
    bitmapSelectionBusyRef,
    bitmapSelectionCanvasRef,
    bitmapSelectionCtxRef,
    bitmapShapeStyleRef,
    brushColorRef,
    clearSelectedPathAnchors,
    commitBitmapSelection,
    commitCurrentPenPlacement,
    configureCanvasForTool,
    drawBitmapSelectionOverlay,
    editorModeRef,
    enforcePathAnchorHandleType,
    fabricCanvasElementRef,
    fabricCanvasHostRef,
    fabricCanvasHostElement,
    fabricCanvasRef,
    flattenBitmapLayer,
    getPathAnchorDragState,
    getSelectedPathAnchorIndices,
    getSelectedPathAnchorTransformSnapshot,
    hitPointSelectionTransform,
    insertedPathAnchorDragSessionRef,
    insertPathPointAtScenePosition,
    isPointSelectionToggleModifierPressed,
    loadBitmapLayer,
    movePathAnchorByDelta,
    penAnchorPlacementSessionRef,
    penDraftRef,
    pointSelectionMarqueeSessionRef,
    pointSelectionTransformSessionRef,
    renderVectorBrushStrokeOverlay,
    renderVectorPointEditingGuide,
    restoreAllOriginalControls,
    saveHistory,
    setSelectedPathAnchors,
    setVectorPointEditingTarget,
    shapeDraftRef,
    startPenAnchorPlacement,
    suppressBitmapSelectionAutoCommitRef,
    syncActiveLayerCanvasVisibility,
    syncSelectionState,
    syncTextSelectionState,
    syncTextStyleFromSelection,
    syncVectorHandleModeFromSelection,
    syncVectorStyleFromSelection,
    textEditingHostRef,
    textStyleRef,
    toPathCommandPoint,
    updatePenAnchorPlacement,
    vectorGuideCanvasRef,
    vectorGuideCtxRef,
    vectorPointEditingTargetRef,
    vectorStrokeCanvasRef,
    vectorStrokeCtxRef,
    vectorStyleRef,
    onFabricCanvasReady: resolveFabricCanvasReady,
    onFabricCanvasAfterRender: handleFabricCanvasAfterRender,
  });

  // Sync tool behavior.
  useLayoutEffect(() => {
    configureCanvasForTool();
  }, [activeTool, bitmapBrushKind, brushColor, brushSize, editorModeState, hasBitmapFloatingSelection, vectorStyle, configureCanvasForTool]);

  useLayoutEffect(() => {
    syncActiveLayerCanvasVisibility();
  }, [activeLayerOpacity, activeLayerVisible, isHostedLayerReadyState, isVisible, syncActiveLayerCanvasVisibility]);

  useCostumeCanvasVectorHandleSync({
    activePathAnchorRef,
    activeToolRef,
    editorModeRef,
    enforcePathAnchorHandleType,
    fabricCanvasRef,
    getPathNodeHandleType,
    getSelectedPathAnchorIndices,
    pendingSelectionSyncedVectorHandleModeRef,
    saveHistory,
    setPathNodeHandleType,
    syncPathControlPointVisibility,
    vectorHandleMode,
    vectorPointEditingTargetRef,
  });

  useEffect(() => {
    syncActiveVectorStyle();
  }, [brushColor, textStyle, vectorStyle, syncActiveVectorStyle]);

  useCostumeCanvasBitmapSelectionController({
    activeTool,
    bitmapFloatingObjectRef,
    bitmapMarqueeRectRef,
    bitmapSelectionBusyRef,
    bitmapSelectionCanvasRef,
    bitmapSelectionDragModeRef,
    bitmapSelectionStartRef,
    commitBitmapSelection,
    configureCanvasForTool,
    drawBitmapSelectionOverlay,
    editorModeState,
    fabricCanvasRef,
    getSelectionMousePos,
    hasBitmapFloatingSelection,
    loadBitmapLayer,
    setHasBitmapFloatingSelection,
    syncSelectionState,
  });

  useEffect(() => {
    if (editorModeState === 'vector' && activeTool === 'pen') {
      return;
    }
    if (penDraftRef.current) {
      finalizePenDraft();
    }
  }, [activeTool, editorModeState, finalizePenDraft]);

  useEffect(() => {
    if (editorModeState !== 'vector' || activeTool !== 'pen') {
      return;
    }
    if (!penDraftRef.current) {
      return;
    }
    fabricCanvasRef.current?.requestRenderAll();
  }, [activeTool, editorModeState, vectorStyle]);

  useCostumeCanvasPenHotkeys({
    activeToolRef,
    editorModeRef,
    fabricCanvasRef,
    finalizePenDraft,
    penAnchorPlacementSessionRef,
    penDraftRef,
    penModifierStateRef,
    removeLastPenDraftAnchor,
    setPenAnchorMoveMode,
    syncPenPlacementToAltModifier,
  });

  useCostumeCanvasImperativeHandle({
    alignSelection,
    bitmapRasterCommitQueueRef,
    configureCanvasForTool,
    createSnapshot,
    deleteSelection,
    duplicateSelection,
    exportCostumeState,
    flipSelection,
    getComposedCanvasElement,
    isTextEditing,
    lastCommittedSnapshotRef,
    loadBitmapLayer,
    loadDocument,
    loadedSessionKeyRef,
    markActiveLayerCanvasStatePersisted,
    markCurrentSnapshotPersisted,
    moveSelectionOrder,
    persistedSnapshotRef,
    ref,
    rotateSelection,
    saveHistory,
    setEditorMode,
    switchEditorMode,
    editorModeRef,
  });

  useEffect(() => {
    if (costumeDocument) {
      return;
    }
    pendingVisibilityHostRenderRef.current = false;
    setHostedLayerId(null);
    setHostedLayerReady(false);
  }, [costumeDocument, setHostedLayerId, setHostedLayerReady]);

  // Keep tab visibility resume owned here so the Fabric host can stay low-level.
  // When the tab is hidden we fall back to the static layer surface, and when it
  // becomes visible again we only trust the live host after its next real paint.
  useEffect(() => {
    const wasVisible = previousVisibilityRef.current;
    previousVisibilityRef.current = isVisible;

    if (wasVisible === isVisible) {
      return;
    }

    const hostedLayerId = hostedLayerIdRef.current ?? hostedDocumentLayer?.id ?? activeDocumentLayer?.id ?? null;
    const fabricCanvas = fabricCanvasRef.current as (FabricCanvas & { calcOffset?: () => void }) | null;

    if (!isVisible) {
      pendingVisibilityHostRenderRef.current = false;
      if (hostedLayerId && fabricCanvas) {
        commitHostedLayerSurfaceSnapshot(hostedLayerId);
      }
      setHostedLayerReady(false);
      syncActiveLayerCanvasVisibility();
      return;
    }

    refreshViewportSize();

    if (!hostedLayerId || !fabricCanvas) {
      pendingVisibilityHostRenderRef.current = false;
      return;
    }

    pendingVisibilityHostRenderRef.current = true;
    setHostedLayerReady(false);
    syncActiveLayerCanvasVisibility();
    fabricCanvas.calcOffset?.();
    syncSelectionState();
    configureCanvasForTool();
    fabricCanvas.requestRenderAll();
  }, [
    activeDocumentLayer?.id,
    commitHostedLayerSurfaceSnapshot,
    configureCanvasForTool,
    hostedDocumentLayer?.id,
    isVisible,
    refreshViewportSize,
    setHostedLayerReady,
    syncSelectionState,
    syncActiveLayerCanvasVisibility,
  ]);

  useEffect(() => {
    return () => {
      const pendingResolvers = fabricCanvasReadyResolversRef.current.splice(0);
      pendingResolvers.forEach((resolve) => resolve());
    };
  }, []);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    const selectionCornerSize = getZoomInvariantMetric(OBJECT_SELECTION_CORNER_SIZE, zoom);
    const selectionBorderScale = getZoomInvariantMetric(VECTOR_SELECTION_BORDER_SCALE, zoom);
    const selectionPadding = getZoomInvariantMetric(OBJECT_SELECTION_PADDING, zoom);
    const pointEditingTarget = vectorPointEditingTargetRef.current as any;

    fabricCanvas.forEachObject((obj: any) => {
      obj.borderScaleFactor = selectionBorderScale;
      obj.padding = obj === pointEditingTarget ? 0 : selectionPadding;
      obj.cornerSize = obj === pointEditingTarget
        ? getZoomInvariantMetric(HANDLE_SIZE, zoom)
        : selectionCornerSize;
      obj.setCoords?.();
    });

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (activeObject) {
      activeObject.borderScaleFactor = selectionBorderScale;
      activeObject.padding = activeObject === pointEditingTarget ? 0 : selectionPadding;
      activeObject.cornerSize = activeObject === pointEditingTarget
        ? getZoomInvariantMetric(HANDLE_SIZE, zoom)
        : selectionCornerSize;
    }
    activeObject?.setCoords?.();
    fabricCanvas.requestRenderAll();
    renderVectorPointEditingGuide();
    drawCollider(collider, activeTool === 'collider');
  }, [activeTool, collider, drawCollider, getZoomInvariantMetric, renderVectorPointEditingGuide, zoom]);

  const handleZoomToActualSize = useCallback(() => {
    setZoomLevel(1);
  }, [setZoomLevel]);

  const handleZoomToFit = useCallback(() => {
    zoomToBounds(COSTUME_WORLD_RECT, 48);
  }, [zoomToBounds]);

  const handleZoomToSelection = useCallback(() => {
    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return;
    zoomToBounds(selectionSnapshot.bounds, 72);
  }, [getSelectionBoundsSnapshot, zoomToBounds]);

  return (
    <CostumeCanvasStage
      activeLayerLocked={activeLayerLocked}
      activeLayerOpacity={activeLayerOpacity}
      activeLayerVisible={activeLayerVisible}
      activeTool={activeTool}
      bitmapSelectionCanvasRef={bitmapSelectionCanvasRef}
      brushCursorOverlayRef={brushCursorOverlayRef}
      cameraCenter={cameraCenter}
      canRedo={canRedo}
      canUndo={canUndo}
      canZoomToSelection={canZoomToSelection}
      colliderCanvasRef={colliderCanvasRef}
      containerRef={containerRef}
      documentLayers={documentLayers}
      editorModeState={editorModeState}
      fabricCanvasHostRef={setFabricCanvasHostNode}
      hasBitmapFloatingSelection={hasBitmapFloatingSelection}
      hostedLayerId={hostedDocumentLayer?.id ?? null}
      hostedLayerReady={isHostedLayerReadyState}
      isViewportPanning={isViewportPanning}
      layerSurfaceRefs={layerSurfaceRefs}
      maxZoom={MAX_ZOOM}
      minZoom={MIN_ZOOM}
      onRedo={onRedo}
      onUndo={onUndo}
      onZoomIn={() => zoomAroundViewportCenter(zoom + ZOOM_STEP)}
      onZoomOut={() => zoomAroundViewportCenter(zoom - ZOOM_STEP)}
      onZoomToActualSize={handleZoomToActualSize}
      onZoomToFit={handleZoomToFit}
      onZoomToSelection={handleZoomToSelection}
      textEditingHostRef={textEditingHostRef}
      vectorGuideCanvasRef={vectorGuideCanvasRef}
      vectorStrokeCanvasRef={vectorStrokeCanvasRef}
      viewportSize={viewportSize}
      zoom={zoom}
    />
  );
});

CostumeCanvas.displayName = 'CostumeCanvas';
