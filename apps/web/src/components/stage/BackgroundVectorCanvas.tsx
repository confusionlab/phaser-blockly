import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  Canvas as FabricCanvas,
  Control,
  Ellipse,
  IText,
  Line,
  Point,
  Polygon,
  Rect,
} from 'fabric';
import type {
  BackgroundVectorDocument,
  BackgroundVectorLayer,
} from '@/types';
import type {
  AlignAction,
  DrawingTool,
  MoveOrderAction,
  SelectionFlipAxis,
  TextToolStyle,
  VectorHandleMode,
  VectorStyleCapabilities,
  VectorToolStyleSelectionSnapshot,
  VectorToolStyle,
} from '@/components/editors/costume/CostumeToolbar';
import {
  buildPolygonShapeDraft,
  getFabricShapeDraftObjectProps,
  getZoomInvariantCanvasMetric,
  type MirroredPathAnchorDragSession,
  type PathAnchorDragState,
  type PointSelectionMarqueeSession,
  type PointSelectionTransformFrameState,
  type PointSelectionTransformSession,
} from '@/components/editors/costume/costumeCanvasShared';
import {
  attachTextEditingContainer,
  beginTextEditing,
  isTextEditableObject,
} from '@/components/editors/costume/costumeTextCommands';
import {
  applyVectorStyleUpdatesToSelection,
  VECTOR_JSON_EXTRA_PROPS,
  cloneFabricObjectWithVectorStyle,
  getFabricFillValueForVectorTexture,
  getFabricStrokeValueForVectorBrush,
  getVectorStyleSelectionSnapshot,
  getVectorStyleCapabilitiesForSelection,
  isActiveSelectionObject,
  isTextObject,
  isVectorPointSelectableObject,
  normalizeVectorObjectRendering,
} from '@/components/editors/costume/costumeCanvasVectorRuntime';
import { useFabricVectorClipboardCommands } from '@/components/editors/shared/useFabricVectorClipboardCommands';
import {
  resolveStyleSliderCommitAction,
  useToolbarSliderPreviewCommitDeferral,
  type ToolbarSliderCommitBoundaryState,
} from '@/components/editors/shared/toolbarSliderCommitBoundary';
import {
  appendLinearLocalHistorySnapshot,
  clearLinearLocalHistory,
  getLinearLocalHistoryAvailability,
  rebaseLinearLocalHistoryToSnapshot,
} from '@/lib/editor/localSnapshotHistory';
import { useCostumeCanvasPenController } from '@/components/editors/costume/useCostumeCanvasPenController';
import { useCostumeCanvasPenHotkeys } from '@/components/editors/costume/useCostumeCanvasPenHotkeys';
import { useCostumeCanvasMirroredPathHotkeys } from '@/components/editors/costume/useCostumeCanvasMirroredPathHotkeys';
import { useCostumeCanvasSelectionController } from '@/components/editors/costume/useCostumeCanvasSelectionController';
import { useCostumeCanvasSelectionTransformCommands } from '@/components/editors/costume/useCostumeCanvasSelectionTransformCommands';
import { useCostumeCanvasToolController } from '@/components/editors/costume/useCostumeCanvasToolController';
import { useCostumeCanvasVectorHandleSync } from '@/components/editors/costume/useCostumeCanvasVectorHandleSync';
import { useCostumeCanvasVectorObjectController } from '@/components/editors/costume/useCostumeCanvasVectorObjectController';
import { useCostumeCanvasVectorPathController } from '@/components/editors/costume/useCostumeCanvasVectorPathController';
import {
  applyUnifiedFabricTransformCanvasOptions,
  clearUnifiedCanvasTransformGuide,
  configureUnifiedObjectTransformForGesture,
  syncUnifiedCanvasTransformGuideFromEvent,
} from '@/components/editors/costume/costumeCanvasObjectTransformGizmo';
import { syncCanvasSelectionGizmoAppearance } from '@/components/editors/costume/costumeCanvasSelectionGizmo';
import type { BitmapBrushKind } from '@/lib/background/brushCore';
import { EMPTY_BACKGROUND_VECTOR_FABRIC_JSON } from '@/lib/background/backgroundDocument';
import {
  markBackgroundVectorSceneDownDocument,
  parseBackgroundVectorFabricJson,
  reflectBackgroundVectorObjectsAcrossXAxis,
} from '@/lib/background/backgroundVectorCoordinateSpace';
import { clearCanvasInCssPixels, syncCanvasViewportSize } from '@/lib/editor/canvasOverlay';
import type { FinishPendingEditsOptions } from '@/lib/editor/interactionSurface';
import { renderComposedVectorSceneForFabricCanvas } from '@/lib/costume/costumeVectorTextureRenderer';
import {
  fabricCanvasContainsObject,
  forEachFabricObjectDeep,
  getVectorGroupEditingPathForTarget,
  isFabricGroupObject,
  resolveVectorGroupEntrySelectionTarget,
  resolveVectorGroupEditingRootTarget,
  resolveVectorHoverTarget,
  sanitizeVectorGroupEditingPath,
} from '@/lib/editor/fabricVectorSelection';

type WorldPoint = { x: number; y: number };

type SupportedVectorTool = Extract<DrawingTool, 'select' | 'pen' | 'brush' | 'rectangle' | 'circle' | 'triangle' | 'star' | 'line' | 'text'>;

type VectorShapeDraft =
  | {
      tool: 'rectangle';
      object: Rect;
      start: WorldPoint;
    }
  | {
      tool: 'circle';
      object: Ellipse;
      start: WorldPoint;
    }
  | {
      tool: 'triangle' | 'star';
      object: Polygon;
      start: WorldPoint;
    }
  | {
      tool: 'line';
      object: Line;
      start: WorldPoint;
    };

type WorldBounds = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

export interface BackgroundVectorCanvasHandle {
  beginShape: (tool: SupportedVectorTool, startWorld: WorldPoint) => boolean;
  updateShape: (currentWorld: WorldPoint) => void;
  commitShape: () => boolean;
  cancelShape: () => void;
  flushPendingEdits: (_options?: FinishPendingEditsOptions) => boolean;
  hasActiveInteraction: () => boolean;
  isTextEditing: () => boolean;
  awaitIdle: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  resetHistoryToCurrent: () => void;
  serialize: () => BackgroundVectorDocument | null;
  deleteSelection: () => boolean;
  duplicateSelection: () => Promise<boolean>;
  copySelection: () => Promise<boolean>;
  cutSelection: () => Promise<boolean>;
  pasteSelection: () => Promise<boolean>;
  moveSelectionOrder: (action: MoveOrderAction) => void;
  groupSelection: () => boolean;
  ungroupSelection: () => boolean;
  nudgeSelection: (dx: number, dy: number) => boolean;
  flipSelection: (axis: SelectionFlipAxis) => void;
  rotateSelection: () => void;
  alignSelection: (action: AlignAction) => boolean;
  exitAllGroupEditing: () => boolean;
  getSelectionBounds: () => WorldBounds | null;
  getDocumentBounds: () => WorldBounds | null;
}

interface BackgroundVectorCanvasProps {
  alignmentBounds: { left: number; top: number; width: number; height: number };
  layer: BackgroundVectorLayer | null;
  viewport: { width: number; height: number };
  camera: { x: number; y: number };
  zoom: number;
  activeTool: SupportedVectorTool;
  brushColor: string;
  textStyle: TextToolStyle;
  vectorStyle: VectorToolStyle;
  vectorStyleChangeRevision: number;
  latestVectorStyleUpdates: Partial<VectorToolStyle>;
  sliderCommitBoundaryState: ToolbarSliderCommitBoundaryState;
  sliderCommitBoundaryStateRef: MutableRefObject<ToolbarSliderCommitBoundaryState>;
  interactive: boolean;
  onDirty: () => void;
  onHistoryStateChange: (state: { canUndo: boolean; canRedo: boolean; isDirty: boolean }) => void;
  onSelectionChange: (hasSelection: boolean) => void;
  onVectorGroupingStateChange?: (state: { canGroup: boolean; canUngroup: boolean }) => void;
  onTextSelectionChange: (hasTextSelection: boolean) => void;
  onTextStyleSync: (style: Partial<TextToolStyle>) => void;
  vectorHandleMode: VectorHandleMode;
  onVectorHandleModeSync: (mode: VectorHandleMode) => void;
  onVectorPointEditingChange: (isEditing: boolean) => void;
  onVectorPointSelectionChange: (hasSelectedVectorPoints: boolean) => void;
  onVectorStyleSync: (snapshot: VectorToolStyleSelectionSnapshot) => boolean;
  onVectorStyleCapabilitiesSync: (capabilities: VectorStyleCapabilities) => void;
  onCanZoomToSelectionChange: (canZoom: boolean) => void;
  onCanvasContextMenu?: (event: MouseEvent) => void;
}

function worldPointToScenePoint(point: WorldPoint): WorldPoint {
  return {
    x: point.x,
    y: -point.y,
  };
}

function sceneBoundsToWorldBounds(bounds: { left: number; top: number; width: number; height: number }): WorldBounds {
  return {
    left: bounds.left,
    right: bounds.left + bounds.width,
    bottom: -(bounds.top + bounds.height),
    top: -bounds.top,
  };
}

function buildVectorStyleProps(vectorStyle: VectorToolStyle, supportsFill: boolean) {
  return {
    fill: supportsFill
      ? getFabricFillValueForVectorTexture(
          vectorStyle.fillTextureId,
          vectorStyle.fillColor,
          vectorStyle.fillOpacity,
        )
      : null,
    opacity: 1,
    stroke: getFabricStrokeValueForVectorBrush(
      vectorStyle.strokeBrushId,
      vectorStyle.strokeColor,
      vectorStyle.strokeOpacity,
    ),
    strokeWidth: Math.max(1, vectorStyle.strokeWidth),
    strokeUniform: true,
    noScaleCache: false,
    vectorFillTextureId: vectorStyle.fillTextureId,
    vectorFillColor: vectorStyle.fillColor,
    vectorFillOpacity: vectorStyle.fillOpacity,
    vectorStrokeBrushId: vectorStyle.strokeBrushId,
    vectorStrokeColor: vectorStyle.strokeColor,
    vectorStrokeOpacity: vectorStyle.strokeOpacity,
  } as const;
}

function getChangedVectorStyleUpdates(
  previous: VectorToolStyle,
  next: VectorToolStyle,
): Partial<VectorToolStyle> {
  const updates: Partial<VectorToolStyle> = {};

  if (previous.fillColor !== next.fillColor) {
    updates.fillColor = next.fillColor;
  }
  if (previous.fillTextureId !== next.fillTextureId) {
    updates.fillTextureId = next.fillTextureId;
  }
  if (previous.fillOpacity !== next.fillOpacity) {
    updates.fillOpacity = next.fillOpacity;
  }
  if (previous.strokeColor !== next.strokeColor) {
    updates.strokeColor = next.strokeColor;
  }
  if (previous.strokeOpacity !== next.strokeOpacity) {
    updates.strokeOpacity = next.strokeOpacity;
  }
  if (previous.strokeWidth !== next.strokeWidth) {
    updates.strokeWidth = next.strokeWidth;
  }
  if (previous.strokeBrushId !== next.strokeBrushId) {
    updates.strokeBrushId = next.strokeBrushId;
  }

  return updates;
}

function getTextStyleSnapshot(obj: unknown): Partial<TextToolStyle> | null {
  if (!isTextObject(obj)) {
    return null;
  }

  const textObject = obj as {
    fontFamily?: unknown;
    fontSize?: unknown;
    fontWeight?: unknown;
    fontStyle?: unknown;
    underline?: unknown;
    textAlign?: unknown;
    opacity?: unknown;
  };

  const snapshot: Partial<TextToolStyle> = {
    fontWeight: textObject.fontWeight === 'bold' ? 'bold' : 'normal',
    fontStyle: textObject.fontStyle === 'italic' ? 'italic' : 'normal',
    underline: textObject.underline === true,
    textAlign: textObject.textAlign === 'center' || textObject.textAlign === 'right' ? textObject.textAlign : 'left',
  };
  if (typeof textObject.fontFamily === 'string') {
    snapshot.fontFamily = textObject.fontFamily;
  }
  if (typeof textObject.fontSize === 'number') {
    snapshot.fontSize = textObject.fontSize;
  }
  if (typeof textObject.opacity === 'number') {
    snapshot.opacity = textObject.opacity;
  }
  return snapshot;
}

function applyViewportTransform(
  fabricCanvas: FabricCanvas,
  viewport: { width: number; height: number },
  camera: { x: number; y: number },
  zoom: number,
) {
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  if (fabricCanvas.getWidth() !== width) {
    fabricCanvas.setDimensions({ width, height });
  } else if (fabricCanvas.getHeight() !== height) {
    fabricCanvas.setDimensions({ width, height });
  }
  fabricCanvas.viewportTransform = [
    zoom,
    0,
    0,
    zoom,
    width * 0.5 - camera.x * zoom,
    height * 0.5 + camera.y * zoom,
  ];
  fabricCanvas.requestRenderAll();
}

export const BackgroundVectorCanvas = forwardRef<BackgroundVectorCanvasHandle, BackgroundVectorCanvasProps>(({
  alignmentBounds,
  layer,
  viewport,
  camera,
  zoom,
  activeTool,
  brushColor,
  textStyle,
  vectorStyle,
  vectorStyleChangeRevision,
  latestVectorStyleUpdates,
  sliderCommitBoundaryState,
  sliderCommitBoundaryStateRef,
  interactive,
  onDirty,
  onHistoryStateChange,
  onSelectionChange,
  onVectorGroupingStateChange,
  onTextSelectionChange,
  onTextStyleSync,
  vectorHandleMode,
  onVectorHandleModeSync,
  onVectorPointEditingChange,
  onVectorPointSelectionChange,
  onVectorStyleSync,
  onVectorStyleCapabilitiesSync,
  onCanZoomToSelectionChange,
  onCanvasContextMenu,
}, ref) => {
  const hostElementRef = useRef<HTMLDivElement | null>(null);
  const textEditingHostRef = useRef<HTMLDivElement | null>(null);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const vectorTextureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const vectorGuideCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const penOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const vectorTextureOverlayDprRef = useRef(1);
  const vectorGuideOverlayDprRef = useRef(1);
  const penOverlayDprRef = useRef(1);
  const vectorGuideCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);
  const resolveLiveVectorTexturePreviewObjectsRef = useRef<() => readonly any[]>(() => []);
  const loadedLayerKeyRef = useRef<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const shapeDraftRef = useRef<VectorShapeDraft | null>(null);
  const shapeDraftHistoryBaselineRef = useRef<number | null>(null);
  const bitmapFloatingObjectRef = useRef<any | null>(null);
  const originalControlsRef = useRef<WeakMap<object, Record<string, Control> | undefined>>(new WeakMap());
  const activePathAnchorRef = useRef<{ path: any; anchorIndex: number } | null>(null);
  const vectorPointEditingTargetRef = useRef<any | null>(null);
  const hoveredVectorTargetRef = useRef<any | null>(null);
  const vectorGroupEditingPathRef = useRef<any[]>([]);
  const selectedPathAnchorIndicesRef = useRef<number[]>([]);
  const pointSelectionTransformFrameRef = useRef<PointSelectionTransformFrameState | null>(null);
  const pointSelectionTransformSessionRef = useRef<PointSelectionTransformSession | null>(null);
  const pointSelectionMarqueeSessionRef = useRef<PointSelectionMarqueeSession | null>(null);
  const mirroredPathAnchorDragSessionRef = useRef<MirroredPathAnchorDragSession | null>(null);
  const mirroredPathAnchorDragModifierStateRef = useRef({ space: false });
  const insertedPathAnchorDragSessionRef = useRef<{
    path: any;
    anchorIndex: number;
    dragState: PathAnchorDragState;
  } | null>(null);
  const pendingSelectionSyncedVectorHandleModeRef = useRef<VectorHandleMode | null>(null);
  const vectorHandleModeRef = useRef(vectorHandleMode);
  const activeLayerVisibleRef = useRef(layer?.visible ?? true);
  const editorModeRef = useRef<'vector'>('vector');
  const activeToolRef = useRef(activeTool);
  const brushColorRef = useRef(brushColor);
  const textStyleRef = useRef(textStyle);
  const vectorStyleRef = useRef(vectorStyle);
  const zoomRef = useRef(zoom);
  const viewportRef = useRef(viewport);
  const cameraRef = useRef(camera);
  const onDirtyRef = useRef(onDirty);
  const onHistoryStateChangeRef = useRef(onHistoryStateChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onTextSelectionChangeRef = useRef(onTextSelectionChange);
  const onVectorGroupingStateChangeRef = useRef(onVectorGroupingStateChange);
  const onTextStyleSyncRef = useRef(onTextStyleSync);
  const onSelectionStateChangeRef = useRef<((state: {
    hasSelection: boolean;
    hasBitmapFloatingSelection: boolean;
  }) => void) | undefined>(undefined);
  const onVectorHandleModeSyncRef = useRef(onVectorHandleModeSync);
  const onVectorPointEditingChangeRef = useRef(onVectorPointEditingChange);
  const onVectorPointSelectionChangeRef = useRef(onVectorPointSelectionChange);
  const onVectorStyleSyncRef = useRef(onVectorStyleSync);
  const onVectorStyleCapabilitiesSyncRef = useRef(onVectorStyleCapabilitiesSync);
  const onCanZoomToSelectionChangeRef = useRef(onCanZoomToSelectionChange);
  const onCanvasContextMenuRef = useRef(onCanvasContextMenu);
  const suppressDirtyRef = useRef(false);
  const pendingLoadPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const ignoreCanvasHistoryEventsRef = useRef(false);
  const skipNextObjectModifiedTargetRef = useRef<object | null>(null);
  const renderPenDraftGuideRef = useRef<(ctx: CanvasRenderingContext2D) => boolean>(() => false);
  const historySnapshotsRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const pendingVectorStyleHistorySaveRef = useRef<number | null>(null);
  const pendingSliderStyleCommitRef = useRef(false);
  const skipNextSelectionSyncedVectorStyleApplyRef = useRef(false);
  const bitmapBrushKindRef = useRef<BitmapBrushKind>('hard-round');
  const brushOpacityRef = useRef(1);
  const brushSizeRef = useRef(1);
  const [canZoomToSelection, setCanZoomToSelection] = useState(false);
  const clearHistoryEffectRef = useRef<() => void>(() => undefined);
  const renderVectorPointEditingGuideEffectRef = useRef<() => void>(() => undefined);
  const restoreAllOriginalControlsEffectRef = useRef<() => void>(() => undefined);
  const setVectorPointEditingTargetEffectRef = useRef<(target: any | null) => void>(() => undefined);
  const previousVectorStyleRef = useRef(vectorStyle);
  const previousVectorStyleChangeRevisionRef = useRef(vectorStyleChangeRevision);
  const previousSliderCommitRevisionRef = useRef(sliderCommitBoundaryState.commitRevision);

  useToolbarSliderPreviewCommitDeferral(
    sliderCommitBoundaryState.isPreviewActive,
    pendingVectorStyleHistorySaveRef,
    pendingSliderStyleCommitRef,
  );

  activeToolRef.current = activeTool;
  brushColorRef.current = brushColor;
  textStyleRef.current = textStyle;
  vectorStyleRef.current = vectorStyle;
  zoomRef.current = zoom;
  viewportRef.current = viewport;
  cameraRef.current = camera;
  vectorHandleModeRef.current = vectorHandleMode;
  activeLayerVisibleRef.current = layer?.visible ?? true;
  onDirtyRef.current = onDirty;
  onHistoryStateChangeRef.current = onHistoryStateChange;
  onSelectionChangeRef.current = onSelectionChange;
  onVectorGroupingStateChangeRef.current = onVectorGroupingStateChange;
  onTextSelectionChangeRef.current = onTextSelectionChange;
  onTextStyleSyncRef.current = onTextStyleSync;
  onSelectionStateChangeRef.current = (state) => {
    onSelectionChangeRef.current(state.hasSelection);
  };
  onVectorHandleModeSyncRef.current = onVectorHandleModeSync;
  onVectorPointEditingChangeRef.current = onVectorPointEditingChange;
  onVectorPointSelectionChangeRef.current = onVectorPointSelectionChange;
  onVectorStyleSyncRef.current = onVectorStyleSync;
  onVectorStyleCapabilitiesSyncRef.current = onVectorStyleCapabilitiesSync;
  onCanZoomToSelectionChangeRef.current = onCanZoomToSelectionChange;
  onCanvasContextMenuRef.current = onCanvasContextMenu;

  const emitHistoryState = useMemo(() => () => {
    onHistoryStateChangeRef.current(
      getLinearLocalHistoryAvailability(
        historyIndexRef.current,
        historySnapshotsRef.current.length,
      ),
    );
  }, []);

  const clearHistory = useMemo(() => () => {
    clearLinearLocalHistory(historySnapshotsRef, historyIndexRef);
    emitHistoryState();
  }, [emitHistoryState]);

  const serializeCanvas = useMemo(() => () => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return null;
    }

    return JSON.stringify(markBackgroundVectorSceneDownDocument(
      fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS) as Record<string, any>,
    ));
  }, []);

  const resetHistory = useMemo(() => () => {
    const snapshot = serializeCanvas();
    rebaseLinearLocalHistoryToSnapshot(snapshot, historySnapshotsRef, historyIndexRef);
    emitHistoryState();
  }, [emitHistoryState, serializeCanvas]);

  const recordHistorySnapshot = useMemo(() => () => {
    if (suppressDirtyRef.current) {
      return false;
    }
    if (sliderCommitBoundaryStateRef.current.isPreviewActive) {
      pendingSliderStyleCommitRef.current = true;
      return false;
    }

    const snapshot = serializeCanvas();
    const didRecord = appendLinearLocalHistorySnapshot(
      snapshot,
      historySnapshotsRef,
      historyIndexRef,
      (a, b) => a === b,
    );
    if (!didRecord) {
      emitHistoryState();
      return false;
    }

    emitHistoryState();
    onDirtyRef.current();
    return true;
  }, [emitHistoryState, serializeCanvas]);

  const ignoreCanvasHistoryEventsTemporarily = useMemo(() => () => {
    ignoreCanvasHistoryEventsRef.current = true;
    window.setTimeout(() => {
      ignoreCanvasHistoryEventsRef.current = false;
    }, 100);
  }, []);

  const scheduleVectorStyleHistorySnapshot = useMemo(() => () => {
    if (typeof window === 'undefined') {
      recordHistorySnapshot();
      return;
    }

    if (pendingVectorStyleHistorySaveRef.current !== null) {
      window.clearTimeout(pendingVectorStyleHistorySaveRef.current);
    }

    pendingVectorStyleHistorySaveRef.current = window.setTimeout(() => {
      pendingVectorStyleHistorySaveRef.current = null;
      recordHistorySnapshot();
    }, 120);
  }, [recordHistorySnapshot]);

  const syncTextStyleFromSelection = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }
    const activeObject = fabricCanvas.getActiveObject() as any;
    const snapshot = getTextStyleSnapshot(activeObject);
    if (snapshot) {
      onTextStyleSyncRef.current(snapshot);
    }
  }, []);

  const syncTextSelectionState = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }
    const activeObject = fabricCanvas.getActiveObject() as any;
    onTextSelectionChangeRef.current(!!activeObject && isTextObject(activeObject));
  }, []);

  const syncVectorStyleFromSelection = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }

    const activeObject = fabricCanvas.getActiveObject() as any;
    onVectorStyleCapabilitiesSyncRef.current?.(getVectorStyleCapabilitiesForSelection(activeObject));
    const snapshot = getVectorStyleSelectionSnapshot(activeObject);
    if (!snapshot) {
      return;
    }

    skipNextSelectionSyncedVectorStyleApplyRef.current = onVectorStyleSyncRef.current?.(snapshot) === true;
  }, []);

  const bindTextObjectEvents = useMemo(() => (obj: unknown) => {
    if (!isTextEditableObject(obj)) {
      return;
    }

    const textObject = obj as any;
    attachTextEditingContainer(textObject, textEditingHostRef.current);
    if (textObject.__backgroundTextEventsBound) {
      return;
    }
    textObject.__backgroundTextEventsBound = true;
    textObject.on?.('editing:entered', () => {
      syncTextSelectionState();
      syncTextStyleFromSelection();
    });
    textObject.on?.('editing:exited', () => {
      syncTextSelectionState();
      syncTextStyleFromSelection();
      recordHistorySnapshot();
    });
  }, [recordHistorySnapshot, syncTextSelectionState, syncTextStyleFromSelection]);

  const drawPenOverlay = useMemo(() => () => {
    const overlayCanvas = penOverlayCanvasRef.current;
    const fabricCanvas = fabricCanvasRef.current;
    if (!overlayCanvas || !fabricCanvas) {
      return;
    }

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.save();
    clearCanvasInCssPixels(ctx, viewport.width, viewport.height, penOverlayDprRef.current);
    const viewportTransform = fabricCanvas.viewportTransform;
    if (viewportTransform) {
      ctx.transform(
        viewportTransform[0] ?? 1,
        viewportTransform[1] ?? 0,
        viewportTransform[2] ?? 0,
        viewportTransform[3] ?? 1,
        viewportTransform[4] ?? 0,
        viewportTransform[5] ?? 0,
      );
    }
    renderPenDraftGuideRef.current(ctx);
    ctx.restore();
  }, [viewport.height, viewport.width]);

  const drawVectorTextureOverlay = useMemo(() => () => {
    const overlayCanvas = vectorTextureCanvasRef.current;
    const fabricCanvas = fabricCanvasRef.current;
    if (!overlayCanvas || !fabricCanvas) {
      return;
    }

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.save();
    clearCanvasInCssPixels(ctx, viewport.width, viewport.height, vectorTextureOverlayDprRef.current);
    renderComposedVectorSceneForFabricCanvas(ctx, fabricCanvas, {
      canvasWidth: viewport.width,
      canvasHeight: viewport.height,
      clear: false,
      additionalObjects: resolveLiveVectorTexturePreviewObjectsRef.current(),
      onTextureSourceReady: () => {
        fabricCanvasRef.current?.requestRenderAll();
      },
    });
    ctx.restore();
  }, [viewport.height, viewport.width]);

  const clearVectorGuideOverlayContext = useCallback((ctx: CanvasRenderingContext2D) => {
    clearCanvasInCssPixels(ctx, viewport.width, viewport.height, vectorGuideOverlayDprRef.current);
  }, [viewport.height, viewport.width]);
  const mapFabricOverlayPoint = useCallback((point: Point) => {
    const viewportTransform = fabricCanvasRef.current?.viewportTransform;
    if (!viewportTransform) {
      return new Point(point.x, point.y);
    }
    return new Point(point.x, point.y).transform(viewportTransform);
  }, []);

  const applyVectorGuideSceneTransform = useCallback((ctx: CanvasRenderingContext2D, fabricCanvas: FabricCanvas) => {
    const viewportTransform = fabricCanvas.viewportTransform;
    if (!viewportTransform) {
      return;
    }
    ctx.transform(
      viewportTransform[0] ?? 1,
      viewportTransform[1] ?? 0,
      viewportTransform[2] ?? 0,
      viewportTransform[3] ?? 1,
      viewportTransform[4] ?? 0,
      viewportTransform[5] ?? 0,
    );
  }, []);

  const getZoomInvariantMetric = useCallback((metric: number, zoomValue = zoomRef.current) => {
    return getZoomInvariantCanvasMetric(metric, zoomValue);
  }, []);

  const normalizeCanvasVectorStrokeUniform = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return false;
    }

    let changed = false;
    forEachFabricObjectDeep(fabricCanvas, (obj: any) => {
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

  const renderPenDraftGuideFromRef = useCallback((ctx: CanvasRenderingContext2D) => {
    return renderPenDraftGuideRef.current(ctx);
  }, []);
  const commitBitmapStampBrushStroke = useCallback(async () => {}, []);
  const getBitmapFloatingSelectionObject = useCallback(() => bitmapFloatingObjectRef.current, []);
  const syncBrushCursorOverlay = useCallback(() => {}, []);

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
    onVectorGroupingStateChangeRef,
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
    mapFabricOverlayPoint,
    movePathAnchorByDelta,
    mirroredPathAnchorDragSessionRef,
    originalControlsRef,
    pointSelectionMarqueeSessionRef,
    hoveredVectorTargetRef,
    removeDuplicateClosedPathAnchorControl,
    renderPenDraftGuide: renderPenDraftGuideFromRef,
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
    activeLayerLocked: !interactive || !layer || layer.locked,
    activeLayerVisible: layer?.visible ?? true,
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
    onVectorTexturePreviewChange: drawVectorTextureOverlay,
    restoreAllOriginalControls,
    restoreOriginalControls,
    saveHistory: recordHistorySnapshot,
    setVectorPointEditingTarget,
    syncBrushCursorOverlay,
    syncSelectionState,
    textEditingHostRef,
    hoveredVectorTargetRef,
    vectorGroupEditingPathRef,
    vectorPointEditingTargetRef,
    vectorStyleRef,
  });

  const {
    alignSelection: alignCanvasSelection,
    deleteSelection: deleteCanvasSelection,
    moveSelectionOrder: moveCanvasSelectionOrder,
    groupSelection: groupCanvasSelection,
    nudgeSelection: nudgeCanvasSelection,
    flipSelection: flipCanvasSelection,
    rotateSelection: rotateCanvasSelection,
    ungroupSelection: ungroupCanvasSelection,
  } = useCostumeCanvasSelectionTransformCommands({
    fabricCanvasRef,
    getAlignmentBounds: () => alignmentBounds,
    getSelectionBoundsSnapshot,
    restoreCanvasSelection,
    saveHistory: recordHistorySnapshot,
    syncSelectionState,
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
    saveHistory: recordHistorySnapshot,
    syncSelectionState,
    vectorStyleRef,
  });
  renderPenDraftGuideRef.current = renderPenDraftGuide;

  const resolveLiveVectorTexturePreviewObjects = useCallback(() => {
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
  resolveLiveVectorTexturePreviewObjectsRef.current = resolveLiveVectorTexturePreviewObjects;

  const finalizePenDraftWithOverlay = useCallback(() => {
    const didFinalize = finalizePenDraft();
    drawPenOverlay();
    return didFinalize;
  }, [drawPenOverlay, finalizePenDraft]);

  const removeLastPenDraftAnchorWithOverlay = useCallback(() => {
    removeLastPenDraftAnchor();
    drawPenOverlay();
  }, [drawPenOverlay, removeLastPenDraftAnchor]);

  const setPenAnchorMoveModeWithOverlay = useCallback((enabled: boolean) => {
    const didChange = setPenAnchorMoveMode(enabled);
    if (didChange) {
      drawPenOverlay();
    }
    return didChange;
  }, [drawPenOverlay, setPenAnchorMoveMode]);

  const syncPenPlacementToAltModifierWithOverlay = useCallback((enabled: boolean) => {
    const didChange = syncPenPlacementToAltModifier(enabled);
    if (didChange) {
      drawPenOverlay();
    }
    return didChange;
  }, [drawPenOverlay, syncPenPlacementToAltModifier]);

  const {
    duplicateSelection,
    copySelection,
    cutSelection,
    pasteSelection,
  } = useFabricVectorClipboardCommands<any>({
    beforeDuplicate: ignoreCanvasHistoryEventsTemporarily,
    beforePaste: ignoreCanvasHistoryEventsTemporarily,
    cloneObject: cloneFabricObjectWithVectorStyle,
    deleteSelection: deleteCanvasSelection,
    fabricCanvasRef,
    normalizeCanvasVectorStrokeUniform,
    pasteTargetCenter: worldPointToScenePoint(camera),
    resolveInsertionParent: () => vectorGroupEditingPathRef.current.at(-1) ?? null,
    saveHistory: recordHistorySnapshot,
    syncSelectionState,
  });
  clearHistoryEffectRef.current = clearHistory;
  renderVectorPointEditingGuideEffectRef.current = renderVectorPointEditingGuide;
  restoreAllOriginalControlsEffectRef.current = restoreAllOriginalControls;
  setVectorPointEditingTargetEffectRef.current = setVectorPointEditingTarget;

  useEffect(() => {
    return () => {
      if (pendingVectorStyleHistorySaveRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(pendingVectorStyleHistorySaveRef.current);
      }
    };
  }, []);

  useEffect(() => {
    onCanZoomToSelectionChangeRef.current(canZoomToSelection);
  }, [canZoomToSelection]);

  useEffect(() => {
    return () => {
      onCanZoomToSelectionChangeRef.current(false);
    };
  }, []);

  const loadSerializedDocument = useMemo(() => (
    json: string,
    options?: { logInvalid?: boolean; resetHistory?: boolean },
  ) => {
    const loadPromise = (async () => {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas) {
        return false;
      }

      const requestId = ++loadRequestIdRef.current;
      let parsed: string | Record<string, any>;
      let coordinateSpace: 'legacy-world-up' | 'scene-down' = 'legacy-world-up';
      try {
        const parsedDocument = parseBackgroundVectorFabricJson(json);
        parsed = parsedDocument.parsed;
        coordinateSpace = parsedDocument.coordinateSpace;
      } catch (error) {
        if (options?.logInvalid !== false) {
          console.warn('Invalid background vector document. Loading an empty layer instead.', error);
        }
        parsed = JSON.parse(EMPTY_BACKGROUND_VECTOR_FABRIC_JSON);
      }

      suppressDirtyRef.current = true;
      try {
        await fabricCanvas.loadFromJSON(parsed);
        if (loadRequestIdRef.current !== requestId) {
          return false;
        }

        if (coordinateSpace === 'legacy-world-up') {
          reflectBackgroundVectorObjectsAcrossXAxis(fabricCanvas);
        }

        restoreAllOriginalControls();
        setVectorPointEditingTarget(null);
        hoveredVectorTargetRef.current = null;
        vectorGroupEditingPathRef.current = [];
        activePathAnchorRef.current = null;
        skipNextObjectModifiedTargetRef.current = null;
        fabricCanvas.discardActiveObject();
        forEachFabricObjectDeep(fabricCanvas, (obj: any) => {
          normalizeVectorObjectRendering(obj);
          bindTextObjectEvents(obj);
        });
        syncTextSelectionState();
        syncVectorStyleFromSelection();
        syncSelectionState();
        applyViewportTransform(fabricCanvas, viewport, camera, zoom);
        configureCanvasForTool();
        drawVectorTextureOverlay();
        renderVectorPointEditingGuide();
        drawPenOverlay();
        if (options?.resetHistory !== false) {
          resetHistory();
        } else {
          emitHistoryState();
        }
        return true;
      } finally {
        if (loadRequestIdRef.current === requestId) {
          suppressDirtyRef.current = false;
        }
      }
    })();

    const idlePromise = loadPromise.then(() => undefined, () => undefined);
    pendingLoadPromiseRef.current = idlePromise;
    return loadPromise.finally(() => {
      if (pendingLoadPromiseRef.current === idlePromise) {
        pendingLoadPromiseRef.current = Promise.resolve();
      }
    });
  }, [
    bindTextObjectEvents,
    camera,
    drawPenOverlay,
    drawVectorTextureOverlay,
    emitHistoryState,
    renderVectorPointEditingGuide,
    resetHistory,
    restoreAllOriginalControls,
    setVectorPointEditingTarget,
    configureCanvasForTool,
    syncSelectionState,
    syncTextSelectionState,
    syncVectorStyleFromSelection,
    viewport,
    zoom,
  ]);

  const supportsPointerEvents = useMemo(
    () => interactive && (activeTool === 'select' || activeTool === 'pen' || activeTool === 'brush' || activeTool === 'text'),
    [activeTool, interactive],
  );

  useEffect(() => {
    const hostElement = hostElementRef.current;
    if (!hostElement) {
      return;
    }

    hostElement.replaceChildren();
    const textEditingHost = document.createElement('div');
    textEditingHost.className = 'pointer-events-none absolute inset-0 z-[4] overflow-hidden';
    textEditingHost.setAttribute('aria-hidden', 'true');
    hostElement.appendChild(textEditingHost);
    textEditingHostRef.current = textEditingHost;
    const canvasElement = document.createElement('canvas');
    canvasElement.className = 'absolute inset-0';
    hostElement.appendChild(canvasElement);
    canvasElementRef.current = canvasElement;
    const initialViewport = viewportRef.current;

    const fabricCanvas = new FabricCanvas(canvasElement, {
      width: Math.max(1, Math.floor(initialViewport.width)),
      height: Math.max(1, Math.floor(initialViewport.height)),
      preserveObjectStacking: true,
      renderOnAddRemove: false,
      enableRetinaScaling: true,
    });
    applyUnifiedFabricTransformCanvasOptions(fabricCanvas);
    const instrumentedCanvas = fabricCanvas as FabricCanvas & {
      upperCanvasEl?: HTMLCanvasElement;
      wrapperEl?: HTMLDivElement;
    };
    const contextMenuTargets = [
      instrumentedCanvas.upperCanvasEl,
      instrumentedCanvas.wrapperEl,
    ].filter((target): target is HTMLCanvasElement | HTMLDivElement => !!target);
    instrumentedCanvas.upperCanvasEl?.setAttribute('data-testid', 'background-vector-layer-canvas');
    instrumentedCanvas.wrapperEl?.setAttribute('data-testid', 'background-vector-layer-surface');
    instrumentedCanvas.wrapperEl?.classList.add('absolute', 'inset-0', 'z-[2]');
    if (instrumentedCanvas.lowerCanvasEl) {
      instrumentedCanvas.lowerCanvasEl.style.opacity = '0';
    }
    const handleContextMenu: EventListener = (event) => {
      if (!(event instanceof MouseEvent)) {
        return;
      }
      if (!interactive) {
        return;
      }
      event.preventDefault();
      onCanvasContextMenuRef.current?.(event);
    };
    contextMenuTargets.forEach((target) => {
      target.addEventListener('contextmenu', handleContextMenu, true);
    });
    const vectorTextureCanvas = document.createElement('canvas');
    vectorTextureCanvas.className = 'pointer-events-none absolute inset-0 z-[1]';
    vectorTextureCanvas.setAttribute('aria-hidden', 'true');
    vectorTextureCanvas.setAttribute('data-testid', 'background-vector-texture-overlay');
    hostElement.appendChild(vectorTextureCanvas);
    vectorTextureCanvasRef.current = vectorTextureCanvas;
    const vectorGuideCanvas = document.createElement('canvas');
    vectorGuideCanvas.className = 'pointer-events-none absolute inset-0 z-[3]';
    vectorGuideCanvas.setAttribute('aria-hidden', 'true');
    hostElement.appendChild(vectorGuideCanvas);
    vectorGuideCanvasRef.current = vectorGuideCanvas;
    vectorGuideCtxRef.current = vectorGuideCanvas.getContext('2d');
    const penOverlayCanvas = document.createElement('canvas');
    penOverlayCanvas.className = 'pointer-events-none absolute inset-0 z-[4]';
    penOverlayCanvas.setAttribute('aria-hidden', 'true');
    hostElement.appendChild(penOverlayCanvas);
    penOverlayCanvasRef.current = penOverlayCanvas;

    fabricCanvasRef.current = fabricCanvas;
    applyViewportTransform(fabricCanvas, viewportRef.current, cameraRef.current, zoomRef.current);
    renderVectorPointEditingGuideEffectRef.current();

    return () => {
      restoreAllOriginalControlsEffectRef.current();
      setVectorPointEditingTargetEffectRef.current(null);
      hoveredVectorTargetRef.current = null;
      vectorGroupEditingPathRef.current = [];
      activePathAnchorRef.current = null;
      shapeDraftRef.current = null;
      shapeDraftHistoryBaselineRef.current = null;
      loadedLayerKeyRef.current = null;
      loadRequestIdRef.current += 1;
      penOverlayCanvasRef.current = null;
      vectorTextureCanvasRef.current = null;
      vectorGuideCanvasRef.current = null;
      vectorGuideCtxRef.current = null;
      textEditingHostRef.current = null;
      clearHistoryEffectRef.current();
      onSelectionChangeRef.current(false);
      onVectorGroupingStateChangeRef.current?.({ canGroup: false, canUngroup: false });
      onTextSelectionChangeRef.current(false);
      contextMenuTargets.forEach((target) => {
        target.removeEventListener('contextmenu', handleContextMenu, true);
      });
      try {
        fabricCanvas.dispose();
      } finally {
        hostElement.replaceChildren();
        canvasElementRef.current = null;
        fabricCanvasRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const nextOpacity = layer?.visible ?? true ? '1' : '0';
    const fabricCanvas = fabricCanvasRef.current as (FabricCanvas & {
      lowerCanvasEl?: HTMLCanvasElement;
      upperCanvasEl?: HTMLCanvasElement;
    }) | null;
    if (fabricCanvas?.lowerCanvasEl) {
      fabricCanvas.lowerCanvasEl.style.opacity = '0';
    }
    if (fabricCanvas?.upperCanvasEl) {
      fabricCanvas.upperCanvasEl.style.opacity = nextOpacity;
    }
    if (vectorTextureCanvasRef.current) {
      vectorTextureCanvasRef.current.style.opacity = nextOpacity;
    }
  }, [layer?.visible]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }
    applyViewportTransform(fabricCanvas, viewport, camera, zoom);
    syncCanvasSelectionGizmoAppearance({
      fabricCanvas,
      getZoomInvariantMetric,
      pointEditingTarget: vectorPointEditingTargetRef.current,
      renderVectorPointEditingGuide,
      renderSpace: 'fabric-viewport',
      zoom,
    });
    drawVectorTextureOverlay();
    drawPenOverlay();
  }, [camera, drawPenOverlay, drawVectorTextureOverlay, getZoomInvariantMetric, renderVectorPointEditingGuide, viewport, zoom]);

  useEffect(() => {
    const vectorTextureCanvas = vectorTextureCanvasRef.current;
    const penOverlayCanvas = penOverlayCanvasRef.current;
    const vectorGuideCanvas = vectorGuideCanvasRef.current;
    if (!vectorTextureCanvas || !penOverlayCanvas || !vectorGuideCanvas) {
      return;
    }

    vectorTextureOverlayDprRef.current = syncCanvasViewportSize(
      vectorTextureCanvas,
      viewport.width,
      viewport.height,
    );
    penOverlayDprRef.current = syncCanvasViewportSize(
      penOverlayCanvas,
      viewport.width,
      viewport.height,
    );
    vectorGuideOverlayDprRef.current = syncCanvasViewportSize(
      vectorGuideCanvas,
      viewport.width,
      viewport.height,
    );
    drawVectorTextureOverlay();
    renderVectorPointEditingGuide();
    drawPenOverlay();
  }, [drawPenOverlay, drawVectorTextureOverlay, renderVectorPointEditingGuide, viewport.height, viewport.width]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }

    if (!layer) {
      restoreAllOriginalControls();
      setVectorPointEditingTarget(null);
      hoveredVectorTargetRef.current = null;
      vectorGroupEditingPathRef.current = [];
      activePathAnchorRef.current = null;
      fabricCanvas.clear();
      loadedLayerKeyRef.current = null;
      shapeDraftHistoryBaselineRef.current = null;
      clearHistory();
      syncTextSelectionState();
      syncSelectionState();
      onVectorGroupingStateChangeRef.current?.({ canGroup: false, canUngroup: false });
      onVectorStyleCapabilitiesSyncRef.current?.({ supportsFill: true });
      drawVectorTextureOverlay();
      drawPenOverlay();
      renderVectorPointEditingGuide();
      fabricCanvas.requestRenderAll();
      return;
    }

    const layerKey = `${layer.id}:${layer.vector.fabricJson}`;
    if (loadedLayerKeyRef.current === layerKey) {
      return;
    }

    const liveSerializedDocument = serializeCanvas();
    if (liveSerializedDocument && layer.vector.fabricJson === liveSerializedDocument) {
      loadedLayerKeyRef.current = layerKey;
      return;
    }

    shapeDraftRef.current = null;
    shapeDraftHistoryBaselineRef.current = null;
    loadedLayerKeyRef.current = layerKey;
    void loadSerializedDocument(layer.vector.fabricJson, { logInvalid: true, resetHistory: true });
  }, [
    clearHistory,
    drawPenOverlay,
    drawVectorTextureOverlay,
    layer,
    loadSerializedDocument,
    renderVectorPointEditingGuide,
    restoreAllOriginalControls,
    serializeCanvas,
    setVectorPointEditingTarget,
    syncSelectionState,
    syncTextSelectionState,
  ]);

  useLayoutEffect(() => {
    configureCanvasForTool();
  }, [
    activeTool,
    brushColor,
    configureCanvasForTool,
    interactive,
    layer?.locked,
    layer?.visible,
    textStyle,
    vectorStyle,
  ]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }

    const setHoveredVectorTarget = (nextTarget: any | null) => {
      const nextHoveredTarget = (
        nextTarget &&
        fabricCanvasContainsObject(fabricCanvas, nextTarget) &&
        !isActiveSelectionObject(nextTarget)
      )
        ? nextTarget
        : null;
      if (hoveredVectorTargetRef.current === nextHoveredTarget) {
        return;
      }
      hoveredVectorTargetRef.current = nextHoveredTarget;
      fabricCanvas.requestRenderAll();
    };

    const setVectorGroupEditingPath = (nextPath: any[]) => {
      vectorGroupEditingPathRef.current = sanitizeVectorGroupEditingPath(fabricCanvas, nextPath);
    };

    const syncVectorGroupEditingPathFromSelection = (activeObject: any | null) => {
      if (!activeObject) {
        return;
      }

      const currentPath = sanitizeVectorGroupEditingPath(fabricCanvas, vectorGroupEditingPathRef.current);
      if (isFabricGroupObject(activeObject) && currentPath.at(-1) === activeObject) {
        vectorGroupEditingPathRef.current = currentPath;
        return;
      }

      setVectorGroupEditingPath(getVectorGroupEditingPathForTarget(activeObject));
    };

    const enterVectorGroupEditing = (
      group: any,
      options?: {
        selectionTarget?: any | null;
      },
    ): boolean => {
      if (!isFabricGroupObject(group) || !fabricCanvasContainsObject(fabricCanvas, group)) {
        return false;
      }

      const selectionTarget = (
        options?.selectionTarget &&
        fabricCanvasContainsObject(fabricCanvas, options.selectionTarget)
      )
        ? options.selectionTarget
        : null;
      setVectorGroupEditingPath([
        ...getVectorGroupEditingPathForTarget(group),
        group,
      ]);
      setHoveredVectorTarget(selectionTarget ?? group);
      fabricCanvas.setActiveObject(selectionTarget ?? group);
      configureCanvasForTool();
      syncSelectionState();
      fabricCanvas.requestRenderAll();
      return true;
    };

    const queueRootVectorGroupSelectionRestore = () => {
      if (activeToolRef.current !== 'select' || vectorPointEditingTargetRef.current) {
        return;
      }

      const rootGroup = resolveVectorGroupEditingRootTarget(
        fabricCanvas,
        vectorGroupEditingPathRef.current,
      );
      if (!rootGroup) {
        return;
      }

      queueMicrotask(() => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) {
          return;
        }
        if (activeToolRef.current !== 'select' || vectorPointEditingTargetRef.current) {
          return;
        }
        if (canvas.getActiveObject()) {
          return;
        }

        const nextRootGroup = resolveVectorGroupEditingRootTarget(
          canvas,
          vectorGroupEditingPathRef.current,
        );
        if (!nextRootGroup) {
          return;
        }

        vectorGroupEditingPathRef.current = [];
        canvas.discardActiveObject();
        canvas.setActiveObject(nextRootGroup as any);
        configureCanvasForTool();
        syncTextStyleFromSelection();
        syncVectorStyleFromSelection();
        syncTextSelectionState();
        syncSelectionState();
        canvas.requestRenderAll();
      });
    };

    const handleMouseDown = (opt: any) => {
      if (!opt.e) {
        return;
      }

      const layerInteractive = interactive && (layer?.visible ?? true) && !layer?.locked;
      if (!layerInteractive) {
        return;
      }

      const pointer = fabricCanvas.getScenePoint(opt.e);
      configureUnifiedObjectTransformForGesture(fabricCanvas, opt.e);
      syncUnifiedCanvasTransformGuideFromEvent(fabricCanvas, opt.e);
      const tool = activeToolRef.current;

      if (tool === 'pen') {
        startPenAnchorPlacement(pointer, { cuspMode: opt.e.altKey === true });
        fabricCanvas.requestRenderAll();
        drawPenOverlay();
        return;
      }

      if (tool === 'select') {
        const pointEditingTarget = vectorPointEditingTargetRef.current;
        const clickedTarget = opt.target as any;
        const clickedPointEditingTarget = !!pointEditingTarget && clickedTarget === pointEditingTarget;
        const clickedActivePathControl = clickedPointEditingTarget && typeof clickedTarget?.__corner === 'string' && clickedTarget.__corner.length > 0;
        const pointSelectionToggle = isPointSelectionToggleModifierPressed(opt.e);
        const pointSelectionTransformHit = (
          pointEditingTarget &&
          !clickedActivePathControl
        )
          ? (() => {
              const snapshot = getSelectedPathAnchorTransformSnapshot(pointEditingTarget);
              return snapshot ? hitPointSelectionTransform(snapshot, pointer) : null;
            })()
          : null;

        if (pointEditingTarget && pointSelectionTransformHit) {
          pointSelectionTransformSessionRef.current = null;
          insertedPathAnchorDragSessionRef.current = null;
          if (beginPointSelectionTransformSession(pointEditingTarget, pointSelectionTransformHit, pointer)) {
            fabricCanvas.setActiveObject(pointEditingTarget);
            fabricCanvas.requestRenderAll();
            return;
          }
        }

        if (pointEditingTarget && !clickedPointEditingTarget && opt.e.detail >= 2) {
          clearSelectedPathAnchors(pointEditingTarget);
          restoreAllOriginalControls();
          setVectorPointEditingTarget(null);
          queueMicrotask(() => {
            const canvas = fabricCanvasRef.current;
            if (!canvas || !fabricCanvasContainsObject(canvas, pointEditingTarget)) {
              return;
            }
            canvas.setActiveObject(pointEditingTarget);
            configureCanvasForTool();
          });
          return;
        }

        if (pointEditingTarget && !clickedPointEditingTarget) {
          pointSelectionTransformSessionRef.current = null;
          insertedPathAnchorDragSessionRef.current = null;
          pointSelectionMarqueeSessionRef.current = {
            path: pointEditingTarget,
            startPointerScene: new Point(pointer.x, pointer.y),
            currentPointerScene: new Point(pointer.x, pointer.y),
            initialSelectedAnchorIndices: getSelectedPathAnchorIndices(pointEditingTarget),
            toggleSelection: pointSelectionToggle,
          };
          fabricCanvas.setActiveObject(pointEditingTarget);
          fabricCanvas.requestRenderAll();
          return;
        }

        if (
          pointEditingTarget &&
          clickedPointEditingTarget &&
          !clickedActivePathControl &&
          opt.e.detail === 1
        ) {
          const insertedAnchorIndex = insertPathPointAtScenePosition(pointEditingTarget, pointer);
          if (insertedAnchorIndex !== null) {
            setSelectedPathAnchors(pointEditingTarget, [insertedAnchorIndex], {
              primaryAnchorIndex: insertedAnchorIndex,
            });
            fabricCanvas.setActiveObject(pointEditingTarget);
            applyVectorPointControls(pointEditingTarget);
            applyVectorPointEditingAppearance(pointEditingTarget);
            syncVectorHandleModeFromSelection();
            syncVectorStyleFromSelection();
            syncSelectionState();
            const dragState = getPathAnchorDragState(pointEditingTarget, insertedAnchorIndex);
            insertedPathAnchorDragSessionRef.current = dragState
              ? { path: pointEditingTarget, anchorIndex: insertedAnchorIndex, dragState }
              : null;
            fabricCanvas.requestRenderAll();
            return;
          }
          clearSelectedPathAnchors(pointEditingTarget);
          return;
        }

        if (opt.e.detail >= 2 && clickedTarget) {
          queueMicrotask(() => {
            const canvas = fabricCanvasRef.current;
            if (!canvas || !fabricCanvasContainsObject(canvas, clickedTarget)) {
              return;
            }
            if (isFabricGroupObject(clickedTarget)) {
              const selectionTarget = resolveVectorGroupEntrySelectionTarget(
                clickedTarget,
                clickedTarget,
                opt.subTargets,
              );
              enterVectorGroupEditing(clickedTarget, { selectionTarget });
              return;
            }
            if (!isVectorPointSelectableObject(clickedTarget)) {
              return;
            }
            (canvas as any).setActiveObject(clickedTarget);
            activateVectorPointEditing(clickedTarget, true);
            configureCanvasForTool();
          });
          return;
        }
      }

      if (tool !== 'text') {
        return;
      }

      if (opt.target && isTextEditableObject(opt.target)) {
        const textObject = opt.target as any;
        attachTextEditingContainer(textObject, textEditingHostRef.current);
        queueMicrotask(() => {
          const canvas = fabricCanvasRef.current;
          if (!canvas || !fabricCanvasContainsObject(canvas, textObject)) {
            return;
          }
          beginTextEditing(canvas as any, textObject, { event: opt.e });
          syncTextStyleFromSelection();
          syncTextSelectionState();
          syncSelectionState();
        });
        return;
      }

      const textObject = new IText('text', {
        left: pointer.x,
        top: pointer.y,
        fill: brushColorRef.current,
        fontFamily: textStyleRef.current.fontFamily,
        fontSize: textStyleRef.current.fontSize,
        fontWeight: textStyleRef.current.fontWeight,
        fontStyle: textStyleRef.current.fontStyle,
        underline: textStyleRef.current.underline,
        textAlign: textStyleRef.current.textAlign,
        opacity: textStyleRef.current.opacity,
      } as any);
      bindTextObjectEvents(textObject);
      fabricCanvas.add(textObject);
      beginTextEditing(fabricCanvas as any, textObject, { selectAll: true });
      syncTextStyleFromSelection();
      syncTextSelectionState();
      syncSelectionState();
      fabricCanvas.requestRenderAll();
    };

    const handleMouseMove = (opt: any) => {
      if (!opt.e) {
        return;
      }

      if (interactive && activeToolRef.current === 'pen') {
        const pointer = fabricCanvas.getScenePoint(opt.e);
        if (updatePenAnchorPlacement(pointer)) {
          fabricCanvas.requestRenderAll();
          drawPenOverlay();
          return;
        }
        if (penDraftRef.current) {
          penDraftRef.current.previewPoint = new Point(pointer.x, pointer.y);
          fabricCanvas.requestRenderAll();
          drawPenOverlay();
        }
        return;
      }

      const pointSelectionTransformSession = pointSelectionTransformSessionRef.current;
      if (pointSelectionTransformSession) {
        const pointer = fabricCanvas.getScenePoint(opt.e);
        if (
          activeToolRef.current !== 'select' ||
          vectorPointEditingTargetRef.current !== pointSelectionTransformSession.path ||
          !fabricCanvasContainsObject(fabricCanvas, pointSelectionTransformSession.path)
        ) {
          pointSelectionTransformSessionRef.current = null;
          return;
        }

        const transformed = applyPointSelectionTransformSession(pointSelectionTransformSession, pointer);
        if (transformed) {
          pointSelectionTransformSession.hasChanged = true;
          fabricCanvas.setActiveObject(pointSelectionTransformSession.path);
          fabricCanvas.requestRenderAll();
        }
        return;
      }

      const pointSelectionMarqueeSession = pointSelectionMarqueeSessionRef.current;
      if (pointSelectionMarqueeSession) {
        if (
          activeToolRef.current !== 'select' ||
          vectorPointEditingTargetRef.current !== pointSelectionMarqueeSession.path ||
          !fabricCanvasContainsObject(fabricCanvas, pointSelectionMarqueeSession.path)
        ) {
          pointSelectionMarqueeSessionRef.current = null;
          return;
        }

        pointSelectionMarqueeSession.currentPointerScene = fabricCanvas.getScenePoint(opt.e);
        fabricCanvas.setActiveObject(pointSelectionMarqueeSession.path);
        fabricCanvas.requestRenderAll();
        return;
      }

      const insertedPathAnchorDragSession = insertedPathAnchorDragSessionRef.current;
      if (insertedPathAnchorDragSession) {
        const { path, anchorIndex, dragState } = insertedPathAnchorDragSession;
        if (
          activeToolRef.current !== 'select' ||
          vectorPointEditingTargetRef.current !== path ||
          !fabricCanvasContainsObject(fabricCanvas, path)
        ) {
          insertedPathAnchorDragSessionRef.current = null;
          return;
        }

        const pointer = fabricCanvas.getScenePoint(opt.e);
        const pointerCommandPoint = toPathCommandPoint(path, pointer);
        if (!pointerCommandPoint) {
          return;
        }

        const deltaX = pointerCommandPoint.x - dragState.previousAnchor.x;
        const deltaY = pointerCommandPoint.y - dragState.previousAnchor.y;
        const moved = movePathAnchorByDelta(path, anchorIndex, deltaX, deltaY, dragState);
        if (moved) {
          enforcePathAnchorHandleType(path, anchorIndex, 'anchor', dragState);
          activePathAnchorRef.current = { path, anchorIndex };
          path.setCoords?.();
          fabricCanvas.setActiveObject(path);
          fabricCanvas.requestRenderAll();
        }
        return;
      }

      if (
        activeToolRef.current === 'select' &&
        !vectorPointEditingTargetRef.current
      ) {
        setHoveredVectorTarget(resolveVectorHoverTarget(
          fabricCanvas as any,
          opt.e,
          vectorGroupEditingPathRef.current,
        ) as any);
      }
    };

    const handleMouseOut = () => {
      setHoveredVectorTarget(null);
    };

    const handleMouseUp = () => {
      clearUnifiedCanvasTransformGuide(fabricCanvas);
      if (interactive && activeToolRef.current === 'pen') {
        if (commitCurrentPenPlacement()) {
          fabricCanvas.requestRenderAll();
          drawPenOverlay();
        }
        return;
      }

      if (pointSelectionTransformSessionRef.current) {
        const shouldSave = pointSelectionTransformSessionRef.current.hasChanged;
        pointSelectionTransformSessionRef.current = null;
        if (shouldSave) {
          recordHistorySnapshot();
        }
        return;
      }

      if (pointSelectionMarqueeSessionRef.current) {
        const marqueeSession = pointSelectionMarqueeSessionRef.current;
        pointSelectionMarqueeSessionRef.current = null;
        applyPointSelectionMarqueeSession(marqueeSession);
        if (
          vectorPointEditingTargetRef.current === marqueeSession.path &&
          fabricCanvasContainsObject(fabricCanvas, marqueeSession.path)
        ) {
          fabricCanvas.setActiveObject(marqueeSession.path);
        }
        fabricCanvas.requestRenderAll();
        return;
      }

      if (insertedPathAnchorDragSessionRef.current) {
        insertedPathAnchorDragSessionRef.current = null;
        recordHistorySnapshot();
        return;
      }

      if (mirroredPathAnchorDragSessionRef.current) {
        const shouldSave = mirroredPathAnchorDragSessionRef.current.hasChanged;
        mirroredPathAnchorDragSessionRef.current = null;
        mirroredPathAnchorDragModifierStateRef.current.space = false;
        if (shouldSave) {
          recordHistorySnapshot();
        }
      }
    };

    const handlePathCreated = (event: { path?: any }) => {
      if (ignoreCanvasHistoryEventsRef.current) {
        return;
      }
      const createdPath = event.path;
      if (createdPath && activeToolRef.current === 'brush') {
        normalizeVectorObjectRendering(createdPath);
        createdPath.setCoords?.();
        syncVectorStyleFromSelection();
        syncSelectionState();
        fabricCanvas.requestRenderAll();
      }
      recordHistorySnapshot();
    };

    const handleObjectModified = (event: { target?: any }) => {
      clearUnifiedCanvasTransformGuide(fabricCanvas);
      if (ignoreCanvasHistoryEventsRef.current) {
        return;
      }
      if (event.target && skipNextObjectModifiedTargetRef.current === event.target) {
        skipNextObjectModifiedTargetRef.current = null;
        return;
      }
      recordHistorySnapshot();
    };

    const handleObjectRemoved = () => {
      if (ignoreCanvasHistoryEventsRef.current) {
        return;
      }
      recordHistorySnapshot();
    };

    const handleObjectAdded = (event: { target?: any }) => {
      bindTextObjectEvents(event.target);
      if (ignoreCanvasHistoryEventsRef.current) {
        return;
      }
      if (shapeDraftRef.current?.object === event.target) {
        return;
      }
      recordHistorySnapshot();
    };

    const handleSelectionChange = () => {
      const activeObject = fabricCanvas.getActiveObject() as any;
      setHoveredVectorTarget(null);
      syncVectorGroupEditingPathFromSelection(activeObject);
      if (
        activeToolRef.current === 'select' &&
        vectorPointEditingTargetRef.current &&
        activeObject !== vectorPointEditingTargetRef.current
      ) {
        restoreAllOriginalControls();
        setVectorPointEditingTarget(null);
        queueMicrotask(() => {
          configureCanvasForTool();
        });
      }
      syncTextStyleFromSelection();
      syncVectorStyleFromSelection();
      syncTextSelectionState();
      syncSelectionState();
      if (
        activeToolRef.current === 'select' &&
        vectorPointEditingTargetRef.current &&
        activeObject === vectorPointEditingTargetRef.current
      ) {
        activateVectorPointEditing(activeObject, false);
        configureCanvasForTool();
      } else {
        configureCanvasForTool();
      }
    };

    const handleSelectionCleared = () => {
      clearUnifiedCanvasTransformGuide(fabricCanvas);
      setHoveredVectorTarget(null);
      if (
        vectorPointEditingTargetRef.current &&
        activeToolRef.current === 'select'
      ) {
        const pointEditingTarget = vectorPointEditingTargetRef.current;
        queueMicrotask(() => {
          const canvas = fabricCanvasRef.current;
          if (!canvas) {
            return;
          }
          if (vectorPointEditingTargetRef.current !== pointEditingTarget) {
            return;
          }
          if (!fabricCanvasContainsObject(canvas, pointEditingTarget)) {
            restoreAllOriginalControls();
            setVectorPointEditingTarget(null);
            configureCanvasForTool();
            return;
          }
          canvas.setActiveObject(pointEditingTarget);
          configureCanvasForTool();
        });
        return;
      }
      if (vectorPointEditingTargetRef.current) {
        restoreAllOriginalControls();
        setVectorPointEditingTarget(null);
        queueMicrotask(() => {
          configureCanvasForTool();
        });
      }
      activePathAnchorRef.current = null;
      queueRootVectorGroupSelectionRestore();
      syncTextSelectionState();
      syncSelectionState();
      onVectorStyleCapabilitiesSyncRef.current?.({ supportsFill: true });
    };

    const handleTextChanged = () => {
      syncTextStyleFromSelection();
      syncTextSelectionState();
      recordHistorySnapshot();
    };

    const handleAfterRender = () => {
      drawVectorTextureOverlay();
      renderVectorPointEditingGuide();
      drawPenOverlay();
    };

    fabricCanvas.on('mouse:down', handleMouseDown);
    fabricCanvas.on('mouse:move', handleMouseMove);
    fabricCanvas.on('mouse:out', handleMouseOut);
    fabricCanvas.on('mouse:up', handleMouseUp);
    fabricCanvas.on('path:created', handlePathCreated);
    fabricCanvas.on('object:modified', handleObjectModified);
    fabricCanvas.on('object:removed', handleObjectRemoved);
    fabricCanvas.on('object:added', handleObjectAdded);
    fabricCanvas.on('selection:created', handleSelectionChange);
    fabricCanvas.on('selection:updated', handleSelectionChange);
    fabricCanvas.on('selection:cleared', handleSelectionCleared);
    fabricCanvas.on('text:changed', handleTextChanged);
    fabricCanvas.on('text:editing:exited', handleTextChanged);
    fabricCanvas.on('after:render', handleAfterRender);
    return () => {
      fabricCanvas.off('mouse:down', handleMouseDown);
      fabricCanvas.off('mouse:move', handleMouseMove);
      fabricCanvas.off('mouse:out', handleMouseOut);
      fabricCanvas.off('mouse:up', handleMouseUp);
      fabricCanvas.off('path:created', handlePathCreated);
      fabricCanvas.off('object:modified', handleObjectModified);
      fabricCanvas.off('object:removed', handleObjectRemoved);
      fabricCanvas.off('object:added', handleObjectAdded);
      fabricCanvas.off('selection:created', handleSelectionChange);
      fabricCanvas.off('selection:updated', handleSelectionChange);
      fabricCanvas.off('selection:cleared', handleSelectionCleared);
      fabricCanvas.off('text:changed', handleTextChanged);
      fabricCanvas.off('text:editing:exited', handleTextChanged);
      fabricCanvas.off('after:render', handleAfterRender);
    };
  }, [
    activateVectorPointEditing,
    applyPointSelectionMarqueeSession,
    applyPointSelectionTransformSession,
    applyVectorPointControls,
    applyVectorPointEditingAppearance,
    bindTextObjectEvents,
    beginPointSelectionTransformSession,
    clearSelectedPathAnchors,
    commitCurrentPenPlacement,
    configureCanvasForTool,
    drawPenOverlay,
    drawVectorTextureOverlay,
    enforcePathAnchorHandleType,
    interactive,
    getPathAnchorDragState,
    getSelectedPathAnchorIndices,
    getSelectedPathAnchorTransformSnapshot,
    hitPointSelectionTransform,
    insertPathPointAtScenePosition,
    isPointSelectionToggleModifierPressed,
    movePathAnchorByDelta,
    recordHistorySnapshot,
    renderVectorPointEditingGuide,
    restoreAllOriginalControls,
    setSelectedPathAnchors,
    setVectorPointEditingTarget,
    startPenAnchorPlacement,
    syncSelectionState,
    syncTextSelectionState,
    syncTextStyleFromSelection,
    syncVectorHandleModeFromSelection,
    syncVectorStyleFromSelection,
    toPathCommandPoint,
    updatePenAnchorPlacement,
    layer?.locked,
    layer?.visible,
  ]);

  useEffect(() => {
    if (activeTool !== 'pen') {
      finalizePenDraftWithOverlay();
      drawPenOverlay();
      renderVectorPointEditingGuide();
      return;
    }
    renderVectorPointEditingGuide();
    drawPenOverlay();
  }, [activeTool, drawPenOverlay, finalizePenDraftWithOverlay, renderVectorPointEditingGuide]);

  useEffect(() => {
    if (activeTool !== 'pen' || !penDraftRef.current) {
      return;
    }
    drawPenOverlay();
  }, [activeTool, drawPenOverlay, vectorStyle]);

  useCostumeCanvasVectorHandleSync({
    activePathAnchorRef,
    activeToolRef,
    editorModeRef,
    enforcePathAnchorHandleType,
    fabricCanvasRef,
    getPathNodeHandleType,
    getSelectedPathAnchorIndices,
    pendingSelectionSyncedVectorHandleModeRef,
    saveHistory: recordHistorySnapshot,
    setPathNodeHandleType,
    syncPathControlPointVisibility,
    vectorHandleMode,
    vectorPointEditingTargetRef,
  });

  useCostumeCanvasPenHotkeys({
    activeToolRef,
    editorModeRef,
    fabricCanvasRef,
    finalizePenDraft: finalizePenDraftWithOverlay,
    penAnchorPlacementSessionRef,
    penDraftRef,
    penModifierStateRef,
    removeLastPenDraftAnchor: removeLastPenDraftAnchorWithOverlay,
    setPenAnchorMoveMode: setPenAnchorMoveModeWithOverlay,
    syncPenPlacementToAltModifier: syncPenPlacementToAltModifierWithOverlay,
  });

  useCostumeCanvasMirroredPathHotkeys({
    activeToolRef,
    editorModeRef,
    fabricCanvasRef,
    mirroredPathAnchorDragModifierStateRef,
    mirroredPathAnchorDragSessionRef,
    setMirroredPathAnchorDragSessionMoveMode,
  });

  const exitAllGroupEditing = useCallback(() => {
    if (activeToolRef.current !== 'select' || editorModeRef.current !== 'vector') {
      return false;
    }

    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return false;
    }

    const rootGroup = resolveVectorGroupEditingRootTarget(
      fabricCanvas,
      vectorGroupEditingPathRef.current,
    );
    if (!rootGroup) {
      return false;
    }

    const activeObject = fabricCanvas.getActiveObject() as any;
    const hasTransientInteraction = (
      !!penAnchorPlacementSessionRef.current ||
      !!penDraftRef.current ||
      !!pointSelectionTransformSessionRef.current ||
      !!pointSelectionMarqueeSessionRef.current ||
      !!insertedPathAnchorDragSessionRef.current ||
      !!mirroredPathAnchorDragSessionRef.current ||
      !!shapeDraftRef.current ||
      !!(isTextEditableObject(activeObject) && activeObject?.isEditing)
    );
    if (hasTransientInteraction) {
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
    configureCanvasForTool,
    restoreAllOriginalControls,
    setVectorPointEditingTarget,
    syncSelectionState,
    syncTextSelectionState,
    syncTextStyleFromSelection,
    syncVectorStyleFromSelection,
  ]);

  useImperativeHandle(ref, () => ({
    beginShape(tool, startWorld) {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas || !layer || tool === 'select' || tool === 'pen' || tool === 'brush' || tool === 'text') {
        return false;
      }

      const startScene = worldPointToScenePoint(startWorld);
      const commonStyle = buildVectorStyleProps(vectorStyleRef.current, tool !== 'line');
      const strokeWidth = Math.max(0, vectorStyleRef.current.strokeWidth);
      let draft: VectorShapeDraft | null = null;
      if (tool === 'rectangle') {
        const rect = new Rect({
          originX: 'left',
          originY: 'top',
          ...getFabricShapeDraftObjectProps(tool, startScene, startScene, strokeWidth),
          ...commonStyle,
        });
        draft = { tool, object: rect, start: startScene };
      } else if (tool === 'circle') {
        const ellipse = new Ellipse({
          originX: 'left',
          originY: 'top',
          ...getFabricShapeDraftObjectProps(tool, startScene, startScene, strokeWidth),
          ...commonStyle,
        });
        draft = { tool, object: ellipse, start: startScene };
      } else if (tool === 'line') {
        const line = new Line([startScene.x, startScene.y, startScene.x, startScene.y], {
          ...buildVectorStyleProps(vectorStyleRef.current, false),
        });
        draft = { tool, object: line, start: startScene };
      } else if (tool === 'triangle' || tool === 'star') {
        const polygonDraft = buildPolygonShapeDraft(tool, startScene, startScene);
        const polygon = new Polygon(polygonDraft.points, {
          left: polygonDraft.left,
          top: polygonDraft.top,
          originX: 'center',
          originY: 'center',
          ...commonStyle,
          objectCaching: false,
        });
        draft = { tool, object: polygon, start: startScene };
      }

      if (!draft) {
        return false;
      }

      normalizeVectorObjectRendering(draft.object);
      ignoreCanvasHistoryEventsRef.current = true;
      fabricCanvas.add(draft.object);
      shapeDraftRef.current = draft;
      shapeDraftHistoryBaselineRef.current = historyIndexRef.current;
      fabricCanvas.requestRenderAll();
      return true;
    },
    updateShape(currentWorld) {
      const draft = shapeDraftRef.current;
      const fabricCanvas = fabricCanvasRef.current;
      if (!draft || !fabricCanvas) {
        return;
      }
      const currentScene = worldPointToScenePoint(currentWorld);

      if (draft.tool === 'rectangle') {
        draft.object.set(getFabricShapeDraftObjectProps(
          draft.tool,
          draft.start,
          currentScene,
          typeof draft.object.strokeWidth === 'number' ? draft.object.strokeWidth : 0,
        ));
      } else if (draft.tool === 'circle') {
        draft.object.set(getFabricShapeDraftObjectProps(
          draft.tool,
          draft.start,
          currentScene,
          typeof draft.object.strokeWidth === 'number' ? draft.object.strokeWidth : 0,
        ));
      } else if (draft.tool === 'line') {
        draft.object.set(getFabricShapeDraftObjectProps(
          draft.tool,
          draft.start,
          currentScene,
          0,
        ));
      } else {
        const polygonProps = getFabricShapeDraftObjectProps(
          draft.tool,
          draft.start,
          currentScene,
          typeof draft.object.strokeWidth === 'number' ? draft.object.strokeWidth : 0,
        ) as { left: number; top: number; points: Array<{ x: number; y: number }> };
        draft.object.set({
          points: polygonProps.points,
        });
        draft.object.setDimensions?.();
        draft.object.set({
          left: polygonProps.left,
          top: polygonProps.top,
        });
      }
      draft.object.setCoords?.();
      fabricCanvas.requestRenderAll();
    },
    commitShape() {
      const draft = shapeDraftRef.current;
      if (!draft) {
        return false;
      }
      ignoreCanvasHistoryEventsTemporarily();
      const committedObject = ensurePathLikeObjectForVectorTool(draft.object) ?? draft.object;
      skipNextObjectModifiedTargetRef.current = committedObject;
      committedObject.setCoords?.();
      draft.object.setCoords?.();
      shapeDraftRef.current = null;
      recordHistorySnapshot();
      const baselineIndex = shapeDraftHistoryBaselineRef.current;
      const currentSnapshot = historySnapshotsRef.current[historyIndexRef.current] ?? null;
      if (baselineIndex !== null && currentSnapshot) {
        const nextHistory = [
          ...historySnapshotsRef.current.slice(0, baselineIndex + 1),
          currentSnapshot,
          ...historySnapshotsRef.current.slice(historyIndexRef.current + 1),
        ];
        historySnapshotsRef.current = nextHistory;
        historyIndexRef.current = Math.min(nextHistory.length - 1, baselineIndex + 1);
        emitHistoryState();
      }
      shapeDraftHistoryBaselineRef.current = null;
      fabricCanvasRef.current?.requestRenderAll();
      return true;
    },
    cancelShape() {
      const fabricCanvas = fabricCanvasRef.current;
      const draft = shapeDraftRef.current;
      shapeDraftRef.current = null;
      shapeDraftHistoryBaselineRef.current = null;
      ignoreCanvasHistoryEventsRef.current = false;
      drawPenOverlay();
      if (!fabricCanvas || !draft) {
        return;
      }
      fabricCanvas.remove(draft.object);
      fabricCanvas.requestRenderAll();
    },
    flushPendingEdits() {
      const fabricCanvas = fabricCanvasRef.current;
      let flushed = false;

      if (pendingVectorStyleHistorySaveRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(pendingVectorStyleHistorySaveRef.current);
        pendingVectorStyleHistorySaveRef.current = null;
        flushed = recordHistorySnapshot() || flushed;
      }

      if (penAnchorPlacementSessionRef.current) {
        commitCurrentPenPlacement();
        flushed = true;
      }
      if (penDraftRef.current) {
        finalizePenDraft();
        flushed = true;
      }

      if (pointSelectionTransformSessionRef.current) {
        const shouldSave = pointSelectionTransformSessionRef.current.hasChanged;
        pointSelectionTransformSessionRef.current = null;
        if (shouldSave) {
          recordHistorySnapshot();
        }
        flushed = true;
      }

      if (pointSelectionMarqueeSessionRef.current && fabricCanvas) {
        const marqueeSession = pointSelectionMarqueeSessionRef.current;
        pointSelectionMarqueeSessionRef.current = null;
        applyPointSelectionMarqueeSession(marqueeSession);
        if (
          vectorPointEditingTargetRef.current === marqueeSession.path &&
          fabricCanvasContainsObject(fabricCanvas, marqueeSession.path)
        ) {
          fabricCanvas.setActiveObject(marqueeSession.path);
        }
        fabricCanvas.requestRenderAll();
        flushed = true;
      }

      if (insertedPathAnchorDragSessionRef.current) {
        insertedPathAnchorDragSessionRef.current = null;
        recordHistorySnapshot();
        flushed = true;
      }

      if (mirroredPathAnchorDragSessionRef.current) {
        const shouldSave = mirroredPathAnchorDragSessionRef.current.hasChanged;
        mirroredPathAnchorDragSessionRef.current = null;
        mirroredPathAnchorDragModifierStateRef.current.space = false;
        if (shouldSave) {
          recordHistorySnapshot();
        }
        flushed = true;
      }

      const activeObject = fabricCanvas?.getActiveObject() as any;
      if (isTextEditableObject(activeObject) && activeObject.isEditing) {
        activeObject.exitEditing?.();
        activeObject.setCoords?.();
        fabricCanvas?.requestRenderAll();
        syncTextSelectionState();
        syncTextStyleFromSelection();
        syncSelectionState();
        flushed = true;
      }

      if (shapeDraftRef.current) {
        const draft = shapeDraftRef.current;
        shapeDraftRef.current = null;
        if (draft) {
          const committedObject = ensurePathLikeObjectForVectorTool(draft.object);
          if (committedObject) {
            committedObject.setCoords?.();
          }
          recordHistorySnapshot();
          configureCanvasForTool();
        }
        flushed = true;
      }

      if (flushed) {
        renderVectorPointEditingGuide();
        drawPenOverlay();
      }
      return flushed;
    },
    hasActiveInteraction() {
      return (
        !!penAnchorPlacementSessionRef.current ||
        !!penDraftRef.current ||
        !!pointSelectionTransformSessionRef.current ||
        !!pointSelectionMarqueeSessionRef.current ||
        !!insertedPathAnchorDragSessionRef.current ||
        !!mirroredPathAnchorDragSessionRef.current ||
        !!shapeDraftRef.current ||
        (() => {
          const activeObject = fabricCanvasRef.current?.getActiveObject() as any;
          return !!(isTextEditableObject(activeObject) && activeObject?.isEditing);
        })()
      );
    },
    isTextEditing() {
      const activeObject = fabricCanvasRef.current?.getActiveObject() as any;
      return !!(isTextEditableObject(activeObject) && activeObject?.isEditing);
    },
    awaitIdle() {
      return pendingLoadPromiseRef.current;
    },
    undo() {
      const nextIndex = historyIndexRef.current - 1;
      const snapshot = historySnapshotsRef.current[nextIndex];
      if (nextIndex < 0 || !snapshot) {
        return;
      }
      historyIndexRef.current = nextIndex;
      void loadSerializedDocument(snapshot, { logInvalid: false, resetHistory: false }).then((loaded) => {
        if (loaded) {
          emitHistoryState();
        }
      });
    },
    redo() {
      const nextIndex = historyIndexRef.current + 1;
      const snapshot = historySnapshotsRef.current[nextIndex];
      if (nextIndex >= historySnapshotsRef.current.length || !snapshot) {
        return;
      }
      historyIndexRef.current = nextIndex;
      void loadSerializedDocument(snapshot, { logInvalid: false, resetHistory: false }).then((loaded) => {
        if (loaded) {
          emitHistoryState();
        }
      });
    },
    canUndo() {
      return historyIndexRef.current > 0;
    },
    canRedo() {
      return historyIndexRef.current >= 0 && historyIndexRef.current < historySnapshotsRef.current.length - 1;
    },
    resetHistoryToCurrent() {
      resetHistory();
    },
    serialize() {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas || !layer) {
        return null;
      }
      return {
        engine: 'fabric',
        version: 1,
        fabricJson: JSON.stringify(markBackgroundVectorSceneDownDocument(
          fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS) as Record<string, any>,
        )),
      };
    },
    deleteSelection() {
      return deleteCanvasSelection();
    },
    duplicateSelection,
    copySelection,
    cutSelection,
    pasteSelection,
    groupSelection() {
      return groupCanvasSelection();
    },
    ungroupSelection() {
      return ungroupCanvasSelection();
    },
    moveSelectionOrder(action) {
      moveCanvasSelectionOrder(action);
    },
    nudgeSelection(dx, dy) {
      return nudgeCanvasSelection(dx, dy);
    },
    flipSelection(axis) {
      flipCanvasSelection(axis);
    },
    rotateSelection() {
      rotateCanvasSelection();
    },
    alignSelection(action) {
      return alignCanvasSelection(action);
    },
    exitAllGroupEditing,
    getSelectionBounds() {
      const selectionBounds = getSelectionBoundsSnapshot()?.bounds ?? null;
      return selectionBounds ? sceneBoundsToWorldBounds(selectionBounds) : null;
    },
    getDocumentBounds() {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas) {
        return null;
      }
      const objectBounds = fabricCanvas.getObjects()
        .map((obj) => obj.getBoundingRect() as { left: number; top: number; width: number; height: number })
        .filter((bounds) => Number.isFinite(bounds.left) && Number.isFinite(bounds.top));
      if (objectBounds.length === 0) {
        return null;
      }
      const left = Math.min(...objectBounds.map((bounds) => bounds.left));
      const top = Math.min(...objectBounds.map((bounds) => bounds.top));
      const right = Math.max(...objectBounds.map((bounds) => bounds.left + bounds.width));
      const bottom = Math.max(...objectBounds.map((bounds) => bounds.top + bounds.height));
      return sceneBoundsToWorldBounds({
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      });
    },
  }), [
    activeTool,
    alignCanvasSelection,
    applyPointSelectionMarqueeSession,
    commitCurrentPenPlacement,
    configureCanvasForTool,
    copySelection,
    cutSelection,
    deleteCanvasSelection,
    duplicateSelection,
    drawPenOverlay,
    exitAllGroupEditing,
    emitHistoryState,
    finalizePenDraft,
    flipCanvasSelection,
    ignoreCanvasHistoryEventsTemporarily,
    interactive,
    moveCanvasSelectionOrder,
    nudgeCanvasSelection,
    getSelectionBoundsSnapshot,
    layer,
    loadSerializedDocument,
    penAnchorPlacementSessionRef,
    penDraftRef,
    pasteSelection,
    recordHistorySnapshot,
    renderVectorPointEditingGuide,
    rotateCanvasSelection,
    syncSelectionState,
    syncTextSelectionState,
    syncTextStyleFromSelection,
  ]);

  const syncActiveVectorStyle = useCallback((
    explicitVectorStyleUpdates?: Partial<VectorToolStyle>,
    previousVectorStyle?: VectorToolStyle,
    commitBoundaryState?: ToolbarSliderCommitBoundaryState,
  ) => {
    const fabricCanvas = fabricCanvasRef.current;
    const commitRequested = previousSliderCommitRevisionRef.current !== (commitBoundaryState?.commitRevision ?? 0);
    previousSliderCommitRevisionRef.current = commitBoundaryState?.commitRevision ?? 0;

    if (!fabricCanvas) {
      pendingSliderStyleCommitRef.current = false;
      return;
    }

    const hasExplicitVectorStyleUpdates = !!explicitVectorStyleUpdates && Object.keys(explicitVectorStyleUpdates).length > 0;
    if (!hasExplicitVectorStyleUpdates && !commitRequested && skipNextSelectionSyncedVectorStyleApplyRef.current) {
      skipNextSelectionSyncedVectorStyleApplyRef.current = false;
      return;
    }

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) {
      pendingSliderStyleCommitRef.current = false;
      return;
    }

    let didChange = false;
    if (isTextObject(activeObject)) {
      const textSnapshot = getTextStyleSnapshot(activeObject);
      if (!textSnapshot) {
        pendingSliderStyleCommitRef.current = false;
        return;
      }

      if (activeObject.fill !== brushColor) {
        didChange = true;
      }
      if (textSnapshot.fontFamily !== textStyle.fontFamily) {
        didChange = true;
      }
      if (textSnapshot.fontSize !== textStyle.fontSize) {
        didChange = true;
      }
      if (textSnapshot.fontWeight !== textStyle.fontWeight) {
        didChange = true;
      }
      if (textSnapshot.fontStyle !== textStyle.fontStyle) {
        didChange = true;
      }
      if (textSnapshot.underline !== textStyle.underline) {
        didChange = true;
      }
      if (textSnapshot.textAlign !== textStyle.textAlign) {
        didChange = true;
      }
      if (textSnapshot.opacity !== textStyle.opacity) {
        didChange = true;
      }

      if (didChange) {
        activeObject.set({
          fill: brushColor,
          fontFamily: textStyle.fontFamily,
          fontSize: textStyle.fontSize,
          fontWeight: textStyle.fontWeight,
          fontStyle: textStyle.fontStyle,
          underline: textStyle.underline,
          textAlign: textStyle.textAlign,
          opacity: textStyle.opacity,
        });
      }
    } else {
      const vectorStyleUpdates =
        hasExplicitVectorStyleUpdates
          ? explicitVectorStyleUpdates
          : previousVectorStyle
            ? getChangedVectorStyleUpdates(previousVectorStyle, vectorStyle)
            : vectorStyle;
      if (Object.keys(vectorStyleUpdates).length > 0) {
        const fillStyleUpdates: Partial<Pick<VectorToolStyle, 'fillColor' | 'fillOpacity' | 'fillTextureId'>> = {};
        const strokeStyleUpdates: Partial<Pick<VectorToolStyle, 'strokeBrushId' | 'strokeColor' | 'strokeOpacity' | 'strokeWidth'>> = {};

        if ('fillColor' in vectorStyleUpdates) {
          fillStyleUpdates.fillColor = vectorStyleUpdates.fillColor;
        }
        if ('fillOpacity' in vectorStyleUpdates) {
          fillStyleUpdates.fillOpacity = vectorStyleUpdates.fillOpacity;
        }
        if ('fillTextureId' in vectorStyleUpdates) {
          fillStyleUpdates.fillTextureId = vectorStyleUpdates.fillTextureId;
        }
        if ('strokeColor' in vectorStyleUpdates) {
          strokeStyleUpdates.strokeColor = vectorStyleUpdates.strokeColor;
        }
        if ('strokeOpacity' in vectorStyleUpdates) {
          strokeStyleUpdates.strokeOpacity = vectorStyleUpdates.strokeOpacity;
        }
        if ('strokeWidth' in vectorStyleUpdates) {
          strokeStyleUpdates.strokeWidth = vectorStyleUpdates.strokeWidth;
        }
        if ('strokeBrushId' in vectorStyleUpdates) {
          strokeStyleUpdates.strokeBrushId = vectorStyleUpdates.strokeBrushId;
        }

        didChange = applyVectorStyleUpdatesToSelection(activeObject, {
          fillStyle: fillStyleUpdates,
          normalizeRendering: true,
          strokeStyle: strokeStyleUpdates,
        }) || didChange;
      }
    }

    const commitAction = resolveStyleSliderCommitAction({
      commitRequested,
      didChange,
      hasPendingPreviewCommit: pendingSliderStyleCommitRef.current,
      isPreviewActive: commitBoundaryState?.isPreviewActive ?? false,
    });
    pendingSliderStyleCommitRef.current = commitAction.hasPendingPreviewCommit;

    if (!didChange && commitAction.action === 'none') {
      return;
    }

    if (didChange) {
      activeObject.setCoords?.();
      fabricCanvas.requestRenderAll();
      syncSelectionState();
    }
    if (commitAction.action === 'schedule') {
      scheduleVectorStyleHistorySnapshot();
      return;
    }
    if (commitAction.action === 'commit-now') {
      recordHistorySnapshot();
    }
  }, [
    brushColor,
    recordHistorySnapshot,
    scheduleVectorStyleHistorySnapshot,
    syncSelectionState,
    textStyle.fontFamily,
    textStyle.fontSize,
    textStyle.fontStyle,
    textStyle.fontWeight,
    textStyle.opacity,
    textStyle.textAlign,
    textStyle.underline,
    vectorStyle,
  ]);

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
    syncActiveVectorStyle,
    textStyle,
    vectorStyle,
    vectorStyleChangeRevision,
  ]);

  return (
    <div
      ref={hostElementRef}
      className="absolute inset-0"
      style={{ pointerEvents: supportsPointerEvents ? 'auto' : 'none' }}
      aria-hidden={!layer}
    />
  );
});

BackgroundVectorCanvas.displayName = 'BackgroundVectorCanvas';
