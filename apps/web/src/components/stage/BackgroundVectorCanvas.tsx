import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import {
  ActiveSelection,
  Canvas as FabricCanvas,
  Ellipse,
  IText,
  Line,
  Polygon,
  Rect,
} from 'fabric';
import type {
  BackgroundVectorDocument,
  BackgroundVectorLayer,
} from '@/types';
import type {
  DrawingTool,
  MoveOrderAction,
  SelectionFlipAxis,
  TextToolStyle,
  VectorToolStyle,
} from '@/components/editors/costume/CostumeToolbar';
import { getZoomInvariantCanvasMetric } from '@/components/editors/costume/costumeCanvasShared';
import {
  attachTextEditingContainer,
  beginTextEditing,
  isTextEditableObject,
} from '@/components/editors/costume/costumeTextCommands';
import {
  applyVectorFillStyleToObject,
  applyVectorStrokeStyleToObject,
  VECTOR_JSON_EXTRA_PROPS,
  VectorPencilBrush,
  getFabricFillValueForVectorTexture,
  getFabricStrokeValueForVectorBrush,
  getVectorStyleTargets,
  isTextObject,
  normalizeVectorObjectRendering,
} from '@/components/editors/costume/costumeCanvasVectorRuntime';
import { useCostumeCanvasPenController } from '@/components/editors/costume/useCostumeCanvasPenController';
import { useCostumeCanvasPenHotkeys } from '@/components/editors/costume/useCostumeCanvasPenHotkeys';
import { EMPTY_BACKGROUND_VECTOR_FABRIC_JSON } from '@/lib/background/backgroundDocument';

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

export interface BackgroundVectorCanvasHandle {
  beginShape: (tool: SupportedVectorTool, startWorld: WorldPoint) => boolean;
  updateShape: (currentWorld: WorldPoint) => void;
  commitShape: () => boolean;
  cancelShape: () => void;
  flushPendingEdits: () => boolean;
  awaitIdle: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  serialize: () => BackgroundVectorDocument | null;
  deleteSelection: () => boolean;
  moveSelectionOrder: (action: MoveOrderAction) => void;
  flipSelection: (axis: SelectionFlipAxis) => void;
  rotateSelection: () => void;
}

interface BackgroundVectorCanvasProps {
  layer: BackgroundVectorLayer | null;
  viewport: { width: number; height: number };
  camera: { x: number; y: number };
  zoom: number;
  activeTool: SupportedVectorTool;
  brushColor: string;
  textStyle: TextToolStyle;
  vectorStyle: VectorToolStyle;
  interactive: boolean;
  onDirty: () => void;
  onHistoryStateChange: (state: { canUndo: boolean; canRedo: boolean; isDirty: boolean }) => void;
  onSelectionChange: (hasSelection: boolean) => void;
  onTextSelectionChange: (hasTextSelection: boolean) => void;
  onTextStyleSync: (style: Partial<TextToolStyle>) => void;
}

function createPolygonShapePoints(kind: 'triangle' | 'star', start: WorldPoint, current: WorldPoint): { x: number; y: number }[] {
  const left = Math.min(start.x, current.x);
  const right = Math.max(start.x, current.x);
  const bottom = Math.min(start.y, current.y);
  const top = Math.max(start.y, current.y);
  const width = Math.max(1, right - left);
  const height = Math.max(1, top - bottom);
  const centerX = left + width * 0.5;
  const centerY = bottom + height * 0.5;

  if (kind === 'triangle') {
    return [
      { x: centerX, y: top },
      { x: left, y: bottom },
      { x: right, y: bottom },
    ];
  }

  const points: { x: number; y: number }[] = [];
  const outerRadiusX = width * 0.5;
  const outerRadiusY = height * 0.5;
  const innerRadiusX = outerRadiusX * 0.45;
  const innerRadiusY = outerRadiusY * 0.45;
  for (let index = 0; index < 10; index += 1) {
    const angle = (-Math.PI / 2) + index * (Math.PI / 5);
    const radiusX = index % 2 === 0 ? outerRadiusX : innerRadiusX;
    const radiusY = index % 2 === 0 ? outerRadiusY : innerRadiusY;
    points.push({
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    });
  }
  return points;
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
    -zoom,
    width * 0.5 - camera.x * zoom,
    height * 0.5 + camera.y * zoom,
  ];
  fabricCanvas.requestRenderAll();
}

export const BackgroundVectorCanvas = forwardRef<BackgroundVectorCanvasHandle, BackgroundVectorCanvasProps>(({
  layer,
  viewport,
  camera,
  zoom,
  activeTool,
  brushColor,
  textStyle,
  vectorStyle,
  interactive,
  onDirty,
  onHistoryStateChange,
  onSelectionChange,
  onTextSelectionChange,
  onTextStyleSync,
}, ref) => {
  const hostElementRef = useRef<HTMLDivElement | null>(null);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);
  const loadedLayerKeyRef = useRef<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const shapeDraftRef = useRef<VectorShapeDraft | null>(null);
  const shapeDraftHistoryBaselineRef = useRef<number | null>(null);
  const editorModeRef = useRef<'vector'>('vector');
  const activeToolRef = useRef(activeTool);
  const brushColorRef = useRef(brushColor);
  const textStyleRef = useRef(textStyle);
  const vectorStyleRef = useRef(vectorStyle);
  const zoomRef = useRef(zoom);
  const onDirtyRef = useRef(onDirty);
  const onHistoryStateChangeRef = useRef(onHistoryStateChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onTextSelectionChangeRef = useRef(onTextSelectionChange);
  const onTextStyleSyncRef = useRef(onTextStyleSync);
  const suppressDirtyRef = useRef(false);
  const pendingLoadPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const ignoreCanvasHistoryEventsRef = useRef(false);
  const skipNextObjectModifiedTargetRef = useRef<object | null>(null);
  const renderPenDraftGuideRef = useRef<(ctx: CanvasRenderingContext2D) => boolean>(() => false);
  const historySnapshotsRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const pendingVectorStyleHistorySaveRef = useRef<number | null>(null);

  activeToolRef.current = activeTool;
  brushColorRef.current = brushColor;
  textStyleRef.current = textStyle;
  vectorStyleRef.current = vectorStyle;
  zoomRef.current = zoom;
  onDirtyRef.current = onDirty;
  onHistoryStateChangeRef.current = onHistoryStateChange;
  onSelectionChangeRef.current = onSelectionChange;
  onTextSelectionChangeRef.current = onTextSelectionChange;
  onTextStyleSyncRef.current = onTextStyleSync;

  const emitHistoryState = useMemo(() => () => {
    const historyIndex = historyIndexRef.current;
    const historyLength = historySnapshotsRef.current.length;
    onHistoryStateChangeRef.current({
      canUndo: historyIndex > 0,
      canRedo: historyIndex >= 0 && historyIndex < historyLength - 1,
      isDirty: historyIndex > 0,
    });
  }, []);

  const clearHistory = useMemo(() => () => {
    historySnapshotsRef.current = [];
    historyIndexRef.current = -1;
    emitHistoryState();
  }, [emitHistoryState]);

  const serializeCanvas = useMemo(() => () => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return null;
    }

    return JSON.stringify(fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS));
  }, []);

  const resetHistory = useMemo(() => () => {
    const snapshot = serializeCanvas();
    if (!snapshot) {
      clearHistory();
      return;
    }

    historySnapshotsRef.current = [snapshot];
    historyIndexRef.current = 0;
    emitHistoryState();
  }, [clearHistory, emitHistoryState, serializeCanvas]);

  const recordHistorySnapshot = useMemo(() => () => {
    if (suppressDirtyRef.current) {
      return false;
    }

    const snapshot = serializeCanvas();
    if (!snapshot) {
      return false;
    }

    const currentSnapshot = historySnapshotsRef.current[historyIndexRef.current] ?? null;
    if (snapshot === currentSnapshot) {
      emitHistoryState();
      return false;
    }

    const nextHistory = historySnapshotsRef.current.slice(0, historyIndexRef.current + 1);
    nextHistory.push(snapshot);
    historySnapshotsRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
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

  const syncSelectionState = useMemo(() => () => {
    const fabricCanvas = fabricCanvasRef.current;
    const activeObject = fabricCanvas?.getActiveObject() as any;
    const hasSelection = !!activeObject;
    const hasTextSelection = !!activeObject && isTextObject(activeObject);
    onSelectionChangeRef.current(hasSelection);
    onTextSelectionChangeRef.current(hasTextSelection);
    if (hasTextSelection) {
      const snapshot = getTextStyleSnapshot(activeObject);
      if (snapshot) {
        onTextStyleSyncRef.current(snapshot);
      }
    }
  }, []);

  const bindTextObjectEvents = useMemo(() => (obj: unknown) => {
    if (!isTextEditableObject(obj)) {
      return;
    }

    const textObject = obj as any;
    attachTextEditingContainer(textObject, hostElementRef.current);
    if (textObject.__backgroundTextEventsBound) {
      return;
    }
    textObject.__backgroundTextEventsBound = true;
    textObject.on?.('editing:entered', () => {
      syncSelectionState();
    });
    textObject.on?.('editing:exited', () => {
      syncSelectionState();
      recordHistorySnapshot();
    });
  }, [recordHistorySnapshot, syncSelectionState]);

  const drawPenOverlay = useMemo(() => () => {
    const overlayCanvas = overlayCanvasRef.current;
    const fabricCanvas = fabricCanvasRef.current;
    if (!overlayCanvas || !fabricCanvas) {
      return;
    }

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const viewportTransform = fabricCanvas.viewportTransform;
    if (viewportTransform) {
      ctx.setTransform(
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
  }, []);

  const getZoomInvariantMetric = useCallback((metric: number, zoomValue = zoomRef.current) => {
    return getZoomInvariantCanvasMetric(metric, zoomValue);
  }, []);

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
    saveHistory: recordHistorySnapshot,
    syncSelectionState,
    vectorStyleRef,
  });
  renderPenDraftGuideRef.current = renderPenDraftGuide;

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

  useEffect(() => {
    return () => {
      if (pendingVectorStyleHistorySaveRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(pendingVectorStyleHistorySaveRef.current);
      }
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
      try {
        parsed = JSON.parse(json);
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

        fabricCanvas.discardActiveObject();
        for (const obj of fabricCanvas.getObjects()) {
          normalizeVectorObjectRendering(obj);
          bindTextObjectEvents(obj);
        }
        onSelectionChangeRef.current(false);
        onTextSelectionChangeRef.current(false);
        applyViewportTransform(fabricCanvas, viewport, camera, zoom);
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
  }, [bindTextObjectEvents, camera, drawPenOverlay, emitHistoryState, resetHistory, viewport, zoom]);

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
    const canvasElement = document.createElement('canvas');
    canvasElement.className = 'absolute inset-0';
    hostElement.appendChild(canvasElement);
    canvasElementRef.current = canvasElement;

    const fabricCanvas = new FabricCanvas(canvasElement, {
      width: Math.max(1, Math.floor(viewport.width)),
      height: Math.max(1, Math.floor(viewport.height)),
      preserveObjectStacking: true,
      renderOnAddRemove: false,
      enableRetinaScaling: true,
      stopContextMenu: true,
    });
    const instrumentedCanvas = fabricCanvas as FabricCanvas & {
      upperCanvasEl?: HTMLCanvasElement;
      wrapperEl?: HTMLDivElement;
    };
    instrumentedCanvas.upperCanvasEl?.setAttribute('data-testid', 'background-vector-layer-canvas');
    instrumentedCanvas.wrapperEl?.setAttribute('data-testid', 'background-vector-layer-surface');
    instrumentedCanvas.wrapperEl?.classList.add('absolute', 'inset-0');
    fabricCanvas.selectionLineWidth = 1.5;
    fabricCanvas.selectionColor = 'rgba(14, 165, 233, 0.12)';
    fabricCanvas.selectionBorderColor = '#0ea5e9';
    fabricCanvas.selectionDashArray = [6, 4];
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.className = 'pointer-events-none absolute inset-0';
    overlayCanvas.setAttribute('aria-hidden', 'true');
    hostElement.appendChild(overlayCanvas);
    overlayCanvasRef.current = overlayCanvas;
    fabricCanvas.on('path:created', (event) => {
      if (ignoreCanvasHistoryEventsRef.current) {
        return;
      }
      const createdPath = event.path;
      if (createdPath) {
        normalizeVectorObjectRendering(createdPath);
        createdPath.setCoords?.();
      }
      recordHistorySnapshot();
      fabricCanvas.requestRenderAll();
    });
    fabricCanvas.on('object:modified', (event) => {
      if (ignoreCanvasHistoryEventsRef.current) {
        return;
      }
      if (event.target && skipNextObjectModifiedTargetRef.current === event.target) {
        skipNextObjectModifiedTargetRef.current = null;
        return;
      }
      recordHistorySnapshot();
    });
    fabricCanvas.on('object:removed', () => {
      if (ignoreCanvasHistoryEventsRef.current) {
        return;
      }
      recordHistorySnapshot();
    });
    fabricCanvas.on('object:added', (event) => {
      if (ignoreCanvasHistoryEventsRef.current) {
        return;
      }
      bindTextObjectEvents(event.target);
      if (shapeDraftRef.current?.object === event.target) {
        return;
      }
      recordHistorySnapshot();
    });
    fabricCanvas.on('selection:created', () => {
      syncSelectionState();
      fabricCanvas.requestRenderAll();
    });
    fabricCanvas.on('selection:updated', () => {
      syncSelectionState();
      fabricCanvas.requestRenderAll();
    });
    fabricCanvas.on('selection:cleared', () => {
      syncSelectionState();
      fabricCanvas.requestRenderAll();
    });

    fabricCanvasRef.current = fabricCanvas;
    applyViewportTransform(fabricCanvas, viewport, camera, zoom);

    return () => {
      shapeDraftRef.current = null;
      shapeDraftHistoryBaselineRef.current = null;
      loadedLayerKeyRef.current = null;
      loadRequestIdRef.current += 1;
      overlayCanvasRef.current = null;
      clearHistory();
      onSelectionChangeRef.current(false);
      onTextSelectionChangeRef.current(false);
      try {
        fabricCanvas.dispose();
      } finally {
        hostElement.replaceChildren();
        canvasElementRef.current = null;
        fabricCanvasRef.current = null;
      }
    };
  }, [bindTextObjectEvents, clearHistory, recordHistorySnapshot, syncSelectionState]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }
    applyViewportTransform(fabricCanvas, viewport, camera, zoom);
    drawPenOverlay();
  }, [camera, drawPenOverlay, viewport, zoom]);

  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) {
      return;
    }

    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    if (overlayCanvas.width !== width) {
      overlayCanvas.width = width;
    }
    if (overlayCanvas.height !== height) {
      overlayCanvas.height = height;
    }
    overlayCanvas.style.width = `${width}px`;
    overlayCanvas.style.height = `${height}px`;
    drawPenOverlay();
  }, [drawPenOverlay, viewport]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }

    if (!layer) {
      fabricCanvas.clear();
      loadedLayerKeyRef.current = null;
      shapeDraftHistoryBaselineRef.current = null;
      clearHistory();
      onSelectionChangeRef.current(false);
      onTextSelectionChangeRef.current(false);
      drawPenOverlay();
      fabricCanvas.requestRenderAll();
      return;
    }

    const layerKey = `${layer.id}:${layer.vector.fabricJson}`;
    if (loadedLayerKeyRef.current === layerKey) {
      return;
    }

    shapeDraftRef.current = null;
    shapeDraftHistoryBaselineRef.current = null;
    loadedLayerKeyRef.current = layerKey;
    void loadSerializedDocument(layer.vector.fabricJson, { logInvalid: true, resetHistory: true });
  }, [clearHistory, drawPenOverlay, layer, loadSerializedDocument]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }

    const isSelectTool = interactive && activeTool === 'select';
    const isBrushTool = interactive && activeTool === 'brush';
    const isTextTool = interactive && activeTool === 'text';
    const activeObject = fabricCanvas.getActiveObject() as any;

    if (activeTool !== 'text' && isTextEditableObject(activeObject) && activeObject.isEditing) {
      activeObject.exitEditing?.();
    }

    fabricCanvas.isDrawingMode = isBrushTool;
    fabricCanvas.selection = isSelectTool;
    fabricCanvas.skipTargetFind = !(isSelectTool || isTextTool);
    fabricCanvas.defaultCursor = isTextTool ? 'text' : (isSelectTool ? 'default' : 'crosshair');
    fabricCanvas.hoverCursor = isTextTool ? 'text' : (isSelectTool ? 'move' : 'crosshair');

    if (fabricCanvas.isDrawingMode) {
      fabricCanvas.freeDrawingBrush = new VectorPencilBrush(fabricCanvas, {
        strokeBrushId: vectorStyle.strokeBrushId,
        strokeColor: vectorStyle.strokeColor,
        strokeOpacity: vectorStyle.strokeOpacity,
        strokeWidth: vectorStyle.strokeWidth,
      });
    }

    fabricCanvas.forEachObject((obj) => {
      const selectable = isSelectTool || (isTextTool && isTextEditableObject(obj));
      obj.selectable = selectable;
      obj.evented = selectable;
      obj.hasControls = selectable;
      obj.hasBorders = selectable;
    });

    if (!isSelectTool && !(isTextTool && isTextEditableObject(activeObject))) {
      fabricCanvas.discardActiveObject();
    }

    syncSelectionState();
    fabricCanvas.requestRenderAll();
    drawPenOverlay();
  }, [activeTool, drawPenOverlay, interactive, syncSelectionState, vectorStyle]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }

    const handleMouseDown = (opt: any) => {
      if (!interactive || !opt.e) {
        return;
      }

      if (activeToolRef.current === 'pen') {
        startPenAnchorPlacement(fabricCanvas.getScenePoint(opt.e), { cuspMode: opt.e.altKey === true });
        drawPenOverlay();
        return;
      }

      if (activeToolRef.current !== 'text') {
        return;
      }

      if (opt.target && isTextEditableObject(opt.target)) {
        const textObject = opt.target as any;
        attachTextEditingContainer(textObject, hostElementRef.current);
        queueMicrotask(() => {
          const canvas = fabricCanvasRef.current;
          if (!canvas) {
            return;
          }
          if (!canvas.getObjects().includes(textObject)) {
            return;
          }
          beginTextEditing(canvas as any, textObject, { event: opt.e });
          syncSelectionState();
        });
        return;
      }

      const pointer = fabricCanvas.getScenePoint(opt.e);
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
      syncSelectionState();
      fabricCanvas.requestRenderAll();
    };

    const handleMouseMove = (opt: any) => {
      if (!interactive || activeToolRef.current !== 'pen' || !opt.e) {
        return;
      }
      if (updatePenAnchorPlacement(fabricCanvas.getScenePoint(opt.e))) {
        fabricCanvas.requestRenderAll();
        drawPenOverlay();
      }
    };

    const handleMouseUp = () => {
      if (!interactive || activeToolRef.current !== 'pen') {
        return;
      }
      if (commitCurrentPenPlacement()) {
        fabricCanvas.requestRenderAll();
        drawPenOverlay();
      }
    };

    fabricCanvas.on('mouse:down', handleMouseDown);
    fabricCanvas.on('mouse:move', handleMouseMove);
    fabricCanvas.on('mouse:up', handleMouseUp);
    return () => {
      fabricCanvas.off('mouse:down', handleMouseDown);
      fabricCanvas.off('mouse:move', handleMouseMove);
      fabricCanvas.off('mouse:up', handleMouseUp);
    };
  }, [
    bindTextObjectEvents,
    commitCurrentPenPlacement,
    drawPenOverlay,
    interactive,
    startPenAnchorPlacement,
    syncSelectionState,
    updatePenAnchorPlacement,
  ]);

  useEffect(() => {
    if (activeTool !== 'pen') {
      finalizePenDraftWithOverlay();
      drawPenOverlay();
      return;
    }
    drawPenOverlay();
  }, [activeTool, drawPenOverlay, finalizePenDraftWithOverlay]);

  useEffect(() => {
    if (activeTool !== 'pen' || !penDraftRef.current) {
      return;
    }
    drawPenOverlay();
  }, [activeTool, drawPenOverlay, vectorStyle]);

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

  useImperativeHandle(ref, () => ({
    beginShape(tool, startWorld) {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas || !layer || tool === 'select' || tool === 'pen' || tool === 'brush' || tool === 'text') {
        return false;
      }

      const commonStyle = buildVectorStyleProps(vectorStyleRef.current, tool !== 'line');
      let draft: VectorShapeDraft | null = null;
      if (tool === 'rectangle') {
        const rect = new Rect({
          left: startWorld.x,
          top: startWorld.y,
          width: 1,
          height: 1,
          originX: 'left',
          originY: 'bottom',
          ...commonStyle,
        });
        draft = { tool, object: rect, start: startWorld };
      } else if (tool === 'circle') {
        const ellipse = new Ellipse({
          left: startWorld.x,
          top: startWorld.y,
          rx: 0.5,
          ry: 0.5,
          originX: 'center',
          originY: 'center',
          ...commonStyle,
        });
        draft = { tool, object: ellipse, start: startWorld };
      } else if (tool === 'line') {
        const line = new Line([startWorld.x, startWorld.y, startWorld.x, startWorld.y], {
          ...buildVectorStyleProps(vectorStyleRef.current, false),
        });
        draft = { tool, object: line, start: startWorld };
      } else if (tool === 'triangle' || tool === 'star') {
        const polygon = new Polygon(createPolygonShapePoints(tool, startWorld, startWorld), {
          ...commonStyle,
          objectCaching: false,
        });
        draft = { tool, object: polygon, start: startWorld };
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

      if (draft.tool === 'rectangle') {
        const left = Math.min(draft.start.x, currentWorld.x);
        const right = Math.max(draft.start.x, currentWorld.x);
        const bottom = Math.min(draft.start.y, currentWorld.y);
        const top = Math.max(draft.start.y, currentWorld.y);
        draft.object.set({
          left,
          top,
          width: Math.max(1, right - left),
          height: Math.max(1, top - bottom),
        });
      } else if (draft.tool === 'circle') {
        const left = Math.min(draft.start.x, currentWorld.x);
        const right = Math.max(draft.start.x, currentWorld.x);
        const bottom = Math.min(draft.start.y, currentWorld.y);
        const top = Math.max(draft.start.y, currentWorld.y);
        draft.object.set({
          left: left + (right - left) * 0.5,
          top: bottom + (top - bottom) * 0.5,
          rx: Math.max(0.5, (right - left) * 0.5),
          ry: Math.max(0.5, (top - bottom) * 0.5),
        });
      } else if (draft.tool === 'line') {
        draft.object.set({
          x2: currentWorld.x,
          y2: currentWorld.y,
        });
      } else {
        draft.object.set({
          points: createPolygonShapePoints(draft.tool, draft.start, currentWorld),
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
      skipNextObjectModifiedTargetRef.current = draft.object;
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

      if (penAnchorPlacementSessionRef.current) {
        commitCurrentPenPlacement();
        flushed = true;
      }
      if (penDraftRef.current) {
        finalizePenDraft();
        flushed = true;
      }

      const activeObject = fabricCanvas?.getActiveObject() as any;
      if (isTextEditableObject(activeObject) && activeObject.isEditing) {
        activeObject.exitEditing?.();
        activeObject.setCoords?.();
        fabricCanvas?.requestRenderAll();
        syncSelectionState();
        flushed = true;
      }

      if (flushed) {
        drawPenOverlay();
      }
      return flushed;
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
    serialize() {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas || !layer) {
        return null;
      }
      return {
        engine: 'fabric',
        version: 1,
        fabricJson: JSON.stringify(fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS)),
      };
    },
    deleteSelection() {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas) {
        return false;
      }
      const activeObject = fabricCanvas.getActiveObject();
      if (!activeObject) {
        return false;
      }
      const objects = activeObject instanceof ActiveSelection ? activeObject.getObjects() : [activeObject];
      fabricCanvas.discardActiveObject();
      objects.forEach((obj) => fabricCanvas.remove(obj));
      fabricCanvas.requestRenderAll();
      return recordHistorySnapshot();
    },
    moveSelectionOrder(action) {
      const fabricCanvas = fabricCanvasRef.current;
      const activeObject = fabricCanvas?.getActiveObject();
      if (!fabricCanvas || !activeObject) {
        return;
      }
      const targets = activeObject instanceof ActiveSelection ? activeObject.getObjects() : [activeObject];
      for (const target of targets) {
        if (action === 'forward') {
          fabricCanvas.bringObjectForward(target);
        } else if (action === 'backward') {
          fabricCanvas.sendObjectBackwards(target);
        } else if (action === 'front') {
          fabricCanvas.bringObjectToFront(target);
        } else {
          fabricCanvas.sendObjectToBack(target);
        }
      }
      fabricCanvas.requestRenderAll();
      recordHistorySnapshot();
    },
    flipSelection(axis) {
      const fabricCanvas = fabricCanvasRef.current;
      const activeObject = fabricCanvas?.getActiveObject();
      if (!fabricCanvas || !activeObject) {
        return;
      }
      const targets = activeObject instanceof ActiveSelection ? activeObject.getObjects() : [activeObject];
      for (const target of targets) {
        if (axis === 'horizontal') {
          target.set('flipX', !target.flipX);
        } else {
          target.set('flipY', !target.flipY);
        }
        target.setCoords?.();
      }
      fabricCanvas.requestRenderAll();
      recordHistorySnapshot();
    },
    rotateSelection() {
      const fabricCanvas = fabricCanvasRef.current;
      const activeObject = fabricCanvas?.getActiveObject();
      if (!fabricCanvas || !activeObject) {
        return;
      }
      activeObject.rotate(((activeObject.angle ?? 0) + 90) % 360);
      activeObject.setCoords?.();
      fabricCanvas.requestRenderAll();
      recordHistorySnapshot();
    },
  }), [
    activeTool,
    commitCurrentPenPlacement,
    drawPenOverlay,
    emitHistoryState,
    finalizePenDraft,
    ignoreCanvasHistoryEventsTemporarily,
    interactive,
    layer,
    loadSerializedDocument,
    penAnchorPlacementSessionRef,
    penDraftRef,
    recordHistorySnapshot,
    syncSelectionState,
  ]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    const activeObject = fabricCanvas?.getActiveObject() as any;
    if (!fabricCanvas || !activeObject) {
      return;
    }

    let didChange = false;
    if (isTextObject(activeObject)) {
      const textSnapshot = getTextStyleSnapshot(activeObject);
      if (!textSnapshot) {
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
        activeObject.setCoords?.();
      }
    } else {
      const targets = getVectorStyleTargets(activeObject);
      for (const target of targets) {
        didChange = applyVectorStrokeStyleToObject(target, vectorStyle) || didChange;
        didChange = applyVectorFillStyleToObject(target, vectorStyle) || didChange;
        didChange = normalizeVectorObjectRendering(target) || didChange;
      }
    }

    if (didChange) {
      fabricCanvas.requestRenderAll();
      scheduleVectorStyleHistorySnapshot();
      syncSelectionState();
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
    vectorStyle.fillColor,
    vectorStyle.fillOpacity,
    vectorStyle.fillTextureId,
    vectorStyle.strokeBrushId,
    vectorStyle.strokeColor,
    vectorStyle.strokeOpacity,
    vectorStyle.strokeWidth,
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
