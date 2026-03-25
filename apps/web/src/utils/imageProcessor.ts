/**
 * Image processing utility for costumes
 * - Resizes images to fit within 950x950 (maintaining aspect ratio)
 * - Centers the result into a canonical 1024x1024 costume layer surface
 * - Converts to WebP format with good compression
 * Note: Canvas is 1024x1024, but we limit imports to 950px to leave room for editing
 */

import { createBitmapSurfaceCanvas } from '@/lib/costume/costumeBitmapSurface';
import { invalidateImageSource, loadImageSource } from '@/lib/assets/imageSourceCache';

const MAX_SIZE = 950;
const WEBP_QUALITY = 0.85; // 85% quality - good balance of size and quality

function getLoadedImageDimensions(image: HTMLImageElement): { width: number; height: number } {
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
}

function encodeProcessedSurface(surfaceCanvas: HTMLCanvasElement): string {
  const webpDataUrl = surfaceCanvas.toDataURL('image/webp', WEBP_QUALITY);
  if (webpDataUrl.startsWith('data:image/webp')) {
    return webpDataUrl;
  }

  console.warn('Browser does not support WebP encoding, using PNG');
  return surfaceCanvas.toDataURL('image/png');
}

function processLoadedImage(image: HTMLImageElement): string {
  const sourceDimensions = getLoadedImageDimensions(image);
  let width = sourceDimensions.width;
  let height = sourceDimensions.height;

  if (width > MAX_SIZE || height > MAX_SIZE) {
    const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  return encodeProcessedSurface(createBitmapSurfaceCanvas(canvas));
}

/**
 * Process an image file: resize if needed and convert to WebP
 * @param file - The image file to process
 * @returns Promise resolving to a WebP data URL
 */
export async function processImage(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageSource(objectUrl);
    return processLoadedImage(image);
  } finally {
    invalidateImageSource(objectUrl);
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Process an image from a data URL: resize if needed and convert to WebP
 * @param dataUrl - The image data URL to process
 * @returns Promise resolving to a WebP data URL
 */
export async function processImageFromDataUrl(dataUrl: string): Promise<string> {
  const image = await loadImageSource(dataUrl);
  return processLoadedImage(image);
}

/**
 * Get image dimensions from a data URL
 */
export async function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  const image = await loadImageSource(dataUrl);
  return getLoadedImageDimensions(image);
}
