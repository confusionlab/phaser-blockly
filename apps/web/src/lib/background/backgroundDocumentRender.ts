import { StaticCanvas } from 'fabric';
import type {
  BackgroundConfig,
  BackgroundDocument,
  BackgroundLayer,
  BackgroundVectorLayer,
} from '@/types';
import {
  createEmptyChunkCanvas,
  isChunkCanvasTransparent,
  normalizeChunkDataMap,
  type ChunkDataMap,
} from './chunkStore';
import {
  getChunkBoundsFromKeys,
  getChunkRangeForWorldBounds,
  getChunkWorldBounds,
  iterateChunkKeys,
  parseChunkKey,
} from './chunkMath';
import {
  isBitmapBackgroundLayer,
  isVectorBackgroundLayer,
} from './backgroundDocument';
import {
  normalizeVectorObjectRendering,
  renderVectorTextureOverlayForFabricCanvas,
} from '@/lib/costume/costumeVectorTextureRenderer';

const MAX_CACHED_BACKGROUND_VECTOR_LAYER_CHUNKS = 64;
const MAX_CACHED_BACKGROUND_LAYER_THUMBNAILS = 128;
const backgroundVectorLayerChunkCache = new Map<string, Promise<ChunkDataMap>>();
const backgroundLayerThumbnailCache = new Map<string, Promise<string | null>>();

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

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

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode background chunk image.'));
    image.src = dataUrl;
  });
}

async function dataUrlToCanvas(dataUrl: string, chunkSize: number): Promise<HTMLCanvasElement | null> {
  try {
    const image = await loadImage(dataUrl);
    const canvas = createEmptyChunkCanvas(chunkSize);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch {
    return null;
  }
}

export function getBackgroundLayerRenderSignature(layer: BackgroundLayer): string | null {
  if (isBitmapBackgroundLayer(layer)) {
    const entries = Object.entries(layer.bitmap.chunks).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) {
      return null;
    }
    return `bitmap:${hashString(entries.map(([key, value]) => `${key}:${value}`).join('|'))}`;
  }

  if (!isVectorBackgroundLayer(layer)) {
    return null;
  }

  return `vector:${layer.vector.engine}:${layer.vector.version}:${hashString(layer.vector.fabricJson)}`;
}

export function getBackgroundLayerThumbnailSignature(layer: BackgroundLayer, chunkSize: number, size: number): string {
  const normalizedSize = Math.max(1, Math.round(size));
  return `thumb:${normalizedSize}:${chunkSize}:${getBackgroundLayerRenderSignature(layer) ?? `${layer.kind}:empty`}`;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type VectorWorldBounds = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

function toPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const maybe = value as { x?: unknown; y?: unknown };
  const x = Number(maybe.x);
  const y = Number(maybe.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function getVectorLayerWorldBounds(objects: readonly any[]): VectorWorldBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const obj of objects) {
    if (!obj || obj.visible === false || typeof obj.getCoords !== 'function') {
      continue;
    }

    const coords = (obj.getCoords() as unknown[] | undefined) ?? [];
    for (const coord of coords) {
      const point = toPoint(coord);
      if (!point) {
        continue;
      }
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    left: Math.floor(minX),
    right: Math.ceil(maxX),
    bottom: Math.floor(minY),
    top: Math.ceil(maxY),
  };
}

export async function renderBackgroundVectorLayerToChunkData(
  layer: BackgroundVectorLayer,
  chunkSize: number,
): Promise<ChunkDataMap> {
  const cacheKey = `${chunkSize}:${getBackgroundLayerRenderSignature(layer) ?? layer.id}`;
  const cached = backgroundVectorLayerChunkCache.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const pending = (async (): Promise<ChunkDataMap> => {
    const vectorCanvasElement = createEmptyChunkCanvas(chunkSize);
    const vectorCanvas = new StaticCanvas(vectorCanvasElement, {
      width: chunkSize,
      height: chunkSize,
      renderOnAddRemove: false,
      enableRetinaScaling: false,
    });

    try {
      const parsed = JSON.parse(layer.vector.fabricJson);
      await vectorCanvas.loadFromJSON(parsed);
      for (const obj of vectorCanvas.getObjects() as any[]) {
        normalizeVectorObjectRendering(obj);
      }

      const objects = vectorCanvas.getObjects() as any[];
      const worldBounds = getVectorLayerWorldBounds(objects);
      if (!worldBounds) {
        return {};
      }

      const range = getChunkRangeForWorldBounds(
        worldBounds.left,
        worldBounds.right,
        worldBounds.bottom,
        worldBounds.top,
        chunkSize,
        0,
      );
      const chunkData: ChunkDataMap = {};

      for (const key of iterateChunkKeys(range)) {
        const parsedKey = parseChunkKey(key);
        if (!parsedKey) {
          continue;
        }

        const chunkBounds = getChunkWorldBounds(parsedKey.cx, parsedKey.cy, chunkSize);
        const snapshotCanvas = createEmptyChunkCanvas(chunkSize);
        const snapshotCtx = snapshotCanvas.getContext('2d');
        if (!snapshotCtx) {
          continue;
        }

        vectorCanvas.viewportTransform = [
          1,
          0,
          0,
          -1,
          -chunkBounds.left,
          chunkBounds.top,
        ];
        vectorCanvas.renderAll();

        snapshotCtx.clearRect(0, 0, chunkSize, chunkSize);
        snapshotCtx.drawImage(vectorCanvasElement, 0, 0, chunkSize, chunkSize);
        renderVectorTextureOverlayForFabricCanvas(snapshotCtx, vectorCanvas, {
          canvasWidth: chunkSize,
          canvasHeight: chunkSize,
          clear: false,
        });

        if (!isChunkCanvasTransparent(snapshotCanvas)) {
          chunkData[key] = snapshotCanvas.toDataURL('image/png');
        }
      }

      return chunkData;
    } finally {
      vectorCanvas.dispose();
    }
  })().catch((error) => {
    backgroundVectorLayerChunkCache.delete(cacheKey);
    throw error;
  });

  return await rememberCachedValue(
    backgroundVectorLayerChunkCache,
    cacheKey,
    pending,
    MAX_CACHED_BACKGROUND_VECTOR_LAYER_CHUNKS,
  );
}

export async function renderBackgroundLayerToChunkData(
  layer: BackgroundLayer,
  chunkSize: number,
): Promise<ChunkDataMap> {
  if (isBitmapBackgroundLayer(layer)) {
    return normalizeChunkDataMap(layer.bitmap.chunks);
  }
  if (!isVectorBackgroundLayer(layer)) {
    return {};
  }
  return await renderBackgroundVectorLayerToChunkData(layer, chunkSize);
}

async function composeLayerChunksToCanvas(
  chunks: ChunkDataMap,
  chunkSize: number,
): Promise<HTMLCanvasElement | null> {
  const bounds = getChunkBoundsFromKeys(Object.keys(chunks), chunkSize);
  if (!bounds) {
    return null;
  }

  const width = Math.max(1, Math.ceil(bounds.right - bounds.left));
  const height = Math.max(1, Math.ceil(bounds.top - bounds.bottom));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  for (const [key, dataUrl] of Object.entries(chunks)) {
    const parsedKey = parseChunkKey(key);
    if (!parsedKey || !dataUrl) {
      continue;
    }
    const chunkCanvas = await dataUrlToCanvas(dataUrl, chunkSize);
    if (!chunkCanvas) {
      continue;
    }
    const chunkBounds = getChunkWorldBounds(parsedKey.cx, parsedKey.cy, chunkSize);
    ctx.drawImage(
      chunkCanvas,
      chunkBounds.left - bounds.left,
      bounds.top - chunkBounds.top,
      chunkSize,
      chunkSize,
    );
  }

  return canvas;
}

export async function renderBackgroundLayerThumbnailToDataUrl(
  layer: BackgroundLayer,
  chunkSize: number,
  size = 48,
): Promise<string | null> {
  const cacheKey = getBackgroundLayerThumbnailSignature(layer, chunkSize, size);
  const cached = backgroundLayerThumbnailCache.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const pending = (async (): Promise<string | null> => {
    const chunks = await renderBackgroundLayerToChunkData(layer, chunkSize);
    const layerCanvas = await composeLayerChunksToCanvas(chunks, chunkSize);
    if (!layerCanvas) {
      return null;
    }

    const normalizedSize = Math.max(1, Math.round(size));
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = normalizedSize;
    thumbnailCanvas.height = normalizedSize;
    const thumbnailCtx = thumbnailCanvas.getContext('2d');
    if (!thumbnailCtx) {
      return null;
    }

    const sourceSize = Math.max(layerCanvas.width, layerCanvas.height);
    const sourceX = clampNumber((layerCanvas.width - sourceSize) * 0.5, 0, Math.max(0, layerCanvas.width - sourceSize));
    const sourceY = clampNumber((layerCanvas.height - sourceSize) * 0.5, 0, Math.max(0, layerCanvas.height - sourceSize));
    thumbnailCtx.clearRect(0, 0, normalizedSize, normalizedSize);
    thumbnailCtx.imageSmoothingEnabled = true;
    thumbnailCtx.drawImage(
      layerCanvas,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      normalizedSize,
      normalizedSize,
    );
    return thumbnailCanvas.toDataURL('image/png');
  })();

  return await rememberCachedValue(
    backgroundLayerThumbnailCache,
    cacheKey,
    pending,
    MAX_CACHED_BACKGROUND_LAYER_THUMBNAILS,
  );
}

export async function flattenBackgroundDocumentToChunkData(
  document: BackgroundDocument,
): Promise<ChunkDataMap> {
  const perLayerChunks = await Promise.all(document.layers.map(async (layer) => {
    if (!layer.visible || layer.opacity <= 0) {
      return { layer, chunks: {} as ChunkDataMap };
    }
    return {
      layer,
      chunks: await renderBackgroundLayerToChunkData(layer, document.chunkSize),
    };
  }));

  const allKeys = new Set<string>();
  for (const { chunks } of perLayerChunks) {
    Object.keys(chunks).forEach((key) => allKeys.add(key));
  }

  const flattened: ChunkDataMap = {};
  for (const key of allKeys) {
    const composedCanvas = createEmptyChunkCanvas(document.chunkSize);
    const composedCtx = composedCanvas.getContext('2d');
    if (!composedCtx) {
      continue;
    }

    for (const { layer, chunks } of perLayerChunks) {
      const dataUrl = chunks[key];
      if (!dataUrl) {
        continue;
      }
      const chunkCanvas = await dataUrlToCanvas(dataUrl, document.chunkSize);
      if (!chunkCanvas) {
        continue;
      }
      composedCtx.save();
      composedCtx.globalAlpha = layer.opacity;
      composedCtx.drawImage(chunkCanvas, 0, 0, document.chunkSize, document.chunkSize);
      composedCtx.restore();
    }

    if (!isChunkCanvasTransparent(composedCanvas)) {
      flattened[key] = composedCanvas.toDataURL('image/png');
    }
  }

  return flattened;
}

export async function buildBackgroundConfigFromDocument(
  document: BackgroundDocument,
  options: {
    baseColor: string;
    scrollFactor?: { x: number; y: number };
  },
): Promise<BackgroundConfig> {
  const chunks = await flattenBackgroundDocumentToChunkData(document);
  return {
    type: Object.keys(chunks).length === 0 ? 'color' : 'tiled',
    value: options.baseColor,
    scrollFactor: options.scrollFactor,
    version: 1,
    chunkSize: document.chunkSize,
    chunks,
    softChunkLimit: document.softChunkLimit,
    hardChunkLimit: document.hardChunkLimit,
    document,
  };
}
