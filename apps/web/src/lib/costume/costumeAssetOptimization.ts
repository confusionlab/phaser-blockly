import type { CostumeAssetFrame, CostumeBounds } from '@/types';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import { renderBitmapAssetToSurfaceCanvas } from './costumeBitmapSurface';

export const COSTUME_ASSET_MIME_TYPE = 'image/webp';
export const COSTUME_ASSET_QUALITY = 0.85;

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

export function optimizeCostumeRasterCanvas(
  sourceCanvas: HTMLCanvasElement,
): OptimizedCostumeRasterAsset {
  const bounds = calculateBoundsFromCanvas(sourceCanvas);
  const cropBounds = calculateBoundsFromCanvas(sourceCanvas, 0);
  const assetFrame = cropBounds ? createOptimizedAssetFrame(cropBounds, sourceCanvas) : undefined;
  const canvas = assetFrame ? cropCanvasToFrame(sourceCanvas, assetFrame) : sourceCanvas;

  return {
    canvas,
    bounds,
    assetFrame,
    dataUrl: canvas.toDataURL(COSTUME_ASSET_MIME_TYPE, COSTUME_ASSET_QUALITY),
  };
}

export async function optimizeCostumeBitmapAssetSource(
  source: string,
  assetFrame?: CostumeAssetFrame | null,
): Promise<OptimizedCostumeRasterAsset | null> {
  const surfaceCanvas = await renderBitmapAssetToSurfaceCanvas(source, assetFrame);
  if (!surfaceCanvas) {
    return null;
  }

  return optimizeCostumeRasterCanvas(surfaceCanvas);
}
