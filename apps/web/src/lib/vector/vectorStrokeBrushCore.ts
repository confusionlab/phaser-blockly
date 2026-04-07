import Color from 'color';

export type VectorStrokeBrushId = 'solid' | 'marker' | 'ink' | 'chalk';

export interface VectorStrokeBrushOption {
  value: VectorStrokeBrushId;
  label: string;
}

export interface VectorStrokeBrushPreset {
  id: VectorStrokeBrushId;
  label: string;
  kind: 'solid' | 'bitmap-dab';
  texturePath?: string;
  dabAspectRatio: number;
  spacingRatio: number;
  opacity: number;
  opacityJitter: number;
  scaleJitter: number;
  rotationJitter: number;
  scatterRatio: number;
  variantCount: number;
}

export interface VectorStrokeBrushBitmapDab {
  height: number;
  image: HTMLCanvasElement;
  opacity: number;
  width: number;
}

export interface VectorStrokeBrushRenderStyle {
  dabs: VectorStrokeBrushBitmapDab[];
  kind: 'solid' | 'bitmap-dab';
  opacityJitter: number;
  rotationJitter: number;
  scaleJitter: number;
  scatter: number;
  spacing: number;
  wiggle: number;
}

export interface CreateVectorStrokeBrushRenderStyleOptions {
  textureSource?: CanvasImageSource | null;
  wiggle?: number;
}

const MINIMUM_DAB_SIZE = 8;

export const DEFAULT_VECTOR_STROKE_BRUSH_ID: VectorStrokeBrushId = 'solid';
export const DEFAULT_VECTOR_STROKE_WIGGLE = 0;

export const VECTOR_STROKE_BRUSH_OPTIONS: VectorStrokeBrushOption[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'marker', label: 'Marker' },
  { value: 'ink', label: 'Ink' },
  { value: 'chalk', label: 'Chalk' },
];

export const VECTOR_STROKE_BRUSH_PRESETS: Record<VectorStrokeBrushId, VectorStrokeBrushPreset> = {
  solid: {
    id: 'solid',
    label: 'Solid',
    kind: 'solid',
    dabAspectRatio: 1,
    spacingRatio: 0.2,
    opacity: 1,
    opacityJitter: 0,
    scaleJitter: 0,
    rotationJitter: 0,
    scatterRatio: 0,
    variantCount: 1,
  },
  marker: {
    id: 'marker',
    label: 'Marker',
    kind: 'bitmap-dab',
    dabAspectRatio: 1.35,
    spacingRatio: 0.15,
    opacity: 0.92,
    opacityJitter: 0.08,
    scaleJitter: 0.06,
    rotationJitter: 0.06,
    scatterRatio: 0.028,
    variantCount: 3,
  },
  ink: {
    id: 'ink',
    label: 'Ink',
    kind: 'bitmap-dab',
    dabAspectRatio: 1.12,
    spacingRatio: 0.13,
    opacity: 0.96,
    opacityJitter: 0.04,
    scaleJitter: 0.04,
    rotationJitter: 0.04,
    scatterRatio: 0.016,
    variantCount: 2,
  },
  chalk: {
    id: 'chalk',
    label: 'Chalk',
    kind: 'bitmap-dab',
    dabAspectRatio: 1.08,
    spacingRatio: 0.1,
    opacity: 0.78,
    opacityJitter: 0.14,
    scaleJitter: 0.1,
    rotationJitter: 0.12,
    scatterRatio: 0.05,
    variantCount: 4,
  },
};

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function normalizeVectorStrokeWiggle(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_VECTOR_STROKE_WIGGLE;
  }
  return clampUnit(value);
}

function hash2d(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const t = clampUnit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
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

function createBrushCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function buildDabFromPixelMap(
  width: number,
  height: number,
  fillPixel: (
    x: number,
    y: number,
    rgba: Uint8ClampedArray,
    pixelIndex: number,
  ) => void,
) {
  const canvas = createBrushCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const imageData = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      fillPixel(x, y, imageData.data, (y * width + x) * 4);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function buildMarkerDab(color: string, width: number, height: number, seed: number) {
  const [baseRed, baseGreen, baseBlue] = Color(color).rgb().array();
  const radiusX = Math.max(1, width * (0.41 + hash2d(seed, 0.3) * 0.06));
  const radiusY = Math.max(1, height * (0.36 + hash2d(seed, 0.8) * 0.05));
  return buildDabFromPixelMap(width, height, (x, y, rgba, pixelIndex) => {
    const dx = (x + 0.5 - width / 2) / radiusX;
    const dy = (y + 0.5 - height / 2) / radiusY;
    const ellipseDistance = Math.sqrt(dx * dx + dy * dy);
    const edgeNoise = (hash2d(x * 0.19 + seed * 13.1, y * 0.07 + seed * 4.3) - 0.5) * 0.2;
    const profile = 1 - smoothstep(0.68 + edgeNoise, 1.02 + edgeNoise, ellipseDistance);
    if (profile <= 0.001) {
      return;
    }
    const centerWeight = 1 - Math.min(1, Math.abs(dy));
    const streak = 0.8 + hash2d(x * 0.11 + seed * 2.3, y * 0.02 + seed * 8.7) * 0.2;
    const alpha = clampUnit(profile * streak * (0.72 + centerWeight * 0.28));
    rgba[pixelIndex] = clampByte(baseRed);
    rgba[pixelIndex + 1] = clampByte(baseGreen);
    rgba[pixelIndex + 2] = clampByte(baseBlue);
    rgba[pixelIndex + 3] = clampByte(alpha * 255);
  });
}

function buildInkDab(color: string, width: number, height: number, seed: number) {
  const [baseRed, baseGreen, baseBlue] = Color(color).rgb().array();
  const radiusX = Math.max(1, width * (0.38 + hash2d(seed, 1.1) * 0.04));
  const radiusY = Math.max(1, height * (0.38 + hash2d(seed, 1.6) * 0.04));
  return buildDabFromPixelMap(width, height, (x, y, rgba, pixelIndex) => {
    const dx = (x + 0.5 - width / 2) / radiusX;
    const dy = (y + 0.5 - height / 2) / radiusY;
    const ellipseDistance = Math.sqrt(dx * dx + dy * dy);
    const edgeNoise = (hash2d(x * 0.17 + seed * 9.9, y * 0.17 + seed * 3.7) - 0.5) * 0.14;
    const body = 1 - smoothstep(0.72 + edgeNoise, 1.01 + edgeNoise, ellipseDistance);
    if (body <= 0.001) {
      return;
    }
    const grain = 0.88 + (hash2d(x * 0.29 + seed * 1.5, y * 0.33 + seed * 5.4) - 0.5) * 0.18;
    const pool = 1 - smoothstep(0.05, 0.8, ellipseDistance);
    const alpha = clampUnit(body * grain * (0.9 + pool * 0.1));
    rgba[pixelIndex] = clampByte(baseRed);
    rgba[pixelIndex + 1] = clampByte(baseGreen);
    rgba[pixelIndex + 2] = clampByte(baseBlue);
    rgba[pixelIndex + 3] = clampByte(alpha * 255);
  });
}

function buildChalkDab(color: string, width: number, height: number, seed: number) {
  const [baseRed, baseGreen, baseBlue] = Color(color).rgb().array();
  const radiusX = Math.max(1, width * (0.4 + hash2d(seed, 2.1) * 0.05));
  const radiusY = Math.max(1, height * (0.4 + hash2d(seed, 2.6) * 0.05));
  return buildDabFromPixelMap(width, height, (x, y, rgba, pixelIndex) => {
    const dx = (x + 0.5 - width / 2) / radiusX;
    const dy = (y + 0.5 - height / 2) / radiusY;
    const ellipseDistance = Math.sqrt(dx * dx + dy * dy);
    const edgeNoise = (hash2d(x * 0.13 + seed * 12.3, y * 0.19 + seed * 7.7) - 0.5) * 0.28;
    const body = 1 - smoothstep(0.58 + edgeNoise, 1.08 + edgeNoise, ellipseDistance);
    if (body <= 0.001) {
      return;
    }
    const grain = hash2d(x * 0.63 + seed * 4.7, y * 0.59 + seed * 9.1);
    const voidNoise = hash2d(x * 1.41 + seed * 2.9, y * 1.27 + seed * 6.1);
    let alpha = body * (0.16 + grain * 0.84);
    if (voidNoise < 0.08) {
      alpha *= 0.05;
    } else if (voidNoise < 0.18) {
      alpha *= 0.18;
    } else if (voidNoise < 0.32) {
      alpha *= 0.42;
    }
    const colorNoise = (hash2d(x * 0.29 + seed * 3.1, y * 0.31 + seed * 8.3) - 0.5) * 30;
    rgba[pixelIndex] = clampByte(baseRed + colorNoise);
    rgba[pixelIndex + 1] = clampByte(baseGreen + colorNoise);
    rgba[pixelIndex + 2] = clampByte(baseBlue + colorNoise);
    rgba[pixelIndex + 3] = clampByte(clampUnit(alpha) * 255);
  });
}

function tintTextureSource(
  source: CanvasImageSource,
  color: string,
  width: number,
  height: number,
) {
  const canvas = createBrushCanvas(width, height);
  const ctx = canvas.getContext('2d');
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
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

export function getVectorStrokeBrushPreset(brushId: VectorStrokeBrushId | null | undefined): VectorStrokeBrushPreset {
  return VECTOR_STROKE_BRUSH_PRESETS[brushId ?? DEFAULT_VECTOR_STROKE_BRUSH_ID] ?? VECTOR_STROKE_BRUSH_PRESETS[DEFAULT_VECTOR_STROKE_BRUSH_ID];
}

export function createVectorStrokeBrushRenderStyle(
  brushId: VectorStrokeBrushId | null | undefined,
  strokeColor: string,
  strokeWidth: number,
  options: CreateVectorStrokeBrushRenderStyleOptions = {},
): VectorStrokeBrushRenderStyle {
  const preset = getVectorStrokeBrushPreset(brushId);
  const wiggle = normalizeVectorStrokeWiggle(options.wiggle);
  if (preset.kind === 'solid') {
    return {
      kind: 'solid',
      dabs: [],
      spacing: Math.max(1, strokeWidth * 0.2),
      opacityJitter: 0,
      rotationJitter: 0,
      scaleJitter: 0,
      scatter: 0,
      wiggle,
    };
  }

  const dabHeight = Math.max(MINIMUM_DAB_SIZE, Math.round(strokeWidth));
  const dabWidth = Math.max(MINIMUM_DAB_SIZE, Math.round(dabHeight * preset.dabAspectRatio));
  const textureSource = options.textureSource;
  const dabCount = textureSource ? 1 : preset.variantCount;
  const dabs: VectorStrokeBrushBitmapDab[] = [];

  for (let index = 0; index < dabCount; index += 1) {
    const seed = index + 1;
    const image = textureSource
      ? tintTextureSource(textureSource, strokeColor, dabWidth, dabHeight)
      : preset.id === 'marker'
        ? buildMarkerDab(strokeColor, dabWidth, dabHeight, seed)
        : preset.id === 'ink'
          ? buildInkDab(strokeColor, dabWidth, dabHeight, seed)
          : buildChalkDab(strokeColor, dabWidth, dabHeight, seed);
    dabs.push({
      image,
      width: image.width,
      height: image.height,
      opacity: preset.opacity,
    });
  }

  return {
    kind: 'bitmap-dab',
    dabs,
    spacing: Math.max(1, strokeWidth * preset.spacingRatio),
    opacityJitter: preset.opacityJitter,
    rotationJitter: preset.rotationJitter,
    scaleJitter: preset.scaleJitter,
    scatter: strokeWidth * preset.scatterRatio,
    wiggle,
  };
}
