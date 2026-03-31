import Color from 'color';

export type BitmapBrushTool = 'brush' | 'eraser';
export type BitmapBrushKind = 'hard-round' | 'airbrush' | 'crayon';

export interface BitmapBrushOption {
  value: BitmapBrushKind;
  label: string;
}

export interface BitmapBrushTextureAssets {
  stampMask?: CanvasImageSource | null;
  texture?: CanvasImageSource | null;
}

export interface BitmapBrushStampDefinition {
  stamp: HTMLCanvasElement;
  spacing: number;
  opacity: number;
  rotationJitter: number;
  scaleJitter: number;
  scatter: number;
  alphaThreshold: number;
}

export interface BrushCursorStyle {
  diameter: number;
  stroke: string;
  fill: string;
  borderWidth: number;
  boxShadow?: string;
}

export const BITMAP_BRUSH_OPTIONS: BitmapBrushOption[] = [
  { value: 'hard-round', label: 'Hard' },
  { value: 'airbrush', label: 'Soft' },
  { value: 'crayon', label: 'Crayon' },
];

function createStampCanvas(size: number) {
  const dimension = Math.max(24, Math.ceil(size * 2.4));
  const canvas = document.createElement('canvas');
  canvas.width = dimension;
  canvas.height = dimension;
  return canvas;
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const t = clampUnit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash2d(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function colorWithAlpha(color: string, alpha: number) {
  return Color(color).alpha(clampUnit(alpha)).rgb().string();
}

function resolveCanvasImageSourceDimension(value: unknown, fallback: number) {
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

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
) {
  const rawSourceWidth = (
    'videoWidth' in source ? source.videoWidth :
      'naturalWidth' in source ? source.naturalWidth :
        'width' in source ? source.width :
          width
  );
  const rawSourceHeight = (
    'videoHeight' in source ? source.videoHeight :
      'naturalHeight' in source ? source.naturalHeight :
        'height' in source ? source.height :
          height
  );
  const sourceWidth = resolveCanvasImageSourceDimension(rawSourceWidth, width);
  const sourceHeight = resolveCanvasImageSourceDimension(rawSourceHeight, height);
  const scale = Math.max(width / Math.max(1, sourceWidth), height / Math.max(1, sourceHeight));
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const left = (width - drawWidth) / 2;
  const top = (height - drawHeight) / 2;
  ctx.drawImage(source, left, top, drawWidth, drawHeight);
}

function buildTexturedStampFromAssets(
  size: number,
  color: string,
  assets?: BitmapBrushTextureAssets,
): HTMLCanvasElement | null {
  if (!assets?.stampMask && !assets?.texture) {
    return null;
  }

  const canvas = createStampCanvas(size);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (assets.texture) {
    const pattern = ctx.createPattern(assets.texture, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      drawImageCover(ctx, assets.texture, canvas.width, canvas.height);
    }
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (assets.stampMask) {
    ctx.globalCompositeOperation = 'destination-in';
    drawImageCover(ctx, assets.stampMask, canvas.width, canvas.height);
  }

  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function createAirbrushStampCanvas(size: number, color: string) {
  const canvas = createStampCanvas(size);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const center = canvas.width / 2;
  const radius = Math.max(6, size * 0.75);
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);
  gradient.addColorStop(0, colorWithAlpha(color, 0.34));
  gradient.addColorStop(0.3, colorWithAlpha(color, 0.2));
  gradient.addColorStop(0.68, colorWithAlpha(color, 0.08));
  gradient.addColorStop(1, colorWithAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

function createProceduralCrayonStampCanvas(size: number, color: string) {
  const canvas = createStampCanvas(size);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const center = canvas.width / 2;
  const radius = Math.max(6, size * 0.58);
  const [baseRed, baseGreen, baseBlue] = Color(color).rgb().array();
  const imageData = ctx.createImageData(canvas.width, canvas.height);

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const nx = (x + 0.5 - center) / radius;
      const ny = (y + 0.5 - center) / radius;
      const distance = Math.sqrt(nx * nx + ny * ny);
      const angle = Math.atan2(ny, nx);
      const edgeNoise = 0.86 + (hash2d(Math.cos(angle) * 11.1, Math.sin(angle) * 13.7) - 0.5) * 0.28;

      if (distance > edgeNoise) {
        continue;
      }

      const edgeFade = 1 - smoothstep(0.72, edgeNoise, distance);
      const grain = 0.42 + hash2d(x * 0.63, y * 0.47) * 0.58;
      const waxStripe = 0.74 + Math.sin(x * 0.42 + y * 0.17) * 0.12;
      const voidNoise = hash2d(x * 1.73, y * 1.29);
      let alpha = edgeFade * grain * waxStripe;

      if (voidNoise < 0.06) {
        alpha *= 0.08;
      } else if (voidNoise < 0.18) {
        alpha *= 0.45;
      }

      const colorNoise = (hash2d(x * 0.37, y * 0.91) - 0.5) * 26;
      const index = (y * canvas.width + x) * 4;
      imageData.data[index] = Math.max(0, Math.min(255, Math.round(baseRed + colorNoise)));
      imageData.data[index + 1] = Math.max(0, Math.min(255, Math.round(baseGreen + colorNoise)));
      imageData.data[index + 2] = Math.max(0, Math.min(255, Math.round(baseBlue + colorNoise)));
      imageData.data[index + 3] = Math.max(0, Math.min(255, Math.round(clampUnit(alpha) * 255)));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function createCrayonStampCanvas(
  size: number,
  color: string,
  assets?: BitmapBrushTextureAssets,
) {
  return buildTexturedStampFromAssets(size, color, assets) ?? createProceduralCrayonStampCanvas(size, color);
}

export function isEraseTool(tool: BitmapBrushTool): boolean {
  return tool === 'eraser';
}

export function getCompositeOperation(tool: BitmapBrushTool): GlobalCompositeOperation {
  return isEraseTool(tool) ? 'destination-out' : 'source-over';
}

export function getBrushPaintColor(tool: BitmapBrushTool, brushColor: string): string {
  return isEraseTool(tool) ? '#000000' : brushColor;
}

export function getBitmapBrushStampDefinition(
  brushKind: Exclude<BitmapBrushKind, 'hard-round'>,
  brushColor: string,
  brushSize: number,
  assets?: BitmapBrushTextureAssets,
): BitmapBrushStampDefinition {
  if (brushKind === 'airbrush') {
    return {
      stamp: createAirbrushStampCanvas(brushSize, brushColor),
      spacing: Math.max(1, brushSize * 0.14),
      opacity: 0.22,
      rotationJitter: 0,
      scaleJitter: 0.08,
      scatter: brushSize * 0.03,
      alphaThreshold: 1,
    };
  }

  return {
    stamp: createCrayonStampCanvas(brushSize, brushColor, assets),
    spacing: Math.max(1, brushSize * 0.18),
    opacity: 0.32,
    rotationJitter: Math.PI * 0.18,
    scaleJitter: 0.16,
    scatter: brushSize * 0.06,
    alphaThreshold: 8,
  };
}

export function getBitmapBrushCursorStyle(
  tool: BitmapBrushTool,
  brushKind: BitmapBrushKind,
  brushColor: string,
  brushSize: number,
  displayScale: number,
  brushOpacity = 1,
): BrushCursorStyle {
  const diameter = Math.max(6, brushSize * displayScale);
  const effectiveOpacity = clampUnit(brushOpacity);
  if (isEraseTool(tool)) {
    return {
      diameter,
      stroke: 'rgba(17,17,17,0.95)',
      fill: 'rgba(255,255,255,0.55)',
      borderWidth: 2,
    };
  }

  if (brushKind === 'airbrush') {
    return {
      diameter,
      stroke: colorWithAlpha(brushColor, 0.8 * effectiveOpacity),
      fill: `radial-gradient(circle, ${colorWithAlpha(brushColor, 0.34 * effectiveOpacity)} 0%, ${colorWithAlpha(brushColor, 0.14 * effectiveOpacity)} 42%, ${colorWithAlpha(brushColor, 0.03 * effectiveOpacity)} 78%, rgba(255,255,255,0) 100%)`,
      borderWidth: 1.25,
      boxShadow: `0 0 ${Math.max(6, diameter * 0.18)}px ${colorWithAlpha(brushColor, 0.16 * effectiveOpacity)}`,
    };
  }

  if (brushKind === 'crayon') {
    return {
      diameter,
      stroke: colorWithAlpha(brushColor, 0.82 * effectiveOpacity),
      fill: `radial-gradient(circle, ${colorWithAlpha(brushColor, 0.18 * effectiveOpacity)} 0%, ${colorWithAlpha(brushColor, 0.07 * effectiveOpacity)} 70%, rgba(255,255,255,0) 100%)`,
      borderWidth: 1.5,
      boxShadow: `0 0 ${Math.max(4, diameter * 0.08)}px ${colorWithAlpha(brushColor, 0.12 * effectiveOpacity)}`,
    };
  }

  return {
    diameter,
    stroke: colorWithAlpha(brushColor, effectiveOpacity),
    fill: 'rgba(255,255,255,0.12)',
    borderWidth: 1.5,
  };
}

export function getBrushCursorStyle(
  tool: BitmapBrushTool,
  brushColor: string,
  brushSize: number,
  displayScale: number,
  brushOpacity = 1,
): BrushCursorStyle {
  return getBitmapBrushCursorStyle(tool, 'hard-round', brushColor, brushSize, displayScale, brushOpacity);
}
