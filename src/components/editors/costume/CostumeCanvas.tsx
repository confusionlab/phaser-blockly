import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import {
  Canvas as FabricCanvas,
  PencilBrush,
  Path,
  Rect,
  Ellipse,
  Line,
  IText,
  ActiveSelection,
  FabricImage,
  Control,
  Point,
  controlsUtils,
} from 'fabric';
import { floodFill, hexToRgb } from '@/utils/floodFill';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import type { AlignAction, DrawingTool, MoveOrderAction, TextToolStyle, VectorHandleType } from './CostumeToolbar';
import type { Costume, CostumeBounds, ColliderConfig, CostumeEditorMode, CostumeVectorDocument } from '@/types';
import { CostumeCanvasHeader } from './CostumeCanvasHeader';

const CANVAS_SIZE = 1024;
const BASE_DISPLAY_SIZE = 480;
const BASE_VIEW_SCALE = BASE_DISPLAY_SIZE / CANVAS_SIZE;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.1;
const HANDLE_SIZE = 16;
const VECTOR_SELECTION_COLOR = '#005eff';
const VECTOR_SELECTION_CORNER_COLOR = '#ffffff';
const VECTOR_SELECTION_CORNER_STROKE = '#005eff';
const VECTOR_SELECTION_BORDER_OPACITY = 1;
const VECTOR_SELECTION_BORDER_SCALE = 2;
const VECTOR_JSON_EXTRA_PROPS = ['nodeHandleTypes'];
const CIRCLE_CUBIC_KAPPA = 0.5522847498307936;

function applyCanvasCursor(fabricCanvas: FabricCanvas, cursor: string) {
  fabricCanvas.defaultCursor = cursor;
  fabricCanvas.hoverCursor = cursor;
  fabricCanvas.moveCursor = cursor;
  fabricCanvas.freeDrawingCursor = cursor;
  if (fabricCanvas.upperCanvasEl) {
    fabricCanvas.upperCanvasEl.style.cursor = cursor;
  }
  if (fabricCanvas.lowerCanvasEl) {
    fabricCanvas.lowerCanvasEl.style.cursor = cursor;
  }
}

class CompositePencilBrush extends PencilBrush {
  compositeOperation: GlobalCompositeOperation = 'source-over';

  override _setBrushStyles(ctx: CanvasRenderingContext2D) {
    super._setBrushStyles(ctx);
    ctx.globalCompositeOperation = this.compositeOperation;
  }

  override createPath(pathData: any) {
    const path = super.createPath(pathData);
    path.set('globalCompositeOperation', this.compositeOperation);
    return path;
  }
}

const VECTOR_POINT_CONTROL_STYLE = {
  cornerColor: '#0ea5e9',
  cornerStrokeColor: '#ffffff',
  cornerSize: 14,
  transparentCorners: false,
};

type CanvasHistorySnapshot = {
  mode: CostumeEditorMode;
  bitmapDataUrl: string;
  vectorJson: string | null;
};

export interface CostumeCanvasExportState {
  dataUrl: string;
  bounds: CostumeBounds | null;
  editorMode: CostumeEditorMode;
  vectorDocument?: CostumeVectorDocument;
}

export interface CostumeCanvasHandle {
  toDataURL: () => string;
  toDataURLWithBounds: () => { dataUrl: string; bounds: CostumeBounds | null };
  loadFromDataURL: (dataUrl: string) => Promise<void>;
  loadCostume: (costume: Costume) => Promise<void>;
  exportCostumeState: () => CostumeCanvasExportState;
  setEditorMode: (mode: CostumeEditorMode) => Promise<void>;
  getEditorMode: () => CostumeEditorMode;
  deleteSelection: () => boolean;
  duplicateSelection: () => Promise<boolean>;
  moveSelectionOrder: (action: MoveOrderAction) => boolean;
  alignSelection: (action: AlignAction) => boolean;
  isTextEditing: () => boolean;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

interface CostumeCanvasProps {
  activeTool: DrawingTool;
  brushColor: string;
  brushSize: number;
  vectorHandleType: VectorHandleType;
  textStyle: TextToolStyle;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToolChange: (tool: DrawingTool) => void;
  colliderType: ColliderConfig['type'];
  onColliderTypeChange: (type: ColliderConfig['type']) => void;
  collider: ColliderConfig | null;
  onHistoryChange?: () => void;
  onColliderChange?: (collider: ColliderConfig) => void;
  onModeChange?: (mode: CostumeEditorMode) => void;
  onTextStyleSync?: (updates: Partial<TextToolStyle>) => void;
  onTextSelectionChange?: (hasTextSelection: boolean) => void;
  onSelectionStateChange?: (state: { hasSelection: boolean; hasBitmapFloatingSelection: boolean }) => void;
}

function getFabricObjectType(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const maybe = obj as { type?: unknown };
  return typeof maybe.type === 'string' ? maybe.type.trim().toLowerCase() : '';
}

function isActiveSelectionObject(obj: unknown): obj is ActiveSelection {
  const type = getFabricObjectType(obj);
  return type === 'activeselection' || type === 'active_selection';
}

function isTextObject(obj: unknown): obj is { type: string; set: (props: Record<string, unknown>) => void } {
  const type = getFabricObjectType(obj);
  return type === 'itext' || type === 'i-text' || type === 'textbox' || type === 'text';
}

function isImageObject(obj: unknown): obj is { type: string } {
  return getFabricObjectType(obj) === 'image';
}

type PathLikeVectorType = 'path' | 'polyline' | 'polygon';

function isPathLikeVectorObject(obj: unknown): obj is { type: PathLikeVectorType } {
  const type = getFabricObjectType(obj);
  return type === 'path' || type === 'polyline' || type === 'polygon';
}

function isVectorPointSelectableObject(obj: unknown): obj is Record<string, any> {
  if (!obj || typeof obj !== 'object') return false;
  if (isImageObject(obj) || isTextObject(obj) || isActiveSelectionObject(obj)) return false;
  return true;
}

export const CostumeCanvas = forwardRef<CostumeCanvasHandle, CostumeCanvasProps>(({
  activeTool,
  brushColor,
  brushSize,
  vectorHandleType,
  textStyle,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onToolChange,
  colliderType,
  onColliderTypeChange,
  collider,
  onHistoryChange,
  onColliderChange,
  onModeChange,
  onTextStyleSync,
  onTextSelectionChange,
  onSelectionStateChange,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const brushCursorOverlayRef = useRef<HTMLDivElement>(null);
  const fabricCanvasElementRef = useRef<HTMLCanvasElement>(null);
  const bitmapSelectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const colliderCanvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapSelectionCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const colliderCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);

  const [zoom, setZoom] = useState(1);
  const [cameraCenter, setCameraCenter] = useState({ x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 });
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [isViewportPanning, setIsViewportPanning] = useState(false);
  const [editorModeState, setEditorModeState] = useState<CostumeEditorMode>('vector');
  const [hasBitmapFloatingSelection, setHasBitmapFloatingSelection] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const cameraCenterRef = useRef(cameraCenter);
  cameraCenterRef.current = cameraCenter;
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;
  const panSessionRef = useRef<{
    startX: number;
    startY: number;
    cameraStartX: number;
    cameraStartY: number;
  } | null>(null);

  const editorModeRef = useRef<CostumeEditorMode>('vector');
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  const brushColorRef = useRef(brushColor);
  brushColorRef.current = brushColor;

  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;

  const vectorHandleTypeRef = useRef<VectorHandleType>(vectorHandleType);
  vectorHandleTypeRef.current = vectorHandleType;

  const textStyleRef = useRef(textStyle);
  textStyleRef.current = textStyle;

  const onHistoryChangeRef = useRef(onHistoryChange);
  onHistoryChangeRef.current = onHistoryChange;

  const onColliderChangeRef = useRef(onColliderChange);
  onColliderChangeRef.current = onColliderChange;

  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;

  const onTextStyleSyncRef = useRef(onTextStyleSync);
  onTextStyleSyncRef.current = onTextStyleSync;

  const onTextSelectionChangeRef = useRef(onTextSelectionChange);
  onTextSelectionChangeRef.current = onTextSelectionChange;
  const onSelectionStateChangeRef = useRef(onSelectionStateChange);
  onSelectionStateChangeRef.current = onSelectionStateChange;

  const colliderRef = useRef(collider);
  colliderRef.current = collider;

  const suppressHistoryRef = useRef(false);

  const historyRef = useRef<CanvasHistorySnapshot[]>([]);
  const historyIndexRef = useRef(-1);

  const shapeDraftRef = useRef<{
    type: 'rectangle' | 'circle' | 'line';
    startX: number;
    startY: number;
    object: any;
  } | null>(null);

  const colliderDragModeRef = useRef<'none' | 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-l' | 'resize-r' | 'resize-t' | 'resize-b'>('none');
  const colliderDragStartRef = useRef<{ x: number; y: number; collider: ColliderConfig } | null>(null);

  const bitmapFloatingObjectRef = useRef<any | null>(null);
  const bitmapSelectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const bitmapMarqueeRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const bitmapSelectionDragModeRef = useRef<'none' | 'marquee'>('none');
  const bitmapSelectionBusyRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const originalControlsRef = useRef<WeakMap<object, Record<string, Control> | undefined>>(new WeakMap());
  const brushCursorEnabledRef = useRef(false);
  const brushCursorPosRef = useRef<{ x: number; y: number } | null>(null);
  const activePathAnchorRef = useRef<{ path: any; anchorIndex: number } | null>(null);

  const syncSelectionState = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    const hasBitmap = !!bitmapFloatingObjectRef.current;
    const hasActive = !!fabricCanvas?.getActiveObject();
    const hasSelection = hasBitmap || (editorModeRef.current === 'vector' && hasActive);
    onSelectionStateChangeRef.current?.({
      hasSelection,
      hasBitmapFloatingSelection: hasBitmap,
    });
  }, []);

  const syncBrushCursorOverlay = useCallback(() => {
    const overlay = brushCursorOverlayRef.current;
    if (!overlay) return;

    const mode = editorModeRef.current;
    const tool = activeToolRef.current;
    const isBitmapBrushTool = mode === 'bitmap' && (tool === 'brush' || tool === 'eraser');
    brushCursorEnabledRef.current = isBitmapBrushTool;

    if (!isBitmapBrushTool) {
      overlay.style.opacity = '0';
      return;
    }

    const displayScale = BASE_VIEW_SCALE * zoomRef.current;
    const diameter = Math.max(6, brushSizeRef.current * displayScale);
    const stroke = tool === 'eraser' ? 'rgba(17,17,17,0.95)' : brushColorRef.current;
    const fill = tool === 'eraser' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.12)';
    const borderWidth = tool === 'eraser' ? 2 : 1.5;
    overlay.style.width = `${diameter}px`;
    overlay.style.height = `${diameter}px`;
    overlay.style.border = `${borderWidth}px solid ${stroke}`;
    overlay.style.background = fill;

    const pos = brushCursorPosRef.current;
    if (pos) {
      overlay.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
      overlay.style.opacity = '1';
    } else {
      overlay.style.opacity = '0';
    }
  }, []);

  const setEditorMode = useCallback((mode: CostumeEditorMode) => {
    editorModeRef.current = mode;
    setEditorModeState(mode);
    onModeChangeRef.current?.(mode);
    if (mode !== 'vector') {
      activePathAnchorRef.current = null;
      onTextSelectionChangeRef.current?.(false);
    }
    syncSelectionState();
  }, [syncSelectionState]);

  const isLoadRequestActive = useCallback((requestId?: number) => {
    if (typeof requestId !== 'number') return true;
    return loadRequestIdRef.current === requestId;
  }, []);

  const clampZoom = useCallback((value: number) => {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  }, []);

  const zoomAtScreenPoint = useCallback((screenX: number, screenY: number, nextZoom: number) => {
    const clampedZoom = clampZoom(nextZoom);
    const currentZoom = zoomRef.current;
    if (Math.abs(clampedZoom - currentZoom) < 0.0001) return;

    const view = viewportSizeRef.current;
    if (view.width <= 0 || view.height <= 0) {
      setZoom(clampedZoom);
      return;
    }

    const currentCamera = cameraCenterRef.current;
    const beforeScale = BASE_VIEW_SCALE * currentZoom;
    const afterScale = BASE_VIEW_SCALE * clampedZoom;

    const worldBefore = {
      x: (screenX - view.width / 2) / beforeScale + currentCamera.x,
      y: (screenY - view.height / 2) / beforeScale + currentCamera.y,
    };
    const worldAfter = {
      x: (screenX - view.width / 2) / afterScale + currentCamera.x,
      y: (screenY - view.height / 2) / afterScale + currentCamera.y,
    };

    setCameraCenter({
      x: currentCamera.x + (worldBefore.x - worldAfter.x),
      y: currentCamera.y + (worldBefore.y - worldAfter.y),
    });
    setZoom(clampedZoom);
  }, [clampZoom]);

  const zoomAroundViewportCenter = useCallback((nextZoom: number) => {
    const view = viewportSizeRef.current;
    zoomAtScreenPoint(view.width / 2, view.height / 2, nextZoom);
  }, [zoomAtScreenPoint]);

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

  const getCanvasElement = useCallback((): HTMLCanvasElement => {
    const fabricCanvas = fabricCanvasRef.current;
    if (fabricCanvas) {
      return fabricCanvas.toCanvasElement(1);
    }
    const fallback = document.createElement('canvas');
    fallback.width = CANVAS_SIZE;
    fallback.height = CANVAS_SIZE;
    return fallback;
  }, []);

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

  const createSnapshot = useCallback((): CanvasHistorySnapshot => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return {
        mode: editorModeRef.current,
        bitmapDataUrl: '',
        vectorJson: null,
      };
    }

    const composed = getCanvasElement();
    const bitmapDataUrl = composed.toDataURL('image/png');
    const mode = editorModeRef.current;
    const vectorJson = mode === 'vector' ? JSON.stringify(fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS)) : null;
    return { mode, bitmapDataUrl, vectorJson };
  }, [getCanvasElement]);

  const saveHistory = useCallback(() => {
    if (suppressHistoryRef.current) return;
    const snapshot = createSnapshot();
    const current = historyRef.current[historyIndexRef.current];
    if (
      current &&
      current.mode === snapshot.mode &&
      current.bitmapDataUrl === snapshot.bitmapDataUrl &&
      current.vectorJson === snapshot.vectorJson
    ) {
      return;
    }

    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(snapshot);
    historyIndexRef.current = historyRef.current.length - 1;

    if (historyRef.current.length > 50) {
      historyRef.current.shift();
      historyIndexRef.current -= 1;
    }

    onHistoryChangeRef.current?.();
  }, [createSnapshot]);

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
      textAlign: textObj.textAlign === 'center' || textObj.textAlign === 'right' ? textObj.textAlign : 'left',
      opacity: typeof textObj.opacity === 'number' ? textObj.opacity : undefined,
    });
  }, []);

  const syncTextSelectionState = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    onTextSelectionChangeRef.current?.(!!activeObject && isTextObject(activeObject));
  }, []);

  const loadBitmapLayer = useCallback(async (dataUrl: string, selectable: boolean, requestId?: number): Promise<boolean> => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
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
  }, [drawBitmapSelectionOverlay, isLoadRequestActive, syncSelectionState]);

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
      const loaded = await loadBitmapLayer(raster.toDataURL('image/png'), false);
      if (!loaded) return false;
      saveHistory();
      return true;
    } finally {
      bitmapSelectionBusyRef.current = false;
    }
  }, [loadBitmapLayer, saveHistory]);

  const flattenBitmapLayer = useCallback(async () => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const rasterized = fabricCanvas.toCanvasElement(1).toDataURL('image/png');
    await loadBitmapLayer(rasterized, false);
  }, [loadBitmapLayer]);

  const loadBitmapAsSingleVectorImage = useCallback(async (bitmapCanvas: HTMLCanvasElement, requestId?: number): Promise<boolean> => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (!isLoadRequestActive(requestId)) return false;

    const bounds = calculateBoundsFromCanvas(bitmapCanvas);
    let image: FabricImage | null = null;

    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = bounds.width;
      croppedCanvas.height = bounds.height;
      const croppedCtx = croppedCanvas.getContext('2d');
      if (!croppedCtx) {
        return false;
      }

      croppedCtx.drawImage(
        bitmapCanvas,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height
      );

      try {
        image = await FabricImage.fromURL(croppedCanvas.toDataURL('image/png'));
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

  const applySnapshot = useCallback(async (snapshot: CanvasHistorySnapshot) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    suppressHistoryRef.current = true;
    try {
      if (snapshot.mode === 'vector' && snapshot.vectorJson) {
        try {
          const parsed = JSON.parse(snapshot.vectorJson);
          fabricCanvas.clear();
          await fabricCanvas.loadFromJSON(parsed);
          fabricCanvas.requestRenderAll();
          setEditorMode('vector');
        } catch (error) {
          console.warn('Failed to restore vector snapshot, falling back to bitmap:', error);
          await loadBitmapLayer(snapshot.bitmapDataUrl, false);
          setEditorMode('bitmap');
        }
      } else {
        await loadBitmapLayer(snapshot.bitmapDataUrl, false);
        setEditorMode('bitmap');
      }
    } finally {
      suppressHistoryRef.current = false;
      onHistoryChangeRef.current?.();
    }
  }, [loadBitmapLayer, setEditorMode]);

  const applyFill = useCallback(async (x: number, y: number) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'bitmap') return;

    const raster = fabricCanvas.toCanvasElement(1);
    const ctx = raster.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const fillColor = hexToRgb(brushColorRef.current);
    floodFill(imageData, Math.floor(x), Math.floor(y), fillColor, 32);
    ctx.putImageData(imageData, 0, 0);
    const loaded = await loadBitmapLayer(raster.toDataURL('image/png'), false);
    if (!loaded) return;
    saveHistory();
  }, [loadBitmapLayer, saveHistory]);

  const switchEditorMode = useCallback(async (nextMode: CostumeEditorMode) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    if (editorModeRef.current === nextMode) return;

    const rasterizedCanvas = fabricCanvas.toCanvasElement(1);
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
  }, [loadBitmapAsSingleVectorImage, loadBitmapLayer, saveHistory, setEditorMode]);

  const exportCostumeState = useCallback((): CostumeCanvasExportState => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) {
      return {
        dataUrl: '',
        bounds: null,
        editorMode: editorModeRef.current,
      };
    }

    const composed = getCanvasElement();
    const dataUrl = composed.toDataURL('image/webp', 0.85);
    const bounds = calculateBoundsFromCanvas(composed);

    const mode = editorModeRef.current;
    if (mode === 'vector') {
      return {
        dataUrl,
        bounds,
        editorMode: mode,
        vectorDocument: {
          version: 1,
          fabricJson: JSON.stringify(fabricCanvas.toObject(VECTOR_JSON_EXTRA_PROPS)),
        },
      };
    }

    return {
      dataUrl,
      bounds,
      editorMode: mode,
    };
  }, [getCanvasElement]);

  const deleteSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current !== 'vector') return false;

    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return false;
    if (isTextObject(activeObject) && (activeObject as any).isEditing) return false;

    if (isActiveSelectionObject(activeObject) && typeof activeObject.getObjects === 'function') {
      const selectedObjects = activeObject.getObjects() as any[];
      selectedObjects.forEach((obj) => fabricCanvas.remove(obj));
    } else {
      fabricCanvas.remove(activeObject);
    }

    fabricCanvas.discardActiveObject();
    fabricCanvas.requestRenderAll();
    saveHistory();
    return true;
  }, [saveHistory]);

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

  const alignSelection = useCallback((action: AlignAction): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const mode = editorModeRef.current;
    const activeObject = fabricCanvas.getActiveObject() as any;
    const selectionObject = mode === 'bitmap'
      ? bitmapFloatingObjectRef.current
      : activeObject;
    if (!selectionObject) return false;
    if (isTextObject(selectionObject) && (selectionObject as any).isEditing) return false;

    const selectedObjects = isActiveSelectionObject(selectionObject) && typeof selectionObject.getObjects === 'function'
      ? (selectionObject.getObjects() as any[]).filter(Boolean)
      : [selectionObject];
    if (selectedObjects.length === 0) return false;

    const boundsList = selectedObjects
      .map((obj) => ({ obj, rect: obj.getBoundingRect() as { left: number; top: number; width: number; height: number } }))
      .filter((entry) => Number.isFinite(entry.rect.left) && Number.isFinite(entry.rect.top));
    if (boundsList.length === 0) return false;

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
    const groupWidth = Math.max(1, maxRight - minLeft);
    const groupHeight = Math.max(1, maxBottom - minTop);

    let targetLeft = minLeft;
    let targetTop = minTop;
    if (action.endsWith('left')) {
      targetLeft = 0;
    } else if (action.endsWith('center')) {
      targetLeft = (CANVAS_SIZE - groupWidth) / 2;
    } else if (action.endsWith('right')) {
      targetLeft = CANVAS_SIZE - groupWidth;
    }

    if (action.startsWith('top')) {
      targetTop = 0;
    } else if (action.startsWith('middle')) {
      targetTop = (CANVAS_SIZE - groupHeight) / 2;
    } else if (action.startsWith('bottom')) {
      targetTop = CANVAS_SIZE - groupHeight;
    }

    const dx = targetLeft - minLeft;
    const dy = targetTop - minTop;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return false;
    }

    for (const { obj } of boundsList) {
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
  }, [saveHistory, syncSelectionState]);

  const isTextEditing = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'vector') return false;
    const activeObject = fabricCanvas.getActiveObject() as any;
    return !!activeObject && isTextObject(activeObject) && !!(activeObject as any).isEditing;
  }, []);

  const loadCostume = useCallback(async (costume: Costume) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    const requestId = ++loadRequestIdRef.current;

    const requestedMode: CostumeEditorMode = costume.editorMode === 'bitmap' ? 'bitmap' : 'vector';
    const hasValidVectorDocument =
      requestedMode === 'vector' &&
      costume.vectorDocument?.version === 1 &&
      typeof costume.vectorDocument.fabricJson === 'string';

    if (hasValidVectorDocument) {
      let loadedVector = false;
      try {
        const parsed = JSON.parse(costume.vectorDocument!.fabricJson);
        suppressHistoryRef.current = true;
        fabricCanvas.clear();
        await fabricCanvas.loadFromJSON(parsed);
        if (!isLoadRequestActive(requestId)) return;
        fabricCanvas.requestRenderAll();
        setEditorMode('vector');
        loadedVector = true;
      } catch (error) {
        console.warn('Invalid vector document. Falling back to bitmap mode.', error);
      } finally {
        suppressHistoryRef.current = false;
      }

      if (!loadedVector) {
        const loaded = await loadBitmapLayer(costume.assetId, false, requestId);
        if (!loaded || !isLoadRequestActive(requestId)) return;
        setEditorMode('bitmap');
      }
    } else if (requestedMode === 'vector') {
      const loadedBitmap = await loadBitmapLayer(costume.assetId, false, requestId);
      if (!loadedBitmap || !isLoadRequestActive(requestId)) return;
      const rasterizedCanvas = fabricCanvas.toCanvasElement(1);
      const loadedVector = await loadBitmapAsSingleVectorImage(rasterizedCanvas, requestId);
      if (!loadedVector || !isLoadRequestActive(requestId)) return;
      setEditorMode('vector');
    } else {
      const loaded = await loadBitmapLayer(costume.assetId, false, requestId);
      if (!loaded || !isLoadRequestActive(requestId)) return;
      setEditorMode('bitmap');
    }

    if (!isLoadRequestActive(requestId)) return;
    historyRef.current = [];
    historyIndexRef.current = -1;
    saveHistory();
  }, [isLoadRequestActive, loadBitmapAsSingleVectorImage, loadBitmapLayer, saveHistory, setEditorMode]);

  const restoreOriginalControls = useCallback((obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    const original = originalControlsRef.current.get(obj);
    if (!original) return;
    obj.controls = original;
    originalControlsRef.current.delete(obj);
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

  const getPathNodeHandleTypes = useCallback((pathObj: any): Record<string, VectorHandleType> => {
    const raw = pathObj?.nodeHandleTypes;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, VectorHandleType> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === 'linear' || value === 'corner' || value === 'smooth' || value === 'symmetric') {
        out[key] = value;
      }
    }
    return out;
  }, []);

  const setPathNodeHandleType = useCallback((pathObj: any, anchorIndex: number, type: VectorHandleType) => {
    const normalized = normalizeAnchorIndex(pathObj, anchorIndex);
    const next = getPathNodeHandleTypes(pathObj);
    next[String(normalized)] = type;
    pathObj.set?.('nodeHandleTypes', next);
  }, [getPathNodeHandleTypes, normalizeAnchorIndex]);

  const getPathNodeHandleType = useCallback((pathObj: any, anchorIndex: number): VectorHandleType | null => {
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

  const enforcePathAnchorHandleType = useCallback((
    pathObj: any,
    anchorIndex: number,
    changed: 'anchor' | 'incoming' | 'outgoing' | null
  ) => {
    const handleType = getPathNodeHandleType(pathObj, anchorIndex) ?? 'corner';
    if (handleType === 'corner') return;

    const commands = getPathCommands(pathObj);
    const normalizedAnchor = normalizeAnchorIndex(pathObj, anchorIndex);
    const anchorPoint = getAnchorPointForIndex(pathObj, normalizedAnchor);
    if (!anchorPoint) return;

    const incomingCommandIndex = findIncomingCubicCommandIndex(pathObj, normalizedAnchor);
    const outgoingCommandIndex = findOutgoingCubicCommandIndex(pathObj, normalizedAnchor);
    const incomingCommand = incomingCommandIndex >= 0 ? commands[incomingCommandIndex] : null;
    const outgoingCommand = outgoingCommandIndex >= 0 ? commands[outgoingCommandIndex] : null;

    if (handleType === 'linear') {
      if (incomingCommand && getCommandType(incomingCommand) === 'C') {
        incomingCommand[3] = anchorPoint.x;
        incomingCommand[4] = anchorPoint.y;
      }
      if (outgoingCommand && getCommandType(outgoingCommand) === 'C') {
        outgoingCommand[1] = anchorPoint.x;
        outgoingCommand[2] = anchorPoint.y;
      }
      pathObj.set('dirty', true);
      pathObj.setDimensions();
      pathObj.setCoords();
      return;
    }

    if (!incomingCommand || !outgoingCommand) {
      return;
    }

    const incomingVec = {
      x: Number(incomingCommand[3]) - anchorPoint.x,
      y: Number(incomingCommand[4]) - anchorPoint.y,
    };
    const outgoingVec = {
      x: Number(outgoingCommand[1]) - anchorPoint.x,
      y: Number(outgoingCommand[2]) - anchorPoint.y,
    };
    const incomingLength = Math.hypot(incomingVec.x, incomingVec.y);
    const outgoingLength = Math.hypot(outgoingVec.x, outgoingVec.y);

    let baseDirX = 1;
    let baseDirY = 0;
    if (changed === 'incoming' && incomingLength > 0.0001) {
      baseDirX = incomingVec.x / incomingLength;
      baseDirY = incomingVec.y / incomingLength;
    } else if (changed === 'outgoing' && outgoingLength > 0.0001) {
      baseDirX = -outgoingVec.x / outgoingLength;
      baseDirY = -outgoingVec.y / outgoingLength;
    } else if (incomingLength > 0.0001) {
      baseDirX = incomingVec.x / incomingLength;
      baseDirY = incomingVec.y / incomingLength;
    } else if (outgoingLength > 0.0001) {
      baseDirX = -outgoingVec.x / outgoingLength;
      baseDirY = -outgoingVec.y / outgoingLength;
    }

    let nextIncomingLength = incomingLength;
    let nextOutgoingLength = outgoingLength;
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

    incomingCommand[3] = anchorPoint.x + baseDirX * nextIncomingLength;
    incomingCommand[4] = anchorPoint.y + baseDirY * nextIncomingLength;
    outgoingCommand[1] = anchorPoint.x - baseDirX * nextOutgoingLength;
    outgoingCommand[2] = anchorPoint.y - baseDirY * nextOutgoingLength;

    pathObj.set('dirty', true);
    pathObj.setDimensions();
    pathObj.setCoords();
  }, [
    findIncomingCubicCommandIndex,
    findOutgoingCubicCommandIndex,
    getAnchorPointForIndex,
    getCommandType,
    getPathCommands,
    getPathNodeHandleType,
    normalizeAnchorIndex,
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

  const sampleObjectOutlinePoints = useCallback((obj: any): { points: Point[]; closed: boolean } | null => {
    const type = getFabricObjectType(obj);
    if (!type) return null;

    if (type === 'line' && typeof obj.calcLinePoints === 'function') {
      const linePoints = obj.calcLinePoints() as { x1: number; y1: number; x2: number; y2: number };
      return {
        points: [
          toCanvasPoint(obj, linePoints.x1, linePoints.y1),
          toCanvasPoint(obj, linePoints.x2, linePoints.y2),
        ],
        closed: false,
      };
    }

    if (typeof obj.getCoords === 'function') {
      const coords = obj.getCoords() as Array<{ x: number; y: number }> | undefined;
      if (Array.isArray(coords) && coords.length >= 2) {
        return {
          points: coords.map((coord) => new Point(coord.x, coord.y)),
          closed: coords.length >= 3,
        };
      }
    }

    return null;
  }, [toCanvasPoint]);

  const convertObjectToVectorPath = useCallback((obj: any): any | null => {
    if (!obj || !isVectorPointSelectableObject(obj)) return null;
    if (isPathLikeVectorObject(obj)) return obj;

    const type = getFabricObjectType(obj);
    let pathData = '';
    let shouldFill = false;
    let initialNodeHandleTypes: Record<string, VectorHandleType> = {};
    if (type === 'ellipse' || type === 'circle') {
      pathData = createFourPointEllipsePathData(obj) ?? '';
      shouldFill = true;
      initialNodeHandleTypes = {
        '0': 'symmetric',
        '1': 'symmetric',
        '2': 'symmetric',
        '3': 'symmetric',
      };
    } else {
      const sampled = sampleObjectOutlinePoints(obj);
      if (!sampled || sampled.points.length < 2) return null;
      pathData = buildPathDataFromPoints(sampled.points, sampled.closed);
      shouldFill = sampled.closed;
      if (sampled.closed) {
        for (let i = 0; i < sampled.points.length; i += 1) {
          initialNodeHandleTypes[String(i)] = 'corner';
        }
      } else {
        initialNodeHandleTypes = { '0': 'linear', '1': 'linear' };
      }
    }
    if (!pathData) return null;

    const strokeValue = obj.stroke ?? obj.fill ?? '#000000';
    const path = new Path(pathData, {
      fill: shouldFill ? (obj.fill ?? null) : null,
      stroke: strokeValue,
      strokeWidth: typeof obj.strokeWidth === 'number' ? obj.strokeWidth : 1,
      strokeLineCap: obj.strokeLineCap,
      strokeLineJoin: obj.strokeLineJoin,
      strokeMiterLimit: obj.strokeMiterLimit,
      strokeDashArray: Array.isArray(obj.strokeDashArray) ? [...obj.strokeDashArray] : null,
      opacity: typeof obj.opacity === 'number' ? obj.opacity : 1,
      globalCompositeOperation: obj.globalCompositeOperation ?? 'source-over',
      fillRule: obj.fillRule,
      paintFirst: obj.paintFirst,
      shadow: obj.shadow ?? null,
      nodeHandleTypes: initialNodeHandleTypes,
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
    } as any);
    path.setCoords();
    return path;
  }, [buildPathDataFromPoints, createFourPointEllipsePathData, sampleObjectOutlinePoints]);

  const ensurePathLikeObjectForVectorTool = useCallback((obj: any): any | null => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || !obj || !isVectorPointSelectableObject(obj)) return null;
    if (isPathLikeVectorObject(obj)) return obj;

    const converted = convertObjectToVectorPath(obj);
    if (!converted) return null;
    if (converted === obj) return obj;

    restoreOriginalControls(obj);
    const stack = fabricCanvas.getObjects();
    const originalObject = obj as any;
    const index = stack.indexOf(originalObject);
    fabricCanvas.remove(originalObject);
    if (index >= 0) {
      fabricCanvas.insertAt(index, converted);
    } else {
      fabricCanvas.add(converted);
    }
    converted.setCoords();
    return converted;
  }, [convertObjectToVectorPath, restoreOriginalControls]);

  const applyVectorPointControls = useCallback((obj: any): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    if (isImageObject(obj) || isTextObject(obj)) return false;
    if (isActiveSelectionObject(obj)) return false;
    const type = getFabricObjectType(obj);

    if (!originalControlsRef.current.has(obj)) {
      originalControlsRef.current.set(obj, obj.controls);
    }

    if (type === 'path') {
      const controls = controlsUtils.createPathControls(obj, {
        ...VECTOR_POINT_CONTROL_STYLE,
        pointStyle: {
          controlFill: '#0ea5e9',
          controlStroke: '#ffffff',
        },
        controlPointStyle: {
          controlFill: '#0ea5e9',
          controlStroke: '#ffffff',
          connectionDashArray: [4, 3],
        },
      });
      removeDuplicateClosedPathAnchorControl(obj, controls);
      for (const [key, control] of Object.entries(controls)) {
        const originalMouseDownHandler = control.mouseDownHandler;
        control.mouseDownHandler = ((eventData: any, transform: any, x: number, y: number) => {
          const pathObj = transform?.target;
          if (pathObj && getFabricObjectType(pathObj) === 'path') {
            const resolved = resolveAnchorFromPathControlKey(pathObj, key);
            if (resolved) {
              activePathAnchorRef.current = { path: pathObj, anchorIndex: resolved.anchorIndex };
              const existingType = getPathNodeHandleType(pathObj, resolved.anchorIndex);
              if (!existingType) {
                setPathNodeHandleType(pathObj, resolved.anchorIndex, vectorHandleTypeRef.current);
                enforcePathAnchorHandleType(pathObj, resolved.anchorIndex, resolved.changed);
                pathObj.canvas?.requestRenderAll?.();
              }
            }
          }
          if (typeof originalMouseDownHandler === 'function') {
            return originalMouseDownHandler.call(control, eventData, transform, x, y);
          }
          return false;
        }) as any;

        const originalActionHandler = control.actionHandler;
        if (typeof originalActionHandler !== 'function') continue;
        control.actionHandler = ((eventData: any, transform: any, x: number, y: number) => {
          const performed = originalActionHandler.call(control, eventData, transform, x, y);
          const pathObj = transform?.target;
          if (!pathObj || getFabricObjectType(pathObj) !== 'path') {
            return performed;
          }
          const resolved = resolveAnchorFromPathControlKey(pathObj, key);
          if (resolved) {
            const existingType = getPathNodeHandleType(pathObj, resolved.anchorIndex);
            if (!existingType) {
              setPathNodeHandleType(pathObj, resolved.anchorIndex, vectorHandleTypeRef.current);
            }
            activePathAnchorRef.current = { path: pathObj, anchorIndex: resolved.anchorIndex };
            enforcePathAnchorHandleType(pathObj, resolved.anchorIndex, resolved.changed);
          }
          return performed;
        }) as any;
      }
      obj.controls = controls;
      if (typeof obj.setControlVisible === 'function') {
        for (const key of Object.keys(obj.controls || {})) {
          obj.setControlVisible(key, true);
        }
      }
      return true;
    }

    if ((type === 'polyline' || type === 'polygon') && Array.isArray((obj as any).points) && (obj as any).points.length > 1) {
      obj.controls = controlsUtils.createPolyControls(obj, {
        ...VECTOR_POINT_CONTROL_STYLE,
        cursorStyle: 'crosshair',
      });
      if (typeof obj.setControlVisible === 'function') {
        for (const key of Object.keys(obj.controls || {})) {
          obj.setControlVisible(key, true);
        }
      }
      return true;
    }

    restoreOriginalControls(obj);
    return false;
  }, [
    enforcePathAnchorHandleType,
    getPathNodeHandleType,
    removeDuplicateClosedPathAnchorControl,
    resolveAnchorFromPathControlKey,
    restoreOriginalControls,
    setPathNodeHandleType,
  ]);

  const activateVectorPointEditing = useCallback((saveConversionToHistory: boolean): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'vector') return false;

    let activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject) return false;
    if (!isVectorPointSelectableObject(activeObject)) {
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
      return false;
    }

    if (!isPathLikeVectorObject(activeObject)) {
      const converted = ensurePathLikeObjectForVectorTool(activeObject);
      if (!converted) {
        fabricCanvas.discardActiveObject();
        fabricCanvas.requestRenderAll();
        return false;
      }
      if (converted !== activeObject) {
        activeObject = converted;
        fabricCanvas.setActiveObject(activeObject);
        if (saveConversionToHistory) {
          saveHistory();
        }
      }
    }

    const applied = applyVectorPointControls(activeObject);
    if (!applied) return false;

    activeObject.hasControls = true;
    activeObject.hasBorders = true;
    activeObject.borderColor = VECTOR_SELECTION_COLOR;
    activeObject.cornerColor = VECTOR_SELECTION_CORNER_COLOR;
    activeObject.cornerStrokeColor = VECTOR_SELECTION_CORNER_STROKE;
    activeObject.cornerSize = 12;
    activeObject.transparentCorners = false;
    activeObject.lockMovementX = true;
    activeObject.lockMovementY = true;
    activeObject.lockRotation = true;
    activeObject.lockScalingX = true;
    activeObject.lockScalingY = true;
    fabricCanvas.requestRenderAll();
    return true;
  }, [applyVectorPointControls, ensurePathLikeObjectForVectorTool, saveHistory]);

  const configureCanvasForTool = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    const mode = editorModeRef.current;
    const tool = activeToolRef.current;

    const isBitmapBrush = mode === 'bitmap' && (tool === 'brush' || tool === 'eraser');
    if (isBitmapBrush) {
      const brush = new CompositePencilBrush(fabricCanvas as any);
      brush.width = brushSizeRef.current;
      brush.color = tool === 'eraser' ? '#000000' : brushColorRef.current;
      brush.compositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      (fabricCanvas as any).freeDrawingBrush = brush;
      fabricCanvas.isDrawingMode = true;
    } else {
      fabricCanvas.isDrawingMode = false;
      if (fabricCanvas.contextTop) {
        fabricCanvas.contextTop.globalCompositeOperation = 'source-over';
      }
    }

    const isVectorSelectionMode = mode === 'vector' && tool === 'select';
    const isVectorPointMode = mode === 'vector' && tool === 'vector';
    const floatingBitmapObject = bitmapFloatingObjectRef.current;
    const isBitmapFloatingSelectionMode =
      mode === 'bitmap' &&
      tool === 'select' &&
      !!floatingBitmapObject;

    if (isVectorPointMode) {
      const originalActiveObject = fabricCanvas.getActiveObject() as any;
      let replacementActiveObject: any = originalActiveObject;
      let convertedAny = false;
      const objects = [...fabricCanvas.getObjects()];
      for (const obj of objects) {
        if (!isVectorPointSelectableObject(obj) || isPathLikeVectorObject(obj)) continue;
        const converted = ensurePathLikeObjectForVectorTool(obj as any);
        if (converted && converted !== obj) {
          convertedAny = true;
          if (originalActiveObject && obj === originalActiveObject) {
            replacementActiveObject = converted;
          }
        }
      }
      if (replacementActiveObject && replacementActiveObject !== originalActiveObject) {
        fabricCanvas.setActiveObject(replacementActiveObject);
      }
      if (convertedAny) {
        saveHistory();
      }
    }

    restoreAllOriginalControls();
    fabricCanvas.selection = isVectorSelectionMode;
    fabricCanvas.selectionColor = 'rgba(0, 94, 255, 0.14)';
    fabricCanvas.selectionBorderColor = VECTOR_SELECTION_COLOR;
    fabricCanvas.selectionLineWidth = 2;
    fabricCanvas.selectionDashArray = [];
    fabricCanvas.forEachObject((obj: any) => {
      const selectable = isVectorSelectionMode
        ? true
        : isVectorPointMode
          ? isVectorPointSelectableObject(obj)
          : (isBitmapFloatingSelectionMode && obj === floatingBitmapObject);

      obj.selectable = selectable;
      obj.evented = selectable;
      obj.hasControls = selectable;
      obj.hasBorders = selectable;
      obj.lockMovementX = !selectable || isVectorPointMode;
      obj.lockMovementY = !selectable || isVectorPointMode;
      obj.lockRotation = !selectable || isVectorPointMode;
      obj.lockScalingX = !selectable || isVectorPointMode;
      obj.lockScalingY = !selectable || isVectorPointMode;
      obj.borderColor = VECTOR_SELECTION_COLOR;
      obj.borderScaleFactor = VECTOR_SELECTION_BORDER_SCALE;
      obj.borderOpacityWhenMoving = VECTOR_SELECTION_BORDER_OPACITY;
      obj.cornerStyle = 'rect';
      obj.cornerColor = VECTOR_SELECTION_CORNER_COLOR;
      obj.cornerStrokeColor = VECTOR_SELECTION_CORNER_STROKE;
      obj.cornerSize = 12;
      obj.transparentCorners = false;
      obj.padding = 2;

      if (isVectorPointMode) {
        const pathLike = isPathLikeVectorObject(obj);
        if (pathLike) {
          const objAny = obj as any;
          applyVectorPointControls(objAny);
          objAny.hasControls = true;
          objAny.hasBorders = true;
        } else {
          restoreOriginalControls(obj);
          const objAny = obj as any;
          objAny.hasControls = false;
          objAny.hasBorders = false;
        }
      }
    });

    let activeObject = fabricCanvas.getActiveObject() as any;
    if (activeObject) {
      if (isVectorPointMode && !isVectorPointSelectableObject(activeObject)) {
        fabricCanvas.discardActiveObject();
        activeObject = null;
      }
      if (activeObject && !isVectorSelectionMode && !isVectorPointMode && activeObject !== floatingBitmapObject) {
        fabricCanvas.discardActiveObject();
        activeObject = null;
      }

      if (activeObject && isVectorPointMode) {
        activateVectorPointEditing(false);
      }
    }

    let cursor = 'default';
    if (mode === 'bitmap' && (tool === 'brush' || tool === 'eraser')) {
      cursor = 'none';
    } else if (tool === 'fill' || tool === 'line' || tool === 'circle' || tool === 'rectangle' || tool === 'vector') {
      cursor = 'crosshair';
    } else if (tool === 'text') {
      cursor = 'text';
    } else if (tool === 'collider') {
      cursor = 'move';
    }

    syncBrushCursorOverlay();
    applyCanvasCursor(fabricCanvas, cursor);
    fabricCanvas.requestRenderAll();
    syncSelectionState();
  }, [activateVectorPointEditing, applyVectorPointControls, ensurePathLikeObjectForVectorTool, restoreAllOriginalControls, restoreOriginalControls, saveHistory, syncBrushCursorOverlay, syncSelectionState]);

  // Draw collider overlay
  const drawCollider = useCallback((coll: ColliderConfig | null, editable: boolean = false) => {
    const colliderCtx = colliderCtxRef.current;
    if (!colliderCtx) return;

    colliderCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    if (!coll || coll.type === 'none') return;

    const centerX = CANVAS_SIZE / 2 + coll.offsetX;
    const centerY = CANVAS_SIZE / 2 + coll.offsetY;

    colliderCtx.strokeStyle = '#22c55e';
    colliderCtx.lineWidth = 3;
    colliderCtx.setLineDash(editable ? [] : [8, 8]);

    if (coll.type === 'box') {
      colliderCtx.strokeRect(
        centerX - coll.width / 2,
        centerY - coll.height / 2,
        coll.width,
        coll.height
      );
    } else if (coll.type === 'circle') {
      colliderCtx.beginPath();
      colliderCtx.arc(centerX, centerY, coll.radius, 0, Math.PI * 2);
      colliderCtx.stroke();
    } else if (coll.type === 'capsule') {
      const halfW = coll.width / 2;
      const halfH = coll.height / 2;
      const radius = Math.min(halfW, halfH);

      colliderCtx.beginPath();
      colliderCtx.moveTo(centerX - halfW + radius, centerY - halfH);
      colliderCtx.lineTo(centerX + halfW - radius, centerY - halfH);
      colliderCtx.arc(centerX + halfW - radius, centerY - halfH + radius, radius, -Math.PI / 2, 0);
      colliderCtx.lineTo(centerX + halfW, centerY + halfH - radius);
      colliderCtx.arc(centerX + halfW - radius, centerY + halfH - radius, radius, 0, Math.PI / 2);
      colliderCtx.lineTo(centerX - halfW + radius, centerY + halfH);
      colliderCtx.arc(centerX - halfW + radius, centerY + halfH - radius, radius, Math.PI / 2, Math.PI);
      colliderCtx.lineTo(centerX - halfW, centerY - halfH + radius);
      colliderCtx.arc(centerX - halfW + radius, centerY - halfH + radius, radius, Math.PI, Math.PI * 1.5);
      colliderCtx.stroke();
    }

    colliderCtx.setLineDash([]);

    if (editable) {
      colliderCtx.fillStyle = '#ffffff';
      colliderCtx.strokeStyle = '#22c55e';
      colliderCtx.lineWidth = 2;

      if (coll.type === 'box' || coll.type === 'capsule') {
        const corners = [
          { x: centerX - coll.width / 2, y: centerY - coll.height / 2 },
          { x: centerX + coll.width / 2, y: centerY - coll.height / 2 },
          { x: centerX - coll.width / 2, y: centerY + coll.height / 2 },
          { x: centerX + coll.width / 2, y: centerY + coll.height / 2 },
        ];
        corners.forEach((corner) => {
          colliderCtx.fillRect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          colliderCtx.strokeRect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        });

        const edges = [
          { x: centerX, y: centerY - coll.height / 2 },
          { x: centerX, y: centerY + coll.height / 2 },
          { x: centerX - coll.width / 2, y: centerY },
          { x: centerX + coll.width / 2, y: centerY },
        ];
        edges.forEach((edge) => {
          colliderCtx.fillRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          colliderCtx.strokeRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        });
      } else if (coll.type === 'circle') {
        const edges = [
          { x: centerX, y: centerY - coll.radius },
          { x: centerX, y: centerY + coll.radius },
          { x: centerX - coll.radius, y: centerY },
          { x: centerX + coll.radius, y: centerY },
        ];
        edges.forEach((edge) => {
          colliderCtx.fillRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          colliderCtx.strokeRect(edge.x - HANDLE_SIZE / 2, edge.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        });
      }

      colliderCtx.beginPath();
      colliderCtx.arc(centerX, centerY, 8, 0, Math.PI * 2);
      colliderCtx.fillStyle = '#22c55e';
      colliderCtx.fill();
      colliderCtx.strokeStyle = '#ffffff';
      colliderCtx.lineWidth = 2;
      colliderCtx.stroke();
    }
  }, []);

  // Initialize fabric canvas once.
  useEffect(() => {
    if (!fabricCanvasElementRef.current || fabricCanvasRef.current) return;

    const fabricCanvas = new FabricCanvas(fabricCanvasElementRef.current, {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      preserveObjectStacking: true,
      selection: false,
    });
    fabricCanvasRef.current = fabricCanvas;

    const onMouseDown = (opt: any) => {
      if (activeToolRef.current === 'collider') return;
      if (!opt.e) return;

      const pointer = fabricCanvas.getScenePoint(opt.e);
      const mode = editorModeRef.current;
      const tool = activeToolRef.current;
      const floatingBitmapObject = bitmapFloatingObjectRef.current;

      if (mode === 'bitmap' && tool === 'select' && floatingBitmapObject) {
        if (!opt.target || opt.target !== floatingBitmapObject) {
          void commitBitmapSelection();
        }
        return;
      }

      if (mode === 'vector' && tool === 'vector' && opt.target && isImageObject(opt.target)) {
        fabricCanvas.discardActiveObject();
        fabricCanvas.requestRenderAll();
        return;
      }

      if (mode === 'vector' && tool === 'vector') {
        if (!opt.target || !isVectorPointSelectableObject(opt.target)) {
          fabricCanvas.discardActiveObject();
          fabricCanvas.requestRenderAll();
          return;
        }
        queueMicrotask(() => {
          const canvas = fabricCanvasRef.current;
          if (!canvas) return;
          const clicked = opt.target as any;
          if (clicked && canvas.getObjects().includes(clicked)) {
            canvas.setActiveObject(clicked);
          }
          activateVectorPointEditing(true);
          configureCanvasForTool();
        });
        return;
      }

      if (tool === 'fill' && mode === 'bitmap') {
        void applyFill(pointer.x, pointer.y);
        return;
      }

      if (tool === 'text' && mode === 'vector') {
        const textObject = new IText('Text', {
          left: pointer.x,
          top: pointer.y,
          fill: brushColorRef.current,
          fontFamily: textStyleRef.current.fontFamily,
          fontSize: textStyleRef.current.fontSize,
          fontWeight: textStyleRef.current.fontWeight,
          textAlign: textStyleRef.current.textAlign,
          opacity: textStyleRef.current.opacity,
        } as any);
        textObject.on('editing:exited', () => {
          syncTextStyleFromSelection();
          saveHistory();
        });
        fabricCanvas.add(textObject);
        fabricCanvas.setActiveObject(textObject);
        textObject.enterEditing();
        fabricCanvas.requestRenderAll();
        saveHistory();
        return;
      }

      if (tool === 'rectangle' || tool === 'circle' || tool === 'line') {
        const color = brushColorRef.current;
        let object: any;
        if (tool === 'rectangle') {
          object = new Rect({
            left: pointer.x,
            top: pointer.y,
            originX: 'left',
            originY: 'top',
            width: 1,
            height: 1,
            fill: color,
            stroke: color,
            strokeWidth: 1,
            selectable: false,
            evented: false,
          });
        } else if (tool === 'circle') {
          object = new Ellipse({
            left: pointer.x,
            top: pointer.y,
            rx: 1,
            ry: 1,
            fill: color,
            stroke: color,
            strokeWidth: 1,
            originX: 'left',
            originY: 'top',
            selectable: false,
            evented: false,
          });
        } else {
          object = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
            stroke: color,
            strokeWidth: Math.max(1, brushSizeRef.current),
            selectable: false,
            evented: false,
          });
        }
        shapeDraftRef.current = {
          type: tool,
          startX: pointer.x,
          startY: pointer.y,
          object,
        };
        fabricCanvas.add(object);
      }
    };

    const onMouseMove = (opt: any) => {
      if (!shapeDraftRef.current || !opt.e) return;
      const pointer = fabricCanvas.getScenePoint(opt.e);
      const draft = shapeDraftRef.current;
      const object = draft.object;

      if (draft.type === 'rectangle') {
        const left = Math.min(pointer.x, draft.startX);
        const top = Math.min(pointer.y, draft.startY);
        const width = Math.abs(pointer.x - draft.startX);
        const height = Math.abs(pointer.y - draft.startY);
        object.set({ left, top, width, height });
      } else if (draft.type === 'circle') {
        const left = Math.min(pointer.x, draft.startX);
        const top = Math.min(pointer.y, draft.startY);
        const rx = Math.abs(pointer.x - draft.startX) / 2;
        const ry = Math.abs(pointer.y - draft.startY) / 2;
        object.set({
          left,
          top,
          rx,
          ry,
        });
      } else {
        object.set({ x2: pointer.x, y2: pointer.y });
      }

      object.setCoords();
      fabricCanvas.requestRenderAll();
    };

    const onMouseUp = () => {
      if (!shapeDraftRef.current) return;
      shapeDraftRef.current = null;
      if (editorModeRef.current === 'bitmap') {
        void (async () => {
          await flattenBitmapLayer();
          saveHistory();
          configureCanvasForTool();
        })();
      } else {
        saveHistory();
        configureCanvasForTool();
      }
    };

    const onPathCreated = () => {
      if (editorModeRef.current !== 'bitmap') {
        saveHistory();
        return;
      }

      void (async () => {
        await flattenBitmapLayer();
        saveHistory();
      })();
    };

    const onObjectModified = () => {
      if (editorModeRef.current === 'vector') {
        saveHistory();
      }
    };

    const onSelectionChange = () => {
      syncTextStyleFromSelection();
      syncTextSelectionState();
      syncSelectionState();
      if (editorModeRef.current === 'vector' && activeToolRef.current === 'vector') {
        activateVectorPointEditing(true);
        configureCanvasForTool();
      }
    };

    const onTextChanged = () => {
      if (editorModeRef.current !== 'vector') return;
      syncTextStyleFromSelection();
      syncTextSelectionState();
      saveHistory();
    };

    const onSelectionCleared = () => {
      if (
        editorModeRef.current === 'bitmap' &&
        activeToolRef.current === 'select' &&
        bitmapFloatingObjectRef.current &&
        !bitmapSelectionBusyRef.current
      ) {
        void commitBitmapSelection();
        return;
      }
      activePathAnchorRef.current = null;
      onTextSelectionChangeRef.current?.(false);
      syncSelectionState();
      if (editorModeRef.current === 'vector' && activeToolRef.current === 'vector') {
        activateVectorPointEditing(false);
        configureCanvasForTool();
      }
    };

    fabricCanvas.on('mouse:down', onMouseDown);
    fabricCanvas.on('mouse:move', onMouseMove);
    fabricCanvas.on('mouse:up', onMouseUp);
    fabricCanvas.on('path:created', onPathCreated);
    fabricCanvas.on('object:modified', onObjectModified);
    fabricCanvas.on('selection:created', onSelectionChange);
    fabricCanvas.on('selection:updated', onSelectionChange);
    fabricCanvas.on('selection:cleared', onSelectionCleared);
    fabricCanvas.on('text:changed', onTextChanged);
    fabricCanvas.on('text:editing:exited', onTextChanged);

    const colliderCanvas = colliderCanvasRef.current;
    if (colliderCanvas) {
      colliderCtxRef.current = colliderCanvas.getContext('2d');
    }
    const bitmapSelectionCanvas = bitmapSelectionCanvasRef.current;
    if (bitmapSelectionCanvas) {
      bitmapSelectionCtxRef.current = bitmapSelectionCanvas.getContext('2d');
      drawBitmapSelectionOverlay();
    }

    setEditorMode('vector');
    historyRef.current = [];
    historyIndexRef.current = -1;
    saveHistory();
    configureCanvasForTool();

    return () => {
      restoreAllOriginalControls();
      fabricCanvas.off('mouse:down', onMouseDown);
      fabricCanvas.off('mouse:move', onMouseMove);
      fabricCanvas.off('mouse:up', onMouseUp);
      fabricCanvas.off('path:created', onPathCreated);
      fabricCanvas.off('object:modified', onObjectModified);
      fabricCanvas.off('selection:created', onSelectionChange);
      fabricCanvas.off('selection:updated', onSelectionChange);
      fabricCanvas.off('selection:cleared', onSelectionCleared);
      fabricCanvas.off('text:changed', onTextChanged);
      fabricCanvas.off('text:editing:exited', onTextChanged);
      fabricCanvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, [activateVectorPointEditing, applyFill, applyVectorPointControls, commitBitmapSelection, configureCanvasForTool, drawBitmapSelectionOverlay, ensurePathLikeObjectForVectorTool, flattenBitmapLayer, loadBitmapLayer, restoreAllOriginalControls, saveHistory, setEditorMode, syncSelectionState, syncTextSelectionState, syncTextStyleFromSelection]);

  // Sync tool behavior.
  useEffect(() => {
    configureCanvasForTool();
  }, [activeTool, brushColor, brushSize, editorModeState, hasBitmapFloatingSelection, configureCanvasForTool]);

  useEffect(() => {
    const activeAnchor = activePathAnchorRef.current;
    const fabricCanvas = fabricCanvasRef.current;
    if (!activeAnchor || !fabricCanvas) return;
    if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'vector') return;
    const activeObject = fabricCanvas.getActiveObject() as any;
    if (!activeObject || activeObject !== activeAnchor.path) return;
    if (getFabricObjectType(activeObject) !== 'path') return;

    setPathNodeHandleType(activeObject, activeAnchor.anchorIndex, vectorHandleType);
    enforcePathAnchorHandleType(activeObject, activeAnchor.anchorIndex, null);
    fabricCanvas.requestRenderAll();
    saveHistory();
  }, [enforcePathAnchorHandleType, saveHistory, setPathNodeHandleType, vectorHandleType]);

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
      if (textObject.textAlign !== textStyle.textAlign) changed = true;
      if (textObject.opacity !== textStyle.opacity) changed = true;
      textObject.set({
        fill: brushColor,
        fontFamily: textStyle.fontFamily,
        fontSize: textStyle.fontSize,
        fontWeight: textStyle.fontWeight,
        textAlign: textStyle.textAlign,
        opacity: textStyle.opacity,
      });
    } else {
      if (activeObject.fill !== brushColor) changed = true;
      if (activeObject.stroke !== brushColor) changed = true;
      activeObject.set({
        fill: brushColor,
        stroke: brushColor,
      });
    }

    if (!changed) return;

    activeObject.setCoords?.();
    fabricCanvas.requestRenderAll();
    saveHistory();
  }, [brushColor, textStyle, saveHistory]);

  // Draw collider when collider/tool changes.
  useEffect(() => {
    drawCollider(collider, activeTool === 'collider');
  }, [collider, activeTool, drawCollider]);

  // Collider interactions.
  useEffect(() => {
    const colliderCanvas = colliderCanvasRef.current;
    if (!colliderCanvas || activeTool !== 'collider') return;

    const getMousePos = (e: MouseEvent) => {
      const rect = colliderCanvas.getBoundingClientRect();
      const scaleX = CANVAS_SIZE / rect.width;
      const scaleY = CANVAS_SIZE / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const isNearPoint = (px: number, py: number, tx: number, ty: number, threshold = HANDLE_SIZE) => (
      Math.abs(px - tx) <= threshold && Math.abs(py - ty) <= threshold
    );

    const handleMouseDown = (e: MouseEvent) => {
      const coll = colliderRef.current;
      if (!coll || coll.type === 'none') return;
      const pos = getMousePos(e);
      const centerX = CANVAS_SIZE / 2 + coll.offsetX;
      const centerY = CANVAS_SIZE / 2 + coll.offsetY;

      const handles = coll.type === 'circle'
        ? {
            t: { x: centerX, y: centerY - coll.radius },
            b: { x: centerX, y: centerY + coll.radius },
            l: { x: centerX - coll.radius, y: centerY },
            r: { x: centerX + coll.radius, y: centerY },
          }
        : {
            tl: { x: centerX - coll.width / 2, y: centerY - coll.height / 2 },
            tr: { x: centerX + coll.width / 2, y: centerY - coll.height / 2 },
            bl: { x: centerX - coll.width / 2, y: centerY + coll.height / 2 },
            br: { x: centerX + coll.width / 2, y: centerY + coll.height / 2 },
            t: { x: centerX, y: centerY - coll.height / 2 },
            b: { x: centerX, y: centerY + coll.height / 2 },
            l: { x: centerX - coll.width / 2, y: centerY },
            r: { x: centerX + coll.width / 2, y: centerY },
          };

      if (coll.type !== 'circle') {
        if (isNearPoint(pos.x, pos.y, handles.tl!.x, handles.tl!.y)) {
          colliderDragModeRef.current = 'resize-tl';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
        if (isNearPoint(pos.x, pos.y, handles.tr!.x, handles.tr!.y)) {
          colliderDragModeRef.current = 'resize-tr';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
        if (isNearPoint(pos.x, pos.y, handles.bl!.x, handles.bl!.y)) {
          colliderDragModeRef.current = 'resize-bl';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
        if (isNearPoint(pos.x, pos.y, handles.br!.x, handles.br!.y)) {
          colliderDragModeRef.current = 'resize-br';
          colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
          return;
        }
      }

      if (isNearPoint(pos.x, pos.y, handles.t.x, handles.t.y)) {
        colliderDragModeRef.current = 'resize-t';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }
      if (isNearPoint(pos.x, pos.y, handles.b.x, handles.b.y)) {
        colliderDragModeRef.current = 'resize-b';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }
      if (isNearPoint(pos.x, pos.y, handles.l.x, handles.l.y)) {
        colliderDragModeRef.current = 'resize-l';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }
      if (isNearPoint(pos.x, pos.y, handles.r.x, handles.r.y)) {
        colliderDragModeRef.current = 'resize-r';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
        return;
      }

      let insideCollider = false;
      if (coll.type === 'circle') {
        const dist = Math.hypot(pos.x - centerX, pos.y - centerY);
        insideCollider = dist <= coll.radius;
      } else {
        insideCollider = Math.abs(pos.x - centerX) <= coll.width / 2 &&
          Math.abs(pos.y - centerY) <= coll.height / 2;
      }

      if (insideCollider) {
        colliderDragModeRef.current = 'move';
        colliderDragStartRef.current = { x: pos.x, y: pos.y, collider: { ...coll } };
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const mode = colliderDragModeRef.current;
      const dragStart = colliderDragStartRef.current;
      if (mode === 'none' || !dragStart) return;

      const pos = getMousePos(e);
      const dx = pos.x - dragStart.x;
      const dy = pos.y - dragStart.y;
      const original = dragStart.collider;
      const updated = { ...original };

      if (mode === 'move') {
        updated.offsetX = original.offsetX + dx;
        updated.offsetY = original.offsetY + dy;
      } else if (original.type === 'circle') {
        const centerX = CANVAS_SIZE / 2 + original.offsetX;
        const centerY = CANVAS_SIZE / 2 + original.offsetY;
        updated.radius = Math.max(16, Math.hypot(pos.x - centerX, pos.y - centerY));
      } else {
        if (mode === 'resize-tl') {
          updated.width = Math.max(32, original.width - dx);
          updated.height = Math.max(32, original.height - dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-tr') {
          updated.width = Math.max(32, original.width + dx);
          updated.height = Math.max(32, original.height - dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-bl') {
          updated.width = Math.max(32, original.width - dx);
          updated.height = Math.max(32, original.height + dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-br') {
          updated.width = Math.max(32, original.width + dx);
          updated.height = Math.max(32, original.height + dy);
          updated.offsetX = original.offsetX + dx / 2;
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-t') {
          updated.height = Math.max(32, original.height - dy);
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-b') {
          updated.height = Math.max(32, original.height + dy);
          updated.offsetY = original.offsetY + dy / 2;
        } else if (mode === 'resize-l') {
          updated.width = Math.max(32, original.width - dx);
          updated.offsetX = original.offsetX + dx / 2;
        } else if (mode === 'resize-r') {
          updated.width = Math.max(32, original.width + dx);
          updated.offsetX = original.offsetX + dx / 2;
        }
      }

      onColliderChangeRef.current?.(updated);
      drawCollider(updated, true);
    };

    const handleMouseUp = () => {
      colliderDragModeRef.current = 'none';
      colliderDragStartRef.current = null;
    };

    colliderCanvas.addEventListener('mousedown', handleMouseDown);
    colliderCanvas.addEventListener('mousemove', handleMouseMove);
    colliderCanvas.addEventListener('mouseup', handleMouseUp);
    colliderCanvas.addEventListener('mouseleave', handleMouseUp);

    return () => {
      colliderCanvas.removeEventListener('mousedown', handleMouseDown);
      colliderCanvas.removeEventListener('mousemove', handleMouseMove);
      colliderCanvas.removeEventListener('mouseup', handleMouseUp);
      colliderCanvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [activeTool, drawCollider]);

  // Keep viewport size in sync with panel size.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateViewportSize = () => {
      const rect = container.getBoundingClientRect();
      setViewportSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };

    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Stage-like pan behavior: middle/right mouse drag.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 1 && event.button !== 2) return;
      if (!container.contains(event.target as Node)) return;
      event.preventDefault();

      const camera = cameraCenterRef.current;
      panSessionRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        cameraStartX: camera.x,
        cameraStartY: camera.y,
      };
      setIsViewportPanning(true);
    };

    const handleMouseMove = (event: MouseEvent) => {
      const pan = panSessionRef.current;
      if (!pan) return;
      event.preventDefault();
      const currentScale = BASE_VIEW_SCALE * zoomRef.current;
      const dx = (event.clientX - pan.startX) / currentScale;
      const dy = (event.clientY - pan.startY) / currentScale;
      setCameraCenter({
        x: pan.cameraStartX - dx,
        y: pan.cameraStartY - dy,
      });
    };

    const endPan = () => {
      if (!panSessionRef.current) return;
      panSessionRef.current = null;
      setIsViewportPanning(false);
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (container.contains(event.target as Node)) {
        event.preventDefault();
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', endPan);
    window.addEventListener('blur', endPan);
    container.addEventListener('contextmenu', handleContextMenu);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', endPan);
      window.removeEventListener('blur', endPan);
      container.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  // Bitmap marquee selection: drag box to extract a floating bitmap object with Fabric transform gizmos.
  useEffect(() => {
    const overlayCanvas = bitmapSelectionCanvasRef.current;
    if (!overlayCanvas) return;
    const isBitmapSelect = editorModeState === 'bitmap' && activeTool === 'select';
    if (!isBitmapSelect || hasBitmapFloatingSelection) {
      drawBitmapSelectionOverlay();
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (bitmapSelectionBusyRef.current) return;
      const pos = getSelectionMousePos(event);
      bitmapSelectionDragModeRef.current = 'marquee';
      bitmapSelectionStartRef.current = pos;
      bitmapMarqueeRectRef.current = {
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
      };
      drawBitmapSelectionOverlay();
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (bitmapSelectionBusyRef.current) return;
      const mode = bitmapSelectionDragModeRef.current;
      if (mode === 'none') return;
      const pos = getSelectionMousePos(event);

      const start = bitmapSelectionStartRef.current;
      if (!start) return;
      const x = Math.min(start.x, pos.x);
      const y = Math.min(start.y, pos.y);
      const width = Math.abs(pos.x - start.x);
      const height = Math.abs(pos.y - start.y);
      bitmapMarqueeRectRef.current = { x, y, width, height };
      drawBitmapSelectionOverlay();
    };

    const handleMouseUp = async () => {
      const mode = bitmapSelectionDragModeRef.current;
      if (mode === 'none') return;
      bitmapSelectionDragModeRef.current = 'none';

      const marquee = bitmapMarqueeRectRef.current;
      bitmapSelectionStartRef.current = null;
      bitmapMarqueeRectRef.current = null;
      drawBitmapSelectionOverlay();

      if (!marquee || marquee.width < 1 || marquee.height < 1) {
        return;
      }

      const width = Math.max(1, Math.floor(marquee.width));
      const height = Math.max(1, Math.floor(marquee.height));
      const x = Math.floor(marquee.x);
      const y = Math.floor(marquee.y);

      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas || bitmapSelectionBusyRef.current) return;

      bitmapSelectionBusyRef.current = true;
      try {
        const raster = fabricCanvas.toCanvasElement(1);
        const rasterCtx = raster.getContext('2d', { willReadFrequently: true });
        if (!rasterCtx) return;

        const selectionImageData = rasterCtx.getImageData(x, y, width, height);
        let hasVisiblePixel = false;
        for (let i = 3; i < selectionImageData.data.length; i += 4) {
          if (selectionImageData.data[i] > 0) {
            hasVisiblePixel = true;
            break;
          }
        }
        if (!hasVisiblePixel) {
          return;
        }

        rasterCtx.clearRect(x, y, width, height);
        const loaded = await loadBitmapLayer(raster.toDataURL('image/png'), false);
        if (!loaded) return;

        const selectionCanvas = document.createElement('canvas');
        selectionCanvas.width = width;
        selectionCanvas.height = height;
        const selectionCtx = selectionCanvas.getContext('2d');
        if (!selectionCtx) return;
        selectionCtx.putImageData(selectionImageData, 0, 0);

        const floatingImage = await FabricImage.fromURL(selectionCanvas.toDataURL('image/png'));
        floatingImage.set({
          left: x + width / 2,
          top: y + height / 2,
          originX: 'center',
          originY: 'center',
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          lockMovementX: false,
          lockMovementY: false,
          lockRotation: false,
          lockScalingX: false,
          lockScalingY: false,
        } as any);
        (floatingImage as any).__bitmapFloatingSelection = true;
        floatingImage.borderColor = VECTOR_SELECTION_COLOR;
        floatingImage.borderScaleFactor = VECTOR_SELECTION_BORDER_SCALE;
        floatingImage.borderOpacityWhenMoving = VECTOR_SELECTION_BORDER_OPACITY;
        floatingImage.cornerStyle = 'rect';
        floatingImage.cornerColor = VECTOR_SELECTION_CORNER_COLOR;
        floatingImage.cornerStrokeColor = VECTOR_SELECTION_CORNER_STROKE;
        floatingImage.cornerSize = 12;
        floatingImage.transparentCorners = false;

        fabricCanvas.add(floatingImage);
        fabricCanvas.setActiveObject(floatingImage);
        bitmapFloatingObjectRef.current = floatingImage;
        setHasBitmapFloatingSelection(true);
        syncSelectionState();
        configureCanvasForTool();
        fabricCanvas.requestRenderAll();
        drawBitmapSelectionOverlay();
      } finally {
        bitmapSelectionBusyRef.current = false;
      }
    };

    overlayCanvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      overlayCanvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    activeTool,
    configureCanvasForTool,
    drawBitmapSelectionOverlay,
    editorModeState,
    hasBitmapFloatingSelection,
    getSelectionMousePos,
    loadBitmapLayer,
    syncSelectionState,
  ]);

  // If we leave bitmap select mode with a floating selection, commit it to avoid losing pixels.
  useEffect(() => {
    if (editorModeState === 'bitmap' && activeTool === 'select') {
      return;
    }
    if (bitmapFloatingObjectRef.current) {
      void commitBitmapSelection();
      return;
    }
    drawBitmapSelectionOverlay();
  }, [activeTool, commitBitmapSelection, drawBitmapSelectionOverlay, editorModeState]);

  // Expose imperative methods.
  useImperativeHandle(ref, () => ({
    toDataURL: () => {
      const composed = getCanvasElement();
      return composed.toDataURL('image/webp', 0.85);
    },

    toDataURLWithBounds: () => {
      const composed = getCanvasElement();
      return {
        dataUrl: composed.toDataURL('image/webp', 0.85),
        bounds: calculateBoundsFromCanvas(composed),
      };
    },

    loadFromDataURL: async (dataUrl: string) => {
      await loadBitmapLayer(dataUrl, false);
      setEditorMode('bitmap');
      historyRef.current = [];
      historyIndexRef.current = -1;
      saveHistory();
    },

    loadCostume,

    exportCostumeState,

    setEditorMode: async (mode: CostumeEditorMode) => {
      await switchEditorMode(mode);
      configureCanvasForTool();
    },

    getEditorMode: () => editorModeRef.current,

    deleteSelection,

    duplicateSelection,

    moveSelectionOrder,

    alignSelection,

    isTextEditing,

    clear: () => {
      void (async () => {
        await loadBitmapLayer('', false);
        setEditorMode('bitmap');
        saveHistory();
      })();
    },

    undo: () => {
      if (historyIndexRef.current <= 0) return;
      historyIndexRef.current -= 1;
      const snapshot = historyRef.current[historyIndexRef.current];
      void applySnapshot(snapshot);
    },

    redo: () => {
      if (historyIndexRef.current >= historyRef.current.length - 1) return;
      historyIndexRef.current += 1;
      const snapshot = historyRef.current[historyIndexRef.current];
      void applySnapshot(snapshot);
    },

    canUndo: () => historyIndexRef.current > 0,
    canRedo: () => historyIndexRef.current < historyRef.current.length - 1,
  }), [
    applySnapshot,
    configureCanvasForTool,
    exportCostumeState,
    getCanvasElement,
    loadBitmapLayer,
    loadCostume,
    saveHistory,
    setEditorMode,
    switchEditorMode,
    deleteSelection,
    duplicateSelection,
    moveSelectionOrder,
    alignSelection,
    isTextEditing,
  ]);

  // Natural wheel controls (stage-matched):
  // - ctrl/cmd + wheel: zoom at cursor pivot.
  // - plain wheel: pan viewport.
  const handleWheel = useCallback((e: WheelEvent) => {
    const container = containerRef.current;
    if (!container) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      const rect = container.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      const zoomDelta = -e.deltaY * 0.01;
      const zoomFactor = Math.max(0.01, 1 + zoomDelta);
      const nextZoom = clampZoom(zoomRef.current * zoomFactor);
      zoomAtScreenPoint(pointerX, pointerY, nextZoom);
      return;
    }

    const currentScale = BASE_VIEW_SCALE * zoomRef.current;
    setCameraCenter((prev) => ({
      x: prev.x + e.deltaX / currentScale,
      y: prev.y + e.deltaY / currentScale,
    }));
  }, [clampZoom, zoomAtScreenPoint]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => handleWheel(event);
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [handleWheel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      brushCursorPosRef.current = { x, y };
      const overlay = brushCursorOverlayRef.current;
      if (!overlay) return;
      overlay.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      if (brushCursorEnabledRef.current) {
        overlay.style.opacity = '1';
      }
    };

    const onPointerLeave = () => {
      brushCursorPosRef.current = null;
      const overlay = brushCursorOverlayRef.current;
      if (overlay) {
        overlay.style.opacity = '0';
      }
    };

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerleave', onPointerLeave);

    return () => {
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
    };
  }, []);

  useEffect(() => {
    syncBrushCursorOverlay();
  }, [activeTool, brushColor, brushSize, editorModeState, zoom, syncBrushCursorOverlay]);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
    setCameraCenter({ x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 });
  }, []);

  const currentViewScale = BASE_VIEW_SCALE * zoom;
  const canvasLeft = viewportSize.width / 2 - cameraCenter.x * currentViewScale;
  const canvasTop = viewportSize.height / 2 - cameraCenter.y * currentViewScale;

  return (
    <div className="flex-1 overflow-hidden bg-muted/50 flex flex-col">
      <CostumeCanvasHeader
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        zoom={zoom}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onZoomOut={() => zoomAroundViewportCenter(zoom - ZOOM_STEP)}
        onZoomIn={() => zoomAroundViewportCenter(zoom + ZOOM_STEP)}
        onZoomReset={handleZoomReset}
        colliderType={colliderType}
        onColliderTypeChange={onColliderTypeChange}
        activeTool={activeTool}
        onToolChange={onToolChange}
      />

      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
        style={{
          cursor: isViewportPanning ? 'grabbing' : undefined,
          overscrollBehavior: 'contain',
        }}
      >
        <div
          className="border shadow-sm absolute top-0 left-0 overflow-hidden checkerboard-bg"
          style={{
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            transform: `translate(${canvasLeft}px, ${canvasTop}px) scale(${currentViewScale})`,
            transformOrigin: 'top left',
          }}
        >
          <canvas
            ref={fabricCanvasElementRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              width: CANVAS_SIZE,
              height: CANVAS_SIZE,
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          />

          <canvas
            ref={bitmapSelectionCanvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: CANVAS_SIZE,
              height: CANVAS_SIZE,
              pointerEvents: editorModeState === 'bitmap' && activeTool === 'select' && !hasBitmapFloatingSelection ? 'auto' : 'none',
            }}
          />

          <canvas
            ref={colliderCanvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: CANVAS_SIZE,
              height: CANVAS_SIZE,
              pointerEvents: activeTool === 'collider' ? 'auto' : 'none',
            }}
          />
        </div>
        <div
          ref={brushCursorOverlayRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 12,
            height: 12,
            borderRadius: '9999px',
            border: '1.5px solid #111111',
            background: 'rgba(255,255,255,0.1)',
            transform: 'translate(-9999px, -9999px)',
            opacity: 0,
            pointerEvents: 'none',
            zIndex: 40,
          }}
        />
      </div>
    </div>
  );
});

CostumeCanvas.displayName = 'CostumeCanvas';
