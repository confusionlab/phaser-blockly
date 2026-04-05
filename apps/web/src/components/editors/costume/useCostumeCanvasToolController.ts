import { useCallback, type MutableRefObject, type RefObject } from 'react';
import { type Canvas as FabricCanvas } from 'fabric';
import { getBrushPaintColor, getCompositeOperation, type BitmapBrushKind } from '@/lib/background/brushCore';
import {
  fabricCanvasContainsObject,
  forEachFabricObjectDeep,
  isActiveSelectionObject,
  isVectorSelectionDirectTarget,
  resolveVectorSelectionDirectTarget,
  sanitizeVectorGroupEditingPath,
  syncVectorGroupInteractivity,
} from '@/lib/editor/fabricVectorSelection';
import { getResolvedEditorSelectionTokens } from '@/lib/ui/editorSelectionTokens';
import type { CostumeEditorMode } from '@/types';
import { attachTextEditingContainer, isTextEditableObject } from './costumeTextCommands';
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
import {
  applyUnifiedFabricTransformCanvasOptions,
  applyUnifiedObjectTransformGizmoAppearance,
} from './costumeCanvasObjectTransformGizmo';

interface UseCostumeCanvasToolControllerOptions {
  activeLayerLocked: boolean;
  activeLayerVisible: boolean;
  activeToolRef: MutableRefObject<DrawingTool>;
  applyVectorPointControls: (target: any) => boolean;
  applyVectorPointEditingAppearance: (target: any) => void;
  bitmapBrushKindRef: MutableRefObject<BitmapBrushKind>;
  brushColorRef: MutableRefObject<string>;
  brushOpacityRef: MutableRefObject<number>;
  brushSizeRef: MutableRefObject<number>;
  commitBitmapStampBrushStroke: (payload: BitmapStampBrushCommitPayload) => Promise<void>;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  ensurePathLikeObjectForVectorTool: (target: any) => any | null;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  getBitmapFloatingSelectionObject: () => any | null;
  getZoomInvariantMetric: (value: number, zoom?: number) => number;
  normalizeCanvasVectorStrokeUniform: () => void;
  onVectorTexturePreviewChange?: () => void;
  restoreAllOriginalControls: () => void;
  restoreOriginalControls: (obj: any) => void;
  saveHistory: () => void;
  setVectorPointEditingTarget: (nextTarget: any | null) => void;
  syncBrushCursorOverlay: () => void;
  syncSelectionState: () => void;
  textEditingHostRef: RefObject<HTMLDivElement | null>;
  hoveredVectorTargetRef?: MutableRefObject<any | null>;
  vectorGroupEditingPathRef: MutableRefObject<any[]>;
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
  onVectorTexturePreviewChange,
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

    if (pointEditingTarget && !fabricCanvasContainsObject(fabricCanvas, pointEditingTarget)) {
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
      const brushOpacity = tool === 'brush' ? brushOpacityRef.current : 1;
      const compositeOperation = getCompositeOperation(tool);
      const brush = bitmapBrushKindRef.current !== 'hard-round'
        ? new BitmapStampBrush(fabricCanvas, {
            brushKind: bitmapBrushKindRef.current,
            brushColor: brushColorRef.current,
            brushOpacity,
            brushSize: brushSizeRef.current,
            compositeOperation,
            onCommit: commitBitmapStampBrushStroke,
          })
        : new CompositePencilBrush(fabricCanvas as any);
      brush.width = brushSizeRef.current;
      brush.color = getBrushPaintColor(tool, brushColorRef.current);
      if (brush instanceof CompositePencilBrush) {
        brush.compositeOperation = compositeOperation;
        brush.opacityMultiplier = brushOpacity;
      }
      (fabricCanvas as any).freeDrawingBrush = brush;
      fabricCanvas.isDrawingMode = true;
    } else if (isVectorPencil) {
      const brush = new VectorPencilBrush(fabricCanvas, {
        onPreviewUpdated: onVectorTexturePreviewChange,
        strokeBrushId: vectorStyleRef.current.strokeBrushId,
        strokeColor: vectorStyleRef.current.strokeColor,
        strokeOpacity: vectorStyleRef.current.strokeOpacity,
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
    const floatingBitmapObject = getBitmapFloatingSelectionObject();
    const isBitmapFloatingSelectionMode =
      layerInteractive &&
      mode === 'bitmap' &&
      tool === 'select' &&
      !!floatingBitmapObject;

    restoreAllOriginalControls();
    applyUnifiedFabricTransformCanvasOptions(fabricCanvas);
    fabricCanvas.selection = isVectorSelectionMode;
    const vectorSelectionPath = isVectorSelectionMode
      ? sanitizeVectorGroupEditingPath(fabricCanvas, vectorGroupEditingPathRef.current)
      : [];
    vectorGroupEditingPathRef.current = vectorSelectionPath;
    syncVectorGroupInteractivity(fabricCanvas, vectorSelectionPath);
    const selectionTokens = getResolvedEditorSelectionTokens();
    fabricCanvas.selectionColor = selectionTokens.fill;
    fabricCanvas.selectionBorderColor = selectionTokens.accent;
    fabricCanvas.selectionLineWidth = 2;
    fabricCanvas.selectionDashArray = [];
    forEachFabricObjectDeep(fabricCanvas, (obj: any) => {
      if (isTextEditableObject(obj)) {
        attachTextEditingContainer(obj, textEditingHostRef.current);
      }

      const isPointEditingTarget = isVectorPointMode && obj === vectorPointEditingTargetRef.current;
      const selectable = !layerInteractive
        ? false
        : isVectorSelectionMode
          ? isVectorSelectionDirectTarget(obj, vectorSelectionPath)
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
      applyUnifiedObjectTransformGizmoAppearance(obj, getZoomInvariantMetric, 1);

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
    if (
      hoveredVectorTargetRef &&
      (
        !isVectorSelectionMode ||
        !fabricCanvasContainsObject(fabricCanvas, hoveredVectorTargetRef.current) ||
        !isVectorSelectionDirectTarget(hoveredVectorTargetRef.current, vectorSelectionPath)
      )
    ) {
      hoveredVectorTargetRef.current = null;
    }

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
    if (isVectorSelectionMode && activeObject && !isActiveSelectionObject(activeObject)) {
      const resolvedActiveObject = resolveVectorSelectionDirectTarget(activeObject, vectorSelectionPath);
      if (
        resolvedActiveObject &&
        resolvedActiveObject !== activeObject &&
        fabricCanvasContainsObject(fabricCanvas, resolvedActiveObject)
      ) {
        fabricCanvas.setActiveObject(resolvedActiveObject as any);
        activeObject = resolvedActiveObject;
      }
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
      } else if (activeObject) {
        applyUnifiedObjectTransformGizmoAppearance(activeObject, getZoomInvariantMetric, 1);
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
      tool === 'star'
    ) {
      cursor = 'default';
    } else if (
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
    brushColorRef,
    brushOpacityRef,
    brushSizeRef,
    commitBitmapStampBrushStroke,
    editorModeRef,
    fabricCanvasRef,
    getBitmapFloatingSelectionObject,
    getZoomInvariantMetric,
    normalizeCanvasVectorStrokeUniform,
    onVectorTexturePreviewChange,
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
