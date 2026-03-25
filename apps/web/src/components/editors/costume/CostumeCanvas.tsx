import { useEffect, useRef, useCallback, forwardRef, useMemo, useState } from 'react';
import {
  Canvas as FabricCanvas,
  Path,
  ActiveSelection,
  FabricImage,
  Control,
  Point,
  util,
} from 'fabric';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import {
  pathNodeHandleTypeToVectorHandleMode,
} from './CostumeToolbar';
import type {
  AlignAction,
  BitmapFillStyle,
  BitmapShapeStyle,
  DrawingTool,
  MoveOrderAction,
  SelectionFlipAxis,
  TextToolStyle,
  VectorHandleMode,
  VectorPathNodeHandleType,
  VectorStyleCapabilities,
  VectorToolStyle,
} from './CostumeToolbar';
import type { CostumeBounds, ColliderConfig, CostumeDocument, CostumeEditorMode, CostumeVectorDocument } from '@/types';
import { deleteActiveCanvasSelection } from './costumeSelectionCommands';
import { CostumeCanvasStage } from './CostumeCanvasStage';
import { type BitmapBrushKind } from '@/lib/background/brushCore';
import {
  applyBitmapBucketFill,
  getBitmapFillTexturePreset,
  type BitmapFillTextureId,
} from '@/lib/background/bitmapFillCore';
import {
  createVectorStrokeBrushRenderStyle,
  getVectorStrokeBrushPreset,
  DEFAULT_VECTOR_STROKE_BRUSH_ID,
  type VectorStrokeBrushRenderStyle,
  type VectorStrokeBrushId,
} from '@/lib/vector/vectorStrokeBrushCore';
import {
  createVectorFillTextureTile,
  getVectorFillTexturePreset,
  DEFAULT_VECTOR_FILL_TEXTURE_ID,
  type VectorFillTextureId,
} from '@/lib/vector/vectorFillTextureCore';
import {
  createEmptyCostumeVectorDocument,
  getActiveCostumeLayer,
  resolveActiveCostumeLayerEditorLoadState,
  type ActiveLayerCanvasState,
} from '@/lib/costume/costumeDocument';
import {
  CANVAS_SIZE,
  BASE_VIEW_SCALE,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  HANDLE_SIZE,
  VECTOR_SELECTION_BORDER_SCALE,
  CIRCLE_CUBIC_KAPPA,
  VECTOR_POINT_HANDLE_GUIDE_STROKE,
  VECTOR_POINT_HANDLE_GUIDE_STROKE_WIDTH,
  VECTOR_POINT_SELECTION_HANDLE_SIZE,
  VECTOR_POINT_SELECTION_ROTATE_OFFSET,
  VECTOR_POINT_SELECTION_HIT_PADDING,
  VECTOR_POINT_SELECTION_MIN_SIZE,
  VECTOR_POINT_INSERTION_HIT_RADIUS_PX,
  VECTOR_POINT_INSERTION_ENDPOINT_RADIUS_PX,
  VECTOR_POINT_MARQUEE_DRAG_THRESHOLD_PX,
  PEN_TOOL_CLOSE_HIT_RADIUS_PX,
  PEN_TOOL_DRAG_THRESHOLD_PX,
  OBJECT_SELECTION_CORNER_SIZE,
  OBJECT_SELECTION_PADDING,
  COSTUME_WORLD_RECT,
  type CanvasSelectionBoundsSnapshot,
  type PathAnchorDragState,
  type PointSelectionTransformSession,
  type PointSelectionMarqueeSession,
  type PointSelectionTransformFrameState,
  type PointSelectionTransformMode,
  type PointSelectionTransformBounds,
  type PointSelectionTransformSnapshot,
  type SelectedPathAnchorTransformSnapshot,
  type PenDraftAnchor,
  type PenDraftState,
  type PenAnchorPlacementSession,
  buildClosedPolylinePoints,
  buildPenDraftNodeHandleTypes,
  buildPenDraftPathData,
  buildPolylineArcTable,
  clampUnit,
  clonePenDraftAnchor,
  createPenDraftAnchor,
  extractVisibleCanvasRegion,
  getCubicBezierPoint,
  getDistanceBetweenPoints,
  getQuadraticBezierPoint,
  getVectorStrokeSampleSpacing,
  hashNumberTriplet,
  normalizeDegrees,
  normalizeRadians,
  sampleAngleAlongPolyline,
  samplePointAlongPolyline,
  cloneScenePoint,
} from './costumeCanvasShared';
import {
  type BitmapStampBrushCommitPayload,
} from './costumeCanvasBitmapRuntime';
import {
  applyVectorFillStyleToObject,
  applyVectorStrokeStyleToObject,
  getFabricFillValueForVectorTexture,
  getFabricObjectType,
  getFabricStrokeValueForVectorBrush,
  getPathCommandType,
  getVectorObjectFillColor,
  getVectorObjectFillTextureId,
  getVectorObjectStrokeBrushId,
  getVectorObjectStrokeColor,
  getVectorStyleCapabilitiesForSelection,
  getVectorStyleTargets,
  isActiveSelectionObject,
  isTextObject,
  normalizeVectorObjectRendering,
  pathCommandsDescribeClosedShape,
  vectorObjectSupportsFill,
  VECTOR_JSON_EXTRA_PROPS,
} from './costumeCanvasVectorRuntime';
import { useCostumeCanvasColliderController } from './useCostumeCanvasColliderController';
import { useCostumeCanvasFabricHostController } from './useCostumeCanvasFabricHostController';
import { useCostumeCanvasHistoryController } from './useCostumeCanvasHistoryController';
import { useCostumeCanvasImperativeHandle } from './useCostumeCanvasImperativeHandle';
import { useCostumeCanvasBitmapSelectionController } from './useCostumeCanvasBitmapSelectionController';
import { useCostumeCanvasPenHotkeys } from './useCostumeCanvasPenHotkeys';
import { useCostumeCanvasToolController } from './useCostumeCanvasToolController';
import { useCostumeCanvasVectorHandleSync } from './useCostumeCanvasVectorHandleSync';
import { useCostumeCanvasVectorObjectController } from './useCostumeCanvasVectorObjectController';
import { useCostumeCanvasViewportController } from './useCostumeCanvasViewportController';

export { DEFAULT_COSTUME_PREVIEW_SCALE } from './costumeCanvasShared';

export interface CostumeCanvasExportState {
  activeLayerDataUrl: string;
  editorMode: CostumeEditorMode;
  vectorDocument?: CostumeVectorDocument;
}

export interface CostumeCanvasHandle {
  toDataURL: () => string;
  toDataURLWithBounds: () => { dataUrl: string; bounds: CostumeBounds | null };
  loadFromDataURL: (dataUrl: string, sessionKey?: string | null) => Promise<void>;
  loadDocument: (sessionKey: string, document: CostumeDocument) => Promise<void>;
  exportCostumeState: (sessionKey?: string | null) => CostumeCanvasExportState | null;
  hasUnsavedChanges: (sessionKey?: string | null) => boolean;
  markPersisted: (sessionKey?: string | null) => void;
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
  onBitmapLayerPick?: (layerId: string | null) => void;
}

export const CostumeCanvas = forwardRef<CostumeCanvasHandle, CostumeCanvasProps>(({
  costumeDocument,
  initialEditorMode,
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
  onBitmapLayerPick,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textEditingHostRef = useRef<HTMLDivElement>(null);
  const brushCursorOverlayRef = useRef<HTMLDivElement>(null);
  const fabricCanvasHostRef = useRef<HTMLDivElement>(null);
  const fabricCanvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const inactiveLayerSurfaceRefs = useRef(new Map<string, HTMLCanvasElement>());
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
  const activeLayerOpacity = activeDocumentLayer?.opacity ?? 1;
  const activeLayerVisible = activeDocumentLayer?.visible ?? true;
  const activeLayerLocked = activeDocumentLayer?.locked ?? false;
  const activeLayerIndex = useMemo(
    () => documentLayers.findIndex((layer) => layer.id === activeDocumentLayer?.id),
    [activeDocumentLayer?.id, documentLayers],
  );
  const inactiveLayersBelowActive = useMemo(
    () => documentLayers.filter((layer, index) => layer.id !== activeDocumentLayer?.id && (activeLayerIndex < 0 || index < activeLayerIndex)),
    [activeDocumentLayer?.id, activeLayerIndex, documentLayers],
  );
  const inactiveLayersAboveActive = useMemo(
    () => documentLayers.filter((layer, index) => layer.id !== activeDocumentLayer?.id && activeLayerIndex >= 0 && index > activeLayerIndex),
    [activeDocumentLayer?.id, activeLayerIndex, documentLayers],
  );
  const [editorModeState, setEditorModeState] = useState<CostumeEditorMode>(initialEditorMode);
  const [hasBitmapFloatingSelection, setHasBitmapFloatingSelection] = useState(false);
  const [canZoomToSelection, setCanZoomToSelection] = useState(false);

  const editorModeRef = useRef<CostumeEditorMode>(initialEditorMode);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const activeLayerVisibleRef = useRef(activeLayerVisible);
  activeLayerVisibleRef.current = activeLayerVisible;
  const activeLayerLockedRef = useRef(activeLayerLocked);
  activeLayerLockedRef.current = activeLayerLocked;

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
  const onBitmapLayerPickRef = useRef(onBitmapLayerPick);
  onBitmapLayerPickRef.current = onBitmapLayerPick;

  const suppressHistoryRef = useRef(false);
  const bitmapRasterCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const vectorStrokeBrushRenderCacheRef = useRef<Map<string, VectorStrokeBrushRenderStyle>>(new Map());
  const vectorStrokeTextureCacheRef = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const vectorStrokeTexturePendingRef = useRef<Set<string>>(new Set());

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
  const penDraftRef = useRef<PenDraftState | null>(null);
  const penAnchorPlacementSessionRef = useRef<PenAnchorPlacementSession | null>(null);
  const penModifierStateRef = useRef({
    alt: false,
    space: false,
  });

  const {
    cameraCenter,
    getZoomInvariantMetric,
    isViewportPanning,
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
    onViewScaleChange,
  });

  const { drawCollider } = useCostumeCanvasColliderController({
    activeTool,
    collider,
    colliderCanvasRef,
    onColliderChange,
  });

  const setVectorPointEditingTarget = useCallback((nextTarget: any | null) => {
    if (vectorPointEditingTargetRef.current === nextTarget) {
      return;
    }

    vectorPointEditingTargetRef.current = nextTarget;
    activePathAnchorRef.current = null;
    selectedPathAnchorIndicesRef.current = [];
    insertedPathAnchorDragSessionRef.current = null;
    pointSelectionTransformFrameRef.current = null;
    pointSelectionTransformSessionRef.current = null;
    pointSelectionMarqueeSessionRef.current = null;
    pendingSelectionSyncedVectorHandleModeRef.current = null;
    onVectorPointSelectionChangeRef.current?.(false);
    onVectorPointEditingChangeRef.current?.(!!nextTarget);
  }, []);

  const getSelectionBoundsSnapshot = useCallback((): CanvasSelectionBoundsSnapshot | null => {
    const fabricCanvas = fabricCanvasRef.current;
    const mode = editorModeRef.current;
    const activeObject = fabricCanvas?.getActiveObject() as any;
    const selectionObject = mode === 'bitmap'
      ? bitmapFloatingObjectRef.current
      : activeObject;
    if (!selectionObject) return null;
    if (isTextObject(selectionObject) && (selectionObject as any).isEditing) return null;

    const selectedObjects = isActiveSelectionObject(selectionObject) && typeof selectionObject.getObjects === 'function'
      ? (selectionObject.getObjects() as any[]).filter(Boolean)
      : [selectionObject];
    if (selectedObjects.length === 0) return null;

    const boundsList = selectedObjects
      .map((obj) => ({ obj, rect: obj.getBoundingRect() as { left: number; top: number; width: number; height: number } }))
      .filter((entry) => Number.isFinite(entry.rect.left) && Number.isFinite(entry.rect.top));
    if (boundsList.length === 0) return null;

    let minLeft = Number.POSITIVE_INFINITY;
    let minTop = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;
    let maxBottom = Number.NEGATIVE_INFINITY;
    for (const { rect } of boundsList) {
      minLeft = Math.min(minLeft, rect.left);
      minTop = Math.min(minTop, rect.top);
      maxRight = Math.max(maxRight, rect.left + rect.width);
      maxBottom = Math.max(maxBottom, rect.top + rect.height);
    }

    return {
      selectionObject,
      selectedObjects: boundsList.map((entry) => entry.obj),
      bounds: {
        left: minLeft,
        top: minTop,
        width: Math.max(1, maxRight - minLeft),
        height: Math.max(1, maxBottom - minTop),
      },
    };
  }, []);

  const restoreCanvasSelection = useCallback((selectedObjects: any[]) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    const nextObjects = selectedObjects.filter((obj) => fabricCanvas.getObjects().includes(obj));
    if (nextObjects.length === 0) {
      fabricCanvas.discardActiveObject();
      return;
    }

    if (nextObjects.length === 1) {
      nextObjects[0].setCoords?.();
      fabricCanvas.setActiveObject(nextObjects[0]);
      return;
    }

    const nextSelection = new ActiveSelection(nextObjects, { canvas: fabricCanvas });
    nextSelection.setCoords?.();
    fabricCanvas.setActiveObject(nextSelection);
  }, []);

  const syncSelectionState = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    const layerVisible = activeLayerVisibleRef.current;
    const hasBitmap = layerVisible && !!bitmapFloatingObjectRef.current;
    const hasActive = layerVisible && !!fabricCanvas?.getActiveObject();
    const hasSelection = hasBitmap || (editorModeRef.current === 'vector' && hasActive);
    setCanZoomToSelection(layerVisible && !!getSelectionBoundsSnapshot());
    onSelectionStateChangeRef.current?.({
      hasSelection,
      hasBitmapFloatingSelection: hasBitmap,
    });
  }, [getSelectionBoundsSnapshot]);

  const syncActiveLayerCanvasVisibility = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current as (FabricCanvas & {
      wrapperEl?: HTMLDivElement;
      lowerCanvasEl?: HTMLCanvasElement;
      upperCanvasEl?: HTMLCanvasElement;
    }) | null;
    if (!fabricCanvas) {
      return;
    }

    const nextOpacity = activeLayerVisible ? String(activeLayerOpacity) : '0';
    if (fabricCanvas.wrapperEl) {
      fabricCanvas.wrapperEl.style.opacity = nextOpacity;
    }
    if (fabricCanvas.lowerCanvasEl) {
      fabricCanvas.lowerCanvasEl.style.opacity = nextOpacity;
    }
    if (fabricCanvas.upperCanvasEl) {
      fabricCanvas.upperCanvasEl.style.opacity = nextOpacity;
    }
  }, [activeLayerOpacity, activeLayerVisible]);

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

  const resolveVectorTextureSource = useCallback((texturePath?: string | null) => {
    const normalizedTexturePath = texturePath?.trim();
    if (!normalizedTexturePath) {
      return null;
    }

    if (vectorStrokeTextureCacheRef.current.has(normalizedTexturePath)) {
      return vectorStrokeTextureCacheRef.current.get(normalizedTexturePath) ?? null;
    }

    if (!vectorStrokeTexturePendingRef.current.has(normalizedTexturePath)) {
      vectorStrokeTexturePendingRef.current.add(normalizedTexturePath);
      const image = new Image();
      image.onload = () => {
        vectorStrokeTexturePendingRef.current.delete(normalizedTexturePath);
        vectorStrokeTextureCacheRef.current.set(normalizedTexturePath, image);
        fabricCanvasRef.current?.requestRenderAll();
      };
      image.onerror = () => {
        vectorStrokeTexturePendingRef.current.delete(normalizedTexturePath);
        vectorStrokeTextureCacheRef.current.set(normalizedTexturePath, null);
        fabricCanvasRef.current?.requestRenderAll();
      };
      image.src = normalizedTexturePath;
    }

    return null;
  }, []);

  const resolveVectorStrokeTextureSource = useCallback((brushId: VectorStrokeBrushId) => {
    const preset = getVectorStrokeBrushPreset(brushId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }
    return resolveVectorTextureSource(texturePath);
  }, [resolveVectorTextureSource]);

  const resolveVectorStrokeBrushRenderStyle = useCallback((
    brushId: VectorStrokeBrushId,
    strokeColor: string,
    strokeWidth: number,
  ) => {
    const preset = getVectorStrokeBrushPreset(brushId);
    const texturePath = preset.texturePath?.trim();
    const textureSource = texturePath
      ? resolveVectorStrokeTextureSource(brushId)
      : null;

    if (texturePath && !textureSource && !vectorStrokeTextureCacheRef.current.has(texturePath)) {
      return null;
    }

    const cacheKey = [
      brushId,
      strokeColor,
      strokeWidth.toFixed(3),
      texturePath ?? 'builtin',
      textureSource ? 'ready' : 'fallback',
    ].join('|');
    const cached = vectorStrokeBrushRenderCacheRef.current.get(cacheKey);
    if (cached) {
      return cached;
    }

    const renderStyle = createVectorStrokeBrushRenderStyle(
      brushId,
      strokeColor,
      strokeWidth,
      textureSource,
    );
    if (vectorStrokeBrushRenderCacheRef.current.size >= 256) {
      vectorStrokeBrushRenderCacheRef.current.clear();
    }
    vectorStrokeBrushRenderCacheRef.current.set(cacheKey, renderStyle);
    return renderStyle;
  }, [resolveVectorStrokeTextureSource]);

  const resolveVectorFillTextureSource = useCallback((textureId: VectorFillTextureId) => {
    const preset = getVectorFillTexturePreset(textureId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }
    return resolveVectorTextureSource(texturePath);
  }, [resolveVectorTextureSource]);

  const resolveBitmapFillTextureSource = useCallback((textureId: BitmapFillTextureId) => {
    const preset = getBitmapFillTexturePreset(textureId);
    const texturePath = preset.texturePath?.trim();
    if (!texturePath) {
      return null;
    }
    return resolveVectorTextureSource(texturePath);
  }, [resolveVectorTextureSource]);

  const transformVectorLocalPointToScene = useCallback((obj: any, x: number, y: number, pathOffset?: Point | null) => {
    const offsetX = pathOffset?.x ?? 0;
    const offsetY = pathOffset?.y ?? 0;
    return new Point(x - offsetX, y - offsetY).transform(obj.calcTransformMatrix());
  }, []);

  const getVectorObjectContourPaths = useCallback((obj: any): Array<{ closed: boolean; points: Point[] }> => {
    if (!obj || typeof obj.calcTransformMatrix !== 'function') {
      return [];
    }

    const objectType = getFabricObjectType(obj);
    const strokeSampleSpacing = getVectorStrokeSampleSpacing(
      typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 1,
    );
    const transformPoint = (x: number, y: number, pathOffset?: Point | null) => (
      transformVectorLocalPointToScene(obj, x, y, pathOffset)
    );

    if (objectType === 'line' && typeof obj.calcLinePoints === 'function') {
      const points = obj.calcLinePoints();
      return [{
        closed: false,
        points: [
          transformPoint(points.x1, points.y1),
          transformPoint(points.x2, points.y2),
        ],
      }];
    }

    if (objectType === 'rect') {
      const halfWidth = (typeof obj.width === 'number' ? obj.width : 0) / 2;
      const halfHeight = (typeof obj.height === 'number' ? obj.height : 0) / 2;
      return [{
        closed: true,
        points: [
          transformPoint(-halfWidth, -halfHeight),
          transformPoint(halfWidth, -halfHeight),
          transformPoint(halfWidth, halfHeight),
          transformPoint(-halfWidth, halfHeight),
        ],
      }];
    }

    if (objectType === 'ellipse' || objectType === 'circle') {
      const radiusX = typeof obj.rx === 'number' ? obj.rx : ((typeof obj.width === 'number' ? obj.width : 0) / 2);
      const radiusY = typeof obj.ry === 'number' ? obj.ry : ((typeof obj.height === 'number' ? obj.height : 0) / 2);
      const ellipseCircumference = Math.PI * (3 * (radiusX + radiusY) - Math.sqrt((3 * radiusX + radiusY) * (radiusX + 3 * radiusY)));
      const segments = Math.max(24, Math.ceil(ellipseCircumference / strokeSampleSpacing));
      const points: Point[] = [];
      for (let index = 0; index < segments; index += 1) {
        const angle = (index / segments) * Math.PI * 2;
        points.push(transformPoint(Math.cos(angle) * radiusX, Math.sin(angle) * radiusY));
      }
      return [{ closed: true, points }];
    }

    if ((objectType === 'polygon' || objectType === 'polyline') && Array.isArray(obj.points) && obj.points.length > 1) {
      const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
      return [{
        closed: objectType === 'polygon',
        points: obj.points.map((point: { x: number; y: number }) => transformPoint(point.x, point.y, pathOffset)),
      }];
    }

    if (objectType === 'path' && Array.isArray(obj.path) && obj.path.length > 0) {
      const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
      const sampledPoints: Point[] = [];
      let currentPoint: Point | null = null;
      let subpathStart: Point | null = null;
      const targetSpacing = strokeSampleSpacing;

      const appendPoint = (point: Point) => {
        const lastPoint = sampledPoints[sampledPoints.length - 1];
        if (!lastPoint || getDistanceBetweenPoints(lastPoint, point) > 0.5) {
          sampledPoints.push(point);
        }
      };

      for (const command of obj.path) {
        const commandType = getPathCommandType(command);
        if (commandType === 'M') {
          currentPoint = transformPoint(command[1], command[2], pathOffset);
          subpathStart = currentPoint;
          appendPoint(currentPoint);
          continue;
        }
        if (!currentPoint) {
          continue;
        }
        if (commandType === 'L') {
          const endPoint = transformPoint(command[1], command[2], pathOffset);
          appendPoint(endPoint);
          currentPoint = endPoint;
          continue;
        }
        if (commandType === 'Q') {
          const control = transformPoint(command[1], command[2], pathOffset);
          const endPoint = transformPoint(command[3], command[4], pathOffset);
          const estimatedLength =
            getDistanceBetweenPoints(currentPoint, control) +
            getDistanceBetweenPoints(control, endPoint);
          const segments = Math.max(8, Math.ceil(estimatedLength / targetSpacing));
          for (let segmentIndex = 1; segmentIndex <= segments; segmentIndex += 1) {
            appendPoint(getQuadraticBezierPoint(currentPoint, control, endPoint, segmentIndex / segments));
          }
          currentPoint = endPoint;
          continue;
        }
        if (commandType === 'C') {
          const control1 = transformPoint(command[1], command[2], pathOffset);
          const control2 = transformPoint(command[3], command[4], pathOffset);
          const endPoint = transformPoint(command[5], command[6], pathOffset);
          const estimatedLength =
            getDistanceBetweenPoints(currentPoint, control1) +
            getDistanceBetweenPoints(control1, control2) +
            getDistanceBetweenPoints(control2, endPoint);
          const segments = Math.max(10, Math.ceil(estimatedLength / targetSpacing));
          for (let segmentIndex = 1; segmentIndex <= segments; segmentIndex += 1) {
            appendPoint(getCubicBezierPoint(currentPoint, control1, control2, endPoint, segmentIndex / segments));
          }
          currentPoint = endPoint;
          continue;
        }
        if (commandType === 'Z' && subpathStart) {
          appendPoint(subpathStart);
          currentPoint = subpathStart;
        }
      }

      return sampledPoints.length > 1
        ? [{ closed: pathCommandsDescribeClosedShape(obj.path), points: sampledPoints }]
        : [];
    }

    return [];
  }, [transformVectorLocalPointToScene]);

  const drawVectorStrokeBrushPath = useCallback((
    ctx: CanvasRenderingContext2D,
    points: Point[],
    closed: boolean,
    renderStyle: VectorStrokeBrushRenderStyle,
  ) => {
    if (renderStyle.kind !== 'bitmap-dab' || renderStyle.dabs.length === 0 || points.length < 2) {
      return;
    }

    const pathPoints = buildClosedPolylinePoints(points, closed);
    if (pathPoints.length < 2) {
      return;
    }
    const { cumulativeLengths, totalLength } = buildPolylineArcTable(pathPoints);
    if (totalLength <= 0) {
      return;
    }

    const tangentWindow = Math.max(1, renderStyle.spacing * 0.85);

    const renderDabAt = (distanceAlongPath: number, dabIndex: number) => {
      const point = samplePointAlongPolyline(
        pathPoints,
        cumulativeLengths,
        totalLength,
        distanceAlongPath,
        closed,
      );
      const angle = sampleAngleAlongPolyline(
        pathPoints,
        cumulativeLengths,
        totalLength,
        distanceAlongPath,
        closed,
        tangentWindow,
      );
      const dab = renderStyle.dabs[dabIndex % renderStyle.dabs.length];
      const scaleRandom = hashNumberTriplet(point.x, point.y, dabIndex * 0.17);
      const opacityRandom = hashNumberTriplet(point.y, point.x, dabIndex * 0.23);
      const rotationRandom = hashNumberTriplet(point.y, point.x, dabIndex * 0.41);
      const scatterAngleRandom = hashNumberTriplet(point.x, angle, dabIndex * 0.83);
      const scatterRadiusRandom = hashNumberTriplet(point.y, angle, dabIndex * 1.29);
      const jitterScale = 1 + (((scaleRandom * 2) - 1) * renderStyle.scaleJitter);
      const jitterRotation = ((rotationRandom * 2) - 1) * renderStyle.rotationJitter;
      const jitterOpacity = clampUnit(1 + (((opacityRandom * 2) - 1) * renderStyle.opacityJitter));
      const scatterAngle = scatterAngleRandom * Math.PI * 2;
      const scatterRadius = renderStyle.scatter > 0 ? scatterRadiusRandom * renderStyle.scatter : 0;
      const renderX = point.x + Math.cos(scatterAngle) * scatterRadius;
      const renderY = point.y + Math.sin(scatterAngle) * scatterRadius;
      const drawWidth = Math.max(1, dab.width * jitterScale);
      const drawHeight = Math.max(1, dab.height * jitterScale);

      ctx.save();
      ctx.globalAlpha = dab.opacity * jitterOpacity;
      ctx.translate(renderX, renderY);
      ctx.rotate(angle + jitterRotation);
      ctx.drawImage(
        dab.image,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight,
      );
      ctx.restore();
    };

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    let dabIndex = 0;
    for (let distanceAlongPath = 0; distanceAlongPath < totalLength; distanceAlongPath += renderStyle.spacing) {
      renderDabAt(distanceAlongPath, dabIndex);
      dabIndex += 1;
    }
    if (!closed) {
      renderDabAt(totalLength, dabIndex);
    }
    ctx.restore();
  }, []);

  const traceVectorObjectLocalPath = useCallback((ctx: CanvasRenderingContext2D, obj: any): boolean => {
    const objectType = getFabricObjectType(obj);

    if (objectType === 'rect') {
      const width = typeof obj.width === 'number' ? obj.width : 0;
      const height = typeof obj.height === 'number' ? obj.height : 0;
      ctx.beginPath();
      ctx.rect(-width / 2, -height / 2, width, height);
      return true;
    }

    if (objectType === 'ellipse' || objectType === 'circle') {
      const radiusX = typeof obj.rx === 'number' ? obj.rx : ((typeof obj.width === 'number' ? obj.width : 0) / 2);
      const radiusY = typeof obj.ry === 'number' ? obj.ry : ((typeof obj.height === 'number' ? obj.height : 0) / 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
      return true;
    }

    if (objectType === 'polygon' && Array.isArray(obj.points) && obj.points.length > 1) {
      const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
      ctx.beginPath();
      obj.points.forEach((point: { x: number; y: number }, index: number) => {
        const localX = point.x - pathOffset.x;
        const localY = point.y - pathOffset.y;
        if (index === 0) {
          ctx.moveTo(localX, localY);
        } else {
          ctx.lineTo(localX, localY);
        }
      });
      ctx.closePath();
      return true;
    }

    if (objectType === 'path' && Array.isArray(obj.path) && pathCommandsDescribeClosedShape(obj.path)) {
      const pathOffset = obj.pathOffset instanceof Point ? obj.pathOffset : new Point(obj.pathOffset?.x ?? 0, obj.pathOffset?.y ?? 0);
      ctx.beginPath();
      for (const command of obj.path as any[]) {
        if (!Array.isArray(command) || typeof command[0] !== 'string') {
          continue;
        }
        switch (command[0].toUpperCase()) {
          case 'M':
            ctx.moveTo(Number(command[1]) - pathOffset.x, Number(command[2]) - pathOffset.y);
            break;
          case 'L':
            ctx.lineTo(Number(command[1]) - pathOffset.x, Number(command[2]) - pathOffset.y);
            break;
          case 'Q':
            ctx.quadraticCurveTo(
              Number(command[1]) - pathOffset.x,
              Number(command[2]) - pathOffset.y,
              Number(command[3]) - pathOffset.x,
              Number(command[4]) - pathOffset.y,
            );
            break;
          case 'C':
            ctx.bezierCurveTo(
              Number(command[1]) - pathOffset.x,
              Number(command[2]) - pathOffset.y,
              Number(command[3]) - pathOffset.x,
              Number(command[4]) - pathOffset.y,
              Number(command[5]) - pathOffset.x,
              Number(command[6]) - pathOffset.y,
            );
            break;
          case 'Z':
            ctx.closePath();
            break;
        }
      }
      return true;
    }

    return false;
  }, []);

  const renderVectorBrushStrokeOverlay = useCallback((ctx: CanvasRenderingContext2D, options: { clear?: boolean } = {}) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (options.clear !== false) {
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
    if (!fabricCanvas || editorModeRef.current !== 'vector') {
      return;
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    for (const obj of fabricCanvas.getObjects() as any[]) {
      if (getVectorStyleTargets(obj).length === 0) {
        continue;
      }

      const fillTextureId = getVectorObjectFillTextureId(obj);
      const fillColor = getVectorObjectFillColor(obj);
      if (vectorObjectSupportsFill(obj) && fillTextureId !== DEFAULT_VECTOR_FILL_TEXTURE_ID && fillColor) {
        const textureTile = createVectorFillTextureTile(
          fillTextureId,
          fillColor,
          resolveVectorFillTextureSource(fillTextureId),
        );
        if (textureTile && typeof obj.calcTransformMatrix === 'function') {
          ctx.save();
          const transform = obj.calcTransformMatrix();
          ctx.transform(transform[0], transform[1], transform[2], transform[3], transform[4], transform[5]);
          if (traceVectorObjectLocalPath(ctx, obj)) {
            const pattern = ctx.createPattern(textureTile, 'repeat');
            if (pattern) {
              ctx.fillStyle = pattern;
              ctx.globalAlpha = typeof obj.opacity === 'number' ? obj.opacity : 1;
              ctx.clip();
              ctx.fillRect(-CANVAS_SIZE, -CANVAS_SIZE, CANVAS_SIZE * 2, CANVAS_SIZE * 2);
            }
          }
          ctx.restore();
        }
      }

      const brushId = getVectorObjectStrokeBrushId(obj);
      if (brushId === DEFAULT_VECTOR_STROKE_BRUSH_ID) {
        continue;
      }
      const strokeColor = getVectorObjectStrokeColor(obj);
      const strokeWidth = typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 0;
      if (!strokeColor || strokeWidth <= 0) {
        continue;
      }

      const renderStyle = resolveVectorStrokeBrushRenderStyle(
        brushId,
        strokeColor,
        strokeWidth,
      );
      if (!renderStyle || renderStyle.kind !== 'bitmap-dab') {
        continue;
      }
      const objectOpacity = typeof obj.opacity === 'number' ? obj.opacity : 1;
      const resolvedRenderStyle = objectOpacity === 1
        ? renderStyle
        : {
            ...renderStyle,
            dabs: renderStyle.dabs.map((dab) => ({
              ...dab,
              opacity: dab.opacity * objectOpacity,
            })),
          };

      const contourPaths = getVectorObjectContourPaths(obj);
      if (contourPaths.length === 0) {
        continue;
      }

      for (const contour of contourPaths) {
        drawVectorStrokeBrushPath(ctx, contour.points, contour.closed, resolvedRenderStyle);
      }
    }

    ctx.restore();
  }, [drawVectorStrokeBrushPath, getVectorObjectContourPaths, resolveVectorFillTextureSource, resolveVectorStrokeBrushRenderStyle, traceVectorObjectLocalPath]);

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

  const getComposedCanvasElement = useCallback((): HTMLCanvasElement => {
    const fabricCanvas = fabricCanvasRef.current;
    if (fabricCanvas) {
      const baseCanvas = getActiveLayerCanvasElement();
      const composed = document.createElement('canvas');
      composed.width = CANVAS_SIZE;
      composed.height = CANVAS_SIZE;
      const composedCtx = composed.getContext('2d');
      if (!composedCtx) {
        return baseCanvas;
      }

      for (const layer of documentLayers) {
        if (layer.id === activeDocumentLayer?.id) {
          composedCtx.save();
          composedCtx.globalAlpha = activeLayerVisible ? activeLayerOpacity : 0;
          composedCtx.drawImage(baseCanvas, 0, 0);
          renderVectorBrushStrokeOverlay(composedCtx, { clear: false });
          composedCtx.restore();
          continue;
        }

        if (!layer.visible || layer.opacity <= 0) {
          continue;
        }

        const layerSurface = inactiveLayerSurfaceRefs.current.get(layer.id);
        if (!layerSurface) {
          continue;
        }

        composedCtx.save();
        composedCtx.globalAlpha = layer.opacity;
        composedCtx.drawImage(layerSurface, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        composedCtx.restore();
      }
      return composed;
    }
    const fallback = document.createElement('canvas');
    fallback.width = CANVAS_SIZE;
    fallback.height = CANVAS_SIZE;
    return fallback;
  }, [activeDocumentLayer?.id, activeLayerOpacity, activeLayerVisible, documentLayers, getActiveLayerCanvasElement, renderVectorBrushStrokeOverlay]);

  const getSelectionMousePos = useCallback((event: MouseEvent) => {
    const canvas = bitmapSelectionCanvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return {
      x: Math.max(0, Math.min(CANVAS_SIZE, (event.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(CANVAS_SIZE, (event.clientY - rect.top) * scaleY)),
    };
  }, []);

  const pickBitmapLayerAtPoint = useCallback((point: { x: number; y: number }): string | null => {
    const x = Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor(point.x)));
    const y = Math.max(0, Math.min(CANVAS_SIZE - 1, Math.floor(point.y)));

    for (let index = documentLayers.length - 1; index >= 0; index -= 1) {
      const layer = documentLayers[index];
      if (!layer || !layer.visible || layer.opacity <= 0) {
        continue;
      }

      const sourceCanvas = layer.id === activeDocumentLayer?.id
        ? fabricCanvasRef.current?.toCanvasElement(1) ?? null
        : inactiveLayerSurfaceRefs.current.get(layer.id) ?? null;
      if (!sourceCanvas) {
        continue;
      }

      const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        continue;
      }

      const alpha = ctx.getImageData(x, y, 1, 1).data[3] ?? 0;
      if (alpha > 0) {
        return layer.id;
      }
    }

    return null;
  }, [activeDocumentLayer?.id, documentLayers]);

  const applySelectionTransform = useCallback((transform: Parameters<typeof util.applyTransformToObject>[1]): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const activeObject = fabricCanvas.getActiveObject() as any;
    const selectedObjects = selectionSnapshot.selectedObjects.filter(Boolean);
    if (selectedObjects.length === 0) {
      return false;
    }

    if (isActiveSelectionObject(activeObject)) {
      fabricCanvas.discardActiveObject();
    }

    let changed = false;
    for (const obj of selectedObjects) {
      if (typeof obj?.calcTransformMatrix !== 'function') {
        continue;
      }
      const nextMatrix = util.multiplyTransformMatrices(transform, obj.calcTransformMatrix());
      util.applyTransformToObject(obj, nextMatrix);
      obj.setCoords?.();
      changed = true;
    }

    restoreCanvasSelection(selectedObjects);

    if (!changed) {
      return false;
    }

    fabricCanvas.requestRenderAll();
    syncSelectionState();
    saveHistory();
    return true;
  }, [getSelectionBoundsSnapshot, restoreCanvasSelection, saveHistory, syncSelectionState]);

  const mirrorPointAcrossAnchor = useCallback((anchor: Point, handlePoint: Point) => (
    new Point(
      anchor.x * 2 - handlePoint.x,
      anchor.y * 2 - handlePoint.y,
    )
  ), []);

  const translateScenePoint = useCallback((point: Point | null, deltaX: number, deltaY: number) => {
    if (!point) return null;
    return new Point(point.x + deltaX, point.y + deltaY);
  }, []);

  const resolvePenDraftAnchorHandleType = useCallback((anchor: PenDraftAnchor): VectorPathNodeHandleType => {
    const hasIncoming = !!anchor.incoming;
    const hasOutgoing = !!anchor.outgoing;
    if (!hasIncoming && !hasOutgoing) {
      return 'linear';
    }
    if (!hasIncoming || !hasOutgoing) {
      return 'corner';
    }

    const incoming = anchor.incoming!;
    const outgoing = anchor.outgoing!;
    const mirrored = (
      Math.abs(incoming.x + outgoing.x - anchor.point.x * 2) <= 0.0001 &&
      Math.abs(incoming.y + outgoing.y - anchor.point.y * 2) <= 0.0001
    );
    return mirrored ? 'symmetric' : 'corner';
  }, []);

  const commitCurrentPenPlacement = useCallback(() => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;
    const anchor = draft.anchors[session.anchorIndex];
    if (!anchor) {
      penAnchorPlacementSessionRef.current = null;
      return false;
    }

    if (!session.hasDragged) {
      anchor.incoming = null;
      anchor.outgoing = null;
      anchor.handleType = 'linear';
    } else {
      anchor.handleType = resolvePenDraftAnchorHandleType(anchor);
    }

    draft.previewPoint = cloneScenePoint(session.currentPointerScene);
    penAnchorPlacementSessionRef.current = null;
    return true;
  }, [resolvePenDraftAnchorHandleType]);

  const updatePenAnchorPlacement = useCallback((pointer: Point) => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;

    const anchor = draft.anchors[session.anchorIndex];
    if (!anchor) return false;

    const nextPointer = new Point(pointer.x, pointer.y);
    session.currentPointerScene = nextPointer;

    const dragThreshold = getZoomInvariantMetric(PEN_TOOL_DRAG_THRESHOLD_PX);
    if (
      Math.hypot(
        nextPointer.x - session.startPointerScene.x,
        nextPointer.y - session.startPointerScene.y,
      ) >= dragThreshold
    ) {
      session.hasDragged = true;
    }

    if (session.moveAnchorMode && session.moveAnchorSnapshot && session.moveAnchorStartPointerScene) {
      const deltaX = nextPointer.x - session.moveAnchorStartPointerScene.x;
      const deltaY = nextPointer.y - session.moveAnchorStartPointerScene.y;
      anchor.point = new Point(
        session.moveAnchorSnapshot.point.x + deltaX,
        session.moveAnchorSnapshot.point.y + deltaY,
      );
      anchor.incoming = translateScenePoint(session.moveAnchorSnapshot.incoming, deltaX, deltaY);
      anchor.outgoing = translateScenePoint(session.moveAnchorSnapshot.outgoing, deltaX, deltaY);
      anchor.handleType = resolvePenDraftAnchorHandleType(anchor);
      return true;
    }

    if (session.handleRole === 'incoming') {
      anchor.incoming = nextPointer;
      anchor.outgoing = session.cuspMode
        ? cloneScenePoint(session.cuspFixedOpposite)
        : mirrorPointAcrossAnchor(anchor.point, nextPointer);
    } else {
      anchor.outgoing = nextPointer;
      anchor.incoming = session.cuspMode
        ? cloneScenePoint(session.cuspFixedOpposite)
        : mirrorPointAcrossAnchor(anchor.point, nextPointer);
    }
    anchor.handleType = session.cuspMode ? 'corner' : 'symmetric';
    draft.previewPoint = nextPointer;
    return true;
  }, [getZoomInvariantMetric, mirrorPointAcrossAnchor, resolvePenDraftAnchorHandleType, translateScenePoint]);

  const setPenAnchorMoveMode = useCallback((enabled: boolean) => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;
    if (enabled === session.moveAnchorMode) return false;

    if (enabled) {
      const anchor = draft.anchors[session.anchorIndex];
      if (!anchor) return false;
      session.moveAnchorMode = true;
      session.moveAnchorStartPointerScene = cloneScenePoint(session.currentPointerScene);
      session.moveAnchorSnapshot = clonePenDraftAnchor(anchor);
      return true;
    }

    session.moveAnchorMode = false;
    session.moveAnchorStartPointerScene = null;
    session.moveAnchorSnapshot = null;
    return true;
  }, []);

  const setPenAnchorCuspMode = useCallback((enabled: boolean) => {
    const draft = penDraftRef.current;
    const session = penAnchorPlacementSessionRef.current;
    if (!draft || !session) return false;
    if (enabled === session.cuspMode) return false;

    const anchor = draft.anchors[session.anchorIndex];
    if (!anchor) return false;

    session.cuspMode = enabled;
    if (enabled) {
      session.cuspFixedOpposite = cloneScenePoint(
        session.handleRole === 'incoming' ? anchor.outgoing : anchor.incoming,
      );
    } else {
      session.cuspFixedOpposite = null;
    }

    if (!session.moveAnchorMode) {
      updatePenAnchorPlacement(session.currentPointerScene);
    }
    return true;
  }, [updatePenAnchorPlacement]);

  const syncPenPlacementToAltModifier = useCallback((enabled: boolean) => {
    const session = penAnchorPlacementSessionRef.current;
    if (!session) {
      return false;
    }
    if (enabled) {
      return setPenAnchorCuspMode(true);
    }
    return false;
  }, [setPenAnchorCuspMode]);

  const discardPenDraft = useCallback(() => {
    penDraftRef.current = null;
    penAnchorPlacementSessionRef.current = null;
    penModifierStateRef.current.alt = false;
    penModifierStateRef.current.space = false;
    fabricCanvasRef.current?.requestRenderAll();
    syncSelectionState();
  }, [syncSelectionState]);

  const finalizePenDraft = useCallback((options: { close?: boolean } = {}): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    const draft = penDraftRef.current;
    if (!fabricCanvas || !draft) return false;

    commitCurrentPenPlacement();

    if (draft.anchors.length < 2) {
      discardPenDraft();
      return false;
    }

    const shouldClose = options.close === true;
    const pathData = buildPenDraftPathData(draft.anchors, shouldClose);
    if (!pathData) {
      discardPenDraft();
      return false;
    }

    const strokeWidth = Math.max(0, vectorStyleRef.current.strokeWidth);
    const path = new Path(pathData, {
      fill: shouldClose
        ? getFabricFillValueForVectorTexture(vectorStyleRef.current.fillTextureId, vectorStyleRef.current.fillColor)
        : null,
      stroke: getFabricStrokeValueForVectorBrush(vectorStyleRef.current.strokeBrushId, vectorStyleRef.current.strokeColor),
      strokeWidth,
      strokeUniform: true,
      noScaleCache: false,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      nodeHandleTypes: buildPenDraftNodeHandleTypes(draft.anchors),
      vectorFillTextureId: shouldClose ? vectorStyleRef.current.fillTextureId : undefined,
      vectorFillColor: shouldClose ? vectorStyleRef.current.fillColor : undefined,
      vectorStrokeBrushId: vectorStyleRef.current.strokeBrushId,
      vectorStrokeColor: vectorStyleRef.current.strokeColor,
    } as any);

    path.setCoords?.();
    fabricCanvas.add(path);
    if (activeToolRef.current === 'pen') {
      fabricCanvas.discardActiveObject();
    } else {
      fabricCanvas.setActiveObject(path);
    }

    penDraftRef.current = null;
    penAnchorPlacementSessionRef.current = null;
    penModifierStateRef.current.alt = false;
    penModifierStateRef.current.space = false;
    fabricCanvas.requestRenderAll();
    syncSelectionState();
    saveHistory();
    return true;
  }, [commitCurrentPenPlacement, discardPenDraft, saveHistory, syncSelectionState]);

  const removeLastPenDraftAnchor = useCallback(() => {
    const draft = penDraftRef.current;
    if (!draft) return false;

    penAnchorPlacementSessionRef.current = null;
    draft.anchors.pop();
    if (draft.anchors.length === 0) {
      discardPenDraft();
      return true;
    }

    draft.previewPoint = cloneScenePoint(draft.anchors[draft.anchors.length - 1]?.point ?? null);
    fabricCanvasRef.current?.requestRenderAll();
    return true;
  }, [discardPenDraft]);

  const startPenAnchorPlacement = useCallback((pointer: Point, options: { cuspMode?: boolean } = {}) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    let draft = penDraftRef.current;
    if (!draft) {
      draft = {
        anchors: [],
        previewPoint: null,
      };
      penDraftRef.current = draft;
    }

    if (draft.anchors.length >= 2) {
      const firstAnchor = draft.anchors[0]?.point ?? null;
      const closeRadius = getZoomInvariantMetric(PEN_TOOL_CLOSE_HIT_RADIUS_PX);
      if (
        firstAnchor &&
        Math.hypot(pointer.x - firstAnchor.x, pointer.y - firstAnchor.y) <= closeRadius
      ) {
        return finalizePenDraft({ close: true });
      }
    }

    const anchor = createPenDraftAnchor(pointer);
    const anchorIndex = draft.anchors.length;
    draft.anchors.push(anchor);
    draft.previewPoint = cloneScenePoint(pointer);
    penAnchorPlacementSessionRef.current = {
      anchorIndex,
      // Match Figma-style pen placement: the drag direction controls the
      // forward/outgoing handle, while the previous-side handle mirrors unless
      // Alt breaks the relationship into a cusp.
      handleRole: 'outgoing',
      startPointerScene: cloneScenePoint(pointer) ?? new Point(pointer.x, pointer.y),
      currentPointerScene: cloneScenePoint(pointer) ?? new Point(pointer.x, pointer.y),
      hasDragged: false,
      moveAnchorMode: false,
      moveAnchorStartPointerScene: null,
      moveAnchorSnapshot: null,
      cuspMode: options.cuspMode === true,
      cuspFixedOpposite: null,
    };
    fabricCanvas.discardActiveObject();
    fabricCanvas.requestRenderAll();
    syncSelectionState();
    return true;
  }, [finalizePenDraft, getZoomInvariantMetric, syncSelectionState]);

  const renderPenDraftGuide = useCallback((ctx: CanvasRenderingContext2D) => {
    const draft = penDraftRef.current;
    if (!draft || draft.anchors.length === 0) return false;

    const activeAnchorIndex = penAnchorPlacementSessionRef.current?.anchorIndex ?? (draft.anchors.length - 1);
    const previewPoint = penAnchorPlacementSessionRef.current ? null : draft.previewPoint;
    const previewStrokeWidth = Math.max(1, vectorStyleRef.current.strokeWidth);

    ctx.save();
    try {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(draft.anchors[0].point.x, draft.anchors[0].point.y);
      for (let index = 1; index < draft.anchors.length; index += 1) {
        const previousAnchor = draft.anchors[index - 1];
        const currentAnchor = draft.anchors[index];
        if (previousAnchor.outgoing || currentAnchor.incoming) {
          const control1 = previousAnchor.outgoing ?? previousAnchor.point;
          const control2 = currentAnchor.incoming ?? currentAnchor.point;
          ctx.bezierCurveTo(
            control1.x,
            control1.y,
            control2.x,
            control2.y,
            currentAnchor.point.x,
            currentAnchor.point.y,
          );
        } else {
          ctx.lineTo(currentAnchor.point.x, currentAnchor.point.y);
        }
      }
      if (previewPoint && draft.anchors.length > 0) {
        const lastAnchor = draft.anchors[draft.anchors.length - 1];
        if (lastAnchor.outgoing) {
          ctx.bezierCurveTo(
            lastAnchor.outgoing.x,
            lastAnchor.outgoing.y,
            previewPoint.x,
            previewPoint.y,
            previewPoint.x,
            previewPoint.y,
          );
        } else {
          ctx.lineTo(previewPoint.x, previewPoint.y);
        }
      }
      ctx.strokeStyle = vectorStyleRef.current.strokeColor;
      ctx.lineWidth = previewStrokeWidth;
      ctx.stroke();

      ctx.strokeStyle = VECTOR_POINT_HANDLE_GUIDE_STROKE;
      ctx.lineWidth = getZoomInvariantMetric(VECTOR_POINT_HANDLE_GUIDE_STROKE_WIDTH);
      draft.anchors.forEach((anchor) => {
        if (anchor.incoming) {
          ctx.beginPath();
          ctx.moveTo(anchor.point.x, anchor.point.y);
          ctx.lineTo(anchor.incoming.x, anchor.incoming.y);
          ctx.stroke();
        }
        if (anchor.outgoing) {
          ctx.beginPath();
          ctx.moveTo(anchor.point.x, anchor.point.y);
          ctx.lineTo(anchor.outgoing.x, anchor.outgoing.y);
          ctx.stroke();
        }
      });

      const handleRadius = getZoomInvariantMetric(HANDLE_SIZE * 0.42);
      draft.anchors.forEach((anchor, anchorIndex) => {
        const isActive = anchorIndex === activeAnchorIndex;
        const drawHandle = (handlePoint: Point | null) => {
          if (!handlePoint) return;
          ctx.beginPath();
          ctx.arc(handlePoint.x, handlePoint.y, handleRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.lineWidth = getZoomInvariantMetric(2);
          ctx.strokeStyle = '#0ea5e9';
          ctx.stroke();
        };

        drawHandle(anchor.incoming);
        drawHandle(anchor.outgoing);

        ctx.beginPath();
        ctx.arc(anchor.point.x, anchor.point.y, getZoomInvariantMetric(HANDLE_SIZE / 2), 0, Math.PI * 2);
        ctx.fillStyle = isActive ? '#0ea5e9' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = getZoomInvariantMetric(2);
        ctx.strokeStyle = isActive ? '#ffffff' : '#0ea5e9';
        ctx.stroke();
      });
    } finally {
      ctx.restore();
    }

    return true;
  }, [getZoomInvariantMetric]);

  const deleteBitmapFloatingSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    const floatingObject = bitmapFloatingObjectRef.current;
    if (!fabricCanvas || !floatingObject) return false;
    if (editorModeRef.current !== 'bitmap' || activeToolRef.current !== 'box-select') return false;
    if (bitmapSelectionBusyRef.current) return false;

    suppressBitmapSelectionAutoCommitRef.current = true;
    try {
      if (fabricCanvas.getActiveObject() === floatingObject) {
        fabricCanvas.discardActiveObject();
      }

      fabricCanvas.remove(floatingObject);
      bitmapFloatingObjectRef.current = null;
      setHasBitmapFloatingSelection(false);
      bitmapSelectionStartRef.current = null;
      bitmapMarqueeRectRef.current = null;
      bitmapSelectionDragModeRef.current = 'none';
      drawBitmapSelectionOverlay();
      fabricCanvas.requestRenderAll();
      syncSelectionState();
      saveHistory();
      return true;
    } finally {
      queueMicrotask(() => {
        suppressBitmapSelectionAutoCommitRef.current = false;
      });
    }
  }, [drawBitmapSelectionOverlay, saveHistory, syncSelectionState]);

  const syncTextStyleFromSelection = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject || !isTextObject(activeObject)) return;
    const textObj = activeObject as any;

    onTextStyleSyncRef.current?.({
      fontFamily: typeof textObj.fontFamily === 'string' ? textObj.fontFamily : undefined,
      fontSize: typeof textObj.fontSize === 'number' ? textObj.fontSize : undefined,
      fontWeight: textObj.fontWeight === 'bold' ? 'bold' : 'normal',
      fontStyle: textObj.fontStyle === 'italic' ? 'italic' : 'normal',
      underline: textObj.underline === true,
      textAlign: textObj.textAlign === 'center' || textObj.textAlign === 'right' ? textObj.textAlign : 'left',
      opacity: typeof textObj.opacity === 'number' ? textObj.opacity : undefined,
    });
  }, []);

  const syncVectorStyleFromSelection = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    onVectorStyleCapabilitiesSyncRef.current?.(getVectorStyleCapabilitiesForSelection(activeObject));
    const [vectorObject] = getVectorStyleTargets(activeObject);
    if (!vectorObject) return;

    onVectorStyleSyncRef.current?.({
      fillColor: getVectorObjectFillColor(vectorObject),
      fillTextureId: getVectorObjectFillTextureId(vectorObject),
      strokeColor: getVectorObjectStrokeColor(vectorObject),
      strokeWidth: typeof vectorObject.strokeWidth === 'number' ? vectorObject.strokeWidth : undefined,
      strokeBrushId: getVectorObjectStrokeBrushId(vectorObject),
    });
  }, []);

  const syncTextSelectionState = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    onTextSelectionChangeRef.current?.(!!activeObject && isTextObject(activeObject));
  }, []);

  const applyBitmapLayerSource = useCallback((
    source: FabricImage | HTMLImageElement | HTMLCanvasElement | null,
    selectable: boolean,
  ): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const image = source
      ? (source instanceof FabricImage ? source : new FabricImage(source as any))
      : null;

    suppressHistoryRef.current = true;
    try {
      bitmapFloatingObjectRef.current = null;
      setHasBitmapFloatingSelection(false);
      bitmapSelectionStartRef.current = null;
      bitmapMarqueeRectRef.current = null;
      bitmapSelectionDragModeRef.current = 'none';
      drawBitmapSelectionOverlay();

      fabricCanvas.clear();

      if (image) {
        const width = image.width || 1;
        const height = image.height || 1;
        const scale = Math.min(CANVAS_SIZE / width, CANVAS_SIZE / height, 1);

        image.set({
          left: CANVAS_SIZE / 2,
          top: CANVAS_SIZE / 2,
          originX: 'center',
          originY: 'center',
          selectable,
          evented: selectable,
          hasControls: selectable,
          hasBorders: selectable,
          lockMovementX: !selectable,
          lockMovementY: !selectable,
          lockRotation: !selectable,
          lockScalingX: !selectable,
          lockScalingY: !selectable,
        } as any);
        image.scale(scale);
        fabricCanvas.add(image);
      }

      fabricCanvas.requestRenderAll();
      syncSelectionState();
      return true;
    } finally {
      suppressHistoryRef.current = false;
    }
  }, [drawBitmapSelectionOverlay, syncSelectionState]);

  const loadBitmapLayer = useCallback(async (dataUrl: string, selectable: boolean, requestId?: number): Promise<boolean> => {
    if (!isLoadRequestActive(requestId)) return false;

    let image: FabricImage | null = null;
    if (dataUrl) {
      try {
        image = await FabricImage.fromURL(dataUrl);
      } catch (error) {
        console.error('Failed to load bitmap layer:', error);
        return false;
      }
      if (!isLoadRequestActive(requestId)) return false;
    }

    return applyBitmapLayerSource(image, selectable);
  }, [applyBitmapLayerSource, isLoadRequestActive]);

  const commitBitmapSelection = useCallback(async () => {
    const fabricCanvas = fabricCanvasRef.current;
    const floatingObject = bitmapFloatingObjectRef.current;
    if (!fabricCanvas || !floatingObject) return false;
    if (bitmapSelectionBusyRef.current) return false;

    bitmapSelectionBusyRef.current = true;
    try {
      if (fabricCanvas.getActiveObject() === floatingObject) {
        fabricCanvas.discardActiveObject();
      }
      floatingObject.set({
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
      });
      fabricCanvas.requestRenderAll();

      const raster = fabricCanvas.toCanvasElement(1);
      const applied = applyBitmapLayerSource(raster, false);
      if (!applied) return false;
      saveHistory();
      return true;
    } finally {
      bitmapSelectionBusyRef.current = false;
    }
  }, [applyBitmapLayerSource, saveHistory]);

  const queueBitmapRasterCommit = useCallback((
    mutateRaster?: (raster: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => void | Promise<void>,
  ) => {
    const nextCommit = bitmapRasterCommitQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const fabricCanvas = fabricCanvasRef.current;
        if (!fabricCanvas || editorModeRef.current !== 'bitmap') {
          return;
        }

        const raster = fabricCanvas.toCanvasElement(1);
        const rasterCtx = raster.getContext('2d', { willReadFrequently: true });
        if (!rasterCtx) {
          return;
        }

        if (mutateRaster) {
          await mutateRaster(raster, rasterCtx);
        }

        const applied = applyBitmapLayerSource(raster, false);
        if (!applied) {
          return;
        }
        saveHistory();
      })
      .catch((error) => {
        console.error('Failed to commit bitmap raster mutation:', error);
      });

    bitmapRasterCommitQueueRef.current = nextCommit;
    return nextCommit;
  }, [applyBitmapLayerSource, saveHistory]);

  const flattenBitmapLayer = useCallback(async () => {
    await queueBitmapRasterCommit();
  }, [queueBitmapRasterCommit]);

  const commitBitmapStampBrushStroke = useCallback((payload: BitmapStampBrushCommitPayload) => {
    void queueBitmapRasterCommit(async (_raster, rasterCtx) => {
      const visibleBounds = calculateBoundsFromCanvas(payload.strokeCanvas, payload.alphaThreshold);
      if (!visibleBounds) {
        return;
      }

      rasterCtx.save();
      rasterCtx.globalCompositeOperation = payload.compositeOperation;
      rasterCtx.drawImage(payload.strokeCanvas, 0, 0);
      rasterCtx.restore();
    });
  }, [queueBitmapRasterCommit]);

  const loadBitmapAsSingleVectorImage = useCallback(async (bitmapCanvas: HTMLCanvasElement, requestId?: number): Promise<boolean> => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (!isLoadRequestActive(requestId)) return false;

    const extractedRegion = extractVisibleCanvasRegion(bitmapCanvas, 0);
    const bounds = extractedRegion?.bounds ?? null;
    let image: FabricImage | null = null;

    if (bounds && extractedRegion) {
      try {
        image = await FabricImage.fromURL(extractedRegion.canvas.toDataURL('image/png'));
      } catch (error) {
        console.error('Failed to create vector image from bitmap bounds:', error);
        return false;
      }
      if (!isLoadRequestActive(requestId)) return false;
    }

    suppressHistoryRef.current = true;
    try {
      fabricCanvas.clear();

      if (image && bounds) {
        image.set({
          left: bounds.x + bounds.width / 2,
          top: bounds.y + bounds.height / 2,
          originX: 'center',
          originY: 'center',
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
        } as any);
        fabricCanvas.add(image);
      }

      fabricCanvas.requestRenderAll();
      return true;
    } finally {
      suppressHistoryRef.current = false;
    }
  }, [isLoadRequestActive]);

  const normalizeCanvasVectorStrokeUniform = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    let changed = false;
    fabricCanvas.forEachObject((obj: any) => {
      if (normalizeVectorObjectRendering(obj)) {
        obj.setCoords?.();
        changed = true;
      }
    });

    if (changed) {
      fabricCanvas.requestRenderAll();
    }

    return changed;
  }, []);

  const applyFill = useCallback(async (x: number, y: number) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'bitmap') return;

    const raster = fabricCanvas.toCanvasElement(1);
    const ctx = raster.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const didFill = applyBitmapBucketFill(
      imageData,
      Math.floor(x),
      Math.floor(y),
      {
        fillColor: brushColorRef.current,
        textureId: bitmapFillStyleRef.current.textureId,
      },
      {
        textureSource: resolveBitmapFillTextureSource(bitmapFillStyleRef.current.textureId),
      },
    );
    if (!didFill) {
      return;
    }
    ctx.putImageData(imageData, 0, 0);
    const loaded = await loadBitmapLayer(raster.toDataURL('image/png'), false);
    if (!loaded) return;
    saveHistory();
  }, [loadBitmapLayer, resolveBitmapFillTextureSource, saveHistory]);

  const switchEditorMode = useCallback(async (nextMode: CostumeEditorMode) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    if (editorModeRef.current === nextMode) return;

    const rasterizedCanvas = getActiveLayerCanvasElement();
    const rasterized = rasterizedCanvas.toDataURL('image/png');

    if (nextMode === 'bitmap') {
      const loaded = await loadBitmapLayer(rasterized, false);
      if (!loaded) return;
      setEditorMode('bitmap');
    } else {
      const loaded = await loadBitmapAsSingleVectorImage(rasterizedCanvas);
      if (!loaded) return;
      setEditorMode('vector');
    }

    saveHistory();
  }, [getActiveLayerCanvasElement, loadBitmapAsSingleVectorImage, loadBitmapLayer, saveHistory, setEditorMode]);

  const exportCostumeState = useCallback((sessionKey?: string | null): CostumeCanvasExportState | null => {
    if (typeof sessionKey !== 'undefined' && loadedSessionKeyRef.current !== sessionKey) {
      return null;
    }

    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return {
        activeLayerDataUrl: '',
        editorMode: editorModeRef.current,
      };
    }

    const activeLayerDataUrl = fabricCanvas.toCanvasElement(1).toDataURL('image/png');

    const mode = editorModeRef.current;
    if (mode === 'vector') {
      return {
        activeLayerDataUrl,
        editorMode: mode,
        vectorDocument: {
          engine: 'fabric',
          version: 1,
          fabricJson: JSON.stringify(fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS)),
        },
      };
    }

    return {
      activeLayerDataUrl,
      editorMode: mode,
    };
  }, []);

  const deleteSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current === 'bitmap') {
      return deleteBitmapFloatingSelection();
    }
    if (editorModeRef.current !== 'vector') return false;
    const deleted = deleteActiveCanvasSelection(fabricCanvas);
    if (!deleted) return false;
    saveHistory();
    return true;
  }, [deleteBitmapFloatingSelection, saveHistory]);

  const cloneFabricObject = useCallback(async (obj: any) => {
    if (!obj || typeof obj.clone !== 'function') {
      throw new Error('Object is not cloneable');
    }

    const maybePromise = obj.clone();
    if (maybePromise && typeof maybePromise.then === 'function') {
      return await maybePromise;
    }

    return await new Promise<any>((resolve) => {
      obj.clone((cloned: any) => resolve(cloned));
    });
  }, []);

  const duplicateSelection = useCallback(async (): Promise<boolean> => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current !== 'vector') return false;

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return false;
    if (isTextObject(activeObject) && (activeObject as any).isEditing) return false;

    const moveOffset = 20;
    const clones: any[] = [];

    if (isActiveSelectionObject(activeObject) && typeof activeObject.getObjects === 'function') {
      const selectedObjects = (activeObject.getObjects() as any[]).filter(Boolean);
      for (const selected of selectedObjects) {
        const cloned = await cloneFabricObject(selected);
        cloned.set({
          left: (typeof cloned.left === 'number' ? cloned.left : 0) + moveOffset,
          top: (typeof cloned.top === 'number' ? cloned.top : 0) + moveOffset,
        });
        fabricCanvas.add(cloned);
        clones.push(cloned);
      }
    } else {
      const cloned = await cloneFabricObject(activeObject);
      cloned.set({
        left: (typeof cloned.left === 'number' ? cloned.left : 0) + moveOffset,
        top: (typeof cloned.top === 'number' ? cloned.top : 0) + moveOffset,
      });
      fabricCanvas.add(cloned);
      clones.push(cloned);
    }

    if (clones.length === 0) return false;

    if (clones.length === 1) {
      fabricCanvas.setActiveObject(clones[0]);
    } else {
      const nextSelection = new ActiveSelection(clones, { canvas: fabricCanvas });
      fabricCanvas.setActiveObject(nextSelection);
    }

    fabricCanvas.requestRenderAll();
    saveHistory();
    return true;
  }, [cloneFabricObject, saveHistory]);

  const moveSelectionOrder = useCallback((action: MoveOrderAction): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current !== 'vector') return false;

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return false;
    if (isTextObject(activeObject) && (activeObject as any).isEditing) return false;

    const selectedObjects = isActiveSelectionObject(activeObject) && typeof activeObject.getObjects === 'function'
      ? (activeObject.getObjects() as any[]).filter(Boolean)
      : [activeObject];
    if (selectedObjects.length === 0) return false;

    const stack = fabricCanvas.getObjects();
    const withIndices = selectedObjects
      .map((obj) => ({ obj, index: stack.indexOf(obj) }))
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => a.index - b.index);
    if (withIndices.length === 0) return false;

    if (action === 'forward') {
      for (const entry of [...withIndices].reverse()) {
        fabricCanvas.bringObjectForward(entry.obj, false);
      }
    } else if (action === 'backward') {
      for (const entry of withIndices) {
        fabricCanvas.sendObjectBackwards(entry.obj, false);
      }
    } else if (action === 'front') {
      for (const entry of withIndices) {
        fabricCanvas.bringObjectToFront(entry.obj);
      }
    } else {
      for (const entry of [...withIndices].reverse()) {
        fabricCanvas.sendObjectToBack(entry.obj);
      }
    }

    fabricCanvas.requestRenderAll();
    saveHistory();
    return true;
  }, [saveHistory]);

  const flipSelection = useCallback((axis: SelectionFlipAxis): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const centerX = selectionSnapshot.bounds.left + selectionSnapshot.bounds.width / 2;
    const centerY = selectionSnapshot.bounds.top + selectionSnapshot.bounds.height / 2;
    const activeObject = fabricCanvas.getActiveObject() as any;
    const selectedObjects = selectionSnapshot.selectedObjects.filter(Boolean);
    if (selectedObjects.length === 0) {
      return false;
    }

    if (isActiveSelectionObject(activeObject)) {
      fabricCanvas.discardActiveObject();
    }

    let changed = false;
    for (const obj of selectedObjects) {
      if (typeof obj?.getCenterPoint !== 'function') {
        continue;
      }

      const currentCenter = obj.getCenterPoint();
      const nextCenter = new Point(
        axis === 'horizontal' ? centerX * 2 - currentCenter.x : currentCenter.x,
        axis === 'vertical' ? centerY * 2 - currentCenter.y : currentCenter.y,
      );
      const nextAngle = normalizeDegrees(-((typeof obj.angle === 'number' ? obj.angle : 0)));
      const currentFlipX = obj.flipX === true;
      const currentFlipY = obj.flipY === true;

      obj.set({
        angle: nextAngle,
        flipX: axis === 'horizontal' ? !currentFlipX : currentFlipX,
        flipY: axis === 'vertical' ? !currentFlipY : currentFlipY,
      });
      if (typeof obj.setPositionByOrigin === 'function') {
        obj.setPositionByOrigin(nextCenter, 'center', 'center');
      } else {
        obj.set({
          left: nextCenter.x,
          top: nextCenter.y,
          originX: 'center',
          originY: 'center',
        });
      }
      obj.setCoords?.();
      changed = true;
    }

    if (!changed) {
      return false;
    }

    restoreCanvasSelection(selectedObjects);
    fabricCanvas.requestRenderAll();
    syncSelectionState();
    saveHistory();
    return true;
  }, [getSelectionBoundsSnapshot, restoreCanvasSelection, saveHistory, syncSelectionState]);

  const rotateSelection = useCallback((): boolean => {
    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const centerX = selectionSnapshot.bounds.left + selectionSnapshot.bounds.width / 2;
    const centerY = selectionSnapshot.bounds.top + selectionSnapshot.bounds.height / 2;
    const transform = util.createRotateMatrix({ angle: 90 }, { x: centerX, y: centerY });
    return applySelectionTransform(transform);
  }, [applySelectionTransform, getSelectionBoundsSnapshot]);

  const alignSelection = useCallback((action: AlignAction): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const selectionSnapshot = getSelectionBoundsSnapshot();
    if (!selectionSnapshot) return false;

    const { selectionObject, selectedObjects, bounds } = selectionSnapshot;
    const minLeft = bounds.left;
    const minTop = bounds.top;
    const groupWidth = bounds.width;
    const groupHeight = bounds.height;

    let targetLeft = minLeft;
    let targetTop = minTop;
    if (action === 'left') {
      targetLeft = 0;
    } else if (action === 'center-x') {
      targetLeft = (CANVAS_SIZE - groupWidth) / 2;
    } else if (action === 'right') {
      targetLeft = CANVAS_SIZE - groupWidth;
    }

    if (action === 'top') {
      targetTop = 0;
    } else if (action === 'center-y') {
      targetTop = (CANVAS_SIZE - groupHeight) / 2;
    } else if (action === 'bottom') {
      targetTop = CANVAS_SIZE - groupHeight;
    }

    const dx = targetLeft - minLeft;
    const dy = targetTop - minTop;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return false;
    }

    for (const obj of selectedObjects) {
      obj.set({
        left: (typeof obj.left === 'number' ? obj.left : 0) + dx,
        top: (typeof obj.top === 'number' ? obj.top : 0) + dy,
      });
      obj.setCoords?.();
    }

    if (selectionObject.setCoords) {
      selectionObject.setCoords();
    }
    fabricCanvas.requestRenderAll();
    saveHistory();
    syncSelectionState();
    return true;
  }, [getSelectionBoundsSnapshot, saveHistory, syncSelectionState]);

  const isTextEditing = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'vector') return false;
    const activeObject = fabricCanvas.getActiveObject() as any;
    return !!activeObject && isTextObject(activeObject) && !!(activeObject as any).isEditing;
  }, []);

  const loadDocument = useCallback(async (sessionKey: string, costumeDocument: CostumeDocument) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const requestId = ++loadRequestIdRef.current;
    loadedSessionKeyRef.current = null;

    const requestedState = resolveActiveCostumeLayerEditorLoadState(costumeDocument);
    if (requestedState.editorMode === 'vector') {
      const requestedVectorDocument = requestedState.vectorDocument ?? createEmptyCostumeVectorDocument();
      try {
        const parsed = JSON.parse(requestedVectorDocument.fabricJson);
        suppressHistoryRef.current = true;
        fabricCanvas.clear();
        await fabricCanvas.loadFromJSON(parsed);
        normalizeCanvasVectorStrokeUniform();
        if (!isLoadRequestActive(requestId)) return;
        fabricCanvas.requestRenderAll();
        setEditorMode('vector');
      } catch (error) {
        console.warn('Invalid vector document. Loading an empty active vector layer instead.', error);
        suppressHistoryRef.current = true;
        try {
          fabricCanvas.clear();
          if (!isLoadRequestActive(requestId)) return;
          fabricCanvas.requestRenderAll();
          setEditorMode('vector');
        } finally {
          suppressHistoryRef.current = false;
        }
      } finally {
        suppressHistoryRef.current = false;
      }
    } else {
      const loaded = await loadBitmapLayer(requestedState.bitmapAssetId ?? '', false, requestId);
      if (!loaded || !isLoadRequestActive(requestId)) {
        const resetToBlank = await loadBitmapLayer('', false, requestId);
        if (!resetToBlank || !isLoadRequestActive(requestId)) return;
      }
      setEditorMode('bitmap');
    }

    if (!isLoadRequestActive(requestId)) return;
    loadedSessionKeyRef.current = sessionKey;
    lastCommittedSnapshotRef.current = null;
    saveHistory();
    markCurrentSnapshotPersisted(sessionKey);
  }, [isLoadRequestActive, loadBitmapLayer, markCurrentSnapshotPersisted, normalizeCanvasVectorStrokeUniform, saveHistory, setEditorMode]);

  const restoreOriginalControls = useCallback((obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    const original = originalControlsRef.current.get(obj);
    if (original) {
      obj.controls = original;
      originalControlsRef.current.delete(obj);
    }
    if (typeof obj.setCoords === 'function') {
      obj.setCoords();
    }
  }, []);

  const restoreAllOriginalControls = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    fabricCanvas.forEachObject((obj: any) => restoreOriginalControls(obj));
  }, [restoreOriginalControls]);

  const toCanvasPoint = useCallback((obj: any, x: number, y: number) => {
    const matrix = typeof obj?.calcTransformMatrix === 'function' ? obj.calcTransformMatrix() : null;
    if (!matrix) return new Point(x, y);
    return new Point(x, y).transform(matrix);
  }, []);

  const isNearlyEqual = useCallback((a: number, b: number) => Math.abs(a - b) <= 0.0001, []);

  const getPathCommands = useCallback((pathObj: any) => {
    if (!pathObj || !Array.isArray(pathObj.path)) return [] as any[];
    return pathObj.path as any[];
  }, []);

  const getCommandType = useCallback((command: any): string => {
    if (!Array.isArray(command) || typeof command[0] !== 'string') return '';
    return command[0].toUpperCase();
  }, []);

  const getCommandEndpoint = useCallback((command: any): Point | null => {
    if (!Array.isArray(command) || command.length < 3) return null;
    const x = Number(command[command.length - 2]);
    const y = Number(command[command.length - 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return new Point(x, y);
  }, []);

  const getLastDrawableCommandIndex = useCallback((pathObj: any): number => {
    const commands = getPathCommands(pathObj);
    for (let i = commands.length - 1; i >= 0; i -= 1) {
      if (getCommandType(commands[i]) !== 'Z') {
        return i;
      }
    }
    return -1;
  }, [getCommandType, getPathCommands]);

  const isClosedPath = useCallback((pathObj: any): boolean => {
    const commands = getPathCommands(pathObj);
    if (commands.length === 0) return false;
    if (commands.some((command) => getCommandType(command) === 'Z')) return true;
    const start = getCommandEndpoint(commands[0]);
    const lastIndex = getLastDrawableCommandIndex(pathObj);
    const end = lastIndex >= 0 ? getCommandEndpoint(commands[lastIndex]) : null;
    if (!start || !end) return false;
    return isNearlyEqual(start.x, end.x) && isNearlyEqual(start.y, end.y);
  }, [getCommandEndpoint, getCommandType, getLastDrawableCommandIndex, getPathCommands, isNearlyEqual]);

  const normalizeAnchorIndex = useCallback((pathObj: any, anchorIndex: number): number => {
    if (anchorIndex <= 0) return 0;
    const commands = getPathCommands(pathObj);
    if (!commands[anchorIndex]) return anchorIndex;
    const closed = isClosedPath(pathObj);
    if (!closed) return anchorIndex;
    const lastDrawable = getLastDrawableCommandIndex(pathObj);
    if (anchorIndex !== lastDrawable) return anchorIndex;
    const start = getCommandEndpoint(commands[0]);
    const end = getCommandEndpoint(commands[anchorIndex]);
    if (!start || !end) return anchorIndex;
    if (isNearlyEqual(start.x, end.x) && isNearlyEqual(start.y, end.y)) {
      return 0;
    }
    return anchorIndex;
  }, [getCommandEndpoint, getLastDrawableCommandIndex, getPathCommands, isClosedPath, isNearlyEqual]);

  const getPathNodeHandleTypes = useCallback((pathObj: any): Record<string, VectorPathNodeHandleType> => {
    const raw = pathObj?.nodeHandleTypes;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, VectorPathNodeHandleType> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === 'linear' || value === 'corner' || value === 'smooth' || value === 'symmetric') {
        out[key] = value;
      }
    }
    return out;
  }, []);

  const setPathNodeHandleType = useCallback((pathObj: any, anchorIndex: number, type: VectorPathNodeHandleType) => {
    const normalized = normalizeAnchorIndex(pathObj, anchorIndex);
    const next = getPathNodeHandleTypes(pathObj);
    next[String(normalized)] = type;
    pathObj.set?.('nodeHandleTypes', next);
  }, [getPathNodeHandleTypes, normalizeAnchorIndex]);

  const getPathNodeHandleType = useCallback((pathObj: any, anchorIndex: number): VectorPathNodeHandleType | null => {
    const normalized = normalizeAnchorIndex(pathObj, anchorIndex);
    const map = getPathNodeHandleTypes(pathObj);
    return map[String(normalized)] ?? null;
  }, [getPathNodeHandleTypes, normalizeAnchorIndex]);

  const findPreviousDrawableCommandIndex = useCallback((pathObj: any, commandIndex: number): number => {
    const commands = getPathCommands(pathObj);
    for (let i = commandIndex - 1; i >= 0; i -= 1) {
      if (getCommandType(commands[i]) !== 'Z') return i;
    }
    if (isClosedPath(pathObj)) {
      for (let i = commands.length - 1; i >= 0; i -= 1) {
        if (getCommandType(commands[i]) !== 'Z') return i;
      }
    }
    return 0;
  }, [getCommandType, getPathCommands, isClosedPath]);

  const findNextDrawableCommandIndex = useCallback((pathObj: any, commandIndex: number): number => {
    const commands = getPathCommands(pathObj);
    for (let i = commandIndex + 1; i < commands.length; i += 1) {
      if (getCommandType(commands[i]) !== 'Z') return i;
    }
    if (isClosedPath(pathObj)) {
      for (let i = 0; i < commands.length; i += 1) {
        if (getCommandType(commands[i]) !== 'Z') return i;
      }
    }
    return commandIndex;
  }, [getCommandType, getPathCommands, isClosedPath]);

  const getAnchorPointForIndex = useCallback((pathObj: any, anchorIndex: number): Point | null => {
    const commands = getPathCommands(pathObj);
    if (!commands[anchorIndex]) return null;
    return getCommandEndpoint(commands[anchorIndex]);
  }, [getCommandEndpoint, getPathCommands]);

  const findIncomingCubicCommandIndex = useCallback((pathObj: any, anchorIndex: number): number => {
    const commands = getPathCommands(pathObj);
    let found = -1;
    for (let i = 0; i < commands.length; i += 1) {
      if (getCommandType(commands[i]) !== 'C') continue;
      const normalized = normalizeAnchorIndex(pathObj, i);
      if (normalized === anchorIndex) {
        found = i;
      }
    }
    return found;
  }, [getCommandType, getPathCommands, normalizeAnchorIndex]);

  const findOutgoingCubicCommandIndex = useCallback((pathObj: any, anchorIndex: number): number => {
    const commands = getPathCommands(pathObj);
    for (let i = 0; i < commands.length; i += 1) {
      if (getCommandType(commands[i]) !== 'C') continue;
      const previousIndex = findPreviousDrawableCommandIndex(pathObj, i);
      const normalizedPrevious = normalizeAnchorIndex(pathObj, previousIndex);
      if (normalizedPrevious === anchorIndex) {
        return i;
      }
    }
    return -1;
  }, [findPreviousDrawableCommandIndex, getCommandType, getPathCommands, normalizeAnchorIndex]);

  const parsePathControlKey = useCallback((key: string): { commandIndex: number; changed: 'anchor' | 'incoming' | 'outgoing' } | null => {
    const cp1 = /^c_(\d+)_C_CP_1$/i.exec(key);
    if (cp1) {
      return { commandIndex: Number(cp1[1]), changed: 'outgoing' };
    }
    const cp2 = /^c_(\d+)_C_CP_2$/i.exec(key);
    if (cp2) {
      return { commandIndex: Number(cp2[1]), changed: 'incoming' };
    }
    const anchor = /^c_(\d+)_/i.exec(key);
    if (anchor) {
      return { commandIndex: Number(anchor[1]), changed: 'anchor' };
    }
    return null;
  }, []);

  const resolveAnchorFromPathControlKey = useCallback((pathObj: any, key: string): { anchorIndex: number; changed: 'anchor' | 'incoming' | 'outgoing' } | null => {
    const parsed = parsePathControlKey(key);
    if (!parsed) return null;
    if (parsed.changed === 'incoming' || parsed.changed === 'anchor') {
      return {
        anchorIndex: normalizeAnchorIndex(pathObj, parsed.commandIndex),
        changed: parsed.changed,
      };
    }
    const previousIndex = findPreviousDrawableCommandIndex(pathObj, parsed.commandIndex);
    return {
      anchorIndex: normalizeAnchorIndex(pathObj, previousIndex),
      changed: 'outgoing',
    };
  }, [findPreviousDrawableCommandIndex, normalizeAnchorIndex, parsePathControlKey]);

  const isPointSelectionToggleModifierPressed = useCallback((eventData: any) => {
    const source = eventData?.e ?? eventData;
    return !!(source?.shiftKey || source?.metaKey || source?.ctrlKey);
  }, []);

  const getSelectedPathAnchorIndices = useCallback((pathObj: any): number[] => {
    if (!pathObj || pathObj !== vectorPointEditingTargetRef.current) {
      return [];
    }

    return Array.from(
      new Set(
        selectedPathAnchorIndicesRef.current
          .map((anchorIndex) => normalizeAnchorIndex(pathObj, anchorIndex))
          .filter((anchorIndex) => Number.isFinite(anchorIndex)),
      ),
    ).sort((a, b) => a - b);
  }, [normalizeAnchorIndex]);

  const getSelectablePathAnchorIndices = useCallback((pathObj: any): number[] => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path') return [];

    const commands = getPathCommands(pathObj);
    const seen = new Set<number>();
    const anchorIndices: number[] = [];
    commands.forEach((command, commandIndex) => {
      if (getCommandType(command) === 'Z') return;
      if (!getCommandEndpoint(command)) return;
      const normalizedAnchorIndex = normalizeAnchorIndex(pathObj, commandIndex);
      if (seen.has(normalizedAnchorIndex)) return;
      seen.add(normalizedAnchorIndex);
      anchorIndices.push(normalizedAnchorIndex);
    });

    return anchorIndices.sort((a, b) => a - b);
  }, [getCommandEndpoint, getCommandType, getPathCommands, normalizeAnchorIndex]);

  const getSceneRectFromPoints = useCallback((startPoint: Point, endPoint: Point) => {
    const left = Math.min(startPoint.x, endPoint.x);
    const top = Math.min(startPoint.y, endPoint.y);
    const right = Math.max(startPoint.x, endPoint.x);
    const bottom = Math.max(startPoint.y, endPoint.y);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }, []);

  const getPointSelectionKey = useCallback((anchorIndices: number[]) => (
    anchorIndices.join(',')
  ), []);

  const getPointSelectionTransformAxes = useCallback((rotationRadians: number) => {
    const cos = Math.cos(rotationRadians);
    const sin = Math.sin(rotationRadians);
    return {
      x: new Point(cos, sin),
      y: new Point(-sin, cos),
    };
  }, []);

  const toPointSelectionTransformLocalPoint = useCallback((
    bounds: PointSelectionTransformBounds,
    point: Point,
  ) => {
    const axes = getPointSelectionTransformAxes(bounds.rotationRadians);
    const dx = point.x - bounds.center.x;
    const dy = point.y - bounds.center.y;
    return new Point(
      dx * axes.x.x + dy * axes.x.y,
      dx * axes.y.x + dy * axes.y.y,
    );
  }, [getPointSelectionTransformAxes]);

  const toPointSelectionTransformScenePoint = useCallback((
    bounds: PointSelectionTransformBounds,
    point: Point,
  ) => {
    const axes = getPointSelectionTransformAxes(bounds.rotationRadians);
    return new Point(
      bounds.center.x + axes.x.x * point.x + axes.y.x * point.y,
      bounds.center.y + axes.x.y * point.x + axes.y.y * point.y,
    );
  }, [getPointSelectionTransformAxes]);

  const createPointSelectionTransformBounds = useCallback((
    points: Point[],
    rotationRadians: number,
  ): PointSelectionTransformBounds | null => {
    if (points.length < 2) {
      return null;
    }

    const normalizedRotation = normalizeRadians(rotationRadians);
    const axes = getPointSelectionTransformAxes(normalizedRotation);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of points) {
      const projectionX = point.x * axes.x.x + point.y * axes.x.y;
      const projectionY = point.x * axes.y.x + point.y * axes.y.y;
      minX = Math.min(minX, projectionX);
      maxX = Math.max(maxX, projectionX);
      minY = Math.min(minY, projectionY);
      maxY = Math.max(maxY, projectionY);
    }

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const center = new Point(
      axes.x.x * ((minX + maxX) / 2) + axes.y.x * ((minY + maxY) / 2),
      axes.x.y * ((minX + maxX) / 2) + axes.y.y * ((minY + maxY) / 2),
    );

    return {
      center,
      width,
      height,
      rotationRadians: normalizedRotation,
      topLeft: new Point(
        center.x - axes.x.x * halfWidth - axes.y.x * halfHeight,
        center.y - axes.x.y * halfWidth - axes.y.y * halfHeight,
      ),
      topRight: new Point(
        center.x + axes.x.x * halfWidth - axes.y.x * halfHeight,
        center.y + axes.x.y * halfWidth - axes.y.y * halfHeight,
      ),
      bottomRight: new Point(
        center.x + axes.x.x * halfWidth + axes.y.x * halfHeight,
        center.y + axes.x.y * halfWidth + axes.y.y * halfHeight,
      ),
      bottomLeft: new Point(
        center.x - axes.x.x * halfWidth + axes.y.x * halfHeight,
        center.y - axes.x.y * halfWidth + axes.y.y * halfHeight,
      ),
    };
  }, [getPointSelectionTransformAxes]);

  const hasPointSelectionMarqueeExceededThreshold = useCallback((session: PointSelectionMarqueeSession) => {
    const threshold = getZoomInvariantMetric(VECTOR_POINT_MARQUEE_DRAG_THRESHOLD_PX);
    return Math.hypot(
      session.currentPointerScene.x - session.startPointerScene.x,
      session.currentPointerScene.y - session.startPointerScene.y,
    ) >= threshold;
  }, [getZoomInvariantMetric]);

  const syncVectorHandleModeFromSelection = useCallback(() => {
    const activeAnchor = activePathAnchorRef.current;
    if (!activeAnchor || getFabricObjectType(activeAnchor.path) !== 'path') return;
    const selectedAnchorIndices = getSelectedPathAnchorIndices(activeAnchor.path);
    const targetAnchorIndices = selectedAnchorIndices.length > 0
      ? selectedAnchorIndices
      : [activeAnchor.anchorIndex];

    const handleModes = new Set<VectorHandleMode>();
    for (const anchorIndex of targetAnchorIndices) {
      handleModes.add(pathNodeHandleTypeToVectorHandleMode(
        getPathNodeHandleType(activeAnchor.path, anchorIndex) ?? 'linear',
      ));
    }

    const syncedMode = handleModes.size > 1
      ? 'multiple'
      : Array.from(handleModes)[0] ?? 'linear';
    pendingSelectionSyncedVectorHandleModeRef.current = syncedMode;
    onVectorHandleModeSyncRef.current?.(syncedMode);
  }, [getPathNodeHandleType, getSelectedPathAnchorIndices]);

  const syncPathControlPointVisibility = useCallback((pathObj: any) => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path' || !pathObj.controls) return;

    const selectedAnchors = new Set(getSelectedPathAnchorIndices(pathObj));
    for (const [key, control] of Object.entries(pathObj.controls as Record<string, Control>)) {
      const resolved = resolveAnchorFromPathControlKey(pathObj, key);
      if (!resolved) continue;

      const isControlPoint = resolved.changed === 'incoming' || resolved.changed === 'outgoing';
      let visible = true;
      if (isControlPoint) {
        const handleType = getPathNodeHandleType(pathObj, resolved.anchorIndex) ?? 'linear';
        const isCurvedHandleType = handleType === 'smooth' || handleType === 'symmetric' || handleType === 'corner';
        const commandIndex = resolved.changed === 'incoming'
          ? findIncomingCubicCommandIndex(pathObj, resolved.anchorIndex)
          : findOutgoingCubicCommandIndex(pathObj, resolved.anchorIndex);
        visible = selectedAnchors.has(resolved.anchorIndex) && isCurvedHandleType && commandIndex >= 0;
      }

      if (typeof pathObj.setControlVisible === 'function') {
        pathObj.setControlVisible(key, visible);
      } else {
        (control as any).visible = visible;
      }
    }
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getPathNodeHandleType,
    getSelectedPathAnchorIndices,
    resolveAnchorFromPathControlKey,
  ]);

  const syncPathAnchorSelectionAppearance = useCallback((pathObj: any) => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path' || !pathObj.controls) return;

    const selectedAnchors = new Set(getSelectedPathAnchorIndices(pathObj));
    for (const [key, control] of Object.entries(pathObj.controls as Record<string, Control>)) {
      const resolved = resolveAnchorFromPathControlKey(pathObj, key);
      if (!resolved || resolved.changed !== 'anchor') continue;

      const isSelected = selectedAnchors.has(resolved.anchorIndex);
      (control as any).controlFill = isSelected ? '#0ea5e9' : '#ffffff';
      (control as any).controlStroke = isSelected ? '#ffffff' : '#0ea5e9';
    }
  }, [getSelectedPathAnchorIndices, resolveAnchorFromPathControlKey]);

  const setSelectedPathAnchors = useCallback((
    pathObj: any,
    anchorIndices: number[],
    options: { primaryAnchorIndex?: number | null } = {},
  ) => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path') return;

    const normalized = Array.from(
      new Set(
        anchorIndices
          .map((anchorIndex) => normalizeAnchorIndex(pathObj, anchorIndex))
          .filter((anchorIndex) => Number.isFinite(anchorIndex)),
      ),
    ).sort((a, b) => a - b);

    const selectionKey = getPointSelectionKey(normalized);
    const currentTransformFrame = pointSelectionTransformFrameRef.current;
    if (normalized.length < 2) {
      pointSelectionTransformFrameRef.current = null;
    } else if (
      !currentTransformFrame ||
      currentTransformFrame.path !== pathObj ||
      currentTransformFrame.selectionKey !== selectionKey
    ) {
      pointSelectionTransformFrameRef.current = {
        path: pathObj,
        selectionKey,
        rotationRadians: 0,
      };
    }

    selectedPathAnchorIndicesRef.current = normalized;
    if (normalized.length === 0) {
      activePathAnchorRef.current = null;
      pendingSelectionSyncedVectorHandleModeRef.current = null;
    } else {
      const requestedPrimary = options.primaryAnchorIndex == null
        ? null
        : normalizeAnchorIndex(pathObj, options.primaryAnchorIndex);
      const currentActiveAnchor = activePathAnchorRef.current;
      const preservedPrimary = currentActiveAnchor &&
        currentActiveAnchor.path === pathObj &&
        normalized.includes(currentActiveAnchor.anchorIndex)
        ? currentActiveAnchor.anchorIndex
        : null;
      const primaryAnchorIndex = requestedPrimary != null && normalized.includes(requestedPrimary)
        ? requestedPrimary
        : preservedPrimary ?? normalized[normalized.length - 1];
      activePathAnchorRef.current = { path: pathObj, anchorIndex: primaryAnchorIndex };
    }

    syncPathAnchorSelectionAppearance(pathObj);
    syncPathControlPointVisibility(pathObj);
    if (normalized.length > 0) {
      syncVectorHandleModeFromSelection();
    }
    onVectorPointSelectionChangeRef.current?.(normalized.length > 0);
    pathObj.setCoords?.();
    fabricCanvasRef.current?.requestRenderAll();
  }, [getPointSelectionKey, normalizeAnchorIndex, syncPathAnchorSelectionAppearance, syncPathControlPointVisibility, syncVectorHandleModeFromSelection]);

  const clearSelectedPathAnchors = useCallback((pathObj?: any) => {
    selectedPathAnchorIndicesRef.current = [];
    activePathAnchorRef.current = null;
    pointSelectionTransformFrameRef.current = null;
    pendingSelectionSyncedVectorHandleModeRef.current = null;
    onVectorPointSelectionChangeRef.current?.(false);
    if (pathObj && getFabricObjectType(pathObj) === 'path') {
      syncPathAnchorSelectionAppearance(pathObj);
      syncPathControlPointVisibility(pathObj);
      pathObj.setCoords?.();
    }
    fabricCanvasRef.current?.requestRenderAll();
  }, [syncPathAnchorSelectionAppearance, syncPathControlPointVisibility]);

  const removeDuplicateClosedPathAnchorControl = useCallback((pathObj: any, controls: Record<string, Control>) => {
    if (!isClosedPath(pathObj)) return;
    const commands = getPathCommands(pathObj);
    if (commands.length === 0) return;
    const lastDrawable = getLastDrawableCommandIndex(pathObj);
    if (lastDrawable <= 0) return;

    const start = getCommandEndpoint(commands[0]);
    const end = getCommandEndpoint(commands[lastDrawable]);
    if (!start || !end) return;
    if (!isNearlyEqual(start.x, end.x) || !isNearlyEqual(start.y, end.y)) return;

    const commandType = getCommandType(commands[lastDrawable]);
    if (!commandType) return;
    delete controls[`c_${lastDrawable}_${commandType}`];
  }, [
    getCommandEndpoint,
    getCommandType,
    getLastDrawableCommandIndex,
    getPathCommands,
    isClosedPath,
    isNearlyEqual,
  ]);

  const clonePoint = useCallback((point: Point | null): Point | null => {
    if (!point) return null;
    return new Point(point.x, point.y);
  }, []);

  const lerpPoint = useCallback((a: Point, b: Point, t: number) => (
    new Point(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
    )
  ), []);

  const distanceSqBetweenPoints = useCallback((a: Point, b: Point) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }, []);

  const getScenePointFromOwnPlanePoint = useCallback((obj: any, point: Point): Point | null => {
    if (!obj || !point || typeof obj.calcOwnMatrix !== 'function') return null;
    return point.transform(obj.calcOwnMatrix());
  }, []);

  const invertOwnPlanePoint = useCallback((obj: any, point: Point): Point | null => {
    if (!obj || !point || typeof obj.calcOwnMatrix !== 'function') return null;
    const [a, b, c, d, e, f] = obj.calcOwnMatrix() as [number, number, number, number, number, number];
    const determinant = a * d - b * c;
    if (Math.abs(determinant) <= 0.0000001) return null;
    const nextX = point.x - e;
    const nextY = point.y - f;
    return new Point(
      (d * nextX - c * nextY) / determinant,
      (-b * nextX + a * nextY) / determinant,
    );
  }, []);

  const toPathScenePoint = useCallback((pathObj: any, point: Point): Point | null => {
    if (!pathObj?.pathOffset) return null;
    return getScenePointFromOwnPlanePoint(
      pathObj,
      new Point(point.x - pathObj.pathOffset.x, point.y - pathObj.pathOffset.y),
    );
  }, [getScenePointFromOwnPlanePoint]);

  const toPathCommandPoint = useCallback((pathObj: any, scenePoint: Point): Point | null => {
    if (!pathObj?.pathOffset) return null;
    const ownPlanePoint = invertOwnPlanePoint(pathObj, scenePoint);
    if (!ownPlanePoint) return null;
    return ownPlanePoint.add(pathObj.pathOffset);
  }, [invertOwnPlanePoint]);

  const findClosestPointOnLineSegment = useCallback((point: Point, start: Point, end: Point) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 0.0000001) {
      return { t: 0, point: new Point(start.x, start.y), distanceSq: distanceSqBetweenPoints(point, start) };
    }
    const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
    const t = Math.max(0, Math.min(1, rawT));
    const nearest = lerpPoint(start, end, t);
    return { t, point: nearest, distanceSq: distanceSqBetweenPoints(point, nearest) };
  }, [distanceSqBetweenPoints, lerpPoint]);

  const evaluateQuadraticPoint = useCallback((p0: Point, p1: Point, p2: Point, t: number) => {
    const a = lerpPoint(p0, p1, t);
    const b = lerpPoint(p1, p2, t);
    return lerpPoint(a, b, t);
  }, [lerpPoint]);

  const evaluateCubicPoint = useCallback((p0: Point, p1: Point, p2: Point, p3: Point, t: number) => {
    const a = lerpPoint(p0, p1, t);
    const b = lerpPoint(p1, p2, t);
    const c = lerpPoint(p2, p3, t);
    const d = lerpPoint(a, b, t);
    const e = lerpPoint(b, c, t);
    return lerpPoint(d, e, t);
  }, [lerpPoint]);

  const findClosestCurveSample = useCallback((
    point: Point,
    evaluate: (t: number) => Point,
  ) => {
    const coarseSteps = 24;
    let bestT = 0;
    let bestPoint = evaluate(0);
    let bestDistanceSq = distanceSqBetweenPoints(point, bestPoint);

    for (let index = 1; index <= coarseSteps; index += 1) {
      const t = index / coarseSteps;
      const candidate = evaluate(t);
      const candidateDistanceSq = distanceSqBetweenPoints(point, candidate);
      if (candidateDistanceSq < bestDistanceSq) {
        bestT = t;
        bestPoint = candidate;
        bestDistanceSq = candidateDistanceSq;
      }
    }

    let minT = Math.max(0, bestT - 1 / coarseSteps);
    let maxT = Math.min(1, bestT + 1 / coarseSteps);
    for (let refinement = 0; refinement < 5; refinement += 1) {
      const refineSteps = 12;
      for (let index = 0; index <= refineSteps; index += 1) {
        const t = minT + ((maxT - minT) * index) / refineSteps;
        const candidate = evaluate(t);
        const candidateDistanceSq = distanceSqBetweenPoints(point, candidate);
        if (candidateDistanceSq < bestDistanceSq) {
          bestT = t;
          bestPoint = candidate;
          bestDistanceSq = candidateDistanceSq;
        }
      }
      const nextSpan = (maxT - minT) / refineSteps;
      minT = Math.max(0, bestT - nextSpan);
      maxT = Math.min(1, bestT + nextSpan);
    }

    return { t: bestT, point: bestPoint, distanceSq: bestDistanceSq };
  }, [distanceSqBetweenPoints]);

  const toParentPlanePoint = useCallback((pathObj: any, point: Point): Point | null => {
    if (!pathObj || !point || !pathObj.pathOffset || typeof pathObj.calcOwnMatrix !== 'function') return null;
    return new Point(point.x - pathObj.pathOffset.x, point.y - pathObj.pathOffset.y).transform(pathObj.calcOwnMatrix());
  }, []);

  const getPathSegments = useCallback((pathObj: any) => {
    const commands = getPathCommands(pathObj);
    const segments: Array<{
      commandIndex: number;
      type: 'L' | 'Q' | 'C' | 'Z';
      start: Point;
      end: Point;
      control1?: Point;
      control2?: Point;
    }> = [];

    if (commands.length === 0) return segments;

    let subpathStart = getCommandEndpoint(commands[0]);
    let previousPoint = subpathStart;
    for (let commandIndex = 1; commandIndex < commands.length; commandIndex += 1) {
      const command = commands[commandIndex];
      const type = getCommandType(command);
      if (type === 'M') {
        subpathStart = getCommandEndpoint(command);
        previousPoint = subpathStart;
        continue;
      }
      if (!previousPoint) continue;
      if (type === 'L') {
        const end = getCommandEndpoint(command);
        if (!end) continue;
        segments.push({ commandIndex, type: 'L', start: previousPoint, end });
        previousPoint = end;
        continue;
      }
      if (type === 'Q') {
        const end = getCommandEndpoint(command);
        if (!end) continue;
        segments.push({
          commandIndex,
          type: 'Q',
          start: previousPoint,
          control1: new Point(Number(command[1]), Number(command[2])),
          end,
        });
        previousPoint = end;
        continue;
      }
      if (type === 'C') {
        const end = getCommandEndpoint(command);
        if (!end) continue;
        segments.push({
          commandIndex,
          type: 'C',
          start: previousPoint,
          control1: new Point(Number(command[1]), Number(command[2])),
          control2: new Point(Number(command[3]), Number(command[4])),
          end,
        });
        previousPoint = end;
        continue;
      }
      if (type === 'Z' && subpathStart) {
        segments.push({
          commandIndex,
          type: 'Z',
          start: previousPoint,
          end: subpathStart,
        });
        previousPoint = subpathStart;
      }
    }

    return segments;
  }, [getCommandEndpoint, getCommandType, getPathCommands]);

  const buildShiftedPathNodeHandleTypes = useCallback((
    pathObj: any,
    fromIndex: number,
    delta: number,
  ) => {
    const next: Record<string, VectorPathNodeHandleType> = {};
    for (const [key, value] of Object.entries(getPathNodeHandleTypes(pathObj))) {
      const numericKey = Number(key);
      if (!Number.isFinite(numericKey)) continue;
      next[String(numericKey >= fromIndex ? numericKey + delta : numericKey)] = value;
    }
    return next;
  }, [getPathNodeHandleTypes]);

  const buildLinearCubicSegmentCommand = useCallback((start: Point, end: Point) => {
    const control1 = lerpPoint(start, end, 1 / 3);
    const control2 = lerpPoint(start, end, 2 / 3);
    return ['C', control1.x, control1.y, control2.x, control2.y, end.x, end.y] as const;
  }, [lerpPoint]);

  const insertPathPointAtScenePosition = useCallback((pathObj: any, scenePoint: Point): number | null => {
    const commands = getPathCommands(pathObj);
    if (commands.length < 2) return null;

    const sceneScale = Math.max(0.0001, BASE_VIEW_SCALE * zoomRef.current);
    const hitRadius = VECTOR_POINT_INSERTION_HIT_RADIUS_PX / sceneScale;
    const endpointClearance = VECTOR_POINT_INSERTION_ENDPOINT_RADIUS_PX / sceneScale;
    const hitRadiusSq = hitRadius * hitRadius;
    const endpointClearanceSq = endpointClearance * endpointClearance;

    let bestCandidate: {
      commandIndex: number;
      type: 'L' | 'Q' | 'C' | 'Z';
      t: number;
      scenePoint: Point;
      distanceSq: number;
      start: Point;
      end: Point;
      control1?: Point;
      control2?: Point;
    } | null = null;

    for (const segment of getPathSegments(pathObj)) {
      const startScene = toPathScenePoint(pathObj, segment.start);
      const endScene = toPathScenePoint(pathObj, segment.end);
      if (!startScene || !endScene) continue;

      let candidate: { t: number; point: Point; distanceSq: number } | null = null;
      if (segment.type === 'L' || segment.type === 'Z') {
        candidate = findClosestPointOnLineSegment(scenePoint, startScene, endScene);
      } else if (segment.type === 'Q' && segment.control1) {
        const controlScene = toPathScenePoint(pathObj, segment.control1);
        if (!controlScene) continue;
        candidate = findClosestCurveSample(
          scenePoint,
          (t) => evaluateQuadraticPoint(startScene, controlScene, endScene, t),
        );
      } else if (segment.type === 'C' && segment.control1 && segment.control2) {
        const control1Scene = toPathScenePoint(pathObj, segment.control1);
        const control2Scene = toPathScenePoint(pathObj, segment.control2);
        if (!control1Scene || !control2Scene) continue;
        candidate = findClosestCurveSample(
          scenePoint,
          (t) => evaluateCubicPoint(startScene, control1Scene, control2Scene, endScene, t),
        );
      }

      if (!candidate) continue;
      if (candidate.distanceSq > hitRadiusSq) continue;
      if (candidate.t <= 0.001 || candidate.t >= 0.999) continue;
      if (
        distanceSqBetweenPoints(candidate.point, startScene) <= endpointClearanceSq ||
        distanceSqBetweenPoints(candidate.point, endScene) <= endpointClearanceSq
      ) {
        continue;
      }
      if (!bestCandidate || candidate.distanceSq < bestCandidate.distanceSq) {
        bestCandidate = {
          commandIndex: segment.commandIndex,
          type: segment.type,
          t: candidate.t,
          scenePoint: candidate.point,
          distanceSq: candidate.distanceSq,
          start: segment.start,
          end: segment.end,
          control1: segment.control1,
          control2: segment.control2,
        };
      }
    }

    if (!bestCandidate) return null;

    const insertedCommandPoint = toPathCommandPoint(pathObj, bestCandidate.scenePoint);
    if (!insertedCommandPoint) return null;

    const nextCommands = commands.map((command) => (Array.isArray(command) ? [...command] : command));
    const insertIndex = bestCandidate.commandIndex;
    if (bestCandidate.type === 'L') {
      nextCommands[insertIndex] = [...buildLinearCubicSegmentCommand(bestCandidate.start, insertedCommandPoint)];
      nextCommands.splice(insertIndex + 1, 0, [...buildLinearCubicSegmentCommand(insertedCommandPoint, bestCandidate.end)]);
    } else if (bestCandidate.type === 'Z') {
      nextCommands.splice(
        insertIndex,
        1,
        [...buildLinearCubicSegmentCommand(bestCandidate.start, insertedCommandPoint)],
        [...buildLinearCubicSegmentCommand(insertedCommandPoint, bestCandidate.end)],
        ['Z'],
      );
    } else if (bestCandidate.type === 'Q' && bestCandidate.control1) {
      const firstControl = lerpPoint(bestCandidate.start, bestCandidate.control1, bestCandidate.t);
      const secondControl = lerpPoint(bestCandidate.control1, bestCandidate.end, bestCandidate.t);
      const insertedPoint = lerpPoint(firstControl, secondControl, bestCandidate.t);
      nextCommands[insertIndex] = ['Q', firstControl.x, firstControl.y, insertedPoint.x, insertedPoint.y];
      nextCommands.splice(insertIndex + 1, 0, ['Q', secondControl.x, secondControl.y, bestCandidate.end.x, bestCandidate.end.y]);
    } else if (bestCandidate.type === 'C' && bestCandidate.control1 && bestCandidate.control2) {
      const p01 = lerpPoint(bestCandidate.start, bestCandidate.control1, bestCandidate.t);
      const p12 = lerpPoint(bestCandidate.control1, bestCandidate.control2, bestCandidate.t);
      const p23 = lerpPoint(bestCandidate.control2, bestCandidate.end, bestCandidate.t);
      const p012 = lerpPoint(p01, p12, bestCandidate.t);
      const p123 = lerpPoint(p12, p23, bestCandidate.t);
      const insertedPoint = lerpPoint(p012, p123, bestCandidate.t);
      nextCommands[insertIndex] = ['C', p01.x, p01.y, p012.x, p012.y, insertedPoint.x, insertedPoint.y];
      nextCommands.splice(insertIndex + 1, 0, ['C', p123.x, p123.y, p23.x, p23.y, bestCandidate.end.x, bestCandidate.end.y]);
    } else {
      return null;
    }

    const centerPoint = typeof pathObj.getCenterPoint === 'function'
      ? pathObj.getCenterPoint()
      : null;
    const nextHandleTypes = buildShiftedPathNodeHandleTypes(pathObj, insertIndex, 1);
    nextHandleTypes[String(insertIndex)] = 'smooth';

    pathObj.set?.({
      path: nextCommands,
      nodeHandleTypes: nextHandleTypes,
    });
    pathObj.setDimensions?.();
    if (centerPoint && typeof pathObj.setPositionByOrigin === 'function') {
      pathObj.setPositionByOrigin(centerPoint, 'center', 'center');
    }
    pathObj.set('dirty', true);
    pathObj.setCoords?.();
    activePathAnchorRef.current = { path: pathObj, anchorIndex: insertIndex };
    return insertIndex;
  }, [
    buildLinearCubicSegmentCommand,
    buildShiftedPathNodeHandleTypes,
    distanceSqBetweenPoints,
    evaluateCubicPoint,
    evaluateQuadraticPoint,
    findClosestCurveSample,
    findClosestPointOnLineSegment,
    getPathCommands,
    getPathSegments,
    lerpPoint,
    toPathCommandPoint,
    toPathScenePoint,
  ]);

  const stabilizePathAfterAnchorMutation = useCallback((pathObj: any, anchorPoint: Point) => {
    const anchorBefore = toParentPlanePoint(pathObj, anchorPoint);
    pathObj.setDimensions();
    const anchorAfter = toParentPlanePoint(pathObj, anchorPoint);
    if (anchorBefore && anchorAfter) {
      const diffX = anchorAfter.x - anchorBefore.x;
      const diffY = anchorAfter.y - anchorBefore.y;
      if (Math.abs(diffX) > 0.0001) {
        pathObj.left -= diffX;
      }
      if (Math.abs(diffY) > 0.0001) {
        pathObj.top -= diffY;
      }
    }
    pathObj.set('dirty', true);
    pathObj.setCoords();
  }, [toParentPlanePoint]);

  const movePathAnchorByDelta = useCallback((
    pathObj: any,
    anchorIndex: number,
    deltaX: number,
    deltaY: number,
    dragState?: PathAnchorDragState,
  ) => {
    if (Math.abs(deltaX) <= 0.0001 && Math.abs(deltaY) <= 0.0001) {
      return false;
    }

    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const commands = getPathCommands(pathObj);
    const anchorCommand = commands[normalizedAnchor];
    if (!Array.isArray(anchorCommand) || anchorCommand.length < 3) return false;

    const currentAnchor = getAnchorPointForIndex(pathObj, normalizedAnchor);
    const nextAnchor = dragState?.previousAnchor
      ? new Point(
        dragState.previousAnchor.x + deltaX,
        dragState.previousAnchor.y + deltaY,
      )
      : currentAnchor
        ? new Point(currentAnchor.x + deltaX, currentAnchor.y + deltaY)
        : null;
    if (!nextAnchor) return false;

    anchorCommand[anchorCommand.length - 2] = nextAnchor.x;
    anchorCommand[anchorCommand.length - 1] = nextAnchor.y;

    const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, normalizedAnchor);
    const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, normalizedAnchor);
    const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
    const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;

    if (incomingCommand && getCommandType(incomingCommand) === 'C') {
      const incomingBase = dragState?.previousIncoming ?? new Point(Number(incomingCommand[3]), Number(incomingCommand[4]));
      incomingCommand[3] = incomingBase.x + deltaX;
      incomingCommand[4] = incomingBase.y + deltaY;
    }

    if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
      const outgoingBase = dragState?.previousOutgoing ?? new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2]));
      outgoingCommand[1] = outgoingBase.x + deltaX;
      outgoingCommand[2] = outgoingBase.y + deltaY;
    }

    pathObj.set('dirty', true);
    return true;
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathCommands,
    normalizeAnchorIndex,
  ]);

  const enforcePathAnchorHandleType = useCallback((
    pathObj: any,
    anchorIndex: number,
    changed: 'anchor' | 'incoming' | 'outgoing' | null,
    dragState?: PathAnchorDragState
  ) => {
    const commands = getPathCommands(pathObj);
    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const anchorPoint = getAnchorPointForIndex(pathObj, normalizedAnchor);
    if (!anchorPoint) return;

    const handleType = getPathNodeHandleType(pathObj, anchorIndex) ?? 'corner';
    const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, normalizedAnchor);
    const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, normalizedAnchor);
    const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
    const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;

    if (changed === 'anchor' && dragState?.previousAnchor) {
      const deltaX = anchorPoint.x - dragState.previousAnchor.x;
      const deltaY = anchorPoint.y - dragState.previousAnchor.y;
      if (incomingCommand && getCommandType(incomingCommand) === 'C') {
        const baseIncoming = dragState.previousIncoming ?? new Point(Number(incomingCommand[3]), Number(incomingCommand[4]));
        incomingCommand[3] = baseIncoming.x + deltaX;
        incomingCommand[4] = baseIncoming.y + deltaY;
      }
      if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
        const baseOutgoing = dragState.previousOutgoing ?? new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2]));
        outgoingCommand[1] = baseOutgoing.x + deltaX;
        outgoingCommand[2] = baseOutgoing.y + deltaY;
      }
      if (handleType === 'linear') {
        if (incomingCommand && getCommandType(incomingCommand) === 'C') {
          incomingCommand[3] = anchorPoint.x;
          incomingCommand[4] = anchorPoint.y;
        }
        if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
          outgoingCommand[1] = anchorPoint.x;
          outgoingCommand[2] = anchorPoint.y;
        }
      }
      stabilizePathAfterAnchorMutation(pathObj, anchorPoint);
      return;
    }

    if (handleType === 'corner') return;

    if (handleType === 'linear') {
      if (incomingCommand && getCommandType(incomingCommand) === 'C') {
        incomingCommand[3] = anchorPoint.x;
        incomingCommand[4] = anchorPoint.y;
      }
      if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
        outgoingCommand[1] = anchorPoint.x;
        outgoingCommand[2] = anchorPoint.y;
      }
      stabilizePathAfterAnchorMutation(pathObj, anchorPoint);
      return;
    }

    if (!incomingCommand && !outgoingCommand) {
      return;
    }

    const incomingVec = incomingCommand && getCommandType(incomingCommand) === 'C'
      ? {
          x: Number(incomingCommand[3]) - anchorPoint.x,
          y: Number(incomingCommand[4]) - anchorPoint.y,
        }
      : null;
    const outgoingVec = outgoingCommand && getCommandType(outgoingCommand) === 'C'
      ? {
          x: Number(outgoingCommand[1]) - anchorPoint.x,
          y: Number(outgoingCommand[2]) - anchorPoint.y,
        }
      : null;
    const incomingLength = incomingVec ? Math.hypot(incomingVec.x, incomingVec.y) : 0;
    const outgoingLength = outgoingVec ? Math.hypot(outgoingVec.x, outgoingVec.y) : 0;
    const previousAnchorIndex = findPreviousDrawableCommandIndex(pathObj, normalizedAnchor);
    const nextAnchorIndex = findNextDrawableCommandIndex(pathObj, normalizedAnchor);
    const previousAnchorPoint = previousAnchorIndex !== normalizedAnchor
      ? getAnchorPointForIndex(pathObj, previousAnchorIndex)
      : null;
    const nextAnchorPoint = nextAnchorIndex !== normalizedAnchor
      ? getAnchorPointForIndex(pathObj, nextAnchorIndex)
      : null;
    const previousSegmentVec = previousAnchorPoint
      ? {
          x: previousAnchorPoint.x - anchorPoint.x,
          y: previousAnchorPoint.y - anchorPoint.y,
        }
      : null;
    const nextSegmentVec = nextAnchorPoint
      ? {
          x: nextAnchorPoint.x - anchorPoint.x,
          y: nextAnchorPoint.y - anchorPoint.y,
        }
      : null;
    const previousSegmentLength = previousSegmentVec
      ? Math.hypot(previousSegmentVec.x, previousSegmentVec.y)
      : 0;
    const nextSegmentLength = nextSegmentVec
      ? Math.hypot(nextSegmentVec.x, nextSegmentVec.y)
      : 0;

    let baseDirX = 1;
    let baseDirY = 0;
    if (changed === 'incoming' && incomingLength > 0.0001) {
      baseDirX = incomingVec!.x / incomingLength;
      baseDirY = incomingVec!.y / incomingLength;
    } else if (changed === 'outgoing' && outgoingLength > 0.0001) {
      baseDirX = -outgoingVec!.x / outgoingLength;
      baseDirY = -outgoingVec!.y / outgoingLength;
    } else if (incomingLength > 0.0001) {
      baseDirX = incomingVec!.x / incomingLength;
      baseDirY = incomingVec!.y / incomingLength;
    } else if (outgoingLength > 0.0001) {
      baseDirX = -outgoingVec!.x / outgoingLength;
      baseDirY = -outgoingVec!.y / outgoingLength;
    } else if (previousSegmentLength > 0.0001 && nextSegmentLength > 0.0001) {
      const previousDirX = previousSegmentVec!.x / previousSegmentLength;
      const previousDirY = previousSegmentVec!.y / previousSegmentLength;
      const nextDirX = nextSegmentVec!.x / nextSegmentLength;
      const nextDirY = nextSegmentVec!.y / nextSegmentLength;
      const bisectorX = previousDirX - nextDirX;
      const bisectorY = previousDirY - nextDirY;
      const bisectorLength = Math.hypot(bisectorX, bisectorY);
      if (bisectorLength > 0.0001) {
        baseDirX = bisectorX / bisectorLength;
        baseDirY = bisectorY / bisectorLength;
      } else {
        baseDirX = previousDirX;
        baseDirY = previousDirY;
      }
    } else if (previousSegmentLength > 0.0001) {
      baseDirX = previousSegmentVec!.x / previousSegmentLength;
      baseDirY = previousSegmentVec!.y / previousSegmentLength;
    } else if (nextSegmentLength > 0.0001) {
      baseDirX = -nextSegmentVec!.x / nextSegmentLength;
      baseDirY = -nextSegmentVec!.y / nextSegmentLength;
    }

    let nextIncomingLength = incomingLength;
    let nextOutgoingLength = outgoingLength;
    if (nextIncomingLength <= 0.0001 && previousSegmentLength > 0.0001) {
      nextIncomingLength = previousSegmentLength / 3;
    }
    if (nextOutgoingLength <= 0.0001 && nextSegmentLength > 0.0001) {
      nextOutgoingLength = nextSegmentLength / 3;
    }
    if (handleType === 'symmetric') {
      if (changed === 'incoming') {
        nextOutgoingLength = incomingLength;
      } else if (changed === 'outgoing') {
        nextIncomingLength = outgoingLength;
      } else {
        const maxLength = Math.max(incomingLength, outgoingLength);
        nextIncomingLength = maxLength;
        nextOutgoingLength = maxLength;
      }
    } else {
      if (nextIncomingLength <= 0.0001 && nextOutgoingLength > 0.0001) {
        nextIncomingLength = nextOutgoingLength;
      }
      if (nextOutgoingLength <= 0.0001 && nextIncomingLength > 0.0001) {
        nextOutgoingLength = nextIncomingLength;
      }
    }

    if (incomingCommand && getCommandType(incomingCommand) === 'C') {
      incomingCommand[3] = anchorPoint.x + baseDirX * nextIncomingLength;
      incomingCommand[4] = anchorPoint.y + baseDirY * nextIncomingLength;
    }
    if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
      outgoingCommand[1] = anchorPoint.x - baseDirX * nextOutgoingLength;
      outgoingCommand[2] = anchorPoint.y - baseDirY * nextOutgoingLength;
    }

    stabilizePathAfterAnchorMutation(pathObj, anchorPoint);
  }, [
    findNextDrawableCommandIndex,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    findPreviousDrawableCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathCommands,
    getPathNodeHandleType,
    normalizeAnchorIndex,
    stabilizePathAfterAnchorMutation,
  ]);

  const getPathAnchorDragState = useCallback((pathObj: any, anchorIndex: number): PathAnchorDragState | null => {
    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const anchorPoint = getAnchorPointForIndex(pathObj, normalizedAnchor);
    if (!anchorPoint) return null;

    const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, normalizedAnchor);
    const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, normalizedAnchor);
    const commands = getPathCommands(pathObj);
    const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
    const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;

    return {
      previousAnchor: new Point(anchorPoint.x, anchorPoint.y),
      previousIncoming: incomingCommand && getCommandType(incomingCommand) === 'C'
        ? clonePoint(new Point(Number(incomingCommand[3]), Number(incomingCommand[4])))
        : null,
      previousOutgoing: outgoingCommand && getCommandType(outgoingCommand) === 'C'
        ? clonePoint(new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2])))
        : null,
    };
  }, [
    clonePoint,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathCommands,
    normalizeAnchorIndex,
  ]);

  const getSelectedPathAnchorTransformSnapshot = useCallback((pathObj: any): PointSelectionTransformSnapshot | null => {
    if (!pathObj || getFabricObjectType(pathObj) !== 'path') return null;

    const selectedAnchorIndices = getSelectedPathAnchorIndices(pathObj);
    if (selectedAnchorIndices.length < 2) return null;
    const selectionKey = getPointSelectionKey(selectedAnchorIndices);

    const commands = getPathCommands(pathObj);
    const anchors: SelectedPathAnchorTransformSnapshot[] = [];
    for (const anchorIndex of selectedAnchorIndices) {
      const anchorPoint = getAnchorPointForIndex(pathObj, anchorIndex);
      const anchorScene = anchorPoint ? toPathScenePoint(pathObj, anchorPoint) : null;
      if (!anchorPoint || !anchorScene) continue;

      const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, anchorIndex);
      const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, anchorIndex);
      const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
      const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;
      const incomingScene = incomingCommand && getCommandType(incomingCommand) === 'C'
        ? toPathScenePoint(pathObj, new Point(Number(incomingCommand[3]), Number(incomingCommand[4])))
        : null;
      const outgoingScene = outgoingCommand && getCommandType(outgoingCommand) === 'C'
        ? toPathScenePoint(pathObj, new Point(Number(outgoingCommand[1]), Number(outgoingCommand[2])))
        : null;

      anchors.push({
        anchorIndex,
        anchorScene,
        incomingScene,
        outgoingScene,
      });
    }

    if (anchors.length < 2) return null;

    const preservedFrame = pointSelectionTransformFrameRef.current;
    const preservedRotation = preservedFrame &&
      preservedFrame.path === pathObj &&
      preservedFrame.selectionKey === selectionKey
      ? preservedFrame.rotationRadians
      : 0;
    const bounds = createPointSelectionTransformBounds(
      anchors.map((anchor) => anchor.anchorScene),
      preservedRotation,
    );
    if (!bounds) {
      return null;
    }

    return {
      path: pathObj,
      selectionKey,
      anchors,
      bounds,
    };
  }, [
    createPointSelectionTransformBounds,
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPointSelectionKey,
    getPathCommands,
    getSelectedPathAnchorIndices,
    toPathScenePoint,
  ]);

  const getPointSelectionTransformHandlePoints = useCallback((bounds: PointSelectionTransformBounds) => {
    const rotateOffset = getZoomInvariantMetric(VECTOR_POINT_SELECTION_ROTATE_OFFSET);
    const halfHeight = bounds.height / 2;
    return {
      topCenter: toPointSelectionTransformScenePoint(bounds, new Point(0, -halfHeight)),
      rotate: toPointSelectionTransformScenePoint(bounds, new Point(0, -halfHeight - rotateOffset)),
      scaleTl: bounds.topLeft,
      scaleTr: bounds.topRight,
      scaleBr: bounds.bottomRight,
      scaleBl: bounds.bottomLeft,
    };
  }, [getZoomInvariantMetric, toPointSelectionTransformScenePoint]);

  const hitPointSelectionTransform = useCallback((
    snapshot: PointSelectionTransformSnapshot,
    pointerScene: Point,
  ): PointSelectionTransformMode | null => {
    const handleHalfSize = getZoomInvariantMetric(VECTOR_POINT_SELECTION_HANDLE_SIZE) / 2;
    const hitPadding = getZoomInvariantMetric(VECTOR_POINT_SELECTION_HIT_PADDING);
    const handlePoints = getPointSelectionTransformHandlePoints(snapshot.bounds);

    const isInsideHandle = (point: Point) => (
      Math.abs(pointerScene.x - point.x) <= handleHalfSize &&
      Math.abs(pointerScene.y - point.y) <= handleHalfSize
    );

    if (isInsideHandle(handlePoints.rotate)) return 'rotate';
    if (isInsideHandle(handlePoints.scaleTl)) return 'scale-tl';
    if (isInsideHandle(handlePoints.scaleTr)) return 'scale-tr';
    if (isInsideHandle(handlePoints.scaleBr)) return 'scale-br';
    if (isInsideHandle(handlePoints.scaleBl)) return 'scale-bl';

    const pointerLocal = toPointSelectionTransformLocalPoint(snapshot.bounds, pointerScene);
    if (
      Math.abs(pointerLocal.x) <= snapshot.bounds.width / 2 + hitPadding &&
      Math.abs(pointerLocal.y) <= snapshot.bounds.height / 2 + hitPadding
    ) {
      return 'move';
    }

    return null;
  }, [getPointSelectionTransformHandlePoints, getZoomInvariantMetric, toPointSelectionTransformLocalPoint]);

  const rotateScenePointAround = useCallback((point: Point, center: Point, angleRadians: number) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const cos = Math.cos(angleRadians);
    const sin = Math.sin(angleRadians);
    return new Point(
      center.x + dx * cos - dy * sin,
      center.y + dx * sin + dy * cos,
    );
  }, []);

  const transformPointSelectionScenePoint = useCallback((
    point: Point,
    session: PointSelectionTransformSession,
    pointerScene: Point,
  ): Point => {
    const { bounds } = session.snapshot;
    if (session.mode === 'move') {
      return new Point(
        point.x + (pointerScene.x - session.startPointerScene.x),
        point.y + (pointerScene.y - session.startPointerScene.y),
      );
    }

    if (session.mode === 'rotate') {
      const startAngle = Math.atan2(
        session.startPointerScene.y - bounds.center.y,
        session.startPointerScene.x - bounds.center.x,
      );
      const nextAngle = Math.atan2(
        pointerScene.y - bounds.center.y,
        pointerScene.x - bounds.center.x,
      );
      return rotateScenePointAround(point, bounds.center, nextAngle - startAngle);
    }

    const minimumSize = getZoomInvariantMetric(VECTOR_POINT_SELECTION_MIN_SIZE);
    const baseWidth = Math.max(bounds.width, minimumSize);
    const baseHeight = Math.max(bounds.height, minimumSize);
    const pointLocal = toPointSelectionTransformLocalPoint(bounds, point);
    const pointerLocal = toPointSelectionTransformLocalPoint(bounds, pointerScene);

    let fixedPointLocal = new Point(-bounds.width / 2, -bounds.height / 2);
    let scaleX = 1;
    let scaleY = 1;
    if (session.mode === 'scale-tl') {
      fixedPointLocal = new Point(bounds.width / 2, bounds.height / 2);
      scaleX = Math.max(minimumSize, fixedPointLocal.x - pointerLocal.x) / baseWidth;
      scaleY = Math.max(minimumSize, fixedPointLocal.y - pointerLocal.y) / baseHeight;
    } else if (session.mode === 'scale-tr') {
      fixedPointLocal = new Point(-bounds.width / 2, bounds.height / 2);
      scaleX = Math.max(minimumSize, pointerLocal.x - fixedPointLocal.x) / baseWidth;
      scaleY = Math.max(minimumSize, fixedPointLocal.y - pointerLocal.y) / baseHeight;
    } else if (session.mode === 'scale-br') {
      fixedPointLocal = new Point(-bounds.width / 2, -bounds.height / 2);
      scaleX = Math.max(minimumSize, pointerLocal.x - fixedPointLocal.x) / baseWidth;
      scaleY = Math.max(minimumSize, pointerLocal.y - fixedPointLocal.y) / baseHeight;
    } else if (session.mode === 'scale-bl') {
      fixedPointLocal = new Point(bounds.width / 2, -bounds.height / 2);
      scaleX = Math.max(minimumSize, fixedPointLocal.x - pointerLocal.x) / baseWidth;
      scaleY = Math.max(minimumSize, pointerLocal.y - fixedPointLocal.y) / baseHeight;
    }

    return toPointSelectionTransformScenePoint(
      bounds,
      new Point(
        fixedPointLocal.x + (pointLocal.x - fixedPointLocal.x) * scaleX,
        fixedPointLocal.y + (pointLocal.y - fixedPointLocal.y) * scaleY,
      ),
    );
  }, [
    getZoomInvariantMetric,
    rotateScenePointAround,
    toPointSelectionTransformLocalPoint,
    toPointSelectionTransformScenePoint,
  ]);

  const beginPointSelectionTransformSession = useCallback((
    pathObj: any,
    mode: PointSelectionTransformMode,
    pointerScene: Point,
  ): boolean => {
    const snapshot = getSelectedPathAnchorTransformSnapshot(pathObj);
    if (!snapshot) return false;

    pointSelectionTransformSessionRef.current = {
      path: pathObj,
      mode,
      startPointerScene: new Point(pointerScene.x, pointerScene.y),
      snapshot,
      hasChanged: false,
    };
    return true;
  }, [getSelectedPathAnchorTransformSnapshot]);

  const applyPointSelectionTransformSession = useCallback((
    session: PointSelectionTransformSession,
    pointerScene: Point,
  ): boolean => {
    const { path, snapshot } = session;
    if (!path || getFabricObjectType(path) !== 'path') return false;

    const commands = getPathCommands(path);
    let referenceCommandPoint: Point | null = null;
    let transformedAnyAnchor = false;
    for (const anchorSnapshot of snapshot.anchors) {
      const normalizedAnchorIndex = normalizeAnchorIndex(path, anchorSnapshot.anchorIndex);
      const anchorCommand = commands[normalizedAnchorIndex];
      if (!Array.isArray(anchorCommand) || anchorCommand.length < 3) continue;

      const transformedAnchorScene = transformPointSelectionScenePoint(anchorSnapshot.anchorScene, session, pointerScene);
      const transformedAnchorCommand = toPathCommandPoint(path, transformedAnchorScene);
      if (!transformedAnchorCommand) continue;

      anchorCommand[anchorCommand.length - 2] = transformedAnchorCommand.x;
      anchorCommand[anchorCommand.length - 1] = transformedAnchorCommand.y;
      referenceCommandPoint ??= transformedAnchorCommand;
      transformedAnyAnchor = true;

      const incomingCommandIndex = findIncomingCubicCommandIndex(path, normalizedAnchorIndex);
      if (incomingCommandIndex >= 0 && anchorSnapshot.incomingScene) {
        const incomingCommand = commands[incomingCommandIndex];
        const transformedIncomingScene = transformPointSelectionScenePoint(anchorSnapshot.incomingScene, session, pointerScene);
        const transformedIncomingCommand = toPathCommandPoint(path, transformedIncomingScene);
        if (transformedIncomingCommand && getCommandType(incomingCommand) === 'C') {
          incomingCommand[3] = transformedIncomingCommand.x;
          incomingCommand[4] = transformedIncomingCommand.y;
        }
      }

      const outgoingCommandIndex = findOutgoingCubicCommandIndex(path, normalizedAnchorIndex);
      if (outgoingCommandIndex >= 0 && anchorSnapshot.outgoingScene) {
        const outgoingCommand = commands[outgoingCommandIndex];
        const transformedOutgoingScene = transformPointSelectionScenePoint(anchorSnapshot.outgoingScene, session, pointerScene);
        const transformedOutgoingCommand = toPathCommandPoint(path, transformedOutgoingScene);
        if (transformedOutgoingCommand && getCommandType(outgoingCommand) === 'C') {
          outgoingCommand[1] = transformedOutgoingCommand.x;
          outgoingCommand[2] = transformedOutgoingCommand.y;
        }
      }
    }

    if (!transformedAnyAnchor || !referenceCommandPoint) return false;

    const nextRotation = session.mode === 'rotate'
      ? normalizeRadians(
          snapshot.bounds.rotationRadians +
          (
            Math.atan2(
              pointerScene.y - snapshot.bounds.center.y,
              pointerScene.x - snapshot.bounds.center.x,
            ) -
            Math.atan2(
              session.startPointerScene.y - snapshot.bounds.center.y,
              session.startPointerScene.x - snapshot.bounds.center.x,
            )
          ),
        )
      : snapshot.bounds.rotationRadians;
    pointSelectionTransformFrameRef.current = {
      path,
      selectionKey: snapshot.selectionKey,
      rotationRadians: nextRotation,
    };

    path.set('dirty', true);
    stabilizePathAfterAnchorMutation(path, referenceCommandPoint);
    syncPathAnchorSelectionAppearance(path);
    syncPathControlPointVisibility(path);
    path.setCoords?.();
    fabricCanvasRef.current?.requestRenderAll();
    return true;
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getCommandType,
    getPathCommands,
    normalizeAnchorIndex,
    stabilizePathAfterAnchorMutation,
    syncPathAnchorSelectionAppearance,
    syncPathControlPointVisibility,
    toPathCommandPoint,
    transformPointSelectionScenePoint,
  ]);

  const applyPointSelectionMarqueeSession = useCallback((session: PointSelectionMarqueeSession) => {
    const { path } = session;
    if (!path || getFabricObjectType(path) !== 'path') return false;

    if (!hasPointSelectionMarqueeExceededThreshold(session)) {
      if (!session.toggleSelection && session.initialSelectedAnchorIndices.length > 0) {
        clearSelectedPathAnchors(path);
        return true;
      }
      return false;
    }

    const marqueeBounds = getSceneRectFromPoints(session.startPointerScene, session.currentPointerScene);
    const hitAnchorIndices = getSelectablePathAnchorIndices(path).filter((anchorIndex) => {
      const anchorPoint = getAnchorPointForIndex(path, anchorIndex);
      const anchorScenePoint = anchorPoint ? toPathScenePoint(path, anchorPoint) : null;
      if (!anchorScenePoint) return false;
      return (
        anchorScenePoint.x >= marqueeBounds.left &&
        anchorScenePoint.x <= marqueeBounds.right &&
        anchorScenePoint.y >= marqueeBounds.top &&
        anchorScenePoint.y <= marqueeBounds.bottom
      );
    });

    let nextSelectedAnchorIndices = hitAnchorIndices;
    if (session.toggleSelection) {
      const nextSelectedAnchorSet = new Set(session.initialSelectedAnchorIndices);
      hitAnchorIndices.forEach((anchorIndex) => {
        if (nextSelectedAnchorSet.has(anchorIndex)) {
          nextSelectedAnchorSet.delete(anchorIndex);
        } else {
          nextSelectedAnchorSet.add(anchorIndex);
        }
      });
      nextSelectedAnchorIndices = Array.from(nextSelectedAnchorSet).sort((a, b) => a - b);
    }

    const primaryAnchorIndex = nextSelectedAnchorIndices.length > 0
      ? nextSelectedAnchorIndices[nextSelectedAnchorIndices.length - 1]
      : null;
    setSelectedPathAnchors(path, nextSelectedAnchorIndices, {
      primaryAnchorIndex,
    });
    return true;
  }, [
    clearSelectedPathAnchors,
    getAnchorPointForIndex,
    getSceneRectFromPoints,
    getSelectablePathAnchorIndices,
    hasPointSelectionMarqueeExceededThreshold,
    setSelectedPathAnchors,
    toPathScenePoint,
  ]);

  const createFourPointEllipsePathData = useCallback((obj: any): string | null => {
    const rx = Math.max(1, typeof obj.rx === 'number' ? obj.rx : ((obj.width || 1) / 2));
    const ry = Math.max(1, typeof obj.ry === 'number' ? obj.ry : ((obj.height || 1) / 2));
    const kx = rx * CIRCLE_CUBIC_KAPPA;
    const ky = ry * CIRCLE_CUBIC_KAPPA;
    const p0 = toCanvasPoint(obj, rx, 0);
    const p1 = toCanvasPoint(obj, 0, ry);
    const p2 = toCanvasPoint(obj, -rx, 0);
    const p3 = toCanvasPoint(obj, 0, -ry);
    const c01a = toCanvasPoint(obj, rx, ky);
    const c01b = toCanvasPoint(obj, kx, ry);
    const c12a = toCanvasPoint(obj, -kx, ry);
    const c12b = toCanvasPoint(obj, -rx, ky);
    const c23a = toCanvasPoint(obj, -rx, -ky);
    const c23b = toCanvasPoint(obj, -kx, -ry);
    const c30a = toCanvasPoint(obj, kx, -ry);
    const c30b = toCanvasPoint(obj, rx, -ky);
    const r = (value: number) => Math.round(value * 1000) / 1000;
    return [
      `M ${r(p0.x)} ${r(p0.y)}`,
      `C ${r(c01a.x)} ${r(c01a.y)} ${r(c01b.x)} ${r(c01b.y)} ${r(p1.x)} ${r(p1.y)}`,
      `C ${r(c12a.x)} ${r(c12a.y)} ${r(c12b.x)} ${r(c12b.y)} ${r(p2.x)} ${r(p2.y)}`,
      `C ${r(c23a.x)} ${r(c23a.y)} ${r(c23b.x)} ${r(c23b.y)} ${r(p3.x)} ${r(p3.y)}`,
      `C ${r(c30a.x)} ${r(c30a.y)} ${r(c30b.x)} ${r(c30b.y)} ${r(p0.x)} ${r(p0.y)}`,
      'Z',
    ].join(' ');
  }, [toCanvasPoint]);

  const buildPathDataFromPoints = useCallback((points: Point[], closed: boolean): string => {
    if (points.length === 0) return '';
    const rounded = (value: number) => Math.round(value * 1000) / 1000;
    const commands = points.map((pt, index) => `${index === 0 ? 'M' : 'L'} ${rounded(pt.x)} ${rounded(pt.y)}`);
    if (closed) {
      commands.push('Z');
    }
    return commands.join(' ');
  }, []);

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
  });

  // Sync tool behavior.
  useEffect(() => {
    configureCanvasForTool();
  }, [activeTool, bitmapBrushKind, brushColor, brushSize, editorModeState, hasBitmapFloatingSelection, vectorStyle, configureCanvasForTool]);

  useEffect(() => {
    syncActiveLayerCanvasVisibility();
  }, [syncActiveLayerCanvasVisibility]);

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

  // Sync selected vector object style when controls change.
  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'vector') return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return;

    let changed = false;
    if (isTextObject(activeObject)) {
      const textObject = activeObject as any;
      if (textObject.fill !== brushColor) changed = true;
      if (textObject.fontFamily !== textStyle.fontFamily) changed = true;
      if (textObject.fontSize !== textStyle.fontSize) changed = true;
      if (textObject.fontWeight !== textStyle.fontWeight) changed = true;
      if (textObject.fontStyle !== textStyle.fontStyle) changed = true;
      if (textObject.underline !== textStyle.underline) changed = true;
      if (textObject.textAlign !== textStyle.textAlign) changed = true;
      if (textObject.opacity !== textStyle.opacity) changed = true;
      textObject.set({
        fill: brushColor,
        fontFamily: textStyle.fontFamily,
        fontSize: textStyle.fontSize,
        fontWeight: textStyle.fontWeight,
        fontStyle: textStyle.fontStyle,
        underline: textStyle.underline,
        textAlign: textStyle.textAlign,
        opacity: textStyle.opacity,
      });
    } else {
      const strokeWidth = Math.max(0, vectorStyle.strokeWidth);
      const vectorTargets = getVectorStyleTargets(activeObject);
      if (!vectorTargets.length) return;

      vectorTargets.forEach((target) => {
        const shouldPreserveCenter =
          target.strokeUniform !== true ||
          target.strokeWidth !== strokeWidth;
        const centerPoint = shouldPreserveCenter && typeof target.getCenterPoint === 'function'
          ? target.getCenterPoint()
          : null;
        const fillChanged = vectorObjectSupportsFill(target)
          ? applyVectorFillStyleToObject(target, {
              fillColor: vectorStyle.fillColor,
              fillTextureId: vectorStyle.fillTextureId,
            })
          : false;
        const strokeChanged = applyVectorStrokeStyleToObject(target, {
          strokeColor: vectorStyle.strokeColor,
          strokeWidth,
          strokeBrushId: vectorStyle.strokeBrushId,
        });
        changed = changed || fillChanged;
        changed = changed || strokeChanged;
        if (strokeChanged && centerPoint && typeof target.setPositionByOrigin === 'function') {
          target.setPositionByOrigin(centerPoint, 'center', 'center');
        }
        target.setCoords?.();
      });
    }

    if (!changed) return;

    activeObject.setCoords?.();
    fabricCanvas.requestRenderAll();
    saveHistory();
  }, [brushColor, textStyle, vectorStyle, saveHistory]);

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
    onBitmapLayerPickRef,
    pickBitmapLayerAtPoint,
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
      editorModeState={editorModeState}
      fabricCanvasHostRef={fabricCanvasHostRef}
      hasBitmapFloatingSelection={hasBitmapFloatingSelection}
      inactiveLayerSurfaceRefs={inactiveLayerSurfaceRefs}
      inactiveLayersAboveActive={inactiveLayersAboveActive}
      inactiveLayersBelowActive={inactiveLayersBelowActive}
      isViewportPanning={isViewportPanning}
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
