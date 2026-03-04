import type { CostumeBounds } from '@/types';

/**
 * Calculate the bounding box of visible (non-transparent) pixels in an image.
 * Returns null if the image is fully transparent.
 */
export async function calculateVisibleBounds(dataUrl: string): Promise<CostumeBounds | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const bounds = calculateBoundsFromImageData(imageData);
      resolve(bounds);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return calculateBoundsFromImageData(imageData, alphaThreshold);
}
