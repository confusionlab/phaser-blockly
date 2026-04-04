import { useCallback, type MutableRefObject } from 'react';
import { Point, util, type Canvas as FabricCanvas } from 'fabric';
import {
  deleteActiveCanvasSelection,
  nudgeActiveCanvasSelection,
} from '@/components/editors/shared/fabricSelectionCommands';
import type { AlignAction, MoveOrderAction, SelectionFlipAxis } from './CostumeToolbar';
import { normalizeDegrees, type CanvasSelectionBoundsSnapshot } from './costumeCanvasShared';
import { isActiveSelectionObject, isTextObject } from './costumeCanvasVectorRuntime';

interface UseCostumeCanvasSelectionTransformCommandsOptions {
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  getAlignmentBounds?: () => { left: number; top: number; width: number; height: number };
  getSelectionBoundsSnapshot: () => CanvasSelectionBoundsSnapshot | null;
  restoreCanvasSelection: (selectedObjects: any[]) => void;
  saveHistory: () => void;
  syncSelectionState: () => void;
}

export function useCostumeCanvasSelectionTransformCommands({
  fabricCanvasRef,
  getAlignmentBounds,
  getSelectionBoundsSnapshot,
  restoreCanvasSelection,
  saveHistory,
  syncSelectionState,
}: UseCostumeCanvasSelectionTransformCommandsOptions) {
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
  }, [
    fabricCanvasRef,
    getSelectionBoundsSnapshot,
    restoreCanvasSelection,
    saveHistory,
    syncSelectionState,
  ]);

  const deleteSelection = useCallback((): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    const deleted = deleteActiveCanvasSelection(fabricCanvas);
    if (!deleted) return false;
    syncSelectionState();
    saveHistory();
    return true;
  }, [fabricCanvasRef, saveHistory, syncSelectionState]);

  const moveSelectionOrder = useCallback((action: MoveOrderAction): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

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
  }, [fabricCanvasRef, saveHistory]);

  const nudgeSelection = useCallback((dx: number, dy: number): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const changed = nudgeActiveCanvasSelection(fabricCanvas, { x: dx, y: dy });
    if (!changed) return false;

    syncSelectionState();
    saveHistory();
    return true;
  }, [fabricCanvasRef, saveHistory, syncSelectionState]);

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
  }, [
    fabricCanvasRef,
    getSelectionBoundsSnapshot,
    restoreCanvasSelection,
    saveHistory,
    syncSelectionState,
  ]);

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

    const alignmentBounds = getAlignmentBounds?.();
    if (!alignmentBounds) return false;

    const { selectionObject, selectedObjects, bounds } = selectionSnapshot;
    let targetLeft = bounds.left;
    let targetTop = bounds.top;
    if (action === 'left') {
      targetLeft = alignmentBounds.left;
    } else if (action === 'center-x') {
      targetLeft = alignmentBounds.left + (alignmentBounds.width - bounds.width) / 2;
    } else if (action === 'right') {
      targetLeft = alignmentBounds.left + alignmentBounds.width - bounds.width;
    }

    if (action === 'top') {
      targetTop = alignmentBounds.top;
    } else if (action === 'center-y') {
      targetTop = alignmentBounds.top + (alignmentBounds.height - bounds.height) / 2;
    } else if (action === 'bottom') {
      targetTop = alignmentBounds.top + alignmentBounds.height - bounds.height;
    }

    const dx = targetLeft - bounds.left;
    const dy = targetTop - bounds.top;
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

    selectionObject.setCoords?.();
    fabricCanvas.requestRenderAll();
    saveHistory();
    syncSelectionState();
    return true;
  }, [
    fabricCanvasRef,
    getAlignmentBounds,
    getSelectionBoundsSnapshot,
    saveHistory,
    syncSelectionState,
  ]);

  return {
    alignSelection,
    deleteSelection,
    moveSelectionOrder,
    nudgeSelection,
    flipSelection,
    rotateSelection,
  };
}
