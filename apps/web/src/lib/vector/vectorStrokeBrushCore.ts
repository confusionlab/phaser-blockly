import Color from 'color';

export type VectorStrokeBrushId = 'solid' | 'marker' | 'ink' | 'chalk';

export interface VectorStrokeBrushOption {
  value: VectorStrokeBrushId;
  label: string;
}

export interface VectorStrokeBrushPreset {
  id: VectorStrokeBrushId;
  label: string;
  kind: 'solid' | 'textured';
  texturePath?: string;
  tileAspectRatio: number;
  advanceRatio: number;
  opacity: number;
  scaleJitter: number;
  rotationJitter: number;
  scatterRatio: number;
}

export interface VectorStrokeBrushStamp {
  advance: number;
  image: HTMLCanvasElement;
  opacity: number;
  rotationJitter: number;
  scaleJitter: number;
  scatter: number;
}

const DEFAULT_TILE_BASE_WIDTH = 192;
const DEFAULT_TILE_BASE_HEIGHT = 48;

export const DEFAULT_VECTOR_STROKE_BRUSH_ID: VectorStrokeBrushId = 'solid';

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
    tileAspectRatio: 4,
    advanceRatio: 0.5,
    opacity: 1,
    scaleJitter: 0,
    rotationJitter: 0,
    scatterRatio: 0,
  },
  marker: {
    id: 'marker',
    label: 'Marker',
    kind: 'textured',
    tileAspectRatio: 3.8,
    advanceRatio: 0.46,
    opacity: 0.88,
    scaleJitter: 0.04,
    rotationJitter: 0.03,
    scatterRatio: 0.02,
  },
  ink: {
    id: 'ink',
    label: 'Ink',
    kind: 'textured',
    tileAspectRatio: 4.6,
    advanceRatio: 0.42,
    opacity: 0.94,
    scaleJitter: 0.06,
    rotationJitter: 0.05,
    scatterRatio: 0.018,
  },
  chalk: {
    id: 'chalk',
    label: 'Chalk',
    kind: 'textured',
    tileAspectRatio: 3.5,
    advanceRatio: 0.38,
    opacity: 0.78,
    scaleJitter: 0.08,
    rotationJitter: 0.08,
    scatterRatio: 0.032,
  },
};

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function hash2d(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function colorWithAlpha(color: string, alpha: number) {
  return Color(color).alpha(clampUnit(alpha)).rgb().string();
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

function createTileCanvas(width = DEFAULT_TILE_BASE_WIDTH, height = DEFAULT_TILE_BASE_HEIGHT) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function buildMarkerTile(color: string, width = DEFAULT_TILE_BASE_WIDTH, height = DEFAULT_TILE_BASE_HEIGHT) {
  const canvas = createTileCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, colorWithAlpha(color, 0.35));
  gradient.addColorStop(0.22, colorWithAlpha(color, 0.92));
  gradient.addColorStop(0.78, colorWithAlpha(color, 0.92));
  gradient.addColorStop(1, colorWithAlpha(color, 0.3));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < width; x += 1) {
    const centerBias = 1 - Math.abs(x / width - 0.5) * 1.8;
    const topDepth = (hash2d(x * 0.41, 0.2) * 0.12 + 0.05) * centerBias;
    const bottomDepth = (hash2d(x * 0.39, 1.3) * 0.12 + 0.05) * centerBias;
    const topHeight = Math.max(1, Math.round(height * topDepth));
    const bottomHeight = Math.max(1, Math.round(height * bottomDepth));
    ctx.fillStyle = `rgba(0,0,0,${0.28 + hash2d(x * 0.17, 4.9) * 0.18})`;
    ctx.fillRect(x, 0, 1, topHeight);
    ctx.fillRect(x, height - bottomHeight, 1, bottomHeight);
  }

  ctx.globalCompositeOperation = 'source-over';
  for (let index = 0; index < 18; index += 1) {
    const streakY = height * (0.12 + index / 24);
    ctx.strokeStyle = colorWithAlpha(color, 0.08 + hash2d(index * 2.7, 1.1) * 0.08);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, streakY + hash2d(index, 1.4) * 2);
    ctx.lineTo(width, streakY + hash2d(index, 4.7) * 2);
    ctx.stroke();
  }

  return canvas;
}

function buildInkTile(color: string, width = DEFAULT_TILE_BASE_WIDTH, height = DEFAULT_TILE_BASE_HEIGHT) {
  const canvas = createTileCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, colorWithAlpha(color, 0.18));
  gradient.addColorStop(0.14, colorWithAlpha(color, 0.94));
  gradient.addColorStop(0.86, colorWithAlpha(color, 0.96));
  gradient.addColorStop(1, colorWithAlpha(color, 0.2));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const edge = Math.abs(y / Math.max(1, height - 1) - 0.5) * 2;
      const grain = 0.9 + (hash2d(x * 0.23, y * 0.47) - 0.5) * 0.24;
      const feather = 1 - Math.max(0, edge - 0.68) / 0.32;
      const alpha = clampUnit((imageData.data[idx + 3] / 255) * grain * feather);
      imageData.data[idx + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function buildChalkTile(color: string, width = DEFAULT_TILE_BASE_WIDTH, height = DEFAULT_TILE_BASE_HEIGHT) {
  const canvas = createTileCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const [baseRed, baseGreen, baseBlue] = Color(color).rgb().array();
  const imageData = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const edge = Math.abs(y / Math.max(1, height - 1) - 0.5) * 2;
      const density = 1 - Math.max(0, edge - 0.6) / 0.4;
      const grain = hash2d(x * 0.59, y * 0.73);
      const voidNoise = hash2d(x * 1.27, y * 1.71);
      let alpha = density * (0.24 + grain * 0.76);
      if (voidNoise < 0.1) {
        alpha *= 0.08;
      } else if (voidNoise < 0.24) {
        alpha *= 0.34;
      }
      const colorNoise = (hash2d(x * 0.31, y * 0.21) - 0.5) * 28;
      imageData.data[idx] = Math.max(0, Math.min(255, Math.round(baseRed + colorNoise)));
      imageData.data[idx + 1] = Math.max(0, Math.min(255, Math.round(baseGreen + colorNoise)));
      imageData.data[idx + 2] = Math.max(0, Math.min(255, Math.round(baseBlue + colorNoise)));
      imageData.data[idx + 3] = Math.max(0, Math.min(255, Math.round(clampUnit(alpha) * 255)));
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function tintTextureSource(
  source: CanvasImageSource,
  color: string,
  width: number,
  height: number,
) {
  const canvas = createTileCanvas(width, height);
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

export function createVectorStrokeBrushStamp(
  brushId: VectorStrokeBrushId | null | undefined,
  strokeColor: string,
  strokeWidth: number,
  textureSource?: CanvasImageSource | null,
): VectorStrokeBrushStamp | null {
  const preset = getVectorStrokeBrushPreset(brushId);
  if (preset.kind === 'solid') {
    return null;
  }

  const baseWidth = DEFAULT_TILE_BASE_WIDTH;
  const baseHeight = Math.max(24, Math.round(baseWidth / Math.max(1, preset.tileAspectRatio)));
  const tintedTexture = textureSource
    ? tintTextureSource(textureSource, strokeColor, baseWidth, baseHeight)
    : preset.id === 'marker'
      ? buildMarkerTile(strokeColor, baseWidth, baseHeight)
      : preset.id === 'ink'
        ? buildInkTile(strokeColor, baseWidth, baseHeight)
        : buildChalkTile(strokeColor, baseWidth, baseHeight);
  const scale = Math.max(0.001, strokeWidth / Math.max(1, tintedTexture.height));
  const scaledWidth = Math.max(1, Math.round(tintedTexture.width * scale));
  const scaledHeight = Math.max(1, Math.round(tintedTexture.height * scale));
  const scaledCanvas = createTileCanvas(scaledWidth, scaledHeight);
  const scaledCtx = scaledCanvas.getContext('2d');
  if (scaledCtx) {
    scaledCtx.imageSmoothingEnabled = true;
    scaledCtx.drawImage(tintedTexture, 0, 0, scaledWidth, scaledHeight);
  }

  return {
    image: scaledCanvas,
    advance: Math.max(1, scaledWidth * preset.advanceRatio),
    opacity: preset.opacity,
    rotationJitter: preset.rotationJitter,
    scaleJitter: preset.scaleJitter,
    scatter: strokeWidth * preset.scatterRatio,
  };
}
