import type { CostumeAssetFrame, CostumeBounds, CostumeDocument, CostumeLayer } from '@/types';
import { getCanvas2dContext } from '@/utils/canvas2d';
import { calculateBoundsFromCanvas } from '@/utils/imageBounds';
import { COSTUME_CANVAS_SIZE, isBitmapCostumeLayer, isVectorCostumeLayer } from './costumeDocument';
import { renderBitmapAssetToSurfaceCanvas } from './costumeBitmapSurface';
import {
  cloneCostumeAssetFrame,
  getCostumeAssetFrameSignature,
} from './costumeAssetFrame';
import {
  type CostumeRasterEncodingOptions,
  optimizeCostumeRasterCanvas,
} from './costumeAssetOptimization';
import { renderVectorLayerDocumentToCanvas } from './costumeVectorTextureRenderer';
import {
  canUseCostumeDocumentPreviewWorker,
  renderCostumePreviewLayersInWorker,
} from './costumeDocumentPreviewClient';
import type { RenderableCostumePreviewLayer } from './costumeDocumentPreviewProtocol';

const MAX_CACHED_COSTUME_LAYER_CANVASES = 128;
const MAX_CACHED_COSTUME_LAYER_PREVIEW_SOURCES = 128;
const MAX_CACHED_COSTUME_LAYER_THUMBNAILS = 256;
const MAX_CACHED_COSTUME_DOCUMENT_PREVIEWS = 128;
const layerCanvasCache = new Map<string, Promise<HTMLCanvasElement>>();
const layerPreviewSourceCache = new Map<string, Promise<string | null>>();
const layerThumbnailCache = new Map<string, Promise<string | null>>();
const layerThumbnailValueCache = new Map<string, string | null>();
const documentPreviewCache = new Map<string, Promise<CostumeDocumentPreview>>();
const documentPreviewValueCache = new Map<string, CostumeDocumentPreview>();

interface CostumeDocumentPreview {
  assetFrame?: CostumeAssetFrame | null;
  dataUrl: string;
  bounds: CostumeBounds | null;
}

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

function rememberResolvedPreview(
  signature: string,
  preview: CostumeDocumentPreview,
): CostumeDocumentPreview {
  if (documentPreviewValueCache.has(signature)) {
    documentPreviewValueCache.delete(signature);
  }
  documentPreviewValueCache.set(signature, {
    assetFrame: cloneCostumeAssetFrame(preview.assetFrame),
    dataUrl: preview.dataUrl,
    bounds: preview.bounds ? { ...preview.bounds } : null,
  });

  while (documentPreviewValueCache.size > MAX_CACHED_COSTUME_DOCUMENT_PREVIEWS) {
    const oldestKey = documentPreviewValueCache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }
    documentPreviewValueCache.delete(oldestKey);
  }

  return preview;
}

function rememberResolvedLayerThumbnail(
  signature: string,
  dataUrl: string | null,
): string | null {
  if (layerThumbnailValueCache.has(signature)) {
    layerThumbnailValueCache.delete(signature);
  }
  layerThumbnailValueCache.set(signature, dataUrl);

  while (layerThumbnailValueCache.size > MAX_CACHED_COSTUME_LAYER_THUMBNAILS) {
    const oldestKey = layerThumbnailValueCache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }
    layerThumbnailValueCache.delete(oldestKey);
  }

  return dataUrl;
}

export function getCostumeLayerRenderSignature(layer: CostumeLayer): string | null {
  if (isBitmapCostumeLayer(layer)) {
    return layer.bitmap.assetId
      ? `bitmap:${layer.bitmap.assetId}:${getCostumeAssetFrameSignature(layer.bitmap.assetFrame)}`
      : null;
  }

  if (!isVectorCostumeLayer(layer)) {
    return null;
  }

  return `vector:${layer.vector.engine}:${layer.vector.version}:${hashString(layer.vector.fabricJson)}`;
}

export function getCostumeLayerPreviewSignature(layer: CostumeLayer): string {
  return [
    layer.kind,
    getCostumeLayerRenderSignature(layer) ?? `${layer.kind}:empty`,
    layer.visible ? 'visible' : 'hidden',
    `opacity:${layer.opacity}`,
    `blend:${layer.blendMode}`,
    `mask:${layer.mask ? 'present' : 'none'}`,
    `effects:${layer.effects.length}`,
  ].join('|');
}

export function getCostumeLayerThumbnailSignature(
  layer: CostumeLayer,
  size: number,
): string {
  const normalizedSize = Math.max(1, Math.round(size));
  return `thumb:${normalizedSize}:${getCostumeLayerRenderSignature(layer) ?? `${layer.kind}:empty`}`;
}

export function getCostumeDocumentPreviewSignature(document: CostumeDocument): string {
  return document.layers
    .map((layer) => getCostumeLayerPreviewSignature(layer))
    .join('||');
}

export function getCachedCostumeDocumentPreview(
  document: CostumeDocument,
): CostumeDocumentPreview | null {
  const cached = documentPreviewValueCache.get(getCostumeDocumentPreviewSignature(document));
  if (!cached) {
    return null;
  }

  return {
    assetFrame: cloneCostumeAssetFrame(cached.assetFrame),
    dataUrl: cached.dataUrl,
    bounds: cached.bounds ? { ...cached.bounds } : null,
  };
}

export async function renderCostumeLayerToCanvas(layer: CostumeLayer): Promise<HTMLCanvasElement | null> {
  const cacheKey = getCostumeLayerRenderSignature(layer);
  if (cacheKey) {
    const cached = layerCanvasCache.get(cacheKey);
    if (cached) {
      return await cached;
    }
  }

  const pending = (async (): Promise<HTMLCanvasElement | null> => {
    if (isBitmapCostumeLayer(layer)) {
      return await renderBitmapAssetToSurfaceCanvas(layer.bitmap.assetId, layer.bitmap.assetFrame);
    }

    if (!isVectorCostumeLayer(layer)) {
      return null;
    }

    return await renderVectorLayerDocumentToCanvas(layer.vector.fabricJson, COSTUME_CANVAS_SIZE);
  })().catch((error) => {
    if (cacheKey) {
      layerCanvasCache.delete(cacheKey);
    }
    throw error;
  });

  if (!cacheKey) {
    return await pending;
  }

  return await rememberCachedValue(layerCanvasCache, cacheKey, pending, MAX_CACHED_COSTUME_LAYER_CANVASES);
}

export async function renderCostumeLayerToDataUrl(layer: CostumeLayer): Promise<string | null> {
  const layerCanvas = await renderCostumeLayerToCanvas(layer);
  if (!layerCanvas) {
    return null;
  }
  return layerCanvas.toDataURL('image/png');
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function drawLayerThumbnail(
  layerCanvas: HTMLCanvasElement,
  size: number,
): string | null {
  const bounds = calculateBoundsFromCanvas(layerCanvas, 0);
  if (!bounds) {
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

  const maxBoundSize = Math.max(bounds.width, bounds.height);
  const padding = Math.max(12, Math.round(maxBoundSize * 0.18));
  const sourceSize = Math.min(
    COSTUME_CANVAS_SIZE,
    Math.max(bounds.width, bounds.height) + (padding * 2),
  );
  const centerX = bounds.x + (bounds.width / 2);
  const centerY = bounds.y + (bounds.height / 2);
  const maxSourceX = Math.max(0, layerCanvas.width - sourceSize);
  const maxSourceY = Math.max(0, layerCanvas.height - sourceSize);
  const sourceX = clampNumber(centerX - (sourceSize / 2), 0, maxSourceX);
  const sourceY = clampNumber(centerY - (sourceSize / 2), 0, maxSourceY);

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
}

export async function renderCostumeLayerThumbnailToDataUrl(
  layer: CostumeLayer,
  size = 48,
): Promise<string | null> {
  const cacheKey = getCostumeLayerThumbnailSignature(layer, size);
  const cached = layerThumbnailCache.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const pending = (async (): Promise<string | null> => {
    const layerCanvas = await renderCostumeLayerToCanvas(layer);
    if (!layerCanvas) {
      return rememberResolvedLayerThumbnail(cacheKey, null);
    }

    return rememberResolvedLayerThumbnail(cacheKey, drawLayerThumbnail(layerCanvas, size));
  })().catch((error) => {
    layerThumbnailCache.delete(cacheKey);
    layerThumbnailValueCache.delete(cacheKey);
    throw error;
  });

  return await rememberCachedValue(
    layerThumbnailCache,
    cacheKey,
    pending,
    MAX_CACHED_COSTUME_LAYER_THUMBNAILS,
  );
}

export function getCachedCostumeLayerThumbnailDataUrl(
  layer: CostumeLayer,
  size = 48,
): string | null | undefined {
  const cacheKey = getCostumeLayerThumbnailSignature(layer, size);
  if (!layerThumbnailValueCache.has(cacheKey)) {
    return undefined;
  }

  const value = layerThumbnailValueCache.get(cacheKey);
  layerThumbnailValueCache.delete(cacheKey);
  layerThumbnailValueCache.set(cacheKey, value ?? null);
  return value ?? null;
}

export function primeCostumeLayerThumbnailFromCanvas(
  layer: CostumeLayer,
  sourceCanvas: HTMLCanvasElement,
  size = 48,
): string | null {
  const cacheKey = getCostumeLayerThumbnailSignature(layer, size);
  const dataUrl = rememberResolvedLayerThumbnail(cacheKey, drawLayerThumbnail(sourceCanvas, size));
  rememberCachedValue(
    layerThumbnailCache,
    cacheKey,
    Promise.resolve(dataUrl),
    MAX_CACHED_COSTUME_LAYER_THUMBNAILS,
  );
  return dataUrl;
}

async function renderCostumeLayerToPreviewSource(layer: CostumeLayer): Promise<string | null> {
  if (isBitmapCostumeLayer(layer)) {
    return layer.bitmap.assetId || null;
  }

  const cacheKey = getCostumeLayerRenderSignature(layer);
  if (!cacheKey) {
    return await renderCostumeLayerToDataUrl(layer);
  }

  const cached = layerPreviewSourceCache.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const pending = renderCostumeLayerToDataUrl(layer).catch((error) => {
    layerPreviewSourceCache.delete(cacheKey);
    throw error;
  });
  return await rememberCachedValue(
    layerPreviewSourceCache,
    cacheKey,
    pending,
    MAX_CACHED_COSTUME_LAYER_PREVIEW_SOURCES,
  );
}

export async function renderCostumeLayerIntoCanvas(
  targetCanvas: HTMLCanvasElement,
  layer: CostumeLayer,
): Promise<boolean> {
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) {
    return false;
  }

  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  const layerCanvas = await renderCostumeLayerToCanvas(layer);
  if (!layerCanvas) {
    return true;
  }

  ctx.drawImage(layerCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
  return true;
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
    const layerCanvas = await renderCostumeLayerToCanvas(layer);
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
  const ctx = getCanvas2dContext(canvas, 'readback');
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
  assetFrame?: CostumeAssetFrame;
  dataUrl: string;
  bounds: CostumeBounds | null;
}>;
export async function renderCostumeDocument(
  document: CostumeDocument,
  options?: CostumeRasterEncodingOptions,
): Promise<{
  canvas: HTMLCanvasElement;
  assetFrame?: CostumeAssetFrame;
  dataUrl: string;
  bounds: CostumeBounds | null;
}>;
export async function renderCostumeDocument(
  document: CostumeDocument,
  options: CostumeRasterEncodingOptions = {},
): Promise<{
  canvas: HTMLCanvasElement;
  assetFrame?: CostumeAssetFrame;
  dataUrl: string;
  bounds: CostumeBounds | null;
}> {
  if (canUseCostumeDocumentPreviewWorker()) {
    try {
      const renderableLayers = await createRenderableCostumePreviewLayers(document);
      const rendered = await renderCostumePreviewLayersInWorker(COSTUME_CANVAS_SIZE, renderableLayers, {
        mimeType: options.mimeType,
        quality: options.quality,
        trimTransparentFrame: true,
      });
      const surfaceCanvas = await renderBitmapAssetToSurfaceCanvas(
        rendered.dataUrl,
        rendered.assetFrame,
      );
      const fallbackCanvas = globalThis.document?.createElement('canvas') ?? null;
      if (fallbackCanvas) {
        fallbackCanvas.width = COSTUME_CANVAS_SIZE;
        fallbackCanvas.height = COSTUME_CANVAS_SIZE;
      }

      return {
        canvas: surfaceCanvas ?? fallbackCanvas ?? await renderCostumeLayerStackToCanvas(document.layers),
        assetFrame: cloneCostumeAssetFrame(rendered.assetFrame),
        dataUrl: rendered.dataUrl,
        bounds: rendered.bounds,
      };
    } catch (error) {
      console.warn('Failed to render optimized costume asset in the background worker. Falling back to the main thread renderer.', error);
    }
  }

  const composedCanvas = await renderCostumeLayerStackToCanvas(document.layers);
  return optimizeCostumeRasterCanvas(composedCanvas, options);
}

async function createRenderableCostumePreviewLayers(
  document: CostumeDocument,
): Promise<RenderableCostumePreviewLayer[]> {
  const previewLayers: RenderableCostumePreviewLayer[] = [];

  for (const layer of document.layers) {
    if (!layer.visible || layer.opacity <= 0) {
      continue;
    }

    const source = await renderCostumeLayerToPreviewSource(layer);
    if (!source) {
      continue;
    }

    previewLayers.push({
      source,
      assetFrame: isBitmapCostumeLayer(layer) ? cloneCostumeAssetFrame(layer.bitmap.assetFrame) ?? null : null,
      opacity: layer.opacity,
    });
  }

  return previewLayers;
}

export async function renderCostumeDocumentPreview(document: CostumeDocument): Promise<{
  assetFrame?: CostumeAssetFrame | null;
  dataUrl: string;
  bounds: CostumeBounds | null;
}> {
  const signature = getCostumeDocumentPreviewSignature(document);
  const cached = documentPreviewCache.get(signature);
  if (cached) {
    return await cached;
  }

  const pending = (async (): Promise<CostumeDocumentPreview> => {
    if (canUseCostumeDocumentPreviewWorker()) {
      try {
        const renderableLayers = await createRenderableCostumePreviewLayers(document);
        return rememberResolvedPreview(
          signature,
          await renderCostumePreviewLayersInWorker(COSTUME_CANVAS_SIZE, renderableLayers),
        );
      } catch (error) {
        console.warn('Failed to render costume preview in the background worker. Falling back to the main thread renderer.', error);
      }
    }

    const canvas = await renderCostumeLayerStackToCanvas(document.layers);
    return rememberResolvedPreview(signature, {
      assetFrame: undefined,
      dataUrl: canvas.toDataURL('image/webp', 0.85),
      bounds: calculateBoundsFromCanvas(canvas),
    });
  })().catch((error) => {
    documentPreviewCache.delete(signature);
    documentPreviewValueCache.delete(signature);
    throw error;
  });

  return await rememberCachedValue(
    documentPreviewCache,
    signature,
    pending,
    MAX_CACHED_COSTUME_DOCUMENT_PREVIEWS,
  );
}

export async function primeCostumeDocumentPresentationCache(
  document: CostumeDocument,
  options: {
    layerThumbnailSize?: number;
  } = {},
): Promise<void> {
  const layerThumbnailSize = options.layerThumbnailSize ?? 48;
  await Promise.allSettled([
    renderCostumeDocumentPreview(document),
    ...document.layers.map((layer) => renderCostumeLayerThumbnailToDataUrl(layer, layerThumbnailSize)),
  ]);
}
