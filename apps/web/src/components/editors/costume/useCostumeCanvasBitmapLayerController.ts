import { useCallback, type MutableRefObject } from 'react';
import { FabricImage, type Canvas as FabricCanvas } from 'fabric';
import { renderBitmapAssetToSurfaceCanvas } from '@/lib/costume/costumeBitmapSurface';
import { extractVisibleCanvasRegion } from './costumeCanvasShared';
import { normalizeVectorObjectRendering } from './costumeCanvasVectorRuntime';
import type { BitmapStampBrushCommitPayload } from './costumeCanvasBitmapRuntime';
import type { CostumeAssetFrame, CostumeEditorMode } from '@/types';

interface UseCostumeCanvasBitmapLayerControllerOptions {
  bitmapMarqueeRectRef: MutableRefObject<{ x: number; y: number; width: number; height: number } | null>;
  bitmapRasterCommitQueueRef: MutableRefObject<Promise<void>>;
  bitmapSelectionBusyRef: MutableRefObject<boolean>;
  bitmapSelectionDragModeRef: MutableRefObject<'none' | 'marquee'>;
  bitmapSelectionStartRef: MutableRefObject<{ x: number; y: number } | null>;
  drawBitmapSelectionOverlay: () => void;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  getBitmapFloatingSelectionObject: () => any | null;
  isLoadRequestActive: (requestId?: number) => boolean;
  saveHistory: () => void;
  setBitmapFloatingSelectionObject: (nextObject: any | null, options?: { activate?: boolean; syncState?: boolean }) => void;
  suppressHistoryRef: MutableRefObject<boolean>;
  syncSelectionState: () => void;
  waitForFabricCanvas: (requestId?: number) => Promise<FabricCanvas | null>;
}

export function useCostumeCanvasBitmapLayerController({
  bitmapMarqueeRectRef,
  bitmapRasterCommitQueueRef,
  bitmapSelectionBusyRef,
  bitmapSelectionDragModeRef,
  bitmapSelectionStartRef,
  drawBitmapSelectionOverlay,
  editorModeRef,
  fabricCanvasRef,
  getBitmapFloatingSelectionObject,
  isLoadRequestActive,
  saveHistory,
  setBitmapFloatingSelectionObject,
  suppressHistoryRef,
  syncSelectionState,
  waitForFabricCanvas,
}: UseCostumeCanvasBitmapLayerControllerOptions) {
  const getReusableBitmapImage = useCallback((): FabricImage | null => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas || editorModeRef.current !== 'bitmap') {
      return null;
    }

    const bitmapImage = fabricCanvas.getObjects().find((object) => {
      return object instanceof FabricImage && !(object as any).__bitmapFloatingSelection;
    });
    return bitmapImage instanceof FabricImage ? bitmapImage : null;
  }, [editorModeRef, fabricCanvasRef]);

  const cloneBitmapCanvas = useCallback((source: HTMLCanvasElement): HTMLCanvasElement | null => {
    const clone = document.createElement('canvas');
    clone.width = source.width;
    clone.height = source.height;
    const cloneCtx = clone.getContext('2d', { willReadFrequently: true });
    if (!cloneCtx) {
      return null;
    }
    cloneCtx.drawImage(source, 0, 0);
    return clone;
  }, []);

  const createBlankBitmapCanvas = useCallback((width: number, height: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }, []);

  const createBitmapRasterBaseSnapshot = useCallback((
    fabricCanvas: FabricCanvas,
    options: { commitObject?: any } = {},
  ): HTMLCanvasElement => {
    const reusableBitmapImage = getReusableBitmapImage();
    const reusableBitmapCanvas = reusableBitmapImage?.getElement();
    if (reusableBitmapCanvas instanceof HTMLCanvasElement) {
      return cloneBitmapCanvas(reusableBitmapCanvas) ?? fabricCanvas.toCanvasElement(1);
    }

    if (options.commitObject) {
      return createBlankBitmapCanvas(fabricCanvas.getWidth(), fabricCanvas.getHeight());
    }

    return fabricCanvas.toCanvasElement(1);
  }, [cloneBitmapCanvas, createBlankBitmapCanvas, getReusableBitmapImage]);

  const waitForFabricRenderFlush = useCallback((fabricCanvas: FabricCanvas): Promise<void> => {
    if (typeof window === 'undefined') {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      let fallbackFrameId = 0;
      let fallbackFrameId2 = 0;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        fabricCanvas.off('after:render', handleAfterRender);
        if (fallbackFrameId) {
          window.cancelAnimationFrame(fallbackFrameId);
        }
        if (fallbackFrameId2) {
          window.cancelAnimationFrame(fallbackFrameId2);
        }
        resolve();
      };

      const handleAfterRender = () => {
        finish();
      };

      fabricCanvas.on('after:render', handleAfterRender);
      fallbackFrameId = window.requestAnimationFrame(() => {
        fallbackFrameId2 = window.requestAnimationFrame(() => {
          finish();
        });
      });
    });
  }, []);

  const applyBitmapLayerSource = useCallback((
    source: HTMLImageElement | HTMLCanvasElement | null,
    selectable: boolean,
    options: { reuseBitmapImage?: boolean } = {},
  ): boolean => {
    const fabricCanvas = fabricCanvasRef.current;
    if (!fabricCanvas) return false;

    suppressHistoryRef.current = true;
    try {
      setBitmapFloatingSelectionObject(null, { syncState: false });
      bitmapSelectionStartRef.current = null;
      bitmapMarqueeRectRef.current = null;
      bitmapSelectionDragModeRef.current = 'none';
      drawBitmapSelectionOverlay();

      const reusableBitmapImage = source && options.reuseBitmapImage
        ? getReusableBitmapImage()
        : null;
      if (fabricCanvas.getActiveObject()) {
        fabricCanvas.discardActiveObject();
      }

      if (source && reusableBitmapImage) {
        for (const object of [...fabricCanvas.getObjects()]) {
          if (object !== reusableBitmapImage) {
            fabricCanvas.remove(object);
          }
        }

        reusableBitmapImage.setElement(source as any, {
          width: source.width,
          height: source.height,
        });
        reusableBitmapImage.set({
          left: 0,
          top: 0,
          originX: 'left',
          originY: 'top',
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
        reusableBitmapImage.setCoords?.();
      } else {
        const image = source
          ? new FabricImage(source as any)
          : null;

        fabricCanvas.clear();

        if (image) {
          image.set({
            left: 0,
            top: 0,
            originX: 'left',
            originY: 'top',
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
          fabricCanvas.add(image);
        }
      }

      fabricCanvas.requestRenderAll();
      syncSelectionState();
      return true;
    } finally {
      suppressHistoryRef.current = false;
    }
  }, [
    bitmapMarqueeRectRef,
    bitmapSelectionDragModeRef,
    bitmapSelectionStartRef,
    drawBitmapSelectionOverlay,
    fabricCanvasRef,
    setBitmapFloatingSelectionObject,
    suppressHistoryRef,
    syncSelectionState,
    getReusableBitmapImage,
  ]);

  const loadBitmapLayer = useCallback(async (
    dataUrl: string,
    selectable: boolean,
    requestId?: number,
    options?: { assetFrame?: CostumeAssetFrame | null },
  ): Promise<boolean> => {
    const fabricCanvas = await waitForFabricCanvas(requestId);
    if (!fabricCanvas) return false;
    if (!isLoadRequestActive(requestId)) return false;

    let surfaceCanvas: HTMLCanvasElement | null = null;
    if (dataUrl) {
      try {
        surfaceCanvas = await renderBitmapAssetToSurfaceCanvas(dataUrl, options?.assetFrame);
      } catch (error) {
        console.error('Failed to load bitmap layer:', error);
        return false;
      }
      if (!isLoadRequestActive(requestId)) return false;
    }

    return applyBitmapLayerSource(surfaceCanvas, selectable);
  }, [applyBitmapLayerSource, isLoadRequestActive, waitForFabricCanvas]);

  const commitBitmapSelection = useCallback(async () => {
    const fabricCanvas = fabricCanvasRef.current;
    const floatingObject = getBitmapFloatingSelectionObject();
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
  }, [applyBitmapLayerSource, bitmapSelectionBusyRef, fabricCanvasRef, getBitmapFloatingSelectionObject, saveHistory]);

  const queueBitmapRasterCommit = useCallback((
    mutateRaster?: (raster: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => void | Promise<void>,
    options: { commitObject?: any } = {},
  ) => {
    const nextCommit = bitmapRasterCommitQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const fabricCanvas = fabricCanvasRef.current;
        if (!fabricCanvas || editorModeRef.current !== 'bitmap') {
          return;
        }

        const raster = createBitmapRasterBaseSnapshot(fabricCanvas, options);
        const rasterCtx = raster.getContext('2d', { willReadFrequently: true });
        if (!rasterCtx) {
          return;
        }

        if (mutateRaster) {
          await mutateRaster(raster, rasterCtx);
        }

        const applied = applyBitmapLayerSource(raster, false, {
          reuseBitmapImage: true,
        });
        if (!applied) {
          return;
        }
        saveHistory();
        await waitForFabricRenderFlush(fabricCanvas);
      })
      .catch((error) => {
        console.error('Failed to commit bitmap raster mutation:', error);
      });

    bitmapRasterCommitQueueRef.current = nextCommit;
    return nextCommit;
  }, [
    applyBitmapLayerSource,
    bitmapRasterCommitQueueRef,
    createBitmapRasterBaseSnapshot,
    editorModeRef,
    fabricCanvasRef,
    saveHistory,
    waitForFabricRenderFlush,
  ]);

  const flattenBitmapLayer = useCallback(async (commitObject?: any) => {
    await queueBitmapRasterCommit(async (_raster, rasterCtx) => {
      if (!commitObject || typeof commitObject.render !== 'function') {
        return;
      }

      const previousObjectCaching = commitObject.objectCaching;
      commitObject.objectCaching = false;
      try {
        commitObject.render(rasterCtx);
      } finally {
        commitObject.objectCaching = previousObjectCaching;
      }
    }, {
      commitObject,
    });
  }, [queueBitmapRasterCommit]);

  const commitBitmapStampBrushStroke = useCallback((payload: BitmapStampBrushCommitPayload) => {
    return queueBitmapRasterCommit(async (_raster, rasterCtx) => {
      const dirtyBounds = payload.dirtyBounds;
      if (!dirtyBounds || dirtyBounds.width <= 0 || dirtyBounds.height <= 0) {
        return;
      }

      rasterCtx.save();
      rasterCtx.globalCompositeOperation = payload.compositeOperation;
      rasterCtx.globalAlpha = payload.strokeOpacity;
      rasterCtx.drawImage(
        payload.strokeCanvas,
        dirtyBounds.x,
        dirtyBounds.y,
        dirtyBounds.width,
        dirtyBounds.height,
        dirtyBounds.x,
        dirtyBounds.y,
        dirtyBounds.width,
        dirtyBounds.height,
      );
      rasterCtx.restore();
    });
  }, [queueBitmapRasterCommit]);

  const loadBitmapAsSingleVectorImage = useCallback(async (bitmapCanvas: HTMLCanvasElement, requestId?: number): Promise<boolean> => {
    const fabricCanvas = await waitForFabricCanvas(requestId);
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
  }, [isLoadRequestActive, suppressHistoryRef, waitForFabricCanvas]);

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
