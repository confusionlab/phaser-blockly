import type { CostumeBounds } from '@/types';
import { loadImageSource } from '@/lib/assets/imageSourceCache';
import { getCanvas2dContext, readCanvasImageData } from './canvas2d';

export interface AlphaBoundsPair {
  bounds: CostumeBounds | null;
  cropBounds: CostumeBounds | null;
}

/**
 * Calculate the bounding box of visible (non-transparent) pixels in an image.
 * Returns null if the image is fully transparent.
 */
export async function calculateVisibleBounds(dataUrl: string): Promise<CostumeBounds | null> {
  try {
    const img = await loadImageSource(dataUrl);
    return await new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = getCanvas2dContext(canvas, 'readback');
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const bounds = calculateBoundsFromImageData(imageData);
      resolve(bounds);
    });
  } catch {
    return null;
  }
}

/**
 * Calculate bounds from ImageData directly (useful when you already have canvas context).
 * Uses a threshold for alpha to handle anti-aliased edges.
 */
export function calculateBoundsFromImageData(imageData: ImageData, alphaThreshold: number = 10): CostumeBounds | null {
  const { data, width, height } = imageData;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  // Scan all pixels to find bounds
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];

      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // No visible pixels found
  if (maxX < 0 || maxY < 0) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Calculate both user-visible bounds and exact crop bounds in a single image-data pass.
 */
export function calculateAlphaBoundsPairFromImageData(
  imageData: ImageData,
  boundsAlphaThreshold: number = 10,
  cropAlphaThreshold: number = 0,
): AlphaBoundsPair {
  const { data, width, height } = imageData;

  let boundsMinX = width;
  let boundsMinY = height;
  let boundsMaxX = -1;
  let boundsMaxY = -1;

  let cropMinX = width;
  let cropMinY = height;
  let cropMaxX = -1;
  let cropMaxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];

      if (alpha > boundsAlphaThreshold) {
        if (x < boundsMinX) boundsMinX = x;
        if (x > boundsMaxX) boundsMaxX = x;
        if (y < boundsMinY) boundsMinY = y;
        if (y > boundsMaxY) boundsMaxY = y;
      }

      if (alpha > cropAlphaThreshold) {
        if (x < cropMinX) cropMinX = x;
        if (x > cropMaxX) cropMaxX = x;
        if (y < cropMinY) cropMinY = y;
        if (y > cropMaxY) cropMaxY = y;
      }
    }
  }

  return {
    bounds: boundsMaxX < 0 || boundsMaxY < 0
      ? null
      : {
          x: boundsMinX,
          y: boundsMinY,
          width: boundsMaxX - boundsMinX + 1,
          height: boundsMaxY - boundsMinY + 1,
        },
    cropBounds: cropMaxX < 0 || cropMaxY < 0
      ? null
      : {
          x: cropMinX,
          y: cropMinY,
          width: cropMaxX - cropMinX + 1,
          height: cropMaxY - cropMinY + 1,
        },
  };
}

/**
 * Calculate bounds from a canvas element directly.
 */
export function calculateBoundsFromCanvas(canvas: HTMLCanvasElement, alphaThreshold: number = 10): CostumeBounds | null {
  const imageData = readCanvasImageData(canvas);
  if (!imageData) return null;
  return calculateBoundsFromImageData(imageData, alphaThreshold);
}

export function calculateAlphaBoundsPairFromCanvas(
  canvas: HTMLCanvasElement,
  boundsAlphaThreshold: number = 10,
  cropAlphaThreshold: number = 0,
): AlphaBoundsPair {
  const imageData = readCanvasImageData(canvas);
  if (!imageData) {
    return {
      bounds: null,
      cropBounds: null,
    };
  }
  return calculateAlphaBoundsPairFromImageData(imageData, boundsAlphaThreshold, cropAlphaThreshold);
}
