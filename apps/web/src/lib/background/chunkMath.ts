export const DEFAULT_BACKGROUND_CHUNK_SIZE = 512;

export interface ChunkCoord {
  cx: number;
  cy: number;
}

export interface ChunkWorldBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface ChunkRange {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
}

export interface ChunkScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function sanitizeChunkSize(chunkSize: number): number {
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) return DEFAULT_BACKGROUND_CHUNK_SIZE;
  return Math.max(1, Math.floor(chunkSize));
}

export function getChunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function parseChunkKey(key: string): ChunkCoord | null {
  const [rawCx, rawCy] = key.split(',');
  const cx = Number.parseInt(rawCx ?? '', 10);
  const cy = Number.parseInt(rawCy ?? '', 10);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return { cx, cy };
}

export function worldToChunkCoord(x: number, y: number, chunkSize: number = DEFAULT_BACKGROUND_CHUNK_SIZE): ChunkCoord {
  const size = sanitizeChunkSize(chunkSize);
  return {
    cx: Math.floor(x / size),
    cy: Math.floor(y / size),
  };
}

export function worldToChunkKey(x: number, y: number, chunkSize: number = DEFAULT_BACKGROUND_CHUNK_SIZE): string {
  const { cx, cy } = worldToChunkCoord(x, y, chunkSize);
  return getChunkKey(cx, cy);
}

export function getChunkWorldBounds(cx: number, cy: number, chunkSize: number = DEFAULT_BACKGROUND_CHUNK_SIZE): ChunkWorldBounds {
  const size = sanitizeChunkSize(chunkSize);
  return {
    left: cx * size,
    right: (cx + 1) * size,
    bottom: cy * size,
    top: (cy + 1) * size,
  };
}

export function getChunkCenterWorld(cx: number, cy: number, chunkSize: number = DEFAULT_BACKGROUND_CHUNK_SIZE): { x: number; y: number } {
  const bounds = getChunkWorldBounds(cx, cy, chunkSize);
  return {
    x: (bounds.left + bounds.right) * 0.5,
    y: (bounds.bottom + bounds.top) * 0.5,
  };
}

// Background editor uses user-space Y-up coordinates; canvas-local Y is down from top.
export function worldToChunkLocal(
  x: number,
  y: number,
  chunkSize: number = DEFAULT_BACKGROUND_CHUNK_SIZE,
): { cx: number; cy: number; localX: number; localY: number } {
  const size = sanitizeChunkSize(chunkSize);
  const { cx, cy } = worldToChunkCoord(x, y, size);
  const localX = x - cx * size;
  const localY = (cy + 1) * size - y;
  return { cx, cy, localX, localY };
}

export function getChunkRangeForWorldBounds(
  left: number,
  right: number,
  bottom: number,
  top: number,
  chunkSize: number = DEFAULT_BACKGROUND_CHUNK_SIZE,
  margin: number = 0,
): ChunkRange {
  const size = sanitizeChunkSize(chunkSize);
  const safeMargin = Math.max(0, Math.floor(margin));
  const minX = Math.min(left, right);
  const maxX = Math.max(left, right);
  const minY = Math.min(bottom, top);
  const maxY = Math.max(bottom, top);
  const epsilon = 1e-6;

  return {
    minCx: Math.floor(minX / size) - safeMargin,
    maxCx: Math.floor((maxX - epsilon) / size) + safeMargin,
    minCy: Math.floor(minY / size) - safeMargin,
    maxCy: Math.floor((maxY - epsilon) / size) + safeMargin,
  };
}

export function iterateChunkKeys(range: ChunkRange): string[] {
  const keys: string[] = [];
  for (let cy = range.minCy; cy <= range.maxCy; cy += 1) {
    for (let cx = range.minCx; cx <= range.maxCx; cx += 1) {
      keys.push(getChunkKey(cx, cy));
    }
  }
  return keys;
}

export function getChunkBoundsFromKeys(
  keys: Iterable<string>,
  chunkSize: number = DEFAULT_BACKGROUND_CHUNK_SIZE,
): ChunkWorldBounds | null {
  const size = sanitizeChunkSize(chunkSize);
  let minCx = Number.POSITIVE_INFINITY;
  let maxCx = Number.NEGATIVE_INFINITY;
  let minCy = Number.POSITIVE_INFINITY;
  let maxCy = Number.NEGATIVE_INFINITY;

  for (const key of keys) {
    const parsed = parseChunkKey(key);
    if (!parsed) continue;
    if (parsed.cx < minCx) minCx = parsed.cx;
    if (parsed.cx > maxCx) maxCx = parsed.cx;
    if (parsed.cy < minCy) minCy = parsed.cy;
    if (parsed.cy > maxCy) maxCy = parsed.cy;
  }

  if (!Number.isFinite(minCx) || !Number.isFinite(minCy) || !Number.isFinite(maxCx) || !Number.isFinite(maxCy)) {
    return null;
  }

  return {
    left: minCx * size,
    right: (maxCx + 1) * size,
    bottom: minCy * size,
    top: (maxCy + 1) * size,
  };
}

export function getProjectedChunkSizePx(
  chunkSize: number,
  zoom: number,
): number {
  return sanitizeChunkSize(chunkSize) * Math.abs(zoom);
}

export function projectChunkWorldBoundsToScreenRect(
  bounds: ChunkWorldBounds,
  viewport: { left: number; right: number; bottom: number; top: number },
  pixelWidth: number,
  pixelHeight: number,
): ChunkScreenRect {
  const targetWidth = Math.max(1, Math.floor(pixelWidth));
  const targetHeight = Math.max(1, Math.floor(pixelHeight));
  const viewportWidth = Math.max(1e-6, viewport.right - viewport.left);
  const viewportHeight = Math.max(1e-6, viewport.top - viewport.bottom);

  const left = ((bounds.left - viewport.left) / viewportWidth) * targetWidth;
  const top = ((viewport.top - bounds.top) / viewportHeight) * targetHeight;
  const right = ((bounds.right - viewport.left) / viewportWidth) * targetWidth;
  const bottom = ((viewport.top - bounds.bottom) / viewportHeight) * targetHeight;

  const snappedLeft = Math.floor(left);
  const snappedTop = Math.floor(top);
  const snappedRight = Math.ceil(right);
  const snappedBottom = Math.ceil(bottom);

  return {
    x: snappedLeft,
    y: snappedTop,
    width: Math.max(1, snappedRight - snappedLeft),
    height: Math.max(1, snappedBottom - snappedTop),
  };
}
