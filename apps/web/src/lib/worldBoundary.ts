import type { WorldPoint } from '@/types';

function squaredDistance(a: WorldPoint, b: WorldPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function hasUsableWorldBoundary(points: WorldPoint[] | null | undefined): points is WorldPoint[] {
  return Array.isArray(points) && points.length >= 3;
}

export function isPointInsidePolygon(point: WorldPoint, polygon: WorldPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects = ((yi > point.y) !== (yj > point.y))
      && point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function projectPointToSegment(point: WorldPoint, a: WorldPoint, b: WorldPoint): WorldPoint {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abLengthSquared = abx * abx + aby * aby;
  if (abLengthSquared <= Number.EPSILON) {
    return { ...a };
  }

  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLengthSquared));

  return {
    x: a.x + abx * t,
    y: a.y + aby * t,
  };
}

export function clampPointToPolygon(point: WorldPoint, polygon: WorldPoint[]): WorldPoint {
  if (!hasUsableWorldBoundary(polygon)) {
    return { ...point };
  }
  if (isPointInsidePolygon(point, polygon)) {
    return { ...point };
  }

  let closest = projectPointToSegment(point, polygon[polygon.length - 1], polygon[0]);
  let closestDistance = squaredDistance(point, closest);

  for (let index = 0; index < polygon.length - 1; index += 1) {
    const projected = projectPointToSegment(point, polygon[index], polygon[index + 1]);
    const distance = squaredDistance(point, projected);
    if (distance < closestDistance) {
      closest = projected;
      closestDistance = distance;
    }
  }

  return closest;
}

export function getPolygonSegments(points: WorldPoint[]): Array<{ start: WorldPoint; end: WorldPoint }> {
  if (!hasUsableWorldBoundary(points)) {
    return [];
  }

  const segments: Array<{ start: WorldPoint; end: WorldPoint }> = [];
  for (let index = 0; index < points.length; index += 1) {
    segments.push({
      start: points[index],
      end: points[(index + 1) % points.length],
    });
  }
  return segments;
}
