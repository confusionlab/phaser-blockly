import type { BackgroundConfig } from '@/types';
import {
  DEFAULT_BACKGROUND_CHUNK_SIZE,
  getChunkRangeForWorldBounds,
  getChunkWorldBounds,
} from './chunkMath';
import { normalizeChunkDataMap } from './chunkStore';
import {
  decodeBackgroundChunkImage,
  getCachedBackgroundChunkImage,
} from './chunkImageCache';
import { getCachedBackgroundChunkIndex } from './chunkIndex';
import {
  getBackgroundDocumentFlattenSignature,
  getCachedBackgroundRuntimeChunkData,
  resolveBackgroundRuntimeChunkData,
} from './backgroundDocumentRender';

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
): background is BackgroundConfig & { type: 'tiled' } {
  return !!background && background.type === 'tiled';
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

  const chunkData = getCachedBackgroundRuntimeChunkData(background)
    ?? (background.chunks ? normalizeChunkDataMap(background.chunks) : null);
  if (!chunkData) {
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

  const chunkIndex = getCachedBackgroundChunkIndex(chunkData);
  const chunks: TiledBackgroundScreenChunk[] = [];
  for (const entry of chunkIndex.query(visibleRange)) {
    if (!entry.value) continue;

    const bounds = getChunkWorldBounds(entry.cx, entry.cy, chunkSize);
    const x = ((bounds.left - viewport.left) / viewportWidth) * targetWidth;
    const y = ((viewport.top - bounds.top) / viewportHeight) * targetHeight;
    const width = ((bounds.right - bounds.left) / viewportWidth) * targetWidth;
    const height = ((bounds.top - bounds.bottom) / viewportHeight) * targetHeight;

    if (x + width <= 0 || y + height <= 0 || x >= targetWidth || y >= targetHeight) {
      continue;
    }

    chunks.push({
      key: entry.key,
      dataUrl: entry.value,
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
  private readonly pendingBackgroundKeys = new Set<string>();
  private disposed = false;

  constructor(options?: { onChange?: () => void }) {
    this.onChange = options?.onChange;
  }

  dispose(): void {
    this.disposed = true;
    this.listeningKeys.clear();
    this.pendingBackgroundKeys.clear();
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

    let pending = false;
    let drawnChunks = 0;

    if (background && background.type === 'tiled' && !getCachedBackgroundRuntimeChunkData(background)) {
      pending = true;
      this.ensureBackgroundChunkData(background);
    }

    const chunks = getVisibleTiledBackgroundScreenChunks(background, viewport, pixelWidth, pixelHeight, 1);

    for (const chunk of chunks) {
      const image = getCachedBackgroundChunkImage(chunk.dataUrl);
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
    if (getCachedBackgroundChunkImage(dataUrl) || this.listeningKeys.has(dataUrl)) {
      return;
    }

    this.listeningKeys.add(dataUrl);
    void decodeBackgroundChunkImage(dataUrl)
      .catch(() => undefined)
      .finally(() => {
        this.listeningKeys.delete(dataUrl);
        if (!this.disposed) {
          this.onChange?.();
        }
      });
  }

  private ensureBackgroundChunkData(background: BackgroundConfig): void {
    if (background.type !== 'tiled' || !background.document) {
      return;
    }

    const pendingKey = getBackgroundDocumentFlattenSignature(background.document);
    if (this.pendingBackgroundKeys.has(pendingKey)) {
      return;
    }

    this.pendingBackgroundKeys.add(pendingKey);
    void resolveBackgroundRuntimeChunkData(background)
      .catch(() => undefined)
      .finally(() => {
        this.pendingBackgroundKeys.delete(pendingKey);
        if (!this.disposed) {
          this.onChange?.();
        }
      });
  }
}
