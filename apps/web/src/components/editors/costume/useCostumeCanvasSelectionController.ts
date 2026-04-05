import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { ActiveSelection, type Canvas as FabricCanvas } from 'fabric';
import type { VectorHandleMode } from './CostumeToolbar';
import {
  fabricCanvasContainsObject,
  getVectorGroupingAvailability,
  type VectorGroupingAvailability,
} from '@/lib/editor/fabricVectorSelection';
import {
  resolveBitmapFloatingSelectionObject,
  resolveCostumeCanvasSelection,
} from './costumeCanvasSelectionState';
import type {
  CanvasSelectionBoundsSnapshot,
  PointSelectionMarqueeSession,
  PointSelectionTransformFrameState,
  PointSelectionTransformSession,
  PathAnchorDragState,
} from './costumeCanvasShared';
import type { CostumeEditorMode } from '@/types';

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
  onVectorGroupingStateChangeRef?: MutableRefObject<((state: VectorGroupingAvailability) => void) | undefined>;
  onVectorPointEditingChangeRef: MutableRefObject<((isEditing: boolean) => void) | undefined>;
  onVectorPointSelectionChangeRef: MutableRefObject<((hasSelectedPoints: boolean) => void) | undefined>;
  pendingSelectionSyncedVectorHandleModeRef: MutableRefObject<VectorHandleMode | null>;
  pointSelectionMarqueeSessionRef: MutableRefObject<PointSelectionMarqueeSession | null>;
  pointSelectionTransformFrameRef: MutableRefObject<PointSelectionTransformFrameState | null>;
  pointSelectionTransformSessionRef: MutableRefObject<PointSelectionTransformSession | null>;
  selectedPathAnchorIndicesRef: MutableRefObject<number[]>;
  setCanZoomToSelection: Dispatch<SetStateAction<boolean>>;
  setHasBitmapFloatingSelection?: Dispatch<SetStateAction<boolean>>;
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
  onVectorGroupingStateChangeRef,
  onVectorPointEditingChangeRef,
  onVectorPointSelectionChangeRef,
  pendingSelectionSyncedVectorHandleModeRef,
  pointSelectionMarqueeSessionRef,
  pointSelectionTransformFrameRef,
  pointSelectionTransformSessionRef,
  selectedPathAnchorIndicesRef,
  setCanZoomToSelection,
  setHasBitmapFloatingSelection = () => undefined,
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

  const getBitmapFloatingSelectionObject = useCallback(() => {
    return resolveBitmapFloatingSelectionObject({
      fabricCanvas: fabricCanvasRef.current,
      registeredBitmapFloatingObject: bitmapFloatingObjectRef.current,
    });
  }, [bitmapFloatingObjectRef, fabricCanvasRef]);

  const getResolvedCanvasSelection = useCallback(() => {
    return resolveCostumeCanvasSelection({
      editorMode: editorModeRef.current,
      fabricCanvas: fabricCanvasRef.current,
      registeredBitmapFloatingObject: bitmapFloatingObjectRef.current,
    });
  }, [bitmapFloatingObjectRef, editorModeRef, fabricCanvasRef]);

  const getSelectionBoundsSnapshot = useCallback((): CanvasSelectionBoundsSnapshot | null => {
    const selection = getResolvedCanvasSelection();
    if (!selection.selectionObject || selection.selectedObjects.length === 0) {
      return null;
    }

    const boundsList = selection.selectedObjects
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
      selectionObject: selection.selectionObject,
      selectedObjects: boundsList.map((entry) => entry.obj),
      bounds: {
        left: minLeft,
        top: minTop,
        width: Math.max(1, maxRight - minLeft),
        height: Math.max(1, maxBottom - minTop),
      },
    };
  }, [getResolvedCanvasSelection]);

  const restoreCanvasSelection = useCallback((selectedObjects: any[]) => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return;

    const nextObjects = selectedObjects.filter((obj) => fabricCanvasContainsObject(fabricCanvas, obj));
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
    const layerVisible = activeLayerVisibleRef.current;
    const selection = getResolvedCanvasSelection();
    const hasBitmap = layerVisible && selection.kind === 'bitmap-floating';
    const hasSelection = layerVisible && selection.kind !== 'none';
    setCanZoomToSelection(layerVisible && !!getSelectionBoundsSnapshot());
    onSelectionStateChangeRef.current?.({
      hasSelection,
      hasBitmapFloatingSelection: hasBitmap,
    });
    onVectorGroupingStateChangeRef?.current?.(
      layerVisible && editorModeRef.current === 'vector'
        ? getVectorGroupingAvailability(fabricCanvasRef.current?.getActiveObject() as any)
        : { canGroup: false, canUngroup: false },
    );
  }, [
    activeLayerVisibleRef,
    editorModeRef,
    fabricCanvasRef,
    getResolvedCanvasSelection,
    getSelectionBoundsSnapshot,
    onSelectionStateChangeRef,
    onVectorGroupingStateChangeRef,
    setCanZoomToSelection,
  ]);

  const setBitmapFloatingSelectionObject = useCallback((
    nextObject: any | null,
    options: { activate?: boolean; syncState?: boolean } = {},
  ) => {
    const fabricCanvas = fabricCanvasRef.current;
    bitmapFloatingObjectRef.current = nextObject;
    setHasBitmapFloatingSelection(!!nextObject);

    if (nextObject) {
      nextObject.setCoords?.();
      if (options.activate && fabricCanvas && fabricCanvas.getActiveObject() !== nextObject) {
        fabricCanvas.setActiveObject(nextObject);
      }
    }

    if (options.syncState !== false) {
      syncSelectionState();
    }
  }, [
    bitmapFloatingObjectRef,
    fabricCanvasRef,
    setHasBitmapFloatingSelection,
    syncSelectionState,
  ]);

  return {
    getBitmapFloatingSelectionObject,
    getSelectionBoundsSnapshot,
    restoreCanvasSelection,
    setBitmapFloatingSelectionObject,
    setVectorPointEditingTarget,
    syncSelectionState,
  };
}
