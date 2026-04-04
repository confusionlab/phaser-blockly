import type { ViewportCenter } from '@/lib/editor/viewportRecovery';

export const DEFAULT_VIEWPORT_CENTER_ANIMATION_MS = 220;

export function easeOutViewportCenterProgress(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return 1 - ((1 - clamped) ** 3);
}

export function interpolateViewportCenter(
  start: ViewportCenter,
  target: ViewportCenter,
  progress: number,
): ViewportCenter {
  const eased = easeOutViewportCenterProgress(progress);
  return {
    x: start.x + ((target.x - start.x) * eased),
    y: start.y + ((target.y - start.y) * eased),
  };
}
