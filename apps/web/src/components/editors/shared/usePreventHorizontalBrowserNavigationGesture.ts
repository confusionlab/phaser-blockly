import { useEffect, type RefObject } from 'react';
import {
  acquireHorizontalBrowserNavigationLock,
  isTargetWithinProtectedSurface,
} from '@/lib/browserNavigationGestures';

type ProtectedPanSurfaceElement = HTMLElement | SVGElement;

interface UsePreventHorizontalBrowserNavigationGestureOptions {
  enabled?: boolean;
  surfaceRef: RefObject<ProtectedPanSurfaceElement | null>;
}

export function usePreventHorizontalBrowserNavigationGesture({
  enabled = true,
  surfaceRef,
}: UsePreventHorizontalBrowserNavigationGestureOptions) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const releaseBrowserNavigationLock = acquireHorizontalBrowserNavigationLock();

    const handleWheelCapture = (event: WheelEvent) => {
      if (!isTargetWithinProtectedSurface(surfaceRef.current, event.target)) {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener('wheel', handleWheelCapture, { passive: false, capture: true });
    return () => {
      window.removeEventListener('wheel', handleWheelCapture, true);
      releaseBrowserNavigationLock();
    };
  }, [enabled, surfaceRef]);
}
