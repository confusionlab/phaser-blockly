import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { FabricImage, type Canvas as FabricCanvas } from 'fabric';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import { extractVisibleCanvasRegion, CANVAS_SIZE } from './costumeCanvasShared';
import { normalizeVectorObjectRendering } from './costumeCanvasVectorRuntime';
import type { BitmapStampBrushCommitPayload } from './costumeCanvasBitmapRuntime';
import type { CostumeEditorMode } from '@/types';

interface UseCostumeCanvasBitmapLayerControllerOptions {
  bitmapFloatingObjectRef: MutableRefObject<any | null>;
  bitmapMarqueeRectRef: MutableRefObject<{ x: number; y: number; width: number; height: number } | null>;
  bitmapRasterCommitQueueRef: MutableRefObject<Promise<void>>;
  bitmapSelectionBusyRef: MutableRefObject<boolean>;
  bitmapSelectionDragModeRef: MutableRefObject<'none' | 'marquee'>;
  bitmapSelectionStartRef: MutableRefObject<{ x: number; y: number } | null>;
  drawBitmapSelectionOverlay: () => void;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  isLoadRequestActive: (requestId?: number) => boolean;
  saveHistory: () => void;
  setHasBitmapFloatingSelection: Dispatch<SetStateAction<boolean>>;
  suppressHistoryRef: MutableRefObject<boolean>;
  syncSelectionState: () => void;
}

export function useCostumeCanvasBitmapLayerController({
  bitmapFloatingObjectRef,
  bitmapMarqueeRectRef,
  bitmapRasterCommitQueueRef,
  bitmapSelectionBusyRef,
  bitmapSelectionDragModeRef,
  bitmapSelectionStartRef,
  drawBitmapSelectionOverlay,
  editorModeRef,
  fabricCanvasRef,
  isLoadRequestActive,
  saveHistory,
  setHasBitmapFloatingSelection,
  suppressHistoryRef,
  syncSelectionState,
}: UseCostumeCanvasBitmapLayerControllerOptions) {
  const applyBitmapLayerSource = useCallback((
    source: FabricImage | HTMLImageElement | HTMLCanvasElement | null,
    selectable: boolean,
  ): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    const image = source
      ? (source instanceof FabricImage ? source : new FabricImage(source as any))
      : null;

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
  }, [
    bitmapFloatingObjectRef,
    bitmapMarqueeRectRef,
    bitmapSelectionDragModeRef,
    bitmapSelectionStartRef,
    drawBitmapSelectionOverlay,
    fabricCanvasRef,
    setHasBitmapFloatingSelection,
    suppressHistoryRef,
    syncSelectionState,
  ]);

  const loadBitmapLayer = useCallback(async (dataUrl: string, selectable: boolean, requestId?: number): Promise<boolean> => {
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

    return applyBitmapLayerSource(image, selectable);
  }, [applyBitmapLayerSource, isLoadRequestActive]);

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
      const applied = applyBitmapLayerSource(raster, false);
      if (!applied) return false;
      saveHistory();
      return true;
    } finally {
      bitmapSelectionBusyRef.current = false;
    }
  }, [applyBitmapLayerSource, bitmapFloatingObjectRef, bitmapSelectionBusyRef, fabricCanvasRef, saveHistory]);

  const queueBitmapRasterCommit = useCallback((
    mutateRaster?: (raster: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => void | Promise<void>,
  ) => {
    const nextCommit = bitmapRasterCommitQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const fabricCanvas = fabricCanvasRef.current;
        if (!fabricCanvas || editorModeRef.current !== 'bitmap') {
          return;
        }

        const raster = fabricCanvas.toCanvasElement(1);
        const rasterCtx = raster.getContext('2d', { willReadFrequently: true });
        if (!rasterCtx) {
          return;
        }

        if (mutateRaster) {
          await mutateRaster(raster, rasterCtx);
        }

        const applied = applyBitmapLayerSource(raster, false);
        if (!applied) {
          return;
        }
        saveHistory();
      })
      .catch((error) => {
        console.error('Failed to commit bitmap raster mutation:', error);
      });

    bitmapRasterCommitQueueRef.current = nextCommit;
    return nextCommit;
  }, [applyBitmapLayerSource, bitmapRasterCommitQueueRef, editorModeRef, fabricCanvasRef, saveHistory]);

  const flattenBitmapLayer = useCallback(async () => {
    await queueBitmapRasterCommit();
  }, [queueBitmapRasterCommit]);

  const commitBitmapStampBrushStroke = useCallback((payload: BitmapStampBrushCommitPayload) => {
    void queueBitmapRasterCommit(async (_raster, rasterCtx) => {
      const visibleBounds = calculateBoundsFromCanvas(payload.strokeCanvas, payload.alphaThreshold);
      if (!visibleBounds) {
        return;
      }

      rasterCtx.save();
      rasterCtx.globalCompositeOperation = payload.compositeOperation;
      rasterCtx.drawImage(payload.strokeCanvas, 0, 0);
      rasterCtx.restore();
    });
  }, [queueBitmapRasterCommit]);

  const loadBitmapAsSingleVectorImage = useCallback(async (bitmapCanvas: HTMLCanvasElement, requestId?: number): Promise<boolean> => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;
    if (!isLoadRequestActive(requestId)) return false;

    const extractedRegion = extractVisibleCanvasRegion(bitmapCanvas, 0);
    const bounds = extractedRegion?.bounds ?? null;
    let image: FabricImage | null = null;

    if (bounds && extractedRegion) {
      try {
        image = await FabricImage.fromURL(extractedRegion.canvas.toDataURL('image/png'));
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
  }, [fabricCanvasRef, isLoadRequestActive, suppressHistoryRef]);

  const normalizeCanvasVectorStrokeUniform = useCallback(() => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    let changed = false;
    fabricCanvas.forEachObject((obj: any) => {
      if (normalizeVectorObjectRendering(obj)) {
        obj.setCoords?.();
        changed = true;
      }
    });

    if (changed) {
      fabricCanvas.requestRenderAll();
    }

    return changed;
  }, [fabricCanvasRef]);

  return {
    commitBitmapSelection,
    commitBitmapStampBrushStroke,
    flattenBitmapLayer,
    loadBitmapAsSingleVectorImage,
    loadBitmapLayer,
    normalizeCanvasVectorStrokeUniform,
  };
}
