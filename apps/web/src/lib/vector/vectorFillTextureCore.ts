import { createVectorCrayonTile } from './vectorCrayonTextureCore';
import { getVectorTextureMaterial } from './vectorTextureMaterialCore';
import { createTintedTextureFromSource } from './vectorTextureImageCore';

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
const CRAYON_MATERIAL = getVectorTextureMaterial('crayon');

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
    texturePath: CRAYON_MATERIAL.texturePath,
    tileSize: CRAYON_MATERIAL.fill.tileSize,
    opacity: CRAYON_MATERIAL.fill.opacity,
  },
};

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
    return createTintedTextureFromSource({
      color: fillColor,
      textureSource,
      width: preset.tileSize,
      height: preset.tileSize,
      opacity: preset.opacity,
    });
  }

  return createVectorCrayonTile(fillColor, preset.tileSize, preset.opacity);
}
