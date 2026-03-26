export type ViewAxisDirection = 'up' | 'down';

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportCamera {
  x: number;
  y: number;
}

export interface ScrollViewportCamera {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface WorldRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clampViewportZoom(value: number, minZoom: number, maxZoom: number): number {
  return Math.max(minZoom, Math.min(maxZoom, value));
}

function clampCameraAxisToWorldRect(
  center: number,
  viewportPixels: number,
  pixelsPerWorldUnit: number,
  rectStart: number,
  rectSize: number,
  maxOverscrollPixels: number,
): number {
  if (viewportPixels <= 0 || pixelsPerWorldUnit <= 0 || rectSize <= 0) {
    return center;
  }

  const halfViewportWorld = viewportPixels / (2 * pixelsPerWorldUnit);
  const overscrollWorld = Math.max(0, maxOverscrollPixels) / pixelsPerWorldUnit;
  const rectEnd = rectStart + rectSize;

  if (rectSize <= halfViewportWorld * 2) {
    const rectCenter = rectStart + rectSize / 2;
    return Math.max(rectCenter - overscrollWorld, Math.min(rectCenter + overscrollWorld, center));
  }

  const minCenter = rectStart + halfViewportWorld - overscrollWorld;
  const maxCenter = rectEnd - halfViewportWorld + overscrollWorld;
  return Math.max(minCenter, Math.min(maxCenter, center));
}

export function clampCameraToWorldRect(
  camera: ViewportCamera,
  viewport: Pick<ViewportRect, 'width' | 'height'>,
  pixelsPerWorldUnit: number,
  worldRect: WorldRect,
  maxOverscrollPixels = 0,
): ViewportCamera {
  const nextX = clampCameraAxisToWorldRect(
    camera.x,
    viewport.width,
    pixelsPerWorldUnit,
    worldRect.left,
    worldRect.width,
    maxOverscrollPixels,
  );
  const nextY = clampCameraAxisToWorldRect(
    camera.y,
    viewport.height,
    pixelsPerWorldUnit,
    worldRect.top,
    worldRect.height,
    maxOverscrollPixels,
  );

  if (nextX === camera.x && nextY === camera.y) {
    return camera;
  }

  return { x: nextX, y: nextY };
}

export function screenToWorldPoint(
  clientX: number,
  clientY: number,
  rect: ViewportRect,
  camera: ViewportCamera,
  pixelsPerWorldUnit: number,
  axis: ViewAxisDirection,
): ViewportCamera {
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const deltaX = (localX - rect.width / 2) / pixelsPerWorldUnit;
  const deltaY = (localY - rect.height / 2) / pixelsPerWorldUnit;

  return {
    x: camera.x + deltaX,
    y: axis === 'up' ? camera.y - deltaY : camera.y + deltaY,
  };
}

export function worldToScreenPoint(
  worldX: number,
  worldY: number,
  rect: ViewportRect,
  camera: ViewportCamera,
  pixelsPerWorldUnit: number,
  axis: ViewAxisDirection,
): ViewportCamera {
  return {
    x: (worldX - camera.x) * pixelsPerWorldUnit + rect.width / 2,
    y:
      axis === 'up'
        ? (camera.y - worldY) * pixelsPerWorldUnit + rect.height / 2
        : (worldY - camera.y) * pixelsPerWorldUnit + rect.height / 2,
  };
}

export function panCameraFromWheel(
  camera: ViewportCamera,
  deltaX: number,
  deltaY: number,
  pixelsPerWorldUnit: number,
  axis: ViewAxisDirection,
): ViewportCamera {
  return {
    x: camera.x + deltaX / pixelsPerWorldUnit,
    y: axis === 'up' ? camera.y - deltaY / pixelsPerWorldUnit : camera.y + deltaY / pixelsPerWorldUnit,
  };
}

export function panCameraFromDrag(
  camera: ViewportCamera,
  deltaX: number,
  deltaY: number,
  pixelsPerWorldUnit: number,
  axis: ViewAxisDirection,
): ViewportCamera {
  return {
    x: camera.x - deltaX / pixelsPerWorldUnit,
    y: axis === 'up' ? camera.y + deltaY / pixelsPerWorldUnit : camera.y - deltaY / pixelsPerWorldUnit,
  };
}

export function getViewportCenterFromScrollCamera(
  camera: ScrollViewportCamera,
  viewport: Pick<ViewportRect, 'width' | 'height'>,
): ViewportCamera {
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  return {
    x: camera.scrollX + viewport.width / (2 * zoom),
    y: camera.scrollY + viewport.height / (2 * zoom),
  };
}

export function getScrollCameraForViewportCenter(
  center: ViewportCamera,
  viewport: Pick<ViewportRect, 'width' | 'height'>,
  zoom: number,
): Pick<ScrollViewportCamera, 'scrollX' | 'scrollY'> {
  const safeZoom = zoom > 0 ? zoom : 1;
  return {
    scrollX: center.x - viewport.width / (2 * safeZoom),
    scrollY: center.y - viewport.height / (2 * safeZoom),
  };
}

export function zoomCameraAtClientPoint(
  clientX: number,
  clientY: number,
  rect: ViewportRect,
  camera: ViewportCamera,
  currentPixelsPerWorldUnit: number,
  nextPixelsPerWorldUnit: number,
  axis: ViewAxisDirection,
): ViewportCamera {
  const worldBefore = screenToWorldPoint(
    clientX,
    clientY,
    rect,
    camera,
    currentPixelsPerWorldUnit,
    axis,
  );
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const screenOffsetX = (localX - rect.width / 2) / nextPixelsPerWorldUnit;
  const screenOffsetY = (localY - rect.height / 2) / nextPixelsPerWorldUnit;

  return {
    x: worldBefore.x - screenOffsetX,
    y: axis === 'up' ? worldBefore.y + screenOffsetY : worldBefore.y - screenOffsetY,
  };
}
