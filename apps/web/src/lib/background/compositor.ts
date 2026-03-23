import type { BackgroundConfig } from '@/types';
import {
  DEFAULT_BACKGROUND_CHUNK_SIZE,
  getChunkRangeForWorldBounds,
  getChunkWorldBounds,
  parseChunkKey,
} from './chunkMath';

const BACKGROUND_IMAGE_CACHE_LIMIT = 256;

const backgroundDecodeCache = new Map<string, HTMLImageElement>();
const backgroundDecodePending = new Map<string, Promise<HTMLImageElement>>();

export interface UserSpaceViewport {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface CanvasViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface TiledBackgroundScreenChunk {
  key: string;
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TiledBackgroundCanvasRenderRequest {
  canvas: HTMLCanvasElement;
  background: BackgroundConfig | null | undefined;
  viewport: UserSpaceViewport;
  pixelWidth: number;
  pixelHeight: number;
}

function cacheDecodedBackgroundImage(dataUrl: string, image: HTMLImageElement): void {
  if (backgroundDecodeCache.has(dataUrl)) {
    backgroundDecodeCache.delete(dataUrl);
  }
  backgroundDecodeCache.set(dataUrl, image);
  while (backgroundDecodeCache.size > BACKGROUND_IMAGE_CACHE_LIMIT) {
    const oldestKey = backgroundDecodeCache.keys().next().value;
    if (!oldestKey) break;
    backgroundDecodeCache.delete(oldestKey);
  }
}

export function decodeBackgroundImage(dataUrl: string): Promise<HTMLImageElement> {
  const cached = backgroundDecodeCache.get(dataUrl);
  if (cached) {
    cacheDecodedBackgroundImage(dataUrl, cached);
    return Promise.resolve(cached);
  }

  const pending = backgroundDecodePending.get(dataUrl);
  if (pending) return pending;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      cacheDecodedBackgroundImage(dataUrl, image);
      backgroundDecodePending.delete(dataUrl);
      resolve(image);
    };
    image.onerror = () => {
      backgroundDecodePending.delete(dataUrl);
      reject(new Error('Failed to decode background chunk image.'));
    };
    image.src = dataUrl;
  });

  backgroundDecodePending.set(dataUrl, promise);
  return promise;
}

export function getSceneBackgroundBaseColor(background: BackgroundConfig | null | undefined): string {
  if (typeof background?.value === 'string') {
    const normalized = background.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      return normalized;
    }
  }
  return '#87CEEB';
}

export function isTiledBackground(
  background: BackgroundConfig | null | undefined,
): background is BackgroundConfig & { type: 'tiled'; chunks: Record<string, string> } {
  return !!background && background.type === 'tiled' && !!background.chunks && typeof background.chunks === 'object';
}

export function getTiledBackgroundChunkSize(background: BackgroundConfig | null | undefined): number {
  if (!background || background.type !== 'tiled') return DEFAULT_BACKGROUND_CHUNK_SIZE;
  if (!Number.isFinite(background.chunkSize) || (background.chunkSize ?? 0) <= 0) {
    return DEFAULT_BACKGROUND_CHUNK_SIZE;
  }
  return Math.max(32, Math.floor(background.chunkSize as number));
}

export function getUserSpaceViewportFromCanvasViewBox(
  viewBox: CanvasViewBox,
  canvasWidth: number,
  canvasHeight: number,
): UserSpaceViewport {
  return {
    left: viewBox.minX - canvasWidth / 2,
    right: viewBox.minX + viewBox.width - canvasWidth / 2,
    top: canvasHeight / 2 - viewBox.minY,
    bottom: canvasHeight / 2 - (viewBox.minY + viewBox.height),
  };
}

export function getVisibleTiledBackgroundScreenChunks(
  background: BackgroundConfig | null | undefined,
  viewport: UserSpaceViewport,
  pixelWidth: number,
  pixelHeight: number,
  margin: number = 1,
): TiledBackgroundScreenChunk[] {
  if (!isTiledBackground(background)) {
    return [];
  }

  const targetWidth = Math.max(1, Math.floor(pixelWidth));
  const targetHeight = Math.max(1, Math.floor(pixelHeight));
  const viewportWidth = Math.max(1e-6, viewport.right - viewport.left);
  const viewportHeight = Math.max(1e-6, viewport.top - viewport.bottom);
  const chunkSize = getTiledBackgroundChunkSize(background);
  const visibleRange = getChunkRangeForWorldBounds(
    viewport.left,
    viewport.right,
    viewport.bottom,
    viewport.top,
    chunkSize,
    margin,
  );

  const chunks: TiledBackgroundScreenChunk[] = [];
  for (const [key, dataUrl] of Object.entries(background.chunks)) {
    if (!dataUrl) continue;
    const parsed = parseChunkKey(key);
    if (!parsed) continue;
    if (
      parsed.cx < visibleRange.minCx ||
      parsed.cx > visibleRange.maxCx ||
      parsed.cy < visibleRange.minCy ||
      parsed.cy > visibleRange.maxCy
    ) {
      continue;
    }

    const bounds = getChunkWorldBounds(parsed.cx, parsed.cy, chunkSize);
    const x = ((bounds.left - viewport.left) / viewportWidth) * targetWidth;
    const y = ((viewport.top - bounds.top) / viewportHeight) * targetHeight;
    const width = ((bounds.right - bounds.left) / viewportWidth) * targetWidth;
    const height = ((bounds.top - bounds.bottom) / viewportHeight) * targetHeight;

    if (x + width <= 0 || y + height <= 0 || x >= targetWidth || y >= targetHeight) {
      continue;
    }

    chunks.push({
      key,
      dataUrl,
      x,
      y,
      width,
      height,
    });
  }

  return chunks;
}

export class TiledBackgroundCanvasCompositor {
  private readonly onChange?: () => void;
  private readonly listeningKeys = new Set<string>();
  private disposed = false;

  constructor(options?: { onChange?: () => void }) {
    this.onChange = options?.onChange;
  }

  dispose(): void {
    this.disposed = true;
    this.listeningKeys.clear();
  }

  render(request: TiledBackgroundCanvasRenderRequest): { pending: boolean; drawnChunks: number } {
    const { canvas, background, viewport } = request;
    const pixelWidth = Math.max(1, Math.floor(request.pixelWidth));
    const pixelHeight = Math.max(1, Math.floor(request.pixelHeight));

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { pending: false, drawnChunks: 0 };
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.fillStyle = getSceneBackgroundBaseColor(background);
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);

    const chunks = getVisibleTiledBackgroundScreenChunks(background, viewport, pixelWidth, pixelHeight, 1);
    let pending = false;
    let drawnChunks = 0;

    for (const chunk of chunks) {
      const image = backgroundDecodeCache.get(chunk.dataUrl);
      if (image) {
        ctx.drawImage(image, chunk.x, chunk.y, chunk.width, chunk.height);
        drawnChunks += 1;
        continue;
      }

      pending = true;
      this.ensureChunkDecode(chunk.dataUrl);
    }

    return { pending, drawnChunks };
  }

  private ensureChunkDecode(dataUrl: string): void {
    if (backgroundDecodeCache.has(dataUrl) || this.listeningKeys.has(dataUrl)) {
      return;
    }

    this.listeningKeys.add(dataUrl);
    void decodeBackgroundImage(dataUrl)
      .catch(() => undefined)
      .finally(() => {
        this.listeningKeys.delete(dataUrl);
        if (!this.disposed) {
          this.onChange?.();
        }
      });
  }
}
