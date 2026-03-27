import type { CostumeAssetFrame, CostumeBounds } from '@/types';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
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
  const bounds = calculateBoundsFromCanvas(sourceCanvas);
  const cropBounds = calculateBoundsFromCanvas(sourceCanvas, 0);
  const assetFrame = cropBounds ? createOptimizedAssetFrame(cropBounds, sourceCanvas) : undefined;
  const canvas = assetFrame ? cropCanvasToFrame(sourceCanvas, assetFrame) : sourceCanvas;

  return {
    canvas,
    bounds,
    assetFrame,
    dataUrl: canvasToEncodedDataUrl(canvas, options),
  };
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
