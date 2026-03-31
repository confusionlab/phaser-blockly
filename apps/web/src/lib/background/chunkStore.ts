import type { BackgroundConfig, BackgroundDocument } from '@/types';
import { getCanvas2dContext, readCanvasImageData } from '@/utils/canvas2d';
import { DEFAULT_BACKGROUND_CHUNK_SIZE } from './chunkMath';

export const DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT = 400;
export const DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT = 1200;

export type ChunkDataMap = Record<string, string>;

export interface ChunkWorldBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface ChunkLimitState {
  count: number;
  softLimit: number;
  hardLimit: number;
  softExceeded: boolean;
  hardExceeded: boolean;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value as number));
}

export function evaluateChunkLimits(
  chunkCount: number,
  softLimit: number = DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT,
  hardLimit: number = DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT,
): ChunkLimitState {
  const normalizedSoftLimit = normalizeLimit(softLimit, DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT);
  const normalizedHardLimit = Math.max(normalizedSoftLimit, normalizeLimit(hardLimit, DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT));
  const count = Math.max(0, Math.floor(chunkCount));
  return {
    count,
    softLimit: normalizedSoftLimit,
    hardLimit: normalizedHardLimit,
    softExceeded: count >= normalizedSoftLimit,
    hardExceeded: count >= normalizedHardLimit,
  };
}

export function canCreateChunk(
  chunkCount: number,
  softLimit: number = DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT,
  hardLimit: number = DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT,
): boolean {
  return !evaluateChunkLimits(chunkCount, softLimit, hardLimit).hardExceeded;
}

export function getChunkCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return getCanvas2dContext(canvas, 'readback');
}

export function isChunkCanvasTransparent(canvas: HTMLCanvasElement): boolean {
  const { width, height } = canvas;
  if (width === 0 || height === 0) return true;

  const imageData = readCanvasImageData(canvas)?.data;
  if (!imageData) return true;
  for (let i = 3; i < imageData.length; i += 4) {
    if (imageData[i] !== 0) {
      return false;
    }
  }
  return true;
}

export function estimateSerializedChunkBytes(chunks: ChunkDataMap): number {
  return Object.values(chunks).reduce((sum, dataUrl) => sum + dataUrl.length, 0);
}

export function createEmptyChunkCanvas(chunkSize: number = DEFAULT_BACKGROUND_CHUNK_SIZE): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : DEFAULT_BACKGROUND_CHUNK_SIZE;
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

export function applyRasterPatchToChunkCanvas(options: {
  chunkSize: number;
  chunkBounds: ChunkWorldBounds;
  patchBounds: ChunkWorldBounds;
  rasterCanvas: HTMLCanvasElement;
  existingChunkCanvas?: HTMLCanvasElement | null;
}): HTMLCanvasElement | null {
  const {
    chunkSize,
    chunkBounds,
    patchBounds,
    rasterCanvas,
    existingChunkCanvas = null,
  } = options;

  const nextCanvas = createEmptyChunkCanvas(chunkSize);
  const nextCtx = getChunkCanvasContext(nextCanvas);
  if (!nextCtx) {
    return null;
  }

  if (existingChunkCanvas) {
    nextCtx.drawImage(existingChunkCanvas, 0, 0);
  }

  const intersectionLeft = Math.max(chunkBounds.left, patchBounds.left);
  const intersectionRight = Math.min(chunkBounds.right, patchBounds.right);
  const intersectionBottom = Math.max(chunkBounds.bottom, patchBounds.bottom);
  const intersectionTop = Math.min(chunkBounds.top, patchBounds.top);
  const intersectionWidth = intersectionRight - intersectionLeft;
  const intersectionHeight = intersectionTop - intersectionBottom;

  if (intersectionWidth <= 0 || intersectionHeight <= 0) {
    return nextCanvas;
  }

  const destinationX = intersectionLeft - chunkBounds.left;
  const destinationY = chunkBounds.top - intersectionTop;
  const sourceX = intersectionLeft - patchBounds.left;
  const sourceY = patchBounds.top - intersectionTop;

  nextCtx.clearRect(
    destinationX,
    destinationY,
    intersectionWidth,
    intersectionHeight,
  );
  nextCtx.drawImage(
    rasterCanvas,
    sourceX,
    sourceY,
    intersectionWidth,
    intersectionHeight,
    destinationX,
    destinationY,
    intersectionWidth,
    intersectionHeight,
  );

  return nextCanvas;
}

export function normalizeChunkDataMap(chunks: BackgroundConfig['chunks']): ChunkDataMap {
  if (!chunks || typeof chunks !== 'object') return {};
  const normalized: ChunkDataMap = {};
  Object.entries(chunks).forEach(([key, value]) => {
    if (typeof key !== 'string' || !key.includes(',')) return;
    if (typeof value !== 'string' || value.length === 0) return;
    normalized[key] = value;
  });
  return normalized;
}

export function buildTiledBackgroundConfig(
  chunks: ChunkDataMap,
  options?: {
    chunkSize?: number;
    softChunkLimit?: number;
    hardChunkLimit?: number;
    baseColor?: string;
    document?: BackgroundDocument;
  },
): BackgroundConfig {
  const chunkSize = Number.isFinite(options?.chunkSize) && (options?.chunkSize ?? 0) > 0
    ? Math.floor(options?.chunkSize as number)
    : DEFAULT_BACKGROUND_CHUNK_SIZE;
  const softChunkLimit = normalizeLimit(options?.softChunkLimit, DEFAULT_BACKGROUND_SOFT_CHUNK_LIMIT);
  const hardChunkLimit = Math.max(softChunkLimit, normalizeLimit(options?.hardChunkLimit, DEFAULT_BACKGROUND_HARD_CHUNK_LIMIT));

  const baseColor = typeof options?.baseColor === 'string' && options.baseColor.trim().length > 0
    ? options.baseColor
    : '#87CEEB';

  return {
    type: 'tiled',
    value: baseColor,
    version: 1,
    chunkSize,
    chunks: { ...chunks },
    softChunkLimit,
    hardChunkLimit,
    document: options?.document,
  };
}
