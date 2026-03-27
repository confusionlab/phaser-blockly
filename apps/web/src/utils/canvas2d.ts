type Canvas2DContextPurpose = 'display' | 'readback';

const READBACK_CONTEXT_SETTINGS: CanvasRenderingContext2DSettings = {
  willReadFrequently: true,
};

const readbackCanvasRegistry = new WeakSet<HTMLCanvasElement>();

export function getCanvas2dContext(
  canvas: HTMLCanvasElement,
  purpose: Canvas2DContextPurpose = 'display',
): CanvasRenderingContext2D | null {
  const ctx = purpose === 'readback'
    ? canvas.getContext('2d', READBACK_CONTEXT_SETTINGS)
    : canvas.getContext('2d');
  if (ctx && purpose === 'readback') {
    readbackCanvasRegistry.add(canvas);
  }
  return ctx;
}

export function getOffscreenCanvas2dContext(
  canvas: OffscreenCanvas,
  purpose: Canvas2DContextPurpose = 'display',
): OffscreenCanvasRenderingContext2D | null {
  return purpose === 'readback'
    ? canvas.getContext('2d', READBACK_CONTEXT_SETTINGS)
    : canvas.getContext('2d');
}

export function readCanvasImageData(
  sourceCanvas: HTMLCanvasElement,
  x = 0,
  y = 0,
  width = sourceCanvas.width,
  height = sourceCanvas.height,
): ImageData | null {
  if (width <= 0 || height <= 0) {
    return null;
  }

  if (readbackCanvasRegistry.has(sourceCanvas)) {
    const sourceCtx = getCanvas2dContext(sourceCanvas, 'readback');
    return sourceCtx?.getImageData(x, y, width, height) ?? null;
  }

  const scratchCanvas = document.createElement('canvas');
  scratchCanvas.width = width;
  scratchCanvas.height = height;
  const scratchCtx = getCanvas2dContext(scratchCanvas, 'readback');
  if (!scratchCtx) {
    return null;
  }

  scratchCtx.drawImage(
    sourceCanvas,
    x,
    y,
    width,
    height,
    0,
    0,
    width,
    height,
  );
  return scratchCtx.getImageData(0, 0, width, height);
}
