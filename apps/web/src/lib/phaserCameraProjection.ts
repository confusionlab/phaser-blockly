export interface PhaserCameraProjectionState {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  zoomX: number;
  zoomY: number;
  rotation: number;
}

export interface PhaserProjectionPoint {
  x: number;
  y: number;
}

export function projectPhaserCameraWorldPointToScreen(
  camera: PhaserCameraProjectionState,
  point: PhaserProjectionPoint,
): PhaserProjectionPoint {
  const originX = camera.width / 2;
  const originY = camera.height / 2;
  const translateX = Math.floor(camera.x + originX + 0.5);
  const translateY = Math.floor(camera.y + originY + 0.5);
  const localX = point.x - camera.scrollX - originX;
  const localY = point.y - camera.scrollY - originY;
  const cosine = Math.cos(camera.rotation);
  const sine = Math.sin(camera.rotation);

  return {
    x: localX * cosine * camera.zoomX + localY * -sine * camera.zoomY + translateX,
    y: localX * sine * camera.zoomX + localY * cosine * camera.zoomY + translateY,
  };
}
