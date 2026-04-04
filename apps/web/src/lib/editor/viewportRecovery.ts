export interface ViewportBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface ViewportCenter {
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export function boundsIntersect(a: ViewportBounds, b: ViewportBounds): boolean {
  return (
    a.left <= b.right &&
    a.right >= b.left &&
    a.bottom <= b.top &&
    a.top >= b.bottom
  );
}

export function getBoundsFromPoints<TPoint extends { x: number; y: number }>(
  points: readonly TPoint[],
): ViewportBounds | null {
  if (points.length === 0) {
    return null;
  }

  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    bottom = Math.min(bottom, point.y);
    top = Math.max(top, point.y);
  }

  return { left, right, bottom, top };
}

export function shouldShowViewportRecovery(options: {
  currentCenter: ViewportCenter;
  homeCenter: ViewportCenter;
  viewportSize: ViewportSize;
  hasVisibleContent: boolean;
  minimumDistance?: number;
  distanceMultiplier?: number;
}): boolean {
  if (options.hasVisibleContent) {
    return false;
  }

  const distance = Math.hypot(
    options.currentCenter.x - options.homeCenter.x,
    options.currentCenter.y - options.homeCenter.y,
  );
  const minimumDistance = Math.max(
    options.minimumDistance ?? 256,
    Math.max(options.viewportSize.width, options.viewportSize.height) * (options.distanceMultiplier ?? 0.75),
  );
  return distance >= minimumDistance;
}

