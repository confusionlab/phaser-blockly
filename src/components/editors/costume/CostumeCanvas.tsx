import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import {
  Canvas as FabricCanvas,
  PencilBrush,
  Rect,
  Ellipse,
  Line,
  IText,
  ActiveSelection,
  FabricImage,
} from 'fabric';
import * as Select from '@radix-ui/react-select';
import { Undo2, Redo2, Move, ChevronDown, Check } from 'lucide-react';
import { floodFill, hexToRgb } from '@/utils/floodFill';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import { Button } from '@/components/ui/button';
import type { DrawingTool, EditorMode, TextToolStyle } from './CostumeToolbar';
import type { Costume, CostumeBounds, ColliderConfig } from '@/types';

const CANVAS_SIZE = 1024;
const BASE_DISPLAY_SIZE = 480;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;
const HANDLE_SIZE = 16;
const VECTOR_SELECTION_COLOR = '#005eff';
const VECTOR_SELECTION_CORNER_COLOR = '#ffffff';
const VECTOR_SELECTION_CORNER_STROKE = '#005eff';
const VECTOR_SELECTION_BORDER_OPACITY = 1;
const VECTOR_SELECTION_BORDER_SCALE = 2;

type CanvasHistorySnapshot = {
  mode: EditorMode;
  bitmapDataUrl: string;
  vectorJson: string | null;
};

export interface CostumeCanvasExportState {
  dataUrl: string;
  bounds: CostumeBounds | null;
  editorMode: EditorMode;
  vectorDocument?: {
    version: 1;
    fabricJson: string;
  };
}

export interface CostumeCanvasHandle {
  toDataURL: () => string;
  toDataURLWithBounds: () => { dataUrl: string; bounds: CostumeBounds | null };
  loadFromDataURL: (dataUrl: string) => Promise<void>;
  loadCostume: (costume: Costume) => Promise<void>;
  exportCostumeState: () => CostumeCanvasExportState;
  setEditorMode: (mode: EditorMode) => Promise<void>;
  getEditorMode: () => EditorMode;
  deleteSelection: () => boolean;
  duplicateSelection: () => Promise<boolean>;
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
  onModeChange?: (mode: EditorMode) => void;
  onTextStyleSync?: (updates: Partial<TextToolStyle>) => void;
  onTextSelectionChange?: (hasTextSelection: boolean) => void;
}

function isTextObject(obj: unknown): obj is { type: string; set: (props: Record<string, unknown>) => void } {
  if (!obj || typeof obj !== 'object') return false;
  const maybe = obj as { type?: string };
  return maybe.type === 'i-text' || maybe.type === 'textbox' || maybe.type === 'text';
}

export const CostumeCanvas = forwardRef<CostumeCanvasHandle, CostumeCanvasProps>(({
  activeTool,
  brushColor,
  brushSize,
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
}, ref) => {
  const colliderTypes: { value: ColliderConfig['type']; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'box', label: 'Box' },
    { value: 'circle', label: 'Circle' },
    { value: 'capsule', label: 'Capsule' },
  ];

  const containerRef = useRef<HTMLDivElement>(null);
  const fabricCanvasElementRef = useRef<HTMLCanvasElement>(null);
  const bitmapSelectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const colliderCanvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapSelectionCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const colliderCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);

  const [zoom, setZoom] = useState(1);
  const [editorModeState, setEditorModeState] = useState<EditorMode>('vector');
  const displaySize = BASE_DISPLAY_SIZE * zoom;

  const editorModeRef = useRef<EditorMode>('vector');
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  const brushColorRef = useRef(brushColor);
  brushColorRef.current = brushColor;

  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;

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

  const bitmapSelectionRef = useRef<{
    imageData: ImageData;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const bitmapSelectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const bitmapMarqueeRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const bitmapSelectionDragModeRef = useRef<'none' | 'marquee' | 'move'>('none');
  const bitmapSelectionDragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const bitmapSelectionBusyRef = useRef(false);

  const setEditorMode = useCallback((mode: EditorMode) => {
    editorModeRef.current = mode;
    setEditorModeState(mode);
    onModeChangeRef.current?.(mode);
    if (mode !== 'vector') {
      onTextSelectionChangeRef.current?.(false);
    }
  }, []);

  const drawBitmapSelectionOverlay = useCallback(() => {
    const overlayCtx = bitmapSelectionCtxRef.current;
    if (!overlayCtx) return;

    overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const floating = bitmapSelectionRef.current;
    if (floating) {
      const temp = document.createElement('canvas');
      temp.width = floating.width;
      temp.height = floating.height;
      const tempCtx = temp.getContext('2d');
      if (tempCtx) {
        tempCtx.putImageData(floating.imageData, 0, 0);
        overlayCtx.drawImage(temp, floating.x, floating.y);
      }

      overlayCtx.strokeStyle = '#0066ff';
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([6, 6]);
      overlayCtx.strokeRect(floating.x, floating.y, floating.width, floating.height);
      overlayCtx.setLineDash([]);
    }

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

  const drawFloatingSelectionToContext = useCallback((ctx: CanvasRenderingContext2D) => {
    const floating = bitmapSelectionRef.current;
    if (!floating) return;
    const temp = document.createElement('canvas');
    temp.width = floating.width;
    temp.height = floating.height;
    const tempCtx = temp.getContext('2d');
    if (!tempCtx) return;
    tempCtx.putImageData(floating.imageData, 0, 0);
    ctx.drawImage(temp, floating.x, floating.y);
  }, []);

  const getCanvasElement = useCallback((): HTMLCanvasElement => {
    const fabricCanvas = fabricCanvasRef.current;
    if (fabricCanvas) {
      const composed = fabricCanvas.toCanvasElement(1);
      const composedCtx = composed.getContext('2d');
      if (composedCtx && editorModeRef.current === 'bitmap') {
        drawFloatingSelectionToContext(composedCtx);
      }
      return composed;
    }
    const fallback = document.createElement('canvas');
    fallback.width = CANVAS_SIZE;
    fallback.height = CANVAS_SIZE;
    return fallback;
  }, [drawFloatingSelectionToContext]);

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
    const vectorJson = mode === 'vector' ? JSON.stringify(fabricCanvas.toJSON()) : null;
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

  const loadBitmapLayer = useCallback(async (dataUrl: string, selectable: boolean) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    bitmapSelectionRef.current = null;
    bitmapSelectionStartRef.current = null;
    bitmapMarqueeRectRef.current = null;
    bitmapSelectionDragModeRef.current = 'none';
    bitmapSelectionDragOffsetRef.current = null;
    drawBitmapSelectionOverlay();

    suppressHistoryRef.current = true;
    fabricCanvas.clear();

    if (dataUrl) {
      try {
        const image = await FabricImage.fromURL(dataUrl);
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
      } catch (error) {
        console.error('Failed to load bitmap layer:', error);
      }
    }

    fabricCanvas.requestRenderAll();
    suppressHistoryRef.current = false;
  }, [drawBitmapSelectionOverlay]);

  const commitBitmapSelection = useCallback(async () => {
    const fabricCanvas = fabricCanvasRef.current;
    const floating = bitmapSelectionRef.current;
    if (!fabricCanvas || !floating) return false;
    if (bitmapSelectionBusyRef.current) return false;

    bitmapSelectionBusyRef.current = true;
    try {
      const raster = fabricCanvas.toCanvasElement(1);
      const rasterCtx = raster.getContext('2d');
      if (!rasterCtx) return false;

      const temp = document.createElement('canvas');
      temp.width = floating.width;
      temp.height = floating.height;
      const tempCtx = temp.getContext('2d');
      if (!tempCtx) return false;
      tempCtx.putImageData(floating.imageData, 0, 0);
      rasterCtx.drawImage(temp, floating.x, floating.y);

      await loadBitmapLayer(raster.toDataURL('image/png'), false);
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

  const loadBitmapAsSingleVectorImage = useCallback(async (bitmapCanvas: HTMLCanvasElement) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    suppressHistoryRef.current = true;
    fabricCanvas.clear();

    const bounds = calculateBoundsFromCanvas(bitmapCanvas);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      fabricCanvas.requestRenderAll();
      suppressHistoryRef.current = false;
      return;
    }

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = bounds.width;
    croppedCanvas.height = bounds.height;
    const croppedCtx = croppedCanvas.getContext('2d');
    if (!croppedCtx) {
      suppressHistoryRef.current = false;
      return;
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
      const image = await FabricImage.fromURL(croppedCanvas.toDataURL('image/png'));
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
    } catch (error) {
      console.error('Failed to create vector image from bitmap bounds:', error);
    }

    fabricCanvas.requestRenderAll();
    suppressHistoryRef.current = false;
  }, []);

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
    await loadBitmapLayer(raster.toDataURL('image/png'), false);
    saveHistory();
  }, [loadBitmapLayer, saveHistory]);

  const switchEditorMode = useCallback(async (nextMode: EditorMode) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    if (editorModeRef.current === nextMode) return;

    const rasterizedCanvas = fabricCanvas.toCanvasElement(1);
    const rasterized = rasterizedCanvas.toDataURL('image/png');

    if (nextMode === 'bitmap') {
      await loadBitmapLayer(rasterized, false);
      setEditorMode('bitmap');
    } else {
      await loadBitmapAsSingleVectorImage(rasterizedCanvas);
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
          fabricJson: JSON.stringify(fabricCanvas.toJSON()),
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

    if (activeObject.type === 'activeSelection' && typeof activeObject.getObjects === 'function') {
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

    if (activeObject.type === 'activeSelection' && typeof activeObject.getObjects === 'function') {
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

  const isTextEditing = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'vector') return false;
    const activeObject = fabricCanvas.getActiveObject() as any;
    return !!activeObject && isTextObject(activeObject) && !!(activeObject as any).isEditing;
  }, []);

  const loadCostume = useCallback(async (costume: Costume) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    const requestedMode: EditorMode = costume.editorMode === 'bitmap' ? 'bitmap' : 'vector';
    const hasValidVectorDocument =
      requestedMode === 'vector' &&
      costume.vectorDocument?.version === 1 &&
      typeof costume.vectorDocument.fabricJson === 'string';

    suppressHistoryRef.current = true;
    try {
      if (hasValidVectorDocument) {
        try {
          const parsed = JSON.parse(costume.vectorDocument!.fabricJson);
          fabricCanvas.clear();
          await fabricCanvas.loadFromJSON(parsed);
          fabricCanvas.requestRenderAll();
          setEditorMode('vector');
        } catch (error) {
          console.warn('Invalid vector document. Falling back to bitmap mode.', error);
          await loadBitmapLayer(costume.assetId, false);
          setEditorMode('bitmap');
        }
      } else if (requestedMode === 'vector') {
        await loadBitmapLayer(costume.assetId, false);
        const rasterizedCanvas = fabricCanvas.toCanvasElement(1);
        await loadBitmapAsSingleVectorImage(rasterizedCanvas);
        setEditorMode('vector');
      } else {
        await loadBitmapLayer(costume.assetId, false);
        setEditorMode('bitmap');
      }
    } finally {
      suppressHistoryRef.current = false;
    }

    historyRef.current = [];
    historyIndexRef.current = -1;
    saveHistory();
  }, [loadBitmapAsSingleVectorImage, loadBitmapLayer, saveHistory, setEditorMode]);

  const configureCanvasForTool = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    const mode = editorModeRef.current;
    const tool = activeToolRef.current;

    const isBitmapBrush = mode === 'bitmap' && (tool === 'brush' || tool === 'eraser');
    if (isBitmapBrush) {
      const brush = new PencilBrush(fabricCanvas);
      brush.width = brushSizeRef.current;
      brush.color = brushColorRef.current;
      (fabricCanvas as any).freeDrawingBrush = brush;
      fabricCanvas.isDrawingMode = true;
    } else {
      fabricCanvas.isDrawingMode = false;
    }

    const allowSelection = mode === 'vector' && tool === 'select';
    fabricCanvas.selection = allowSelection;
    fabricCanvas.selectionColor = 'rgba(0, 94, 255, 0.14)';
    fabricCanvas.selectionBorderColor = VECTOR_SELECTION_COLOR;
    fabricCanvas.selectionLineWidth = 2;
    fabricCanvas.selectionDashArray = [];
    fabricCanvas.forEachObject((obj: any) => {
      const selectable = allowSelection;
      obj.selectable = selectable;
      obj.evented = selectable;
      obj.lockMovementX = !selectable;
      obj.lockMovementY = !selectable;
      obj.lockRotation = !selectable;
      obj.lockScalingX = !selectable;
      obj.lockScalingY = !selectable;
      obj.borderColor = VECTOR_SELECTION_COLOR;
      obj.borderScaleFactor = VECTOR_SELECTION_BORDER_SCALE;
      obj.borderOpacityWhenMoving = VECTOR_SELECTION_BORDER_OPACITY;
      obj.cornerStyle = 'rect';
      obj.cornerColor = VECTOR_SELECTION_CORNER_COLOR;
      obj.cornerStrokeColor = VECTOR_SELECTION_CORNER_STROKE;
      obj.cornerSize = 12;
      obj.transparentCorners = false;
      obj.padding = 2;
    });

    let cursor = 'default';
    if (tool === 'brush' || tool === 'eraser' || tool === 'fill' || tool === 'line' || tool === 'circle' || tool === 'rectangle') {
      cursor = 'crosshair';
    } else if (tool === 'text') {
      cursor = 'text';
    } else if (tool === 'collider') {
      cursor = 'move';
    }

    fabricCanvas.defaultCursor = cursor;
    if (fabricCanvas.upperCanvasEl) {
      fabricCanvas.upperCanvasEl.style.cursor = cursor;
    }
    if (fabricCanvas.lowerCanvasEl) {
      fabricCanvas.lowerCanvasEl.style.cursor = cursor;
    }
  }, []);

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
        })();
      } else {
        saveHistory();
      }
    };

    const onPathCreated = (event: any) => {
      if (editorModeRef.current !== 'bitmap') {
        saveHistory();
        return;
      }

      if (activeToolRef.current === 'eraser' && event?.path) {
        event.path.set({ globalCompositeOperation: 'destination-out' });
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
    };

    const onTextChanged = () => {
      if (editorModeRef.current !== 'vector') return;
      syncTextStyleFromSelection();
      syncTextSelectionState();
      saveHistory();
    };

    const onSelectionCleared = () => {
      onTextSelectionChangeRef.current?.(false);
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

    void loadBitmapLayer('', false).then(() => {
      setEditorMode('vector');
      historyRef.current = [];
      historyIndexRef.current = -1;
      saveHistory();
      configureCanvasForTool();
    });

    return () => {
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
  }, [applyFill, configureCanvasForTool, drawBitmapSelectionOverlay, flattenBitmapLayer, loadBitmapLayer, saveHistory, setEditorMode, syncTextSelectionState, syncTextStyleFromSelection]);

  // Sync tool behavior.
  useEffect(() => {
    configureCanvasForTool();
  }, [activeTool, brushColor, brushSize, editorModeState, configureCanvasForTool]);

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

  // Resize CSS dimensions for zoom.
  useEffect(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;
    fabricCanvas.setDimensions(
      { width: displaySize, height: displaySize },
      { cssOnly: true }
    );
  }, [displaySize]);

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

  // Bitmap marquee selection (main-like behavior): drag box, move floating pixels, click outside to deselect.
  useEffect(() => {
    const overlayCanvas = bitmapSelectionCanvasRef.current;
    if (!overlayCanvas) return;
    const isBitmapSelect = editorModeState === 'bitmap' && activeTool === 'select';
    if (!isBitmapSelect) {
      drawBitmapSelectionOverlay();
      return;
    }

    const isInsideFloatingSelection = (x: number, y: number) => {
      const floating = bitmapSelectionRef.current;
      if (!floating) return false;
      return (
        x >= floating.x &&
        x <= floating.x + floating.width &&
        y >= floating.y &&
        y <= floating.y + floating.height
      );
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (bitmapSelectionBusyRef.current) return;
      const pos = getSelectionMousePos(event);
      const floating = bitmapSelectionRef.current;

      if (floating) {
        if (isInsideFloatingSelection(pos.x, pos.y)) {
          bitmapSelectionDragModeRef.current = 'move';
          bitmapSelectionDragOffsetRef.current = {
            x: pos.x - floating.x,
            y: pos.y - floating.y,
          };
          return;
        }
        void commitBitmapSelection();
        return;
      }

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

      if (mode === 'move') {
        const floating = bitmapSelectionRef.current;
        const dragOffset = bitmapSelectionDragOffsetRef.current;
        if (!floating || !dragOffset) return;
        const nextX = Math.max(0, Math.min(CANVAS_SIZE - floating.width, pos.x - dragOffset.x));
        const nextY = Math.max(0, Math.min(CANVAS_SIZE - floating.height, pos.y - dragOffset.y));
        floating.x = nextX;
        floating.y = nextY;
        drawBitmapSelectionOverlay();
        return;
      }

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

      if (mode === 'move') {
        bitmapSelectionDragOffsetRef.current = null;
        drawBitmapSelectionOverlay();
        return;
      }

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
        await loadBitmapLayer(raster.toDataURL('image/png'), false);
        bitmapSelectionRef.current = {
          imageData: selectionImageData,
          x,
          y,
          width,
          height,
        };
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
    commitBitmapSelection,
    drawBitmapSelectionOverlay,
    editorModeState,
    getSelectionMousePos,
    loadBitmapLayer,
  ]);

  // If we leave bitmap select mode with a floating selection, commit it to avoid losing pixels.
  useEffect(() => {
    if (editorModeState === 'bitmap' && activeTool === 'select') {
      return;
    }
    if (bitmapSelectionRef.current) {
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

    setEditorMode: async (mode: EditorMode) => {
      await switchEditorMode(mode);
      configureCanvasForTool();
    },

    getEditorMode: () => editorModeRef.current,

    deleteSelection,

    duplicateSelection,

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
    isTextEditing,
  ]);

  // Handle wheel zoom.
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((prev) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)));
  }, []);

  return (
    <div className="flex-1 overflow-hidden bg-muted/50 flex flex-col">
      <div className="flex items-center py-2 px-3 border-b bg-background/50">
        <div className="flex-1 flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={onUndo} disabled={!canUndo} title="Undo">
            <Undo2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={onRedo} disabled={!canRedo} title="Redo">
            <Redo2 className="size-4" />
          </Button>
        </div>

        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setZoom((prev) => Math.max(MIN_ZOOM, prev - ZOOM_STEP))}
            className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded"
            disabled={zoom <= MIN_ZOOM}
          >
            -
          </button>
          <span className="text-xs text-muted-foreground w-16 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((prev) => Math.min(MAX_ZOOM, prev + ZOOM_STEP))}
            className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded"
            disabled={zoom >= MAX_ZOOM}
          >
            +
          </button>
          <button
            onClick={() => setZoom(1)}
            className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded ml-2"
          >
            Reset
          </button>
        </div>

        <div className="flex-1 flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">Collider:</span>
          <Select.Root value={colliderType} onValueChange={(value) => onColliderTypeChange(value as ColliderConfig['type'])}>
            <Select.Trigger className="inline-flex items-center justify-between gap-1 h-8 px-2 text-xs bg-background border rounded hover:bg-accent min-w-[90px]">
              <Select.Value />
              <Select.Icon>
                <ChevronDown className="size-3" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="bg-popover border rounded-md shadow-md z-50">
                <Select.Viewport className="p-1">
                  {colliderTypes.map(({ value, label }) => (
                    <Select.Item
                      key={value}
                      value={value}
                      className="flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer outline-none hover:bg-accent data-[highlighted]:bg-accent"
                    >
                      <Select.ItemIndicator>
                        <Check className="size-3" />
                      </Select.ItemIndicator>
                      <Select.ItemText>{label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>

          {colliderType !== 'none' && (
            <Button
              variant={activeTool === 'collider' ? 'default' : 'outline'}
              size="sm"
              className="h-8 px-2 gap-1"
              onClick={() => onToolChange('collider')}
              title="Edit Collider"
              style={activeTool === 'collider' ? { backgroundColor: '#22c55e', borderColor: '#22c55e' } : { borderColor: '#22c55e', color: '#22c55e' }}
            >
              <Move className="size-3" />
              <span className="text-xs">Edit</span>
            </Button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex items-center justify-center p-4"
        onWheel={handleWheel}
      >
        <div
          className="border shadow-sm relative overflow-hidden flex-shrink-0 checkerboard-bg"
          style={{
            width: displaySize,
            height: displaySize,
          }}
        >
          <canvas
            ref={fabricCanvasElementRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            style={{
              width: displaySize,
              height: displaySize,
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
              width: displaySize,
              height: displaySize,
              pointerEvents: editorModeState === 'bitmap' && activeTool === 'select' ? 'auto' : 'none',
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
              width: displaySize,
              height: displaySize,
              pointerEvents: activeTool === 'collider' ? 'auto' : 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
});

CostumeCanvas.displayName = 'CostumeCanvas';
