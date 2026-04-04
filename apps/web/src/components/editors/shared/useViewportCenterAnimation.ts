import { useCallback, useEffect, useRef } from 'react';
import type { ViewportCenter } from '@/lib/editor/viewportRecovery';
import {
  DEFAULT_VIEWPORT_CENTER_ANIMATION_MS,
  interpolateViewportCenter,
} from '@/lib/editor/viewportCenterAnimation';

type UseViewportCenterAnimationOptions = {
  applyCenter: (center: ViewportCenter) => void;
  durationMs?: number;
  getCurrentCenter: () => ViewportCenter;
  minimumDistance?: number;
};

export function useViewportCenterAnimation({
  applyCenter,
  durationMs = DEFAULT_VIEWPORT_CENTER_ANIMATION_MS,
  getCurrentCenter,
  minimumDistance = 1,
}: UseViewportCenterAnimationOptions) {
  const frameRef = useRef<number | null>(null);
  const applyCenterRef = useRef(applyCenter);
  applyCenterRef.current = applyCenter;
  const getCurrentCenterRef = useRef(getCurrentCenter);
  getCurrentCenterRef.current = getCurrentCenter;

  const cancelAnimation = useCallback(() => {
    if (frameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = null;
  }, []);

  const animateToCenter = useCallback((target: ViewportCenter) => {
    const start = getCurrentCenterRef.current();
    const distance = Math.hypot(target.x - start.x, target.y - start.y);
    if (
      distance < minimumDistance
      || typeof window === 'undefined'
      || typeof window.requestAnimationFrame !== 'function'
    ) {
      cancelAnimation();
      applyCenterRef.current(target);
      return;
    }

    cancelAnimation();
    const startTime = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / Math.max(1, durationMs));
      applyCenterRef.current(interpolateViewportCenter(start, target, progress));
      if (progress >= 1) {
        frameRef.current = null;
        return;
      }
      frameRef.current = window.requestAnimationFrame(step);
    };

    frameRef.current = window.requestAnimationFrame(step);
  }, [cancelAnimation, durationMs, minimumDistance]);

  useEffect(() => cancelAnimation, [cancelAnimation]);

  return {
    animateToCenter,
    cancelAnimation,
  };
}
