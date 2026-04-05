import { useEffect, useLayoutEffect, useRef, useCallback, forwardRef, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Canvas as FabricCanvas,
  Control,
  Point,
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
  VectorToolStyleSelectionSnapshot,
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
import { getResolvedEditorSelectionTokens } from '@/lib/ui/editorSelectionTokens';
import {
  fabricCanvasContainsObject,
  resolveVectorGroupEditingRootTarget,
} from '@/lib/editor/fabricVectorSelection';
import { CostumeCanvasStage } from './CostumeCanvasStage';
import { type BitmapBrushKind } from '@/lib/background/brushCore';
import {
  getActiveCostumeLayer,
  type ActiveLayerCanvasState,
} from '@/lib/costume/costumeDocument';
import { renderComposedVectorSceneForFabricCanvas } from '@/lib/costume/costumeVectorTextureRenderer';
import {
  CANVAS_SIZE,
  DEFAULT_COSTUME_PREVIEW_SCALE,
  type MirroredPathAnchorDragSession,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  COSTUME_WORLD_RECT,
  type PathAnchorDragState,
  type PointSelectionTransformSession,
  type PointSelectionMarqueeSession,
  type PointSelectionTransformFrameState,
  type ShapeDraftSession,
} from './costumeCanvasShared';
import { clearCanvasInCssPixels, syncCanvasViewportSize } from '@/lib/editor/canvasOverlay';
import { useCostumeCanvasColliderController } from './useCostumeCanvasColliderController';
import { useCostumeCanvasFabricHostController } from './useCostumeCanvasFabricHostController';
import { useCostumeCanvasHistoryController } from './useCostumeCanvasHistoryController';
import { useCostumeCanvasImperativeHandle } from './useCostumeCanvasImperativeHandle';
import { useCostumeCanvasBitmapSelectionController } from './useCostumeCanvasBitmapSelectionController';
import { useCostumeCanvasBitmapLayerController } from './useCostumeCanvasBitmapLayerController';
import { useCostumeCanvasCommandController } from './useCostumeCanvasCommandController';
import { useCostumeCanvasPenController } from './useCostumeCanvasPenController';
import { useCostumeCanvasMirroredPathHotkeys } from './useCostumeCanvasMirroredPathHotkeys';
import { useCostumeCanvasPenHotkeys } from './useCostumeCanvasPenHotkeys';
import { useCostumeCanvasSelectionController } from './useCostumeCanvasSelectionController';
import { useCostumeCanvasToolController } from './useCostumeCanvasToolController';
import { useCostumeCanvasVectorHandleSync } from './useCostumeCanvasVectorHandleSync';
import { useCostumeCanvasVectorBrushRenderer } from './useCostumeCanvasVectorBrushRenderer';
import { useCostumeCanvasVectorObjectController } from './useCostumeCanvasVectorObjectController';
import { useCostumeCanvasVectorPathController } from './useCostumeCanvasVectorPathController';
import { useCostumeCanvasViewportController } from './useCostumeCanvasViewportController';
import { syncCanvasSelectionGizmoAppearance } from './costumeCanvasSelectionGizmo';
import { VectorSelectionContextMenu } from '@/components/editors/shared/VectorSelectionContextMenu';
import type { ToolbarSliderCommitBoundaryState } from '@/components/editors/shared/toolbarSliderCommitBoundary';
import type { FinishPendingEditsOptions } from '@/lib/editor/interactionSurface';
import {
  EDITOR_VIEWPORT_FIT_PADDING_PX,
  EDITOR_VIEWPORT_SELECTION_PADDING_PX,
} from '@/lib/editor/editorViewportPolicy';
import { hasVectorClipboardContents } from '@/lib/editor/vectorClipboard';

export { DEFAULT_COSTUME_PREVIEW_SCALE } from './costumeCanvasShared';

export interface CostumeCanvasExportState {
  activeLayerDataUrl: string;
  editorMode: CostumeEditorMode;
  bitmapAssetFrame?: CostumeAssetFrame | null;
  vectorDocument?: CostumeVectorDocument;
}

export interface CostumeCanvasHandle {
  toDataURL: () => string;
  toDataURLWithBounds: () => { dataUrl: string; bounds: CostumeBounds | null };
  loadFromDataURL: (dataUrl: string, sessionKey?: string | null) => Promise<void>;
  loadDocument: (sessionKey: string, document: CostumeDocument) => Promise<void>;
  flushPendingBitmapCommits: () => Promise<void>;
  flushPendingEdits: (options?: FinishPendingEditsOptions) => Promise<boolean>;
  hasActiveInteraction: () => boolean;
  exportCostumeState: (sessionKey?: string | null) => CostumeCanvasExportState | null;
  hasUnsavedChanges: (sessionKey?: string | null) => boolean;
  markPersisted: (sessionKey?: string | null, state?: ActiveLayerCanvasState | null) => void;
  setEditorMode: (mode: CostumeEditorMode) => Promise<void>;
  getEditorMode: () => CostumeEditorMode;
  getLoadedSessionKey: () => string | null;
  deleteSelection: () => boolean;
  duplicateSelection: () => Promise<boolean>;
  copySelection: () => Promise<boolean>;
  cutSelection: () => Promise<boolean>;
  pasteSelection: () => Promise<boolean>;
  moveSelectionOrder: (action: MoveOrderAction) => boolean;
  groupSelection: () => boolean;
  ungroupSelection: () => boolean;
  nudgeSelection: (dx: number, dy: number) => boolean;
  flipSelection: (axis: SelectionFlipAxis) => boolean;
  rotateSelection: () => boolean;
  alignSelection: (action: AlignAction) => boolean;
  isTextEditing: () => boolean;
  exitAllGroupEditing: () => boolean;
  clearSelection: () => boolean;
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
  brushOpacity: number;
  brushSize: number;
  bitmapFillStyle: BitmapFillStyle;
  bitmapShapeStyle: BitmapShapeStyle;
  vectorHandleMode: VectorHandleMode;
  textStyle: TextToolStyle;
  vectorStyle: VectorToolStyle;
  vectorStyleChangeRevision: number;
  latestVectorStyleUpdates: Partial<VectorToolStyle>;
  sliderCommitBoundaryState: ToolbarSliderCommitBoundaryState;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  collider: ColliderConfig | null;
  onHistoryChange?: (state: ActiveLayerCanvasState) => void;
  onColliderChange?: (collider: ColliderConfig) => void;
  onModeChange?: (mode: CostumeEditorMode) => void;
  onTextStyleSync?: (updates: Partial<TextToolStyle>) => void;
  onVectorStyleSync?: (snapshot: VectorToolStyleSelectionSnapshot) => boolean;
  onVectorHandleModeSync?: (handleMode: VectorHandleMode) => void;
  onVectorStyleCapabilitiesSync?: (capabilities: VectorStyleCapabilities) => void;
  onVectorPointEditingChange?: (isEditing: boolean) => void;
  onVectorPointSelectionChange?: (hasSelectedPoints: boolean) => void;
  onTextSelectionChange?: (hasTextSelection: boolean) => void;
  onSelectionStateChange?: (state: { hasSelection: boolean; hasBitmapFloatingSelection: boolean }) => void;
  onVectorGroupingStateChange?: (state: { canGroup: boolean; canUngroup: boolean }) => void;
  onViewScaleChange?: (scale: number) => void;
}

export const CostumeCanvas = forwardRef<CostumeCanvasHandle, CostumeCanvasProps>(({
  costumeDocument,
  initialEditorMode,
  isVisible,
  activeTool,
  bitmapBrushKind,
  brushColor,
  brushOpacity,
  brushSize,
  bitmapFillStyle,
  bitmapShapeStyle,
  vectorHandleMode,
  textStyle,
  vectorStyle,
  vectorStyleChangeRevision,
  latestVectorStyleUpdates,
  sliderCommitBoundaryState,
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
  onVectorGroupingStateChange,
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
  const vectorGuideOverlayDprRef = useRef(1);
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
  const [hasVectorSelection, setHasVectorSelection] = useState(false);
  const [vectorGroupingState, setVectorGroupingState] = useState({ canGroup: false, canUngroup: false });
  const [canZoomToSelection, setCanZoomToSelection] = useState(false);
  const [vectorContextMenuPosition, setVectorContextMenuPosition] = useState<{ x: number; y: number } | null>(null);

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
  const pendingHostedLayerRenderRef = useRef(false);
  const hoveredVectorTargetRef = useRef<any | null>(null);
  const vectorGroupEditingPathRef = useRef<any[]>([]);

  const bitmapBrushKindRef = useRef(bitmapBrushKind);
  bitmapBrushKindRef.current = bitmapBrushKind;

  const brushColorRef = useRef(brushColor);
  brushColorRef.current = brushColor;
  const brushOpacityRef = useRef(brushOpacity);
  brushOpacityRef.current = brushOpacity;

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
  const previousVectorStyleRef = useRef(vectorStyle);
  const previousVectorStyleChangeRevisionRef = useRef(vectorStyleChangeRevision);

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
  onSelectionStateChangeRef.current = (state) => {
    setHasVectorSelection(state.hasSelection);
    onSelectionStateChange?.(state);
  };
  const onVectorGroupingStateChangeRef = useRef<((state: { canGroup: boolean; canUngroup: boolean }) => void) | undefined>(undefined);
  onVectorGroupingStateChangeRef.current = (state) => {
    setVectorGroupingState((previous) => (
      previous.canGroup === state.canGroup && previous.canUngroup === state.canUngroup
        ? previous
        : state
    ));
    onVectorGroupingStateChange?.(state);
  };

  const suppressHistoryRef = useRef(false);
  const bitmapRasterCommitQueueRef = useRef<Promise<void>>(Promise.resolve());

  const shapeDraftRef = useRef<ShapeDraftSession | null>(null);

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
    markActiveLayerCanvasStatePersisted,
    markCurrentSnapshotPersisted,
    persistedSnapshotRef,
    rebaseHistoryToCurrentSnapshot,
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
  const mirroredPathAnchorDragSessionRef = useRef<MirroredPathAnchorDragSession | null>(null);
  const mirroredPathAnchorDragModifierStateRef = useRef({ space: false });
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
    brushOpacity,
    brushOpacityRef,
    brushCursorOverlayRef,
    brushSize,
    brushSizeRef,
    containerRef,
    editorModeRef,
    editorModeState,
    isVisible,
    onViewScaleChange,
  });

  useEffect(() => {
    const vectorGuideCanvas = vectorGuideCanvasRef.current;
    if (!vectorGuideCanvas) {
      return;
    }
    vectorGuideOverlayDprRef.current = syncCanvasViewportSize(
      vectorGuideCanvas,
      viewportSize.width,
      viewportSize.height,
    );
  }, [viewportSize.height, viewportSize.width]);

  const clearVectorGuideOverlayContext = useCallback((ctx: CanvasRenderingContext2D) => {
    clearCanvasInCssPixels(
      ctx,
      viewportSize.width,
      viewportSize.height,
      vectorGuideOverlayDprRef.current,
    );
  }, [viewportSize.height, viewportSize.width]);

  const applyVectorGuideSceneTransform = useCallback((ctx: CanvasRenderingContext2D) => {
    const previewScale = zoom * DEFAULT_COSTUME_PREVIEW_SCALE;
    const canvasLeft = viewportSize.width / 2 - cameraCenter.x * previewScale;
    const canvasTop = viewportSize.height / 2 - cameraCenter.y * previewScale;
    ctx.transform(previewScale, 0, 0, previewScale, canvasLeft, canvasTop);
  }, [cameraCenter.x, cameraCenter.y, viewportSize.height, viewportSize.width, zoom]);

  const mapCostumeCanvasPointToOverlay = useCallback((point: Point) => {
    const previewScale = zoom * DEFAULT_COSTUME_PREVIEW_SCALE;
    const canvasLeft = viewportSize.width / 2 - cameraCenter.x * previewScale;
    const canvasTop = viewportSize.height / 2 - cameraCenter.y * previewScale;
    return new Point(
      canvasLeft + point.x * previewScale,
      canvasTop + point.y * previewScale,
    );
  }, [cameraCenter.x, cameraCenter.y, viewportSize.height, viewportSize.width, zoom]);

  const { drawCollider } = useCostumeCanvasColliderController({
    activeTool,
    collider,
    colliderCanvasRef,
    onColliderChange,
  });

  const {
    getBitmapFloatingSelectionObject,
    getSelectionBoundsSnapshot,
    restoreCanvasSelection,
    setBitmapFloatingSelectionObject,
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
    onVectorGroupingStateChangeRef,
    onVectorPointEditingChangeRef,
    onVectorPointSelectionChangeRef,
    pendingSelectionSyncedVectorHandleModeRef,
    pointSelectionMarqueeSessionRef,
    pointSelectionTransformFrameRef,
    pointSelectionTransformSessionRef,
    selectedPathAnchorIndicesRef,
    setCanZoomToSelection,
    setHasBitmapFloatingSelection,
    vectorPointEditingTargetRef,
  });

  const {
    commitCurrentPenPlacement,
    finalizePenDraft,
    getPenDraftPreviewObject,
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

  const resolveLiveVectorTexturePreviewObjects = useCallback(() => {
    if (editorModeRef.current !== 'vector') {
      return [];
    }

    const previewObjects: any[] = [];
    if (activeToolRef.current === 'brush') {
      const activeBrush = (fabricCanvasRef.current as {
        freeDrawingBrush?: { getTexturePreviewObject?: () => any | null };
      } | null)?.freeDrawingBrush;
      const brushPreview = activeBrush?.getTexturePreviewObject?.();
      if (brushPreview) {
        previewObjects.push(brushPreview);
      }
    }
    if (activeToolRef.current === 'pen') {
      const penPreview = getPenDraftPreviewObject();
      if (penPreview) {
        previewObjects.push(penPreview);
      }
    }
    return previewObjects;
  }, [getPenDraftPreviewObject]);

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
    const showVectorComposite = editorModeRef.current === 'vector';
    const hideFabricArtwork = showVectorComposite && activeToolRef.current !== 'text';
    if (fabricCanvas.wrapperEl) {
      fabricCanvas.wrapperEl.style.opacity = '1';
      fabricCanvas.wrapperEl.style.zIndex = '0';
    }
    if (fabricCanvas.lowerCanvasEl) {
      fabricCanvas.lowerCanvasEl.style.opacity = hideFabricArtwork ? '0' : nextOpacity;
      fabricCanvas.lowerCanvasEl.style.visibility = hideFabricArtwork ? 'hidden' : 'visible';
      fabricCanvas.lowerCanvasEl.style.zIndex = '0';
    }
    if (fabricCanvas.upperCanvasEl) {
      fabricCanvas.upperCanvasEl.style.opacity = hideFabricArtwork ? '0' : nextOpacity;
      fabricCanvas.upperCanvasEl.style.visibility = nextOpacity === '0' ? 'hidden' : 'visible';
      fabricCanvas.upperCanvasEl.style.zIndex = '2';
    }
  }, []);

  const markHostedLayerRenderPending = useCallback(() => {
    pendingHostedLayerRenderRef.current = isVisibleRef.current;
    setHostedLayerReady(false);
    syncActiveLayerCanvasVisibility();
  }, [setHostedLayerReady, syncActiveLayerCanvasVisibility]);

  const setEditorMode = useCallback((mode: CostumeEditorMode) => {
    editorModeRef.current = mode;
    setEditorModeState(mode);
    onModeChangeRef.current?.(mode);
    if (mode !== 'vector') {
      hoveredVectorTargetRef.current = null;
      vectorGroupEditingPathRef.current = [];
      setVectorGroupingState({ canGroup: false, canUngroup: false });
      onVectorGroupingStateChangeRef.current?.({ canGroup: false, canUngroup: false });
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

  const editorSelectionTokens = useMemo(() => getResolvedEditorSelectionTokens(), []);

  const drawBitmapSelectionOverlay = useCallback(() => {
    const overlayCtx = bitmapSelectionCtxRef.current;
    if (!overlayCtx) return;

    overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const marquee = bitmapMarqueeRectRef.current;
    if (marquee && bitmapSelectionDragModeRef.current === 'marquee') {
      overlayCtx.fillStyle = editorSelectionTokens.fill;
      overlayCtx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height);
      overlayCtx.strokeStyle = editorSelectionTokens.accent;
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([6, 6]);
      overlayCtx.strokeRect(marquee.x, marquee.y, marquee.width, marquee.height);
      overlayCtx.setLineDash([]);
    }
  }, [editorSelectionTokens]);

  const {
    commitBitmapSelection,
    commitBitmapStampBrushStroke,
    flattenBitmapLayer,
    loadBitmapAsSingleVectorImage,
    loadBitmapLayer,
    normalizeCanvasVectorStrokeUniform,
  } = useCostumeCanvasBitmapLayerController({
    bitmapMarqueeRectRef,
    bitmapRasterCommitQueueRef,
    bitmapSelectionBusyRef,
    bitmapSelectionDragModeRef,
    bitmapSelectionStartRef,
    drawBitmapSelectionOverlay,
    editorModeRef,
    fabricCanvasRef,
    getBitmapFloatingSelectionObject,
    isLoadRequestActive,
    saveHistory,
    setBitmapFloatingSelectionObject,
    suppressHistoryRef,
    syncSelectionState,
    waitForFabricCanvas,
  });

  const {
    renderVectorCompositeScene,
    resolveBitmapFillTextureSource,
  } = useCostumeCanvasVectorBrushRenderer({
    editorModeRef,
    fabricCanvasRef,
    resolvePreviewObjects: resolveLiveVectorTexturePreviewObjects,
  });

  const refreshVectorTextureOverlay = useCallback(() => {
    const overlayCanvas = vectorStrokeCanvasRef.current;
    if (!overlayCanvas) {
      return;
    }
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) {
      return;
    }
    renderVectorCompositeScene(ctx);
  }, [renderVectorCompositeScene]);

  const getActiveLayerCanvasElement = useCallback((): HTMLCanvasElement => {
    const fabricCanvas = fabricCanvasRef.current;
    if (fabricCanvas) {
      if (editorModeRef.current !== 'vector') {
        return fabricCanvas.toCanvasElement(1);
      }

      const composed = document.createElement('canvas');
      composed.width = CANVAS_SIZE;
      composed.height = CANVAS_SIZE;
      const composedCtx = composed.getContext('2d');
      if (!composedCtx) {
        return fabricCanvas.toCanvasElement(1);
      }

      renderComposedVectorSceneForFabricCanvas(composedCtx, fabricCanvas, { canvasSize: CANVAS_SIZE });
      return composed;
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
    if (!surface) {
      return;
    }

    const ctx = surface.getContext('2d');
    if (!ctx) {
      return;
    }

    const activeLayerCanvas = getActiveLayerCanvasElement();
    ctx.clearRect(0, 0, surface.width, surface.height);
    ctx.drawImage(activeLayerCanvas, 0, 0, surface.width, surface.height);
  }, [getActiveLayerCanvasElement]);

  const {
    alignSelection,
    applyFill,
    copySelection,
    cutSelection,
    deleteSelection,
    duplicateSelection,
    exportCostumeState,
    flipSelection,
    getComposedCanvasElement,
    getSelectionMousePos,
    isTextEditing,
    loadDocument,
    moveSelectionOrder,
    groupSelection,
    nudgeSelection,
    pasteSelection,
    rotateSelection,
    switchEditorMode,
    syncActiveVectorStyle,
    syncTextSelectionState,
    syncTextStyleFromSelection,
    syncVectorStyleFromSelection,
    ungroupSelection,
  } = useCostumeCanvasCommandController({
    activeDocumentLayerId: activeDocumentLayer?.id,
    activeLayerOpacity,
    activeLayerVisible,
    bitmapFillStyleRef,
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
    getBitmapFloatingSelectionObject,
    getSelectionBoundsSnapshot,
    hostedLayerIdRef,
    isLoadRequestActive,
    isHostedLayerReadyRef,
    layerSurfaceRefs,
    loadBitmapAsSingleVectorImage,
    loadBitmapLayer,
    loadRequestIdRef,
    loadedSessionKeyRef,
    normalizeCanvasVectorStrokeUniform,
    onTextSelectionChangeRef,
    onTextStyleSyncRef,
    onVectorStyleCapabilitiesSyncRef,
    onVectorStyleSyncRef,
    rebaseHistoryToCurrentSnapshot,
    resolveBitmapFillTextureSource,
    restoreCanvasSelection,
    saveHistory,
    setEditorMode,
    setBitmapFloatingSelectionObject,
    setHostedLayerId,
    setHostedLayerReady,
    markHostedLayerRenderPending,
    suppressBitmapSelectionAutoCommitRef,
    suppressHistoryRef,
    syncSelectionState,
    textStyle,
    vectorStyle,
    sliderCommitBoundaryState,
    vectorGroupEditingPathRef,
    waitForFabricCanvas,
  });

  const handleFabricCanvasAfterRender = useCallback(() => {
    if (!isVisibleRef.current || !pendingHostedLayerRenderRef.current) {
      return;
    }

    pendingHostedLayerRenderRef.current = false;
    setHostedLayerReady(true);
    syncActiveLayerCanvasVisibility();
  }, [setHostedLayerReady, syncActiveLayerCanvasVisibility]);

  const {
    applyMirroredPathAnchorCurveDragSession,
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
    isPathCurveDragModifierPressed,
    isPointSelectionToggleModifierPressed,
    movePathAnchorByDelta,
    removeDuplicateClosedPathAnchorControl,
    resolveAnchorFromPathControlKey,
    restoreAllOriginalControls,
    restoreOriginalControls,
    resolveMirroredPathAnchorHandleRole,
    setMirroredPathAnchorDragSessionMoveMode,
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
    applyOverlaySceneTransform: applyVectorGuideSceneTransform,
    applyMirroredPathAnchorCurveDragSession,
    buildPathDataFromPoints,
    createFourPointEllipsePathData,
    clearOverlayContext: clearVectorGuideOverlayContext,
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
    isPathCurveDragModifierPressed,
    isPointSelectionToggleModifierPressed,
    mapFabricOverlayPoint: mapCostumeCanvasPointToOverlay,
    movePathAnchorByDelta,
    mirroredPathAnchorDragSessionRef,
    originalControlsRef,
    pointSelectionMarqueeSessionRef,
    pointSelectionTransformSessionRef,
    hoveredVectorTargetRef,
    removeDuplicateClosedPathAnchorControl,
    renderPenDraftGuide,
    resolveMirroredPathAnchorHandleRole,
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
    brushColorRef,
    brushOpacityRef,
    brushSizeRef,
    commitBitmapStampBrushStroke,
    editorModeRef,
    ensurePathLikeObjectForVectorTool,
    fabricCanvasRef,
    getBitmapFloatingSelectionObject,
    getZoomInvariantMetric,
    normalizeCanvasVectorStrokeUniform,
    onVectorTexturePreviewChange: refreshVectorTextureOverlay,
    restoreAllOriginalControls,
    restoreOriginalControls,
    saveHistory,
    setVectorPointEditingTarget,
    syncBrushCursorOverlay,
    syncSelectionState,
    textEditingHostRef,
    hoveredVectorTargetRef,
    vectorGroupEditingPathRef,
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
    mirroredPathAnchorDragSessionRef,
    movePathAnchorByDelta,
    penAnchorPlacementSessionRef,
    penDraftRef,
    pointSelectionMarqueeSessionRef,
    pointSelectionTransformSessionRef,
    renderVectorCompositeScene,
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
    hoveredVectorTargetRef,
    vectorGuideCanvasRef,
    vectorGuideCtxRef,
    vectorGroupEditingPathRef,
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
  }, [activeTool, bitmapBrushKind, brushColor, brushOpacity, brushSize, editorModeState, hasBitmapFloatingSelection, vectorStyle, configureCanvasForTool]);

  useLayoutEffect(() => {
    syncActiveLayerCanvasVisibility();
  }, [
    activeLayerOpacity,
    activeLayerVisible,
    editorModeState,
    isHostedLayerReadyState,
    isVisible,
    syncActiveLayerCanvasVisibility,
  ]);

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
    const explicitVectorStyleUpdates = previousVectorStyleChangeRevisionRef.current !== vectorStyleChangeRevision
      ? latestVectorStyleUpdates
      : undefined;
    syncActiveVectorStyle(explicitVectorStyleUpdates, previousVectorStyleRef.current, sliderCommitBoundaryState);
    previousVectorStyleRef.current = vectorStyle;
    previousVectorStyleChangeRevisionRef.current = vectorStyleChangeRevision;
  }, [
    brushColor,
    latestVectorStyleUpdates,
    sliderCommitBoundaryState,
    textStyle,
    vectorStyle,
    vectorStyleChangeRevision,
    syncActiveVectorStyle,
  ]);

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
    setBitmapFloatingSelectionObject,
    syncSelectionState,
  });

  const hasActiveInteraction = useCallback(() => {
    return (
      isTextEditing() ||
      !!penDraftRef.current ||
      !!penAnchorPlacementSessionRef.current ||
      !!pointSelectionTransformSessionRef.current ||
      !!pointSelectionMarqueeSessionRef.current ||
      !!insertedPathAnchorDragSessionRef.current ||
      !!mirroredPathAnchorDragSessionRef.current ||
      !!shapeDraftRef.current ||
      !!bitmapFloatingObjectRef.current
    );
  }, [isTextEditing, penAnchorPlacementSessionRef, penDraftRef]);

  const flushPendingEdits = useCallback(async (options?: FinishPendingEditsOptions) => {
    const fabricCanvas = fabricCanvasRef.current;
    let handled = false;

    if (isTextEditing()) {
      const activeObject = fabricCanvas?.getActiveObject() as { exitEditing?: () => void } | null | undefined;
      activeObject?.exitEditing?.();
      fabricCanvas?.requestRenderAll();
      handled = true;
    }

    if (penDraftRef.current) {
      finalizePenDraft();
      handled = true;
    } else if (penAnchorPlacementSessionRef.current) {
      commitCurrentPenPlacement();
      fabricCanvas?.requestRenderAll();
      handled = true;
    }

    if (pointSelectionTransformSessionRef.current) {
      const shouldSave = pointSelectionTransformSessionRef.current.hasChanged;
      pointSelectionTransformSessionRef.current = null;
      if (shouldSave) {
        saveHistory();
      }
      handled = true;
    }

    if (pointSelectionMarqueeSessionRef.current && fabricCanvas) {
      const pointSelectionMarqueeSession = pointSelectionMarqueeSessionRef.current;
      pointSelectionMarqueeSessionRef.current = null;
      applyPointSelectionMarqueeSession(pointSelectionMarqueeSession);
      if (
        vectorPointEditingTargetRef.current === pointSelectionMarqueeSession.path &&
        fabricCanvasContainsObject(fabricCanvas, pointSelectionMarqueeSession.path)
      ) {
        fabricCanvas.setActiveObject(pointSelectionMarqueeSession.path);
      }
      fabricCanvas.requestRenderAll();
      handled = true;
    }

    if (insertedPathAnchorDragSessionRef.current) {
      insertedPathAnchorDragSessionRef.current = null;
      saveHistory();
      handled = true;
    }

    if (mirroredPathAnchorDragSessionRef.current) {
      const shouldSave = mirroredPathAnchorDragSessionRef.current.hasChanged;
      mirroredPathAnchorDragSessionRef.current = null;
      mirroredPathAnchorDragModifierStateRef.current.space = false;
      if (shouldSave) {
        saveHistory();
      }
      handled = true;
    }

    if (shapeDraftRef.current) {
      const completedShapeDraft = shapeDraftRef.current;
      shapeDraftRef.current = null;
      if (editorModeRef.current === 'bitmap') {
        await flattenBitmapLayer(completedShapeDraft.object);
      } else {
        saveHistory();
      }
      configureCanvasForTool();
      handled = true;
    }

    if (bitmapFloatingObjectRef.current) {
      const didCommitBitmapSelection = await commitBitmapSelection({
        behavior: options?.bitmapFloatingSelectionBehavior,
      });
      handled = didCommitBitmapSelection || handled;
    }

    await bitmapRasterCommitQueueRef.current.catch(() => undefined);
    return handled;
  }, [
    applyPointSelectionMarqueeSession,
    commitBitmapSelection,
    commitCurrentPenPlacement,
    configureCanvasForTool,
    finalizePenDraft,
    flattenBitmapLayer,
    isTextEditing,
    penAnchorPlacementSessionRef,
    penDraftRef,
    saveHistory,
  ]);

  const clearSelection = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return false;
    }

    const hadSelection = !!fabricCanvas.getActiveObject() || !!vectorPointEditingTargetRef.current;
    if (!hadSelection) {
      return false;
    }

    setVectorPointEditingTarget(null);
    fabricCanvas.discardActiveObject();
    fabricCanvas.requestRenderAll();
    syncSelectionState();
    return true;
  }, [setVectorPointEditingTarget, syncSelectionState]);

  const exitAllGroupEditing = useCallback(() => {
    if (editorModeState !== 'vector' || activeTool !== 'select') {
      return false;
    }

    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || hasActiveInteraction()) {
      return false;
    }

    const rootGroup = resolveVectorGroupEditingRootTarget(
      fabricCanvas,
      vectorGroupEditingPathRef.current,
    );
    if (!rootGroup) {
      return false;
    }

    hoveredVectorTargetRef.current = null;
    vectorGroupEditingPathRef.current = [];
    if (vectorPointEditingTargetRef.current) {
      restoreAllOriginalControls();
      setVectorPointEditingTarget(null);
    }
    fabricCanvas.discardActiveObject();
    fabricCanvas.setActiveObject(rootGroup);
    configureCanvasForTool();
    syncTextStyleFromSelection();
    syncVectorStyleFromSelection();
    syncTextSelectionState();
    syncSelectionState();
    fabricCanvas.requestRenderAll();
    return true;
  }, [
    activeTool,
    configureCanvasForTool,
    editorModeState,
    hasActiveInteraction,
    restoreAllOriginalControls,
    setVectorPointEditingTarget,
    syncSelectionState,
    syncTextSelectionState,
    syncTextStyleFromSelection,
    syncVectorStyleFromSelection,
  ]);

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

  useCostumeCanvasMirroredPathHotkeys({
    activeToolRef,
    editorModeRef,
    fabricCanvasRef,
    mirroredPathAnchorDragModifierStateRef,
    mirroredPathAnchorDragSessionRef,
    setMirroredPathAnchorDragSessionMoveMode,
  });

  useCostumeCanvasImperativeHandle({
    alignSelection,
    bitmapRasterCommitQueueRef,
    clearSelection,
    configureCanvasForTool,
    createSnapshot,
    copySelection,
    cutSelection,
    deleteSelection,
    duplicateSelection,
    exportCostumeState,
    exitAllGroupEditing,
    flipSelection,
    flushPendingEdits,
    getComposedCanvasElement,
    hasActiveInteraction,
    isTextEditing,
    loadBitmapLayer,
    loadDocument,
    loadedSessionKeyRef,
    markActiveLayerCanvasStatePersisted,
    markCurrentSnapshotPersisted,
    moveSelectionOrder,
    groupSelection,
    nudgeSelection,
    pasteSelection,
    persistedSnapshotRef,
    ref,
    rotateSelection,
    rebaseHistoryToCurrentSnapshot,
    saveHistory,
    setEditorMode,
    switchEditorMode,
    ungroupSelection,
    editorModeRef,
  });

  useEffect(() => {
    if (costumeDocument) {
      return;
    }
    pendingHostedLayerRenderRef.current = false;
    hoveredVectorTargetRef.current = null;
    vectorGroupEditingPathRef.current = [];
    setVectorGroupingState({ canGroup: false, canUngroup: false });
    onVectorGroupingStateChangeRef.current?.({ canGroup: false, canUngroup: false });
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
      pendingHostedLayerRenderRef.current = false;
      if (hostedLayerId && fabricCanvas) {
        commitHostedLayerSurfaceSnapshot(hostedLayerId);
      }
      setHostedLayerReady(false);
      syncActiveLayerCanvasVisibility();
      return;
    }

    refreshViewportSize();

    if (!hostedLayerId || !fabricCanvas) {
      pendingHostedLayerRenderRef.current = false;
      return;
    }

    markHostedLayerRenderPending();
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
    markHostedLayerRenderPending,
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

    syncCanvasSelectionGizmoAppearance({
      fabricCanvas,
      getZoomInvariantMetric,
      pointEditingTarget: vectorPointEditingTargetRef.current,
      renderVectorPointEditingGuide,
      zoom,
    });
    drawCollider(collider, activeTool === 'collider');
  }, [activeTool, collider, drawCollider, getZoomInvariantMetric, renderVectorPointEditingGuide, zoom]);

  const handleZoomToActualSize = useCallback(() => {
    setZoomLevel(1);
  }, [setZoomLevel]);

  const handleZoomToFit = useCallback(() => {
    zoomToBounds(COSTUME_WORLD_RECT, EDITOR_VIEWPORT_FIT_PADDING_PX);
  }, [zoomToBounds]);

  const handleZoomToSelection = useCallback(() => {
    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return;
    zoomToBounds(selectionSnapshot.bounds, EDITOR_VIEWPORT_SELECTION_PADDING_PX);
  }, [getSelectionBoundsSnapshot, zoomToBounds]);

  useEffect(() => {
    if (editorModeState !== 'vector') {
      setVectorContextMenuPosition(null);
    }
  }, [editorModeState]);

  const closeVectorContextMenu = useCallback(() => {
    setVectorContextMenuPosition(null);
  }, []);

  const handleVectorContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (editorModeState !== 'vector') {
      return;
    }

    setVectorContextMenuPosition({
      x: event.clientX,
      y: event.clientY,
    });
  }, [editorModeState]);

  const handleVectorContextMenuCopy = useCallback(() => {
    closeVectorContextMenu();
    void copySelection().catch((error) => {
      console.error('Failed to copy costume vector selection:', error);
    });
  }, [closeVectorContextMenu, copySelection]);

  const handleVectorContextMenuCut = useCallback(() => {
    closeVectorContextMenu();
    void cutSelection().catch((error) => {
      console.error('Failed to cut costume vector selection:', error);
    });
  }, [closeVectorContextMenu, cutSelection]);

  const handleVectorContextMenuPaste = useCallback(() => {
    closeVectorContextMenu();
    void pasteSelection().catch((error) => {
      console.error('Failed to paste costume vector selection:', error);
    });
  }, [closeVectorContextMenu, pasteSelection]);

  const handleVectorContextMenuDuplicate = useCallback(() => {
    closeVectorContextMenu();
    void duplicateSelection().catch((error) => {
      console.error('Failed to duplicate costume vector selection:', error);
    });
  }, [closeVectorContextMenu, duplicateSelection]);

  const handleVectorContextMenuGroup = useCallback(() => {
    closeVectorContextMenu();
    groupSelection();
  }, [closeVectorContextMenu, groupSelection]);

  const handleVectorContextMenuUngroup = useCallback(() => {
    closeVectorContextMenu();
    ungroupSelection();
  }, [closeVectorContextMenu, ungroupSelection]);

  const handleVectorContextMenuDelete = useCallback(() => {
    closeVectorContextMenu();
    deleteSelection();
  }, [closeVectorContextMenu, deleteSelection]);

  return (
    <>
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
        onCanvasContextMenu={handleVectorContextMenu}
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
      {vectorContextMenuPosition ? (
        <VectorSelectionContextMenu
          canCopy={hasVectorSelection}
          canDelete={hasVectorSelection}
          canGroup={vectorGroupingState.canGroup}
          canPaste={hasVectorClipboardContents()}
          canUngroup={vectorGroupingState.canUngroup}
          onClose={closeVectorContextMenu}
          onCopy={handleVectorContextMenuCopy}
          onCut={handleVectorContextMenuCut}
          onDelete={handleVectorContextMenuDelete}
          onDuplicate={handleVectorContextMenuDuplicate}
          onGroup={handleVectorContextMenuGroup}
          onPaste={handleVectorContextMenuPaste}
          onUngroup={handleVectorContextMenuUngroup}
          position={vectorContextMenuPosition}
        />
      ) : null}
    </>
  );
});

CostumeCanvas.displayName = 'CostumeCanvas';
