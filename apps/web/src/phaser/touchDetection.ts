export interface TouchBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

export interface TouchOverlapRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface TouchSurface {
  id: string;
  bounds: TouchBounds;
  hasPixelMask: boolean;
  sampleOpaqueAtWorldPoint(worldX: number, worldY: number): boolean;
}

export const DEFAULT_TOUCH_GRID_CELL_SIZE_PX = 128;

export function touchBoundsOverlap(a: TouchBounds, b: TouchBounds): boolean {
  return !(
    a.maxX <= b.minX ||
    a.minX >= b.maxX ||
    a.maxY <= b.minY ||
    a.minY >= b.maxY
  );
}

export function getTouchOverlapRect(a: TouchBounds, b: TouchBounds): TouchOverlapRect | null {
  if (!touchBoundsOverlap(a, b)) {
    return null;
  }

  return {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minY: Math.max(a.minY, b.minY),
    maxY: Math.min(a.maxY, b.maxY),
  };
}

export function areTouchSurfacesTouching(a: TouchSurface, b: TouchSurface): boolean {
  const overlap = getTouchOverlapRect(a.bounds, b.bounds);
  if (!overlap) {
    return false;
  }

  if (!a.hasPixelMask && !b.hasPixelMask) {
    return true;
  }

  const minX = Math.floor(overlap.minX);
  const maxX = Math.ceil(overlap.maxX);
  const minY = Math.floor(overlap.minY);
  const maxY = Math.ceil(overlap.maxY);

  if (minX >= maxX || minY >= maxY) {
    return false;
  }

  for (let worldY = minY; worldY < maxY; worldY += 1) {
    const sampleY = worldY + 0.5;
    for (let worldX = minX; worldX < maxX; worldX += 1) {
      const sampleX = worldX + 0.5;
      if (!a.sampleOpaqueAtWorldPoint(sampleX, sampleY)) {
        continue;
      }
      if (b.sampleOpaqueAtWorldPoint(sampleX, sampleY)) {
        return true;
      }
    }
  }

  return false;
}

function getTouchGridRange(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

export function collectPotentialTouchPairs<T extends TouchSurface>(
  surfaces: readonly T[],
  cellSize: number = DEFAULT_TOUCH_GRID_CELL_SIZE_PX,
): Array<[T, T]> {
  if (surfaces.length <= 1) {
    return [];
  }

  const grid = new Map<string, number[]>();
  const pairs: Array<[T, T]> = [];
  const seenPairs = new Set<string>();

  surfaces.forEach((surface, index) => {
    const startCellX = getTouchGridRange(surface.bounds.minX, cellSize);
    const endCellX = getTouchGridRange(Math.max(surface.bounds.minX, surface.bounds.maxX - 1), cellSize);
    const startCellY = getTouchGridRange(surface.bounds.minY, cellSize);
    const endCellY = getTouchGridRange(Math.max(surface.bounds.minY, surface.bounds.maxY - 1), cellSize);

    for (let cellY = startCellY; cellY <= endCellY; cellY += 1) {
      for (let cellX = startCellX; cellX <= endCellX; cellX += 1) {
        const cellKey = `${cellX},${cellY}`;
        const occupants = grid.get(cellKey) ?? [];
        for (const otherIndex of occupants) {
          const otherSurface = surfaces[otherIndex];
          const pairKey = otherIndex < index ? `${otherIndex}|${index}` : `${index}|${otherIndex}`;
          if (seenPairs.has(pairKey)) {
            continue;
          }
          seenPairs.add(pairKey);
          if (touchBoundsOverlap(surface.bounds, otherSurface.bounds)) {
            pairs.push([otherSurface, surface]);
          }
        }
        occupants.push(index);
        grid.set(cellKey, occupants);
      }
    }
  });

  return pairs;
}
