import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { FabricImage, type Canvas as FabricCanvas } from 'fabric';
import type { ActiveLayerCanvasState } from '@/lib/costume/costumeDocument';
import { renderBitmapAssetToSurfaceCanvas } from '@/lib/costume/costumeBitmapSurface';
import {
  optimizeCostumeRasterCanvas,
  optimizeCostumeRasterCanvasIncrementally,
} from '@/lib/costume/costumeAssetOptimization';
import { extractVisibleCanvasRegion } from './costumeCanvasShared';
import { normalizeVectorObjectRendering } from './costumeCanvasVectorRuntime';
import type { BitmapStampBrushCommitPayload } from './costumeCanvasBitmapRuntime';
import type { CostumeAssetFrame, CostumeBounds, CostumeEditorMode } from '@/types';
import type { CanvasHistorySnapshot, SaveHistoryOptions } from './costumeCanvasShared';

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
  getLastCommittedSnapshot: () => CanvasHistorySnapshot | null;
  isLoadRequestActive: (requestId?: number) => boolean;
  saveHistory: (options?: SaveHistoryOptions) => void;
  setHasBitmapFloatingSelection: Dispatch<SetStateAction<boolean>>;
  suppressHistoryRef: MutableRefObject<boolean>;
  syncSelectionState: () => void;
  waitForFabricCanvas: (requestId?: number) => Promise<FabricCanvas | null>;
}

export interface BitmapRasterCommitOptions {
  commitObject?: any;
  historyOptimization?: {
    compositeOperation?: GlobalCompositeOperation;
    dirtyBounds?: CostumeBounds | null;
    source?: string;
  };
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
  getLastCommittedSnapshot,
  isLoadRequestActive,
  saveHistory,
  setHasBitmapFloatingSelection,
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

  const getReusableBitmapCanvas = useCallback((): HTMLCanvasElement | null => {
    const bitmapImage = getReusableBitmapImage();
    const element = bitmapImage?.getElement();
    return element instanceof HTMLCanvasElement ? element : null;
  }, [getReusableBitmapImage]);

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

  const cloneBitmapRegion = useCallback((
    source: HTMLCanvasElement,
    bounds: CostumeBounds | null,
  ): HTMLCanvasElement | null => {
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }

    const clone = document.createElement('canvas');
    clone.width = bounds.width;
    clone.height = bounds.height;
    const cloneCtx = clone.getContext('2d', { willReadFrequently: true });
    if (!cloneCtx) {
      return null;
    }

    cloneCtx.drawImage(
      source,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height,
    );
    return clone;
  }, []);

  const normalizeBitmapCommitBounds = useCallback((
    rect: { left?: number; top?: number; width?: number; height?: number } | null | undefined,
  ): CostumeBounds | null => {
    if (!rect) {
      return null;
    }

    const left = Number(rect.left);
    const top = Number(rect.top);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      return null;
    }

    const x = Math.max(0, Math.floor(left));
    const y = Math.max(0, Math.floor(top));
    const right = Math.ceil(left + width);
    const bottom = Math.ceil(top + height);
    if (right <= x || bottom <= y) {
      return null;
    }

    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
    };
  }, []);

  const createBitmapHistoryStateFromRaster = useCallback((
    raster: HTMLCanvasElement,
    options: {
      compositeOperation?: GlobalCompositeOperation;
      dirtyBounds?: CostumeBounds | null;
    } = {},
  ): { durationMs: number; state: ActiveLayerCanvasState } => {
    const startMs = performance.now();
    const previousSnapshot = getLastCommittedSnapshot();
    const optimizedBitmap = options.dirtyBounds && options.compositeOperation
      ? optimizeCostumeRasterCanvasIncrementally(raster, {
          mimeType: 'image/png',
          compositeOperation: options.compositeOperation,
          dirtyBounds: options.dirtyBounds,
          previousAssetFrame: previousSnapshot?.bitmapAssetFrame ?? null,
          previousBounds: previousSnapshot?.bitmapBounds ?? null,
        }) ?? optimizeCostumeRasterCanvas(raster, { mimeType: 'image/png' })
      : optimizeCostumeRasterCanvas(raster, { mimeType: 'image/png' });

    return {
      durationMs: performance.now() - startMs,
      state: {
        editorMode: 'bitmap',
        dataUrl: optimizedBitmap.dataUrl,
        bitmapAssetFrame: optimizedBitmap.assetFrame ?? null,
        bitmapBounds: optimizedBitmap.bounds ?? null,
      },
    };
  }, [getLastCommittedSnapshot]);

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
      bitmapFloatingObjectRef.current = null;
      setHasBitmapFloatingSelection(false);
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
    bitmapFloatingObjectRef,
    bitmapMarqueeRectRef,
    bitmapSelectionDragModeRef,
    bitmapSelectionStartRef,
    drawBitmapSelectionOverlay,
    fabricCanvasRef,
    setHasBitmapFloatingSelection,
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
    options: BitmapRasterCommitOptions = {},
  ) => {
    const nextCommit = bitmapRasterCommitQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const fabricCanvas = fabricCanvasRef.current;
        if (!fabricCanvas || editorModeRef.current !== 'bitmap') {
          return;
        }

        const reusableBitmapImage = getReusableBitmapImage();
        const reusableBitmapCanvas = reusableBitmapImage?.getElement();
        const canCommitStampInPlace =
          options.historyOptimization?.source === 'bitmapStampCommit'
          && reusableBitmapImage instanceof FabricImage
          && reusableBitmapCanvas instanceof HTMLCanvasElement
          && fabricCanvas.getObjects().length === 1;

        if (canCommitStampInPlace && reusableBitmapCanvas instanceof HTMLCanvasElement) {
          const raster = reusableBitmapCanvas;
          const rasterCtx = raster.getContext('2d', { willReadFrequently: true });
          if (!rasterCtx) {
            return;
          }

          const dirtyBounds = options.historyOptimization?.dirtyBounds ?? null;
          const dirtyRegionBackup = cloneBitmapRegion(raster, dirtyBounds);
          try {
            if (mutateRaster) {
              await mutateRaster(raster, rasterCtx);
            }

            (reusableBitmapImage as any).dirty = true;
            reusableBitmapImage.setCoords?.();
            fabricCanvas.requestRenderAll();

            const traceStartedAtMs = performance.now();
            const bitmapHistoryState = createBitmapHistoryStateFromRaster(raster, {
              compositeOperation: options.historyOptimization?.compositeOperation,
              dirtyBounds,
            });

            saveHistory({
              source: options.historyOptimization?.source ?? 'bitmapRasterCommit',
              state: bitmapHistoryState.state,
              snapshotDurationMs: bitmapHistoryState.durationMs,
              traceStartedAtMs,
            });
            await waitForFabricRenderFlush(fabricCanvas);
            return;
          } catch (error) {
            if (dirtyRegionBackup && dirtyBounds) {
              rasterCtx.save();
              rasterCtx.globalCompositeOperation = 'source-over';
              rasterCtx.clearRect(dirtyBounds.x, dirtyBounds.y, dirtyBounds.width, dirtyBounds.height);
              rasterCtx.drawImage(dirtyRegionBackup, dirtyBounds.x, dirtyBounds.y);
              rasterCtx.restore();
              (reusableBitmapImage as any).dirty = true;
              fabricCanvas.requestRenderAll();
            }
            throw error;
          }
        }

        const raster = reusableBitmapCanvas instanceof HTMLCanvasElement
          && (options.commitObject || fabricCanvas.getObjects().length === 1)
          ? cloneBitmapCanvas(reusableBitmapCanvas) ?? fabricCanvas.toCanvasElement(1)
          : fabricCanvas.toCanvasElement(1);
        const rasterCtx = raster.getContext('2d', { willReadFrequently: true });
        if (!rasterCtx) {
          return;
        }

        if (mutateRaster) {
          await mutateRaster(raster, rasterCtx);
        }

        const traceStartedAtMs = performance.now();
        const bitmapHistoryState = createBitmapHistoryStateFromRaster(raster, {
          compositeOperation: options.historyOptimization?.compositeOperation,
          dirtyBounds: options.historyOptimization?.dirtyBounds ?? null,
        });

        const applied = applyBitmapLayerSource(raster, false, {
          reuseBitmapImage: true,
        });
        if (!applied) {
          return;
        }
        saveHistory({
          source: options.historyOptimization?.source ?? 'bitmapRasterCommit',
          state: bitmapHistoryState.state,
          snapshotDurationMs: bitmapHistoryState.durationMs,
          traceStartedAtMs,
        });
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
    cloneBitmapCanvas,
    cloneBitmapRegion,
    editorModeRef,
    fabricCanvasRef,
    getReusableBitmapImage,
    saveHistory,
    waitForFabricRenderFlush,
  ]);

  const flattenBitmapLayer = useCallback(async (commitObject?: any) => {
    const dirtyBounds = normalizeBitmapCommitBounds(
      commitObject && typeof commitObject.getBoundingRect === 'function'
        ? commitObject.getBoundingRect()
        : null,
    );
    const compositeOperation = commitObject?.globalCompositeOperation === 'destination-out'
      ? 'destination-out'
      : 'source-over';
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
      historyOptimization: {
        compositeOperation,
        dirtyBounds,
        source: 'bitmapObjectCommit',
      },
    });
  }, [normalizeBitmapCommitBounds, queueBitmapRasterCommit]);

  const commitBitmapStampBrushStroke = useCallback((payload: BitmapStampBrushCommitPayload) => {
    return queueBitmapRasterCommit(async (_raster, rasterCtx) => {
      const dirtyBounds = payload.dirtyBounds;
      if (!dirtyBounds || dirtyBounds.width <= 0 || dirtyBounds.height <= 0) {
        return;
      }

      rasterCtx.save();
      rasterCtx.globalCompositeOperation = payload.compositeOperation;
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
    }, {
      historyOptimization: {
        compositeOperation: payload.compositeOperation,
        dirtyBounds: payload.dirtyBounds,
        source: 'bitmapStampCommit',
      },
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
    commitBitmapRasterMutation: queueBitmapRasterCommit,
    commitBitmapSelection,
    commitBitmapStampBrushStroke,
    flattenBitmapLayer,
    getReusableBitmapCanvas,
    loadBitmapAsSingleVectorImage,
    loadBitmapLayer,
    normalizeCanvasVectorStrokeUniform,
  };
}
