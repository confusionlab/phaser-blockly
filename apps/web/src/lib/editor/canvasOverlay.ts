export function syncCanvasViewportSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): number {
  const cssWidth = Math.max(1, Math.floor(width));
  const cssHeight = Math.max(1, Math.floor(height));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const targetWidth = Math.max(1, Math.round(cssWidth * dpr));
  const targetHeight = Math.max(1, Math.round(cssHeight * dpr));

  if (canvas.width !== targetWidth) {
    canvas.width = targetWidth;
  }
  if (canvas.height !== targetHeight) {
    canvas.height = targetHeight;
  }
  if (canvas.style.width !== `${cssWidth}px`) {
    canvas.style.width = `${cssWidth}px`;
  }
  if (canvas.style.height !== `${cssHeight}px`) {
    canvas.style.height = `${cssHeight}px`;
  }

  return dpr;
}

export function clearCanvasInCssPixels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
}
