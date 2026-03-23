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

export function clampViewportZoom(value: number, minZoom: number, maxZoom: number): number {
  return Math.max(minZoom, Math.min(maxZoom, value));
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
