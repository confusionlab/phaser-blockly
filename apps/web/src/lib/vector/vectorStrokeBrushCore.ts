import { createVectorCrayonDab } from './vectorCrayonTextureCore';
import { getVectorTextureMaterial } from './vectorTextureMaterialCore';
import {
  canvasHasVisibleAlpha,
  createTintedTextureFromSource,
} from './vectorTextureImageCore';

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
  maskPath?: string;
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
  maskSource?: CanvasImageSource | null;
  textureSource?: CanvasImageSource | null;
  wiggle?: number;
}

const MINIMUM_DAB_SIZE = 8;
const CRAYON_MATERIAL = getVectorTextureMaterial('crayon');

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
    texturePath: CRAYON_MATERIAL.texturePath,
    maskPath: CRAYON_MATERIAL.strokeMaskPath,
    dabAspectRatio: CRAYON_MATERIAL.stroke.dabAspectRatio,
    spacingRatio: CRAYON_MATERIAL.stroke.spacingRatio,
    opacity: CRAYON_MATERIAL.stroke.opacity,
    opacityJitter: CRAYON_MATERIAL.stroke.opacityJitter,
    scaleJitter: CRAYON_MATERIAL.stroke.scaleJitter,
    rotationJitter: CRAYON_MATERIAL.stroke.rotationJitter,
    scatterRatio: CRAYON_MATERIAL.stroke.scatterRatio,
    variantCount: CRAYON_MATERIAL.stroke.variantCount,
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
  const maskSource = options.maskSource;
  const dabCount = textureSource ? 1 : preset.variantCount;
  const dabs: VectorStrokeBrushBitmapDab[] = [];

  for (let index = 0; index < dabCount; index += 1) {
    const seed = index + 1;
    const image = textureSource
      ? createTintedTextureFromSource({
          color: strokeColor,
          textureSource,
          maskSource,
          width: dabWidth,
          height: dabHeight,
          opacity: 1,
          minSampleSize: 48,
        })
      : null;
    const resolvedImage = image && canvasHasVisibleAlpha(image)
      ? image
      : createVectorCrayonDab(strokeColor, dabWidth, dabHeight, seed);
    dabs.push({
      image: resolvedImage,
      width: resolvedImage.width,
      height: resolvedImage.height,
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
