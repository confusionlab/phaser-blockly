import { createVectorCrayonDab } from './vectorCrayonTextureCore';

export type VectorStrokeBrushId = 'solid' | 'crayon';

type LegacyVectorStrokeBrushId = 'marker' | 'ink' | 'chalk';

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
  { value: 'crayon', label: 'Crayon' },
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
  crayon: {
    id: 'crayon',
    label: 'Crayon',
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

export function parseVectorStrokeBrushId(value: unknown): VectorStrokeBrushId {
  if (value === 'solid') {
    return 'solid';
  }
  if (
    value === 'crayon'
    || value === 'marker'
    || value === 'ink'
    || value === 'chalk'
  ) {
    return 'crayon';
  }
  return DEFAULT_VECTOR_STROKE_BRUSH_ID;
}

export function isLegacyVectorStrokeBrushId(value: unknown): value is LegacyVectorStrokeBrushId {
  return value === 'marker' || value === 'ink' || value === 'chalk';
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
  return VECTOR_STROKE_BRUSH_PRESETS[parseVectorStrokeBrushId(brushId)] ?? VECTOR_STROKE_BRUSH_PRESETS[DEFAULT_VECTOR_STROKE_BRUSH_ID];
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
      : createVectorCrayonDab(strokeColor, dabWidth, dabHeight, seed);
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
