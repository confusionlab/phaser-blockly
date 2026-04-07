import Color from 'color';
import type { VectorTextureToneMapping } from './vectorTextureMaterialCore';

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampSignedUnit(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function lerpNumber(start: number, end: number, amount: number) {
  return start + ((end - start) * amount);
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

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
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

function sampleSourceAlpha(
  pixels: Uint8ClampedArray,
  pixelIndex: number,
) {
  return clampUnit((pixels[pixelIndex + 3] ?? 0) / 255);
}

function sampleSourceLuminance(
  pixels: Uint8ClampedArray,
  pixelIndex: number,
) {
  return clampUnit((
    0.2126 * (pixels[pixelIndex] ?? 0)
    + 0.7152 * (pixels[pixelIndex + 1] ?? 0)
    + 0.0722 * (pixels[pixelIndex + 2] ?? 0)
  ) / 255);
}

export function resolveTextureToneSignal(
  textureValue: number,
  toneMapping?: VectorTextureToneMapping | null,
) {
  const neutral = clampUnit(toneMapping?.neutral ?? 0.5);
  const contrast = Math.max(0, toneMapping?.contrast ?? 1);
  const scale = textureValue >= neutral
    ? Math.max(0.0001, 1 - neutral)
    : Math.max(0.0001, neutral);
  return clampSignedUnit(((textureValue - neutral) / scale) * contrast);
}

export function applyTextureToneToColorChannels(
  color: [number, number, number],
  baseLightness: number,
  textureValue: number,
  toneMapping?: VectorTextureToneMapping | null,
  participation = 1,
): [number, number, number] {
  const resolvedParticipation = clampUnit(participation);
  const signedSignal = resolveTextureToneSignal(textureValue, toneMapping) * resolvedParticipation;
  const shadowStrength = clampUnit(toneMapping?.shadowStrength ?? 0.32);
  const highlightStrength = clampUnit(toneMapping?.highlightStrength ?? 0.18);
  const shadowBias = lerpNumber(0.35, 1, clampUnit(baseLightness));
  const highlightBias = lerpNumber(1, 0.35, clampUnit(baseLightness));
  const shadowMix = clampUnit(Math.max(0, -signedSignal) * shadowStrength * shadowBias);
  const highlightMix = clampUnit(Math.max(0, signedSignal) * highlightStrength * highlightBias);

  let [red, green, blue] = color;
  if (shadowMix > 0) {
    red = lerpNumber(red, 0, shadowMix);
    green = lerpNumber(green, 0, shadowMix);
    blue = lerpNumber(blue, 0, shadowMix);
  }
  if (highlightMix > 0) {
    red = lerpNumber(red, 255, highlightMix);
    green = lerpNumber(green, 255, highlightMix);
    blue = lerpNumber(blue, 255, highlightMix);
  }
  return [
    clampByte(red),
    clampByte(green),
    clampByte(blue),
  ];
}

export function createTintedTextureFromSource(options: {
  color: string;
  minSampleSize?: number;
  maskSource?: CanvasImageSource | null;
  opacity?: number;
  toneMapping?: VectorTextureToneMapping | null;
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

  const baseColor = Color(options.color);
  const [red, green, blue] = baseColor.rgb().array();
  const baseLightness = (baseColor.hsl().array()[2] ?? 0) / 100;
  const sampledCanvas = createTextureCanvas(sampleDimensions.width, sampleDimensions.height);
  const sampledCtx = sampledCanvas.getContext('2d');
  if (!sampledCtx) {
    return canvas;
  }
  const output = sampledCtx.createImageData(sampleDimensions.width, sampleDimensions.height);
  const opacity = clampUnit(options.opacity ?? 1);

  for (let pixelIndex = 0; pixelIndex < output.data.length; pixelIndex += 4) {
    const textureLuminance = sampleSourceLuminance(texturePixels, pixelIndex);
    const textureParticipation = sampleSourceAlpha(texturePixels, pixelIndex);
    const maskStrength = maskPixels ? sampleSourceStrength(maskPixels, pixelIndex) : 1;
    // Named vector materials keep shape coverage in alpha while the texture
    // modulates the visible tone of the color field.
    const [tonedRed, tonedGreen, tonedBlue] = applyTextureToneToColorChannels(
      [red, green, blue],
      baseLightness,
      textureLuminance,
      options.toneMapping,
      textureParticipation,
    );
    const coverageAlpha = clampUnit(maskStrength * opacity);
    output.data[pixelIndex] = tonedRed;
    output.data[pixelIndex + 1] = tonedGreen;
    output.data[pixelIndex + 2] = tonedBlue;
    output.data[pixelIndex + 3] = Math.round(coverageAlpha * 255);
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
