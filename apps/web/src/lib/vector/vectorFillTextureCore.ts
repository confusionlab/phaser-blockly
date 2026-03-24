import Color from 'color';

export type VectorFillTextureId = 'solid' | 'paper' | 'linen' | 'grain';

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
  { value: 'paper', label: 'Paper' },
  { value: 'linen', label: 'Linen' },
  { value: 'grain', label: 'Grain' },
];

export const VECTOR_FILL_TEXTURE_PRESETS: Record<VectorFillTextureId, VectorFillTexturePreset> = {
  solid: {
    id: 'solid',
    label: 'Solid',
    kind: 'solid',
    tileSize: DEFAULT_TILE_SIZE,
    opacity: 1,
  },
  paper: {
    id: 'paper',
    label: 'Paper',
    kind: 'textured',
    tileSize: 176,
    opacity: 0.88,
  },
  linen: {
    id: 'linen',
    label: 'Linen',
    kind: 'textured',
    tileSize: 144,
    opacity: 0.82,
  },
  grain: {
    id: 'grain',
    label: 'Grain',
    kind: 'textured',
    tileSize: 128,
    opacity: 0.76,
  },
};

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function hash2d(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
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

function createPaperTile(fillColor: string, tileSize: number, opacity: number) {
  const canvas = createTileCanvas(tileSize);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const [red, green, blue] = Color(fillColor).rgb().array();
  const imageData = ctx.createImageData(tileSize, tileSize);
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      const noise = hash2d(x * 0.53, y * 0.71);
      const fiber = hash2d(x * 1.73, y * 0.29);
      const blotch = hash2d(x * 0.11, y * 0.13);
      let alpha = 0.22 + noise * 0.3;
      if (fiber > 0.92) {
        alpha += 0.18;
      }
      if (blotch < 0.06) {
        alpha *= 0.18;
      }

      const index = (y * tileSize + x) * 4;
      imageData.data[index] = red;
      imageData.data[index + 1] = green;
      imageData.data[index + 2] = blue;
      imageData.data[index + 3] = Math.round(clampUnit(alpha * opacity) * 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function createLinenTile(fillColor: string, tileSize: number, opacity: number) {
  const canvas = createTileCanvas(tileSize);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  ctx.fillStyle = Color(fillColor).alpha(opacity * 0.2).rgb().string();
  ctx.fillRect(0, 0, tileSize, tileSize);

  ctx.strokeStyle = Color(fillColor).alpha(opacity * 0.42).rgb().string();
  ctx.lineWidth = 1;
  for (let x = 0; x <= tileSize; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, tileSize);
    ctx.stroke();
  }
  for (let y = 0; y <= tileSize; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(tileSize, y);
    ctx.stroke();
  }
  return canvas;
}

function createGrainTile(fillColor: string, tileSize: number, opacity: number) {
  const canvas = createTileCanvas(tileSize);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const [red, green, blue] = Color(fillColor).rgb().array();
  const imageData = ctx.createImageData(tileSize, tileSize);
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      const noise = hash2d(x * 0.91, y * 0.67);
      const alpha = noise > 0.54 ? (noise - 0.54) / 0.46 : 0;
      const index = (y * tileSize + x) * 4;
      imageData.data[index] = red;
      imageData.data[index + 1] = green;
      imageData.data[index + 2] = blue;
      imageData.data[index + 3] = Math.round(clampUnit(alpha * opacity) * 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function getVectorFillTexturePreset(textureId: VectorFillTextureId | null | undefined): VectorFillTexturePreset {
  return VECTOR_FILL_TEXTURE_PRESETS[textureId ?? DEFAULT_VECTOR_FILL_TEXTURE_ID] ?? VECTOR_FILL_TEXTURE_PRESETS[DEFAULT_VECTOR_FILL_TEXTURE_ID];
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

  if (preset.id === 'paper') {
    return createPaperTile(fillColor, preset.tileSize, preset.opacity);
  }
  if (preset.id === 'linen') {
    return createLinenTile(fillColor, preset.tileSize, preset.opacity);
  }
  return createGrainTile(fillColor, preset.tileSize, preset.opacity);
}
