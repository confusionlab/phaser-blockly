import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import {
  ActiveSelection,
  Canvas as FabricCanvas,
  Ellipse,
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
  VectorToolStyle,
} from '@/components/editors/costume/CostumeToolbar';
import {
  applyVectorFillStyleToObject,
  applyVectorStrokeStyleToObject,
  VECTOR_JSON_EXTRA_PROPS,
  VectorPencilBrush,
  getFabricFillValueForVectorTexture,
  getFabricStrokeValueForVectorBrush,
  getVectorStyleTargets,
  normalizeVectorObjectRendering,
} from '@/components/editors/costume/costumeCanvasVectorRuntime';
import { EMPTY_BACKGROUND_VECTOR_FABRIC_JSON } from '@/lib/background/backgroundDocument';

type WorldPoint = { x: number; y: number };

type SupportedVectorTool = Extract<DrawingTool, 'select' | 'brush' | 'rectangle' | 'circle' | 'triangle' | 'star' | 'line'>;

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
  vectorStyle: VectorToolStyle;
  interactive: boolean;
  onDirty: () => void;
  onHistoryStateChange: (state: { canUndo: boolean; canRedo: boolean; isDirty: boolean }) => void;
  onSelectionChange: (hasSelection: boolean) => void;
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
      ? getFabricFillValueForVectorTexture(vectorStyle.fillTextureId, vectorStyle.fillColor)
      : null,
    stroke: getFabricStrokeValueForVectorBrush(vectorStyle.strokeBrushId, vectorStyle.strokeColor),
    strokeWidth: Math.max(1, vectorStyle.strokeWidth),
    strokeUniform: true,
    noScaleCache: false,
    vectorFillTextureId: vectorStyle.fillTextureId,
    vectorFillColor: vectorStyle.fillColor,
    vectorStrokeBrushId: vectorStyle.strokeBrushId,
    vectorStrokeColor: vectorStyle.strokeColor,
  } as const;
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
  vectorStyle,
  interactive,
  onDirty,
  onHistoryStateChange,
  onSelectionChange,
}, ref) => {
  const hostElementRef = useRef<HTMLDivElement | null>(null);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);
  const loadedLayerKeyRef = useRef<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const shapeDraftRef = useRef<VectorShapeDraft | null>(null);
  const shapeDraftHistoryBaselineRef = useRef<number | null>(null);
  const vectorStyleRef = useRef(vectorStyle);
  const onDirtyRef = useRef(onDirty);
  const onHistoryStateChangeRef = useRef(onHistoryStateChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const suppressDirtyRef = useRef(false);
  const pendingLoadPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const ignoreCanvasHistoryEventsRef = useRef(false);
  const skipNextObjectModifiedTargetRef = useRef<object | null>(null);
  const historySnapshotsRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  vectorStyleRef.current = vectorStyle;
  onDirtyRef.current = onDirty;
  onHistoryStateChangeRef.current = onHistoryStateChange;
  onSelectionChangeRef.current = onSelectionChange;

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
        }
        onSelectionChangeRef.current(false);
        applyViewportTransform(fabricCanvas, viewport, camera, zoom);
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
  }, [camera, emitHistoryState, resetHistory, viewport, zoom]);

  const supportsPointerEvents = useMemo(
    () => interactive && (activeTool === 'select' || activeTool === 'brush'),
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
    fabricCanvas.selectionLineWidth = 1.5;
    fabricCanvas.selectionColor = 'rgba(14, 165, 233, 0.12)';
    fabricCanvas.selectionBorderColor = '#0ea5e9';
    fabricCanvas.selectionDashArray = [6, 4];
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
      if (shapeDraftRef.current?.object === event.target) {
        return;
      }
      recordHistorySnapshot();
    });
    fabricCanvas.on('selection:created', () => {
      onSelectionChangeRef.current(true);
      fabricCanvas.requestRenderAll();
    });
    fabricCanvas.on('selection:updated', () => {
      onSelectionChangeRef.current(true);
      fabricCanvas.requestRenderAll();
    });
    fabricCanvas.on('selection:cleared', () => {
      onSelectionChangeRef.current(false);
      fabricCanvas.requestRenderAll();
    });

    fabricCanvasRef.current = fabricCanvas;
    applyViewportTransform(fabricCanvas, viewport, camera, zoom);

    return () => {
      shapeDraftRef.current = null;
      shapeDraftHistoryBaselineRef.current = null;
      loadedLayerKeyRef.current = null;
      loadRequestIdRef.current += 1;
      clearHistory();
      onSelectionChangeRef.current(false);
      try {
        fabricCanvas.dispose();
      } finally {
        hostElement.replaceChildren();
        canvasElementRef.current = null;
        fabricCanvasRef.current = null;
      }
    };
  }, [clearHistory, recordHistorySnapshot]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }
    applyViewportTransform(fabricCanvas, viewport, camera, zoom);
  }, [camera, viewport, zoom]);

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
  }, [clearHistory, layer, loadSerializedDocument]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return;
    }

    fabricCanvas.isDrawingMode = interactive && activeTool === 'brush';
    fabricCanvas.selection = interactive && activeTool === 'select';
    fabricCanvas.skipTargetFind = !(interactive && activeTool === 'select');
    fabricCanvas.defaultCursor = interactive && activeTool === 'select' ? 'default' : 'crosshair';
    fabricCanvas.hoverCursor = interactive && activeTool === 'select' ? 'move' : 'crosshair';

    if (fabricCanvas.isDrawingMode) {
      fabricCanvas.freeDrawingBrush = new VectorPencilBrush(fabricCanvas, {
        strokeBrushId: vectorStyle.strokeBrushId,
        strokeColor: vectorStyle.strokeColor,
        strokeWidth: vectorStyle.strokeWidth,
      });
    }

    fabricCanvas.forEachObject((obj) => {
      obj.selectable = interactive && activeTool === 'select';
      obj.evented = interactive && activeTool === 'select';
    });
    fabricCanvas.requestRenderAll();
  }, [activeTool, interactive, vectorStyle]);

  useImperativeHandle(ref, () => ({
    beginShape(tool, startWorld) {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas || !layer || tool === 'select' || tool === 'brush') {
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
      if (!fabricCanvas || !draft) {
        return;
      }
      fabricCanvas.remove(draft.object);
      fabricCanvas.requestRenderAll();
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
  }), [activeTool, emitHistoryState, ignoreCanvasHistoryEventsTemporarily, interactive, layer, loadSerializedDocument, recordHistorySnapshot]);

  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    const activeObject = fabricCanvas?.getActiveObject();
    if (!fabricCanvas || !activeObject) {
      return;
    }
    const targets = getVectorStyleTargets(activeObject);
    let didChange = false;
    for (const target of targets) {
      didChange = applyVectorStrokeStyleToObject(target, vectorStyle) || didChange;
      didChange = applyVectorFillStyleToObject(target, vectorStyle) || didChange;
      didChange = normalizeVectorObjectRendering(target) || didChange;
    }
    if (didChange) {
      fabricCanvas.requestRenderAll();
      recordHistorySnapshot();
    }
  }, [recordHistorySnapshot, vectorStyle.fillColor, vectorStyle.fillTextureId, vectorStyle.strokeBrushId, vectorStyle.strokeColor, vectorStyle.strokeWidth]);

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
