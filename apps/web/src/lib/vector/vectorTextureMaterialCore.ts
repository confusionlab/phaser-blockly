export type VectorTextureMaterialId = 'crayon';

export interface VectorTextureToneMapping {
  contrast: number;
  highlightStrength: number;
  neutral: number;
  shadowStrength: number;
}

export interface VectorTextureMaterialDefinition {
  id: VectorTextureMaterialId;
  label: string;
  sourceKind: 'image' | 'procedural';
  toneMapping: VectorTextureToneMapping;
  texturePath?: string;
  strokeMaskPath?: string;
  fill: {
    opacity: number;
    tileSize: number;
  };
  stroke: {
    dabAspectRatio: number;
    opacity: number;
    opacityJitter: number;
    rotationJitter: number;
    scaleJitter: number;
    scatterRatio: number;
    spacingRatio: number;
    variantCount: number;
  };
}

const DEFAULT_CRAYON_TILE_SIZE = 160;

export const VECTOR_TEXTURE_MATERIALS: Record<VectorTextureMaterialId, VectorTextureMaterialDefinition> = {
  crayon: {
    id: 'crayon',
    label: 'Crayon',
    sourceKind: 'image',
    toneMapping: {
      contrast: 1.4,
      highlightStrength: 0.36,
      neutral: 0.77,
      shadowStrength: 0.46,
    },
    texturePath: '/vector-materials/crayon/texture.png',
    strokeMaskPath: '/vector-materials/crayon/dab-mask.png',
    fill: {
      tileSize: DEFAULT_CRAYON_TILE_SIZE,
      opacity: 1,
    },
    stroke: {
      dabAspectRatio: 1.08,
      opacity: 1,
      opacityJitter: 0,
      rotationJitter: 0.12,
      scaleJitter: 0.1,
      scatterRatio: 0.05,
      spacingRatio: 0.1,
      variantCount: 4,
    },
  },
};

export function getVectorTextureMaterial(
  materialId: VectorTextureMaterialId | null | undefined,
): VectorTextureMaterialDefinition {
  return VECTOR_TEXTURE_MATERIALS[materialId ?? 'crayon'] ?? VECTOR_TEXTURE_MATERIALS.crayon;
}
