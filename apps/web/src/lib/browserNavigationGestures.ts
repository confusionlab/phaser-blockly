interface HorizontalBrowserNavigationLockSnapshot {
  bodyOverscrollBehaviorX: string;
  htmlOverscrollBehaviorX: string;
}

let activeHorizontalBrowserNavigationLockCount = 0;
let activeHorizontalBrowserNavigationLockSnapshot: HorizontalBrowserNavigationLockSnapshot | null = null;

export function acquireHorizontalBrowserNavigationLock(): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }

  const html = document.documentElement;
  const { body } = document;
  if (!html || !body) {
    return () => {};
  }

  if (activeHorizontalBrowserNavigationLockCount === 0) {
    activeHorizontalBrowserNavigationLockSnapshot = {
      htmlOverscrollBehaviorX: html.style.overscrollBehaviorX,
      bodyOverscrollBehaviorX: body.style.overscrollBehaviorX,
    };
    html.style.overscrollBehaviorX = 'none';
    body.style.overscrollBehaviorX = 'none';
  }

  activeHorizontalBrowserNavigationLockCount += 1;

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    activeHorizontalBrowserNavigationLockCount = Math.max(0, activeHorizontalBrowserNavigationLockCount - 1);
    if (activeHorizontalBrowserNavigationLockCount !== 0) {
      return;
    }

    if (activeHorizontalBrowserNavigationLockSnapshot) {
      html.style.overscrollBehaviorX = activeHorizontalBrowserNavigationLockSnapshot.htmlOverscrollBehaviorX;
      body.style.overscrollBehaviorX = activeHorizontalBrowserNavigationLockSnapshot.bodyOverscrollBehaviorX;
      activeHorizontalBrowserNavigationLockSnapshot = null;
    }
  };
}

export function isTargetWithinProtectedSurface(
  surface: Element | null | undefined,
  target: EventTarget | null,
): target is Node {
  if (!surface || !target || typeof Node === 'undefined' || !(target instanceof Node)) {
    return false;
  }

  return surface.contains(target);
}
