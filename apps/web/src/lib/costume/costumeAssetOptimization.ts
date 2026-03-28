import type { CostumeAssetFrame, CostumeBounds } from '@/types';
import {
  calculateAlphaBoundsPairFromCanvas,
  calculateAlphaBoundsPairFromCanvasRegion,
} from '@/utils/imageBounds';
import { renderBitmapAssetToSurfaceCanvas } from './costumeBitmapSurface';

export const COSTUME_ASSET_MIME_TYPE = 'image/webp';
export const COSTUME_ASSET_QUALITY = 0.85;

export interface CostumeRasterEncodingOptions {
  mimeType?: string;
  quality?: number;
}

function cropCanvasToFrame(
  sourceCanvas: HTMLCanvasElement,
  frame: CostumeAssetFrame,
): HTMLCanvasElement {
  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = frame.width;
  croppedCanvas.height = frame.height;

  const croppedCtx = croppedCanvas.getContext('2d');
  if (!croppedCtx) {
    return croppedCanvas;
  }

  croppedCtx.drawImage(
    sourceCanvas,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    0,
    0,
    frame.width,
    frame.height,
  );
  return croppedCanvas;
}

function createOptimizedAssetFrame(
  cropBounds: CostumeBounds,
  sourceCanvas: HTMLCanvasElement,
): CostumeAssetFrame | undefined {
  if (
    cropBounds.x === 0 &&
    cropBounds.y === 0 &&
    cropBounds.width === sourceCanvas.width &&
    cropBounds.height === sourceCanvas.height
  ) {
    return undefined;
  }

  return {
    x: cropBounds.x,
    y: cropBounds.y,
    width: cropBounds.width,
    height: cropBounds.height,
    sourceWidth: sourceCanvas.width,
    sourceHeight: sourceCanvas.height,
  };
}

export interface OptimizedCostumeRasterAsset {
  assetFrame?: CostumeAssetFrame;
  bounds: CostumeBounds | null;
  canvas: HTMLCanvasElement;
  dataUrl: string;
}

export interface IncrementalCostumeRasterCommitOptions extends CostumeRasterEncodingOptions {
  compositeOperation: GlobalCompositeOperation;
  dirtyBounds: CostumeBounds;
  previousAssetFrame?: CostumeAssetFrame | null;
  previousBounds?: CostumeBounds | null;
}

function cloneBounds(bounds: CostumeBounds | null | undefined): CostumeBounds | null {
  return bounds ? { ...bounds } : null;
}

function normalizeBoundsToCanvas(
  bounds: CostumeBounds,
  sourceCanvas: HTMLCanvasElement,
): CostumeBounds | null {
  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(sourceCanvas.width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(sourceCanvas.height, Math.ceil(bounds.y + bounds.height));
  if (right <= x || bottom <= y) {
    return null;
  }

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function offsetBounds(bounds: CostumeBounds | null, x: number, y: number): CostumeBounds | null {
  if (!bounds) {
    return null;
  }

  return {
    x: bounds.x + x,
    y: bounds.y + y,
    width: bounds.width,
    height: bounds.height,
  };
}

function unionBounds(a: CostumeBounds | null, b: CostumeBounds | null): CostumeBounds | null {
  if (!a) {
    return cloneBounds(b);
  }
  if (!b) {
    return cloneBounds(a);
  }

  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function resolvePreviousCropBounds(
  sourceCanvas: HTMLCanvasElement,
  previousAssetFrame?: CostumeAssetFrame | null,
  previousBounds?: CostumeBounds | null,
): CostumeBounds | null {
  if (previousAssetFrame) {
    return {
      x: previousAssetFrame.x,
      y: previousAssetFrame.y,
      width: previousAssetFrame.width,
      height: previousAssetFrame.height,
    };
  }

  if (previousBounds) {
    return {
      x: 0,
      y: 0,
      width: sourceCanvas.width,
      height: sourceCanvas.height,
    };
  }

  return null;
}

function touchesBoundsEdge(outer: CostumeBounds | null, inner: CostumeBounds | null): boolean {
  if (!outer || !inner) {
    return true;
  }

  return (
    inner.x <= outer.x ||
    inner.y <= outer.y ||
    inner.x + inner.width >= outer.x + outer.width ||
    inner.y + inner.height >= outer.y + outer.height
  );
}

function buildOptimizedCostumeRasterAsset(
  sourceCanvas: HTMLCanvasElement,
  bounds: CostumeBounds | null,
  cropBounds: CostumeBounds | null,
  options: CostumeRasterEncodingOptions = {},
): OptimizedCostumeRasterAsset {
  const assetFrame = cropBounds ? createOptimizedAssetFrame(cropBounds, sourceCanvas) : undefined;
  const canvas = assetFrame ? cropCanvasToFrame(sourceCanvas, assetFrame) : sourceCanvas;

  return {
    bounds: cloneBounds(bounds),
    assetFrame,
    canvas,
    dataUrl: canvasToEncodedDataUrl(canvas, options),
  };
}

function canvasToEncodedDataUrl(
  canvas: HTMLCanvasElement,
  options: CostumeRasterEncodingOptions = {},
): string {
  const mimeType = options.mimeType ?? COSTUME_ASSET_MIME_TYPE;
  if (mimeType === 'image/png') {
    return canvas.toDataURL(mimeType);
  }
  return canvas.toDataURL(mimeType, options.quality ?? COSTUME_ASSET_QUALITY);
}

export function optimizeCostumeRasterCanvas(
  sourceCanvas: HTMLCanvasElement,
  options: CostumeRasterEncodingOptions = {},
): OptimizedCostumeRasterAsset {
  const { bounds, cropBounds } = calculateAlphaBoundsPairFromCanvas(sourceCanvas);
  const assetFrame = cropBounds ? createOptimizedAssetFrame(cropBounds, sourceCanvas) : undefined;
  const canvas = assetFrame ? cropCanvasToFrame(sourceCanvas, assetFrame) : sourceCanvas;

  return {
    canvas,
    bounds,
    assetFrame,
    dataUrl: canvasToEncodedDataUrl(canvas, options),
  };
}

export function optimizeCostumeRasterCanvasIncrementally(
  sourceCanvas: HTMLCanvasElement,
  options: IncrementalCostumeRasterCommitOptions,
): OptimizedCostumeRasterAsset | null {
  const dirtyBounds = normalizeBoundsToCanvas(options.dirtyBounds, sourceCanvas);
  if (!dirtyBounds) {
    return null;
  }

  const previousBounds = cloneBounds(options.previousBounds);
  const previousCropBounds = resolvePreviousCropBounds(
    sourceCanvas,
    options.previousAssetFrame,
    options.previousBounds,
  );

  if (options.compositeOperation === 'source-over') {
    const dirtyPair = calculateAlphaBoundsPairFromCanvasRegion(sourceCanvas, dirtyBounds);
    return buildOptimizedCostumeRasterAsset(
      sourceCanvas,
      unionBounds(previousBounds, offsetBounds(dirtyPair.bounds, dirtyBounds.x, dirtyBounds.y)),
      unionBounds(previousCropBounds, offsetBounds(dirtyPair.cropBounds, dirtyBounds.x, dirtyBounds.y)),
      options,
    );
  }

  if (
    options.compositeOperation === 'destination-out' &&
    previousCropBounds &&
    previousBounds &&
    !touchesBoundsEdge(previousCropBounds, dirtyBounds) &&
    !touchesBoundsEdge(previousBounds, dirtyBounds)
  ) {
    return buildOptimizedCostumeRasterAsset(
      sourceCanvas,
      previousBounds,
      previousCropBounds,
      options,
    );
  }

  return null;
}

export async function optimizeCostumeBitmapAssetSource(
  source: string,
  assetFrame?: CostumeAssetFrame | null,
  options: CostumeRasterEncodingOptions = {},
): Promise<OptimizedCostumeRasterAsset | null> {
  const surfaceCanvas = await renderBitmapAssetToSurfaceCanvas(source, assetFrame);
  if (!surfaceCanvas) {
    return null;
  }

  return optimizeCostumeRasterCanvas(surfaceCanvas, options);
}
