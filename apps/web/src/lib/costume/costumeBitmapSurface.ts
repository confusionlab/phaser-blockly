import { COSTUME_CANVAS_SIZE } from './costumeDocument';

const MAX_CACHED_BITMAP_IMAGES = 128;
const MAX_CACHED_BITMAP_SURFACES = 128;

const bitmapImageCache = new Map<string, Promise<HTMLImageElement>>();
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

async function loadBitmapImage(source: string): Promise<HTMLImageElement> {
  const cached = bitmapImageCache.get(source);
  if (cached) {
    return await cached;
  }

  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load bitmap layer image: ${source.slice(0, 64)}`));
    image.src = source;
  });

  return await rememberCachedValue(bitmapImageCache, source, pending, MAX_CACHED_BITMAP_IMAGES);
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
): HTMLCanvasElement {
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
): Promise<HTMLCanvasElement | null> {
  if (!source) {
    return null;
  }

  const cached = bitmapSurfaceCache.get(source);
  if (cached) {
    return await cached;
  }

  const pending = loadBitmapImage(source)
    .then((image) => createBitmapSurfaceCanvas(image))
    .catch((error) => {
      bitmapSurfaceCache.delete(source);
      throw error;
    });

  return await rememberCachedValue(bitmapSurfaceCache, source, pending, MAX_CACHED_BITMAP_SURFACES);
}

export async function renderBitmapAssetToSurfaceDataUrl(
  source: string | null | undefined,
  type: 'image/png' | 'image/webp' = 'image/png',
  quality?: number,
): Promise<string | null> {
  const surfaceCanvas = await renderBitmapAssetToSurfaceCanvas(source);
  if (!surfaceCanvas) {
    return null;
  }

  return surfaceCanvas.toDataURL(type, quality);
}
