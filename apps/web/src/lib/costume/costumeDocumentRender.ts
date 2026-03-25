import { StaticCanvas } from 'fabric';
import type { CostumeBounds, CostumeDocument, CostumeLayer } from '@/types';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import { COSTUME_CANVAS_SIZE, isBitmapCostumeLayer, isVectorCostumeLayer } from './costumeDocument';

const MAX_CACHED_COSTUME_IMAGES = 128;
const MAX_CACHED_COSTUME_LAYER_CANVASES = 128;
const imageCache = new Map<string, Promise<HTMLImageElement>>();
const layerCanvasCache = new Map<string, Promise<HTMLCanvasElement>>();

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

function getCostumeLayerCacheKey(layer: CostumeLayer): string | null {
  if (isBitmapCostumeLayer(layer)) {
    return layer.bitmap.assetId ? `bitmap:${layer.bitmap.assetId}` : null;
  }

  if (!isVectorCostumeLayer(layer)) {
    return null;
  }

  return `vector:${layer.vector.engine}:${layer.vector.version}:${layer.vector.fabricJson}`;
}

async function loadImage(source: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(source);
  if (cached) {
    return await cached;
  }

  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load costume layer image: ${source.slice(0, 64)}`));
    image.src = source;
  });

  return await rememberCachedValue(imageCache, source, pending, MAX_CACHED_COSTUME_IMAGES);
}

async function renderLayerToCanvas(layer: CostumeLayer): Promise<HTMLCanvasElement | null> {
  const cacheKey = getCostumeLayerCacheKey(layer);
  if (cacheKey) {
    const cached = layerCanvasCache.get(cacheKey);
    if (cached) {
      return await cached;
    }
  }

  const pending = (async (): Promise<HTMLCanvasElement | null> => {
    if (isBitmapCostumeLayer(layer)) {
      if (!layer.bitmap.assetId) {
        return null;
      }

      const image = await loadImage(layer.bitmap.assetId);
      const canvas = document.createElement('canvas');
      canvas.width = COSTUME_CANVAS_SIZE;
      canvas.height = COSTUME_CANVAS_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return null;
      }

      ctx.drawImage(image, 0, 0, COSTUME_CANVAS_SIZE, COSTUME_CANVAS_SIZE);
      return canvas;
    }

    if (!isVectorCostumeLayer(layer)) {
      return null;
    }

    const vectorCanvasElement = document.createElement('canvas');
    vectorCanvasElement.width = COSTUME_CANVAS_SIZE;
    vectorCanvasElement.height = COSTUME_CANVAS_SIZE;
    const vectorCanvas = new StaticCanvas(vectorCanvasElement, {
      width: COSTUME_CANVAS_SIZE,
      height: COSTUME_CANVAS_SIZE,
      renderOnAddRemove: false,
      enableRetinaScaling: false,
    });

    try {
      const parsed = JSON.parse(layer.vector.fabricJson);
      await vectorCanvas.loadFromJSON(parsed);
      vectorCanvas.renderAll();
      const snapshotCanvas = document.createElement('canvas');
      snapshotCanvas.width = COSTUME_CANVAS_SIZE;
      snapshotCanvas.height = COSTUME_CANVAS_SIZE;
      const snapshotCtx = snapshotCanvas.getContext('2d');
      if (!snapshotCtx) {
        return null;
      }
      snapshotCtx.drawImage(vectorCanvasElement, 0, 0, COSTUME_CANVAS_SIZE, COSTUME_CANVAS_SIZE);
      return snapshotCanvas;
    } finally {
      vectorCanvas.dispose();
    }
  })();

  if (!cacheKey) {
    return await pending;
  }

  return await rememberCachedValue(layerCanvasCache, cacheKey, pending, MAX_CACHED_COSTUME_LAYER_CANVASES);
}

async function renderLayerOntoContext(
  ctx: CanvasRenderingContext2D,
  layer: CostumeLayer,
): Promise<void> {
  if (!layer.visible || layer.opacity <= 0) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = layer.opacity;

  try {
    const layerCanvas = await renderLayerToCanvas(layer);
    if (!layerCanvas) {
      return;
    }
    ctx.drawImage(layerCanvas, 0, 0, COSTUME_CANVAS_SIZE, COSTUME_CANVAS_SIZE);
  } finally {
    ctx.restore();
  }
}

export async function renderCostumeLayerStackToCanvas(layers: CostumeLayer[]): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = COSTUME_CANVAS_SIZE;
  canvas.height = COSTUME_CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  for (const layer of layers) {
    await renderLayerOntoContext(ctx, layer);
  }

  return canvas;
}

export async function renderCostumeLayerStackToDataUrl(layers: CostumeLayer[]): Promise<string> {
  const canvas = await renderCostumeLayerStackToCanvas(layers);
  return canvas.toDataURL('image/png');
}

export async function renderCostumeDocumentSlice(
  document: CostumeDocument,
  options: { activeLayerId: string; placement: 'below' | 'above' },
): Promise<string> {
  const activeLayerIndex = document.layers.findIndex((layer) => layer.id === options.activeLayerId);
  if (activeLayerIndex < 0) {
    return renderCostumeLayerStackToDataUrl([]);
  }

  const layers = options.placement === 'below'
    ? document.layers.slice(0, activeLayerIndex)
    : document.layers.slice(activeLayerIndex + 1);
  return await renderCostumeLayerStackToDataUrl(layers);
}

export async function renderCostumeDocument(document: CostumeDocument): Promise<{
  canvas: HTMLCanvasElement;
  dataUrl: string;
  bounds: CostumeBounds | null;
}> {
  const canvas = await renderCostumeLayerStackToCanvas(document.layers);
  return {
    canvas,
    dataUrl: canvas.toDataURL('image/webp', 0.85),
    bounds: calculateBoundsFromCanvas(canvas),
  };
}
