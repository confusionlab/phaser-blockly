import Color from 'color';

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function resolveTextureSourceDimension(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (
    value &&
    typeof value === 'object' &&
    'baseVal' in value &&
    value.baseVal &&
    typeof value.baseVal === 'object' &&
    'value' in value.baseVal
  ) {
    const animatedValue = Number(value.baseVal.value);
    if (Number.isFinite(animatedValue) && animatedValue > 0) {
      return animatedValue;
    }
  }
  return fallback;
}

function createTextureCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function resolveTextureSampleDimensions(
  width: number,
  height: number,
  minSampleSize?: number,
) {
  const minSide = Math.max(1, Math.min(width, height));
  const requiredMinimum = typeof minSampleSize === 'number' && Number.isFinite(minSampleSize)
    ? Math.max(1, Math.round(minSampleSize))
    : minSide;
  const scale = Math.max(1, Math.ceil(requiredMinimum / minSide));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function drawSourceToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
) {
  const canvas = createTextureCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return canvas;
  }

  const sourceWidth = resolveTextureSourceDimension(
    'videoWidth' in source ? source.videoWidth : 'naturalWidth' in source ? source.naturalWidth : 'width' in source ? source.width : width,
    width,
  );
  const sourceHeight = resolveTextureSourceDimension(
    'videoHeight' in source ? source.videoHeight : 'naturalHeight' in source ? source.naturalHeight : 'height' in source ? source.height : height,
    height,
  );
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
  return canvas;
}

function sampleSourceStrength(
  pixels: Uint8ClampedArray,
  pixelIndex: number,
) {
  const alpha = (pixels[pixelIndex + 3] ?? 0) / 255;
  const luminance = (
    0.2126 * (pixels[pixelIndex] ?? 0)
    + 0.7152 * (pixels[pixelIndex + 1] ?? 0)
    + 0.0722 * (pixels[pixelIndex + 2] ?? 0)
  ) / 255;
  return clampUnit(alpha * luminance);
}

export function createTintedTextureFromSource(options: {
  color: string;
  minSampleSize?: number;
  maskSource?: CanvasImageSource | null;
  opacity?: number;
  textureSource: CanvasImageSource;
  width: number;
  height: number;
}): HTMLCanvasElement {
  const canvas = createTextureCanvas(options.width, options.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const sampleDimensions = resolveTextureSampleDimensions(
    options.width,
    options.height,
    options.minSampleSize,
  );

  const textureCanvas = drawSourceToCanvas(
    options.textureSource,
    sampleDimensions.width,
    sampleDimensions.height,
  );
  const textureCtx = textureCanvas.getContext('2d', { willReadFrequently: true });
  if (!textureCtx) {
    return canvas;
  }

  const texturePixels = textureCtx.getImageData(
    0,
    0,
    sampleDimensions.width,
    sampleDimensions.height,
  ).data;
  const maskPixels = options.maskSource
    ? drawSourceToCanvas(options.maskSource, sampleDimensions.width, sampleDimensions.height)
        .getContext('2d', { willReadFrequently: true })
        ?.getImageData(0, 0, sampleDimensions.width, sampleDimensions.height).data
    : null;

  const [red, green, blue] = Color(options.color).rgb().array();
  const sampledCanvas = createTextureCanvas(sampleDimensions.width, sampleDimensions.height);
  const sampledCtx = sampledCanvas.getContext('2d');
  if (!sampledCtx) {
    return canvas;
  }
  const output = sampledCtx.createImageData(sampleDimensions.width, sampleDimensions.height);
  const opacity = clampUnit(options.opacity ?? 1);

  for (let pixelIndex = 0; pixelIndex < output.data.length; pixelIndex += 4) {
    const textureStrength = sampleSourceStrength(texturePixels, pixelIndex);
    const maskStrength = maskPixels ? sampleSourceStrength(maskPixels, pixelIndex) : 1;
    const alpha = clampUnit(textureStrength * maskStrength * opacity);
    output.data[pixelIndex] = Math.round(red);
    output.data[pixelIndex + 1] = Math.round(green);
    output.data[pixelIndex + 2] = Math.round(blue);
    output.data[pixelIndex + 3] = Math.round(alpha * 255);
  }

  sampledCtx.putImageData(output, 0, 0);
  ctx.clearRect(0, 0, options.width, options.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    sampledCanvas,
    0,
    0,
    sampleDimensions.width,
    sampleDimensions.height,
    0,
    0,
    options.width,
    options.height,
  );
  return canvas;
}

export function createAlphaMaskFromSource(options: {
  minSampleSize?: number;
  opacity?: number;
  source: CanvasImageSource;
  width: number;
  height: number;
}): HTMLCanvasElement {
  const canvas = createTextureCanvas(options.width, options.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const sampleDimensions = resolveTextureSampleDimensions(
    options.width,
    options.height,
    options.minSampleSize,
  );

  const sourceCanvas = drawSourceToCanvas(
    options.source,
    sampleDimensions.width,
    sampleDimensions.height,
  );
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) {
    return canvas;
  }

  const sourcePixels = sourceCtx.getImageData(
    0,
    0,
    sampleDimensions.width,
    sampleDimensions.height,
  ).data;
  const sampledCanvas = createTextureCanvas(sampleDimensions.width, sampleDimensions.height);
  const sampledCtx = sampledCanvas.getContext('2d');
  if (!sampledCtx) {
    return canvas;
  }

  const output = sampledCtx.createImageData(sampleDimensions.width, sampleDimensions.height);
  const opacity = clampUnit(options.opacity ?? 1);

  for (let pixelIndex = 0; pixelIndex < output.data.length; pixelIndex += 4) {
    const alpha = clampUnit(sampleSourceStrength(sourcePixels, pixelIndex) * opacity);
    output.data[pixelIndex] = 255;
    output.data[pixelIndex + 1] = 255;
    output.data[pixelIndex + 2] = 255;
    output.data[pixelIndex + 3] = Math.round(alpha * 255);
  }

  sampledCtx.putImageData(output, 0, 0);
  ctx.clearRect(0, 0, options.width, options.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    sampledCanvas,
    0,
    0,
    sampleDimensions.width,
    sampleDimensions.height,
    0,
    0,
    options.width,
    options.height,
  );
  return canvas;
}

export function canvasHasVisibleAlpha(
  canvas: HTMLCanvasElement,
  minimumAlpha = 1,
): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return false;
  }

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let pixelIndex = 3; pixelIndex < data.length; pixelIndex += 4) {
    if ((data[pixelIndex] ?? 0) >= minimumAlpha) {
      return true;
    }
  }
  return false;
}
