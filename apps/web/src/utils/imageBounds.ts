import type { CostumeBounds } from '@/types';
import { loadImageSource } from '@/lib/assets/imageSourceCache';
import { getCanvas2dContext, readCanvasImageData } from './canvas2d';

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
 * Calculate bounds from a canvas element directly.
 */
export function calculateBoundsFromCanvas(canvas: HTMLCanvasElement, alphaThreshold: number = 10): CostumeBounds | null {
  const imageData = readCanvasImageData(canvas);
  if (!imageData) return null;
  return calculateBoundsFromImageData(imageData, alphaThreshold);
}
