import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { ActiveSelection, type Canvas as FabricCanvas } from 'fabric';
import type { VectorHandleMode } from './CostumeToolbar';
import type {
  CanvasSelectionBoundsSnapshot,
  PointSelectionMarqueeSession,
  PointSelectionTransformFrameState,
  PointSelectionTransformSession,
  PathAnchorDragState,
} from './costumeCanvasShared';
import type { CostumeEditorMode } from '@/types';
import { isActiveSelectionObject, isTextObject } from './costumeCanvasVectorRuntime';

interface UseCostumeCanvasSelectionControllerOptions {
  activeLayerVisibleRef: MutableRefObject<boolean>;
  activePathAnchorRef: MutableRefObject<{ path: any; anchorIndex: number } | null>;
  bitmapFloatingObjectRef: MutableRefObject<any | null>;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  insertedPathAnchorDragSessionRef: MutableRefObject<{
    path: any;
    anchorIndex: number;
    dragState: PathAnchorDragState;
  } | null>;
  onSelectionStateChangeRef: MutableRefObject<((state: { hasSelection: boolean; hasBitmapFloatingSelection: boolean }) => void) | undefined>;
  onVectorPointEditingChangeRef: MutableRefObject<((isEditing: boolean) => void) | undefined>;
  onVectorPointSelectionChangeRef: MutableRefObject<((hasSelectedPoints: boolean) => void) | undefined>;
  pendingSelectionSyncedVectorHandleModeRef: MutableRefObject<VectorHandleMode | null>;
  pointSelectionMarqueeSessionRef: MutableRefObject<PointSelectionMarqueeSession | null>;
  pointSelectionTransformFrameRef: MutableRefObject<PointSelectionTransformFrameState | null>;
  pointSelectionTransformSessionRef: MutableRefObject<PointSelectionTransformSession | null>;
  selectedPathAnchorIndicesRef: MutableRefObject<number[]>;
  setCanZoomToSelection: Dispatch<SetStateAction<boolean>>;
  vectorPointEditingTargetRef: MutableRefObject<any | null>;
}

export function useCostumeCanvasSelectionController({
  activeLayerVisibleRef,
  activePathAnchorRef,
  bitmapFloatingObjectRef,
  editorModeRef,
  fabricCanvasRef,
  insertedPathAnchorDragSessionRef,
  onSelectionStateChangeRef,
  onVectorPointEditingChangeRef,
  onVectorPointSelectionChangeRef,
  pendingSelectionSyncedVectorHandleModeRef,
  pointSelectionMarqueeSessionRef,
  pointSelectionTransformFrameRef,
  pointSelectionTransformSessionRef,
  selectedPathAnchorIndicesRef,
  setCanZoomToSelection,
  vectorPointEditingTargetRef,
}: UseCostumeCanvasSelectionControllerOptions) {
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
  }, [
    activePathAnchorRef,
    insertedPathAnchorDragSessionRef,
    onVectorPointEditingChangeRef,
    onVectorPointSelectionChangeRef,
    pendingSelectionSyncedVectorHandleModeRef,
    pointSelectionMarqueeSessionRef,
    pointSelectionTransformFrameRef,
    pointSelectionTransformSessionRef,
    selectedPathAnchorIndicesRef,
    vectorPointEditingTargetRef,
  ]);

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
  }, [bitmapFloatingObjectRef, editorModeRef, fabricCanvasRef]);

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
  }, [fabricCanvasRef]);

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
  }, [
    activeLayerVisibleRef,
    bitmapFloatingObjectRef,
    editorModeRef,
    fabricCanvasRef,
    getSelectionBoundsSnapshot,
    onSelectionStateChangeRef,
    setCanZoomToSelection,
  ]);

  return {
    getSelectionBoundsSnapshot,
    restoreCanvasSelection,
    setVectorPointEditingTarget,
    syncSelectionState,
  };
}
