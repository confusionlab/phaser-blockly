import { useCallback, type MutableRefObject, type RefObject } from 'react';
import { type Canvas as FabricCanvas } from 'fabric';
import { getBrushPaintColor, getCompositeOperation, type BitmapBrushKind } from '@/lib/background/brushCore';
import type { CostumeEditorMode } from '@/types';
import { attachTextEditingContainer, isTextEditableObject } from './costumeTextCommands';
import {
  OBJECT_SELECTION_CORNER_SIZE,
  OBJECT_SELECTION_PADDING,
  VECTOR_SELECTION_BORDER_OPACITY,
  VECTOR_SELECTION_BORDER_SCALE,
  VECTOR_SELECTION_COLOR,
  VECTOR_SELECTION_CORNER_COLOR,
  VECTOR_SELECTION_CORNER_STROKE,
} from './costumeCanvasShared';
import {
  applyCanvasCursor,
  BitmapStampBrush,
  type BitmapStampBrushCommitPayload,
  CompositePencilBrush,
} from './costumeCanvasBitmapRuntime';
import {
  isDirectlyEditablePathObject,
  isVectorPointSelectableObject,
  VectorPencilBrush,
} from './costumeCanvasVectorRuntime';
import type { DrawingTool } from './CostumeToolbar';

interface UseCostumeCanvasToolControllerOptions {
  activeLayerLocked: boolean;
  activeLayerVisible: boolean;
  activeToolRef: MutableRefObject<DrawingTool>;
  applyVectorPointControls: (target: any) => boolean;
  applyVectorPointEditingAppearance: (target: any) => void;
  bitmapBrushKindRef: MutableRefObject<BitmapBrushKind>;
  bitmapFloatingObjectRef: MutableRefObject<any | null>;
  brushColorRef: MutableRefObject<string>;
  brushSizeRef: MutableRefObject<number>;
  commitBitmapStampBrushStroke: (payload: BitmapStampBrushCommitPayload) => void;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  ensurePathLikeObjectForVectorTool: (target: any) => any | null;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  getZoomInvariantMetric: (value: number, zoom?: number) => number;
  normalizeCanvasVectorStrokeUniform: () => void;
  restoreAllOriginalControls: () => void;
  restoreOriginalControls: (obj: any) => void;
  saveHistory: () => void;
  setVectorPointEditingTarget: (nextTarget: any | null) => void;
  syncBrushCursorOverlay: () => void;
  syncSelectionState: () => void;
  textEditingHostRef: RefObject<HTMLDivElement | null>;
  vectorPointEditingTargetRef: MutableRefObject<any | null>;
  vectorStyleRef: MutableRefObject<any>;
}

export function useCostumeCanvasToolController({
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
}: UseCostumeCanvasToolControllerOptions) {
  const activateVectorPointEditing = useCallback((target: any, saveConversionToHistory: boolean): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'select') return false;

    let activeObject = target ?? fabricCanvas.getActiveObject() as any;
    if (!activeObject) return false;
    if (!isVectorPointSelectableObject(activeObject)) {
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
      return false;
    }

    if (!isDirectlyEditablePathObject(activeObject)) {
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

    fabricCanvas.setActiveObject(activeObject);
    setVectorPointEditingTarget(activeObject);
    applyVectorPointEditingAppearance(activeObject);
    fabricCanvas.requestRenderAll();
    return true;
  }, [
    activeToolRef,
    applyVectorPointControls,
    applyVectorPointEditingAppearance,
    editorModeRef,
    ensurePathLikeObjectForVectorTool,
    fabricCanvasRef,
    saveHistory,
    setVectorPointEditingTarget,
  ]);

  const configureCanvasForTool = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    const mode = editorModeRef.current;
    const tool = activeToolRef.current;
    const layerInteractive = activeLayerVisible && !activeLayerLocked;
    const pointEditingTarget = vectorPointEditingTargetRef.current;

    if (pointEditingTarget && !fabricCanvas.getObjects().includes(pointEditingTarget)) {
      setVectorPointEditingTarget(null);
    }
    if (vectorPointEditingTargetRef.current && (mode !== 'vector' || tool !== 'select' || !layerInteractive)) {
      restoreAllOriginalControls();
      setVectorPointEditingTarget(null);
    }

    if (mode === 'vector') {
      normalizeCanvasVectorStrokeUniform();
    }

    const isBitmapBrush = layerInteractive && mode === 'bitmap' && (tool === 'brush' || tool === 'eraser');
    const isVectorPencil = layerInteractive && mode === 'vector' && tool === 'brush';
    if (isBitmapBrush) {
      const compositeOperation = getCompositeOperation(tool);
      const brush = bitmapBrushKindRef.current !== 'hard-round'
        ? new BitmapStampBrush(fabricCanvas, {
            brushKind: bitmapBrushKindRef.current,
            brushColor: brushColorRef.current,
            brushSize: brushSizeRef.current,
            compositeOperation,
            onCommit: commitBitmapStampBrushStroke,
          })
        : new CompositePencilBrush(fabricCanvas as any);
      brush.width = brushSizeRef.current;
      brush.color = getBrushPaintColor(tool, brushColorRef.current);
      if (brush instanceof CompositePencilBrush) {
        brush.compositeOperation = compositeOperation;
      }
      (fabricCanvas as any).freeDrawingBrush = brush;
      fabricCanvas.isDrawingMode = true;
    } else if (isVectorPencil) {
      const brush = new VectorPencilBrush(fabricCanvas, {
        strokeBrushId: vectorStyleRef.current.strokeBrushId,
        strokeColor: vectorStyleRef.current.strokeColor,
        strokeWidth: vectorStyleRef.current.strokeWidth,
      });
      (fabricCanvas as any).freeDrawingBrush = brush;
      fabricCanvas.isDrawingMode = true;
    } else {
      fabricCanvas.isDrawingMode = false;
      if (fabricCanvas.lowerCanvasEl) {
        fabricCanvas.lowerCanvasEl.style.opacity = '';
      }
      if (fabricCanvas.contextTop) {
        fabricCanvas.contextTop.globalCompositeOperation = 'source-over';
      }
    }

    const isVectorPointMode = layerInteractive && mode === 'vector' && tool === 'select' && !!vectorPointEditingTargetRef.current;
    const isVectorSelectionMode = layerInteractive && mode === 'vector' && tool === 'select' && !isVectorPointMode;
    const isVectorTextMode = layerInteractive && mode === 'vector' && tool === 'text';
    const floatingBitmapObject = bitmapFloatingObjectRef.current;
    const isBitmapFloatingSelectionMode =
      layerInteractive &&
      mode === 'bitmap' &&
      tool === 'select' &&
      !!floatingBitmapObject;

    restoreAllOriginalControls();
    fabricCanvas.selection = isVectorSelectionMode;
    fabricCanvas.selectionColor = 'rgba(0, 94, 255, 0.14)';
    fabricCanvas.selectionBorderColor = VECTOR_SELECTION_COLOR;
    fabricCanvas.selectionLineWidth = 2;
    fabricCanvas.selectionDashArray = [];
    fabricCanvas.forEachObject((obj: any) => {
      if (isTextEditableObject(obj)) {
        attachTextEditingContainer(obj, textEditingHostRef.current);
      }

      const isPointEditingTarget = isVectorPointMode && obj === vectorPointEditingTargetRef.current;
      const selectable = !layerInteractive
        ? false
        : isVectorSelectionMode
          ? true
          : isVectorPointMode
            ? isVectorPointSelectableObject(obj)
            : isVectorTextMode
              ? isTextEditableObject(obj)
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
      obj.borderScaleFactor = getZoomInvariantMetric(VECTOR_SELECTION_BORDER_SCALE);
      obj.borderOpacityWhenMoving = VECTOR_SELECTION_BORDER_OPACITY;
      obj.cornerStyle = 'rect';
      obj.cornerColor = VECTOR_SELECTION_CORNER_COLOR;
      obj.cornerStrokeColor = VECTOR_SELECTION_CORNER_STROKE;
      obj.cornerSize = getZoomInvariantMetric(OBJECT_SELECTION_CORNER_SIZE);
      obj.transparentCorners = false;
      obj.padding = getZoomInvariantMetric(OBJECT_SELECTION_PADDING);

      if (isVectorPointMode) {
        if (isPointEditingTarget) {
          const objAny = obj as any;
          applyVectorPointControls(objAny);
          applyVectorPointEditingAppearance(objAny);
        } else {
          restoreOriginalControls(obj);
          const objAny = obj as any;
          objAny.hasControls = false;
          objAny.hasBorders = false;
          objAny.lockMovementX = false;
          objAny.lockMovementY = false;
          objAny.lockRotation = false;
          objAny.lockScalingX = false;
          objAny.lockScalingY = false;
        }
      }
    });

    let activeObject = fabricCanvas.getActiveObject() as any;
    if (!layerInteractive && activeObject) {
      fabricCanvas.discardActiveObject();
      activeObject = null;
    }
    if (
      isVectorPointMode &&
      vectorPointEditingTargetRef.current &&
      activeObject !== vectorPointEditingTargetRef.current
    ) {
      fabricCanvas.setActiveObject(vectorPointEditingTargetRef.current);
      activeObject = vectorPointEditingTargetRef.current;
    }
    if (activeObject) {
      if (isVectorPointMode && !isVectorPointSelectableObject(activeObject)) {
        fabricCanvas.discardActiveObject();
        activeObject = null;
      }
      if (activeObject && !isVectorSelectionMode && !isVectorPointMode && activeObject !== floatingBitmapObject) {
        const keepActiveTextObject = isVectorTextMode && isTextEditableObject(activeObject);
        if (!keepActiveTextObject) {
          fabricCanvas.discardActiveObject();
          activeObject = null;
        }
      }

      if (activeObject && isVectorPointMode && activeObject === vectorPointEditingTargetRef.current) {
        activateVectorPointEditing(activeObject, false);
      }
    }

    let cursor = 'default';
    if (mode === 'bitmap' && (tool === 'brush' || tool === 'eraser')) {
      cursor = 'none';
    } else if (
      tool === 'fill' ||
      tool === 'line' ||
      tool === 'circle' ||
      tool === 'rectangle' ||
      tool === 'triangle' ||
      tool === 'star' ||
      tool === 'pen' ||
      (mode === 'vector' && tool === 'brush')
    ) {
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
  }, [
    activeLayerLocked,
    activeLayerVisible,
    activeToolRef,
    activateVectorPointEditing,
    applyVectorPointControls,
    applyVectorPointEditingAppearance,
    bitmapBrushKindRef,
    bitmapFloatingObjectRef,
    brushColorRef,
    brushSizeRef,
    commitBitmapStampBrushStroke,
    editorModeRef,
    fabricCanvasRef,
    getZoomInvariantMetric,
    normalizeCanvasVectorStrokeUniform,
    restoreAllOriginalControls,
    restoreOriginalControls,
    setVectorPointEditingTarget,
    syncBrushCursorOverlay,
    syncSelectionState,
    textEditingHostRef,
    vectorPointEditingTargetRef,
    vectorStyleRef,
  ]);

  return {
    activateVectorPointEditing,
    configureCanvasForTool,
  };
}
