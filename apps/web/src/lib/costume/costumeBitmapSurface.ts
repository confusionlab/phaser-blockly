import type { CostumeAssetFrame } from '@/types';
import { getCostumeAssetFrameSignature } from './costumeAssetFrame';
import { COSTUME_CANVAS_SIZE } from './costumeDocument';
import { loadImageSource } from '@/lib/assets/imageSourceCache';

const MAX_CACHED_BITMAP_SURFACES = 128;

const bitmapSurfaceCache = new Map<string, Promise<HTMLCanvasElement>>();

function rememberCachedValue<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  value: Promise<T>,
  maxEntries: number,
): Promise<T> {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }
    cache.delete(oldestKey);
  }

  return value;
}

function getBitmapSourceDimensions(source: HTMLImageElement | HTMLCanvasElement): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }

  return {
    width: source.width,
    height: source.height,
  };
}

export function createBitmapSurfaceCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  assetFrame?: CostumeAssetFrame | null,
): HTMLCanvasElement {
  if (assetFrame) {
    const canvas = document.createElement('canvas');
    canvas.width = assetFrame.sourceWidth;
    canvas.height = assetFrame.sourceHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return canvas;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      source,
      assetFrame.x,
      assetFrame.y,
      assetFrame.width,
      assetFrame.height,
    );
    return canvas;
  }

  const canvas = document.createElement('canvas');
  canvas.width = COSTUME_CANVAS_SIZE;
  canvas.height = COSTUME_CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const { width: sourceWidth, height: sourceHeight } = getBitmapSourceDimensions(source);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return canvas;
  }

  const scale = Math.min(
    COSTUME_CANVAS_SIZE / sourceWidth,
    COSTUME_CANVAS_SIZE / sourceHeight,
    1,
  );
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = (COSTUME_CANVAS_SIZE - drawWidth) / 2;
  const drawY = (COSTUME_CANVAS_SIZE - drawHeight) / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, COSTUME_CANVAS_SIZE, COSTUME_CANVAS_SIZE);
  ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
  return canvas;
}

export async function renderBitmapAssetToSurfaceCanvas(
  source: string | null | undefined,
  assetFrame?: CostumeAssetFrame | null,
): Promise<HTMLCanvasElement | null> {
  if (!source) {
    return null;
  }

  const cacheKey = `${source}#${getCostumeAssetFrameSignature(assetFrame)}`;
  const cached = bitmapSurfaceCache.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const pending = loadImageSource(source)
    .then((image) => createBitmapSurfaceCanvas(image, assetFrame))
    .catch((error) => {
      bitmapSurfaceCache.delete(cacheKey);
      throw error;
    });

  return await rememberCachedValue(bitmapSurfaceCache, cacheKey, pending, MAX_CACHED_BITMAP_SURFACES);
}

export async function renderBitmapAssetToSurfaceDataUrl(
  source: string | null | undefined,
  type: 'image/png' | 'image/webp' = 'image/png',
  quality?: number,
  assetFrame?: CostumeAssetFrame | null,
): Promise<string | null> {
  const surfaceCanvas = await renderBitmapAssetToSurfaceCanvas(source, assetFrame);
  if (!surfaceCanvas) {
    return null;
  }

  return surfaceCanvas.toDataURL(type, quality);
}
