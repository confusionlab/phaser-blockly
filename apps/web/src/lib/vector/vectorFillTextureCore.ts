import Color from 'color';
import { createVectorCrayonTile } from './vectorCrayonTextureCore';

export type VectorFillTextureId = 'solid' | 'crayon';

type LegacyVectorFillTextureId = 'paper' | 'linen' | 'grain';

export interface VectorFillTextureOption {
  value: VectorFillTextureId;
  label: string;
}

export interface VectorFillTexturePreset {
  id: VectorFillTextureId;
  label: string;
  kind: 'solid' | 'textured';
  texturePath?: string;
  tileSize: number;
  opacity: number;
}

const DEFAULT_TILE_SIZE = 160;

export const DEFAULT_VECTOR_FILL_TEXTURE_ID: VectorFillTextureId = 'solid';

export const VECTOR_FILL_TEXTURE_OPTIONS: VectorFillTextureOption[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'crayon', label: 'Crayon' },
];

export const VECTOR_FILL_TEXTURE_PRESETS: Record<VectorFillTextureId, VectorFillTexturePreset> = {
  solid: {
    id: 'solid',
    label: 'Solid',
    kind: 'solid',
    tileSize: DEFAULT_TILE_SIZE,
    opacity: 1,
  },
  crayon: {
    id: 'crayon',
    label: 'Crayon',
    kind: 'textured',
    tileSize: DEFAULT_TILE_SIZE,
    opacity: 0.76,
  },
};

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

function createTileCanvas(size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function tintCanvasFromSource(
  source: CanvasImageSource,
  fillColor: string,
  tileSize: number,
  opacity: number,
) {
  const canvas = createTileCanvas(tileSize);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const sourceWidth = resolveTextureSourceDimension(
    'videoWidth' in source ? source.videoWidth : 'naturalWidth' in source ? source.naturalWidth : 'width' in source ? source.width : tileSize,
    tileSize,
  );
  const sourceHeight = resolveTextureSourceDimension(
    'videoHeight' in source ? source.videoHeight : 'naturalHeight' in source ? source.naturalHeight : 'height' in source ? source.height : tileSize,
    tileSize,
  );

  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, tileSize, tileSize);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = Color(fillColor).alpha(opacity).rgb().string();
  ctx.fillRect(0, 0, tileSize, tileSize);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

export function parseVectorFillTextureId(value: unknown): VectorFillTextureId {
  if (value === 'solid') {
    return 'solid';
  }
  if (
    value === 'crayon'
    || value === 'paper'
    || value === 'linen'
    || value === 'grain'
  ) {
    return 'crayon';
  }
  return DEFAULT_VECTOR_FILL_TEXTURE_ID;
}

export function isLegacyVectorFillTextureId(value: unknown): value is LegacyVectorFillTextureId {
  return value === 'paper' || value === 'linen' || value === 'grain';
}

export function getVectorFillTexturePreset(textureId: VectorFillTextureId | null | undefined): VectorFillTexturePreset {
  return VECTOR_FILL_TEXTURE_PRESETS[parseVectorFillTextureId(textureId)] ?? VECTOR_FILL_TEXTURE_PRESETS[DEFAULT_VECTOR_FILL_TEXTURE_ID];
}

export function createVectorFillTextureTile(
  textureId: VectorFillTextureId | null | undefined,
  fillColor: string,
  textureSource?: CanvasImageSource | null,
): HTMLCanvasElement | null {
  const preset = getVectorFillTexturePreset(textureId);
  if (preset.kind === 'solid') {
    return null;
  }

  if (textureSource) {
    return tintCanvasFromSource(textureSource, fillColor, preset.tileSize, preset.opacity);
  }

  return createVectorCrayonTile(fillColor, preset.tileSize, preset.opacity);
}
