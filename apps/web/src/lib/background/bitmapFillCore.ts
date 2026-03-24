import Color from 'color';

export type BitmapFillTextureId = 'solid' | 'paper' | 'linen' | 'grain' | 'brush';

export interface BitmapFillTextureOption {
  value: BitmapFillTextureId;
  label: string;
}

export interface BitmapFillTexturePreset {
  id: BitmapFillTextureId;
  label: string;
  kind: 'solid' | 'textured';
  texturePath?: string;
  tileSize: number;
  contrast: number;
}

export interface BitmapBucketFillStyle {
  fillColor: string;
  textureId: BitmapFillTextureId;
}

export interface BitmapBucketFillOptions {
  tolerance?: number;
  softTolerance?: number;
  bridgeIterations?: number;
  textureSource?: CanvasImageSource | null;
}

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface PixelBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const DEFAULT_TOLERANCE = 34;
const DEFAULT_SOFT_TOLERANCE = 62;
const DEFAULT_BRIDGE_ITERATIONS = 2;
const DEFAULT_TILE_SIZE = 160;

export const DEFAULT_BITMAP_FILL_TEXTURE_ID: BitmapFillTextureId = 'solid';

export const BITMAP_FILL_TEXTURE_OPTIONS: BitmapFillTextureOption[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'paper', label: 'Paper' },
  { value: 'linen', label: 'Linen' },
  { value: 'grain', label: 'Grain' },
  { value: 'brush', label: 'Brush' },
];

export const BITMAP_FILL_TEXTURE_PRESETS: Record<BitmapFillTextureId, BitmapFillTexturePreset> = {
  solid: {
    id: 'solid',
    label: 'Solid',
    kind: 'solid',
    tileSize: DEFAULT_TILE_SIZE,
    contrast: 0,
  },
  paper: {
    id: 'paper',
    label: 'Paper',
    kind: 'textured',
    tileSize: 176,
    contrast: 0.2,
  },
  linen: {
    id: 'linen',
    label: 'Linen',
    kind: 'textured',
    tileSize: 144,
    contrast: 0.3,
  },
  grain: {
    id: 'grain',
    label: 'Grain',
    kind: 'textured',
    tileSize: 128,
    contrast: 0.4,
  },
  brush: {
    id: 'brush',
    label: 'Brush',
    kind: 'textured',
    tileSize: 192,
    contrast: 0.52,
  },
};

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hash2d(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function lerpNumber(a: number, b: number, t: number) {
  return a + (b - a) * t;
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

function getPixel(data: Uint8ClampedArray, offset: number): RGBA {
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
    a: data[offset + 3],
  };
}

function colorsEqual(a: RGBA, b: RGBA) {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function computeColorDistance(candidate: RGBA, target: RGBA) {
  if (target.a <= 12 && candidate.a >= 96) {
    return 255 + (candidate.a - target.a) * 0.5;
  }

  const rgbDistance = (
    Math.abs(candidate.r - target.r) +
    Math.abs(candidate.g - target.g) +
    Math.abs(candidate.b - target.b)
  ) / 3;
  const alphaDistance = Math.abs(candidate.a - target.a);
  return rgbDistance * 0.58 + alphaDistance * 0.82;
}

function getExpandedBounds(
  bounds: PixelBounds,
  width: number,
  height: number,
  padding: number,
): PixelBounds {
  return {
    left: Math.max(0, bounds.left - padding),
    top: Math.max(0, bounds.top - padding),
    right: Math.min(width - 1, bounds.right + padding),
    bottom: Math.min(height - 1, bounds.bottom + padding),
  };
}

function countFilledNeighbors(mask: Uint8Array, width: number, height: number, x: number, y: number) {
  let orthogonal = 0;
  let diagonal = 0;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    const nextY = y + offsetY;
    if (nextY < 0 || nextY >= height) {
      continue;
    }

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const nextX = x + offsetX;
      if (
        (offsetX === 0 && offsetY === 0) ||
        nextX < 0 ||
        nextX >= width
      ) {
        continue;
      }

      if (!mask[nextY * width + nextX]) {
        continue;
      }

      if (offsetX === 0 || offsetY === 0) {
        orthogonal += 1;
      } else {
        diagonal += 1;
      }
    }
  }

  return { orthogonal, diagonal, total: orthogonal + diagonal };
}

function computeNeighborCoverage(
  coverage: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  let weightedCoverage = 0;
  let totalWeight = 0;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    const nextY = y + offsetY;
    if (nextY < 0 || nextY >= height) {
      continue;
    }

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const nextX = x + offsetX;
      if (
        (offsetX === 0 && offsetY === 0) ||
        nextX < 0 ||
        nextX >= width
      ) {
        continue;
      }

      const weight = offsetX === 0 || offsetY === 0 ? 1 : 0.72;
      weightedCoverage += (coverage[nextY * width + nextX] / 255) * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight <= 0) {
    return 0;
  }

  return weightedCoverage / totalWeight;
}

function buildFloodFillMask(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number,
) {
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  const mask = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);
  const stack: number[] = [startX, startY];
  const target = getPixel(data, (startY * width + startX) * 4);
  let bounds: PixelBounds | null = null;

  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }

    let currentX = x;
    while (currentX >= 0) {
      const scanIndex = y * width + currentX;
      if (visited[scanIndex]) {
        currentX -= 1;
        continue;
      }

      const distance = computeColorDistance(
        getPixel(data, scanIndex * 4),
        target,
      );
      if (distance > tolerance) {
        break;
      }
      currentX -= 1;
    }
    currentX += 1;

    let spanAbove = false;
    let spanBelow = false;

    while (currentX < width) {
      const scanIndex = y * width + currentX;
      if (visited[scanIndex]) {
        currentX += 1;
        continue;
      }

      const distance = computeColorDistance(
        getPixel(data, scanIndex * 4),
        target,
      );
      if (distance > tolerance) {
        break;
      }

      visited[scanIndex] = 1;
      mask[scanIndex] = 1;
      if (!bounds) {
        bounds = { left: currentX, top: y, right: currentX, bottom: y };
      } else {
        bounds.left = Math.min(bounds.left, currentX);
        bounds.top = Math.min(bounds.top, y);
        bounds.right = Math.max(bounds.right, currentX);
        bounds.bottom = Math.max(bounds.bottom, y);
      }

      if (y > 0) {
        const aboveIndex = (y - 1) * width + currentX;
        const aboveMatches = !visited[aboveIndex] && computeColorDistance(
          getPixel(data, aboveIndex * 4),
          target,
        ) <= tolerance;
        if (aboveMatches && !spanAbove) {
          stack.push(currentX, y - 1);
          spanAbove = true;
        } else if (!aboveMatches) {
          spanAbove = false;
        }
      }

      if (y < height - 1) {
        const belowIndex = (y + 1) * width + currentX;
        const belowMatches = !visited[belowIndex] && computeColorDistance(
          getPixel(data, belowIndex * 4),
          target,
        ) <= tolerance;
        if (belowMatches && !spanBelow) {
          stack.push(currentX, y + 1);
          spanBelow = true;
        } else if (!belowMatches) {
          spanBelow = false;
        }
      }

      currentX += 1;
    }
  }

  return {
    mask,
    bounds,
    target,
  };
}

function bridgeMaskEdges(
  imageData: ImageData,
  baseMask: Uint8Array,
  bounds: PixelBounds,
  target: RGBA,
  softTolerance: number,
  iterations: number,
) {
  const { width, height, data } = imageData;
  let mask = baseMask;
  let nextBounds = bounds;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const nextMask = mask.slice();
    const scanBounds = getExpandedBounds(nextBounds, width, height, 1);
    let didChange = false;

    for (let y = scanBounds.top; y <= scanBounds.bottom; y += 1) {
      for (let x = scanBounds.left; x <= scanBounds.right; x += 1) {
        const index = y * width + x;
        if (mask[index]) {
          continue;
        }

        const distance = computeColorDistance(getPixel(data, index * 4), target);
        if (distance > softTolerance) {
          continue;
        }

        const neighbors = countFilledNeighbors(mask, width, height, x, y);
        if (
          neighbors.total >= 6 ||
          (neighbors.orthogonal >= 2 && neighbors.total >= 4) ||
          (distance <= softTolerance * 0.7 && neighbors.orthogonal >= 1 && neighbors.total >= 3)
        ) {
          nextMask[index] = 1;
          didChange = true;
          nextBounds = {
            left: Math.min(nextBounds.left, x),
            top: Math.min(nextBounds.top, y),
            right: Math.max(nextBounds.right, x),
            bottom: Math.max(nextBounds.bottom, y),
          };
        }
      }
    }

    mask = nextMask;
    if (!didChange) {
      break;
    }
  }

  return {
    mask,
    bounds: nextBounds,
  };
}

function buildCoverageMask(
  imageData: ImageData,
  mask: Uint8Array,
  bounds: PixelBounds,
  target: RGBA,
  tolerance: number,
  softTolerance: number,
) {
  const { width, height, data } = imageData;
  const coverage = new Uint8ClampedArray(mask.length);

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      coverage[index] = 255;
    }
  }

  let currentCoverage = coverage;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const nextCoverage = currentCoverage.slice();
    const scanBounds = getExpandedBounds(bounds, width, height, iteration + 1);

    for (let y = scanBounds.top; y <= scanBounds.bottom; y += 1) {
      for (let x = scanBounds.left; x <= scanBounds.right; x += 1) {
        const index = y * width + x;
        if (mask[index] || currentCoverage[index] >= 255) {
          continue;
        }

        const distance = computeColorDistance(getPixel(data, index * 4), target);
        if (distance > softTolerance) {
          continue;
        }

        const neighborCoverage = computeNeighborCoverage(currentCoverage, width, height, x, y);
        if (neighborCoverage < 0.26) {
          continue;
        }

        const similarity = clampUnit(
          1 - Math.max(0, distance - tolerance) / Math.max(1, softTolerance - tolerance),
        );
        const edgeCoverage = clampUnit(
          Math.pow(neighborCoverage, 1.12) * similarity * 0.82,
        );
        if (edgeCoverage <= 0.08) {
          continue;
        }

        nextCoverage[index] = Math.max(nextCoverage[index], Math.round(edgeCoverage * 255));
      }
    }

    currentCoverage = nextCoverage;
  }

  return currentCoverage;
}

function createTexturePalette(fillColor: string, contrast: number) {
  const base = Color(fillColor);
  const dark = base.mix(Color('#000000'), 0.1 + contrast * 0.18).rgb().array();
  const light = base.mix(Color('#ffffff'), 0.04 + contrast * 0.16).rgb().array();
  return { dark, light };
}

function writeModulatedPixel(
  imageData: ImageData,
  offset: number,
  palette: ReturnType<typeof createTexturePalette>,
  modulation: number,
) {
  const mix = clampUnit(modulation);
  imageData.data[offset] = clampByte(lerpNumber(palette.dark[0], palette.light[0], mix));
  imageData.data[offset + 1] = clampByte(lerpNumber(palette.dark[1], palette.light[1], mix));
  imageData.data[offset + 2] = clampByte(lerpNumber(palette.dark[2], palette.light[2], mix));
  imageData.data[offset + 3] = 255;
}

function createTexturedTile(
  fillColor: string,
  preset: BitmapFillTexturePreset,
  resolver: (x: number, y: number, size: number) => number,
) {
  const canvas = createTileCanvas(preset.tileSize);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  const palette = createTexturePalette(fillColor, preset.contrast);
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const modulation = resolver(x, y, canvas.width);
      writeModulatedPixel(imageData, (y * canvas.width + x) * 4, palette, modulation);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function createPaperTextureTile(fillColor: string, preset: BitmapFillTexturePreset) {
  return createTexturedTile(fillColor, preset, (x, y) => {
    const noise = hash2d(x * 0.53, y * 0.71);
    const fiber = hash2d(x * 1.73, y * 0.29);
    const blotch = hash2d(x * 0.11, y * 0.13);
    let modulation = 0.48 + (noise - 0.5) * 0.22;
    if (fiber > 0.92) {
      modulation -= 0.14;
    }
    if (blotch < 0.05) {
      modulation += 0.12;
    }
    return clampUnit(modulation);
  });
}

function createLinenTextureTile(fillColor: string, preset: BitmapFillTexturePreset) {
  return createTexturedTile(fillColor, preset, (x, y, size) => {
    const vertical = 0.5 + 0.5 * Math.sin((x / size) * Math.PI * 2 * 18);
    const horizontal = 0.5 + 0.5 * Math.sin((y / size) * Math.PI * 2 * 18);
    const noise = hash2d(x * 0.91, y * 0.63);
    return clampUnit(0.36 + vertical * 0.18 + horizontal * 0.18 + noise * 0.14);
  });
}

function createGrainTextureTile(fillColor: string, preset: BitmapFillTexturePreset) {
  return createTexturedTile(fillColor, preset, (x, y) => {
    const primary = hash2d(x * 0.91, y * 0.67);
    const secondary = hash2d(x * 1.73, y * 1.21);
    return clampUnit(0.28 + primary * 0.44 + secondary * 0.18);
  });
}

function createBrushTextureTile(fillColor: string, preset: BitmapFillTexturePreset) {
  return createTexturedTile(fillColor, preset, (x, y, size) => {
    const directional = 0.5 + 0.5 * Math.sin((x / size) * Math.PI * 2 * 9 + (y / size) * Math.PI * 2 * 1.6);
    const cross = 0.5 + 0.5 * Math.sin((x / size) * Math.PI * 2 * 2.1 - (y / size) * Math.PI * 2 * 5.2);
    const noise = hash2d(x * 0.73, y * 0.49);
    const voidNoise = hash2d(x * 1.91, y * 0.27);
    let modulation = 0.24 + directional * 0.42 + cross * 0.14 + noise * 0.18;
    if (voidNoise < 0.06) {
      modulation *= 0.58;
    }
    return clampUnit(modulation);
  });
}

function createTextureTileFromSource(
  fillColor: string,
  preset: BitmapFillTexturePreset,
  source: CanvasImageSource,
) {
  const canvas = createTileCanvas(preset.tileSize);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return canvas;
  }

  const sourceWidth = resolveTextureSourceDimension(
    'videoWidth' in source ? source.videoWidth : 'naturalWidth' in source ? source.naturalWidth : 'width' in source ? source.width : preset.tileSize,
    preset.tileSize,
  );
  const sourceHeight = resolveTextureSourceDimension(
    'videoHeight' in source ? source.videoHeight : 'naturalHeight' in source ? source.naturalHeight : 'height' in source ? source.height : preset.tileSize,
    preset.tileSize,
  );

  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  const sampled = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const palette = createTexturePalette(fillColor, preset.contrast);

  for (let offset = 0; offset < sampled.data.length; offset += 4) {
    const alpha = sampled.data[offset + 3] / 255;
    const luminance = (
      sampled.data[offset] * 0.2126 +
      sampled.data[offset + 1] * 0.7152 +
      sampled.data[offset + 2] * 0.0722
    ) / 255;
    const modulation = clampUnit(0.5 + (luminance - 0.5) * (0.9 * alpha + 0.2));
    writeModulatedPixel(sampled, offset, palette, lerpNumber(0.5, modulation, alpha));
  }

  ctx.putImageData(sampled, 0, 0);
  return canvas;
}

function sampleTextureColor(
  textureData: Uint8ClampedArray | null,
  textureWidth: number,
  textureHeight: number,
  x: number,
  y: number,
  fallbackColor: [number, number, number],
): [number, number, number] {
  if (!textureData || textureWidth <= 0 || textureHeight <= 0) {
    return fallbackColor;
  }

  const textureX = ((x % textureWidth) + textureWidth) % textureWidth;
  const textureY = ((y % textureHeight) + textureHeight) % textureHeight;
  const offset = (textureY * textureWidth + textureX) * 4;
  return [
    textureData[offset],
    textureData[offset + 1],
    textureData[offset + 2],
  ];
}

function blendPixel(
  destination: Uint8ClampedArray,
  offset: number,
  sourceColor: [number, number, number],
  sourceAlpha: number,
) {
  const srcAlpha = clampUnit(sourceAlpha);
  if (srcAlpha <= 0) {
    return;
  }

  if (srcAlpha >= 0.999) {
    destination[offset] = sourceColor[0];
    destination[offset + 1] = sourceColor[1];
    destination[offset + 2] = sourceColor[2];
    destination[offset + 3] = 255;
    return;
  }

  const destAlpha = destination[offset + 3] / 255;
  const outAlpha = srcAlpha + destAlpha * (1 - srcAlpha);
  const nextRed = (
    sourceColor[0] * srcAlpha +
    destination[offset] * destAlpha * (1 - srcAlpha)
  ) / Math.max(outAlpha, 0.0001);
  const nextGreen = (
    sourceColor[1] * srcAlpha +
    destination[offset + 1] * destAlpha * (1 - srcAlpha)
  ) / Math.max(outAlpha, 0.0001);
  const nextBlue = (
    sourceColor[2] * srcAlpha +
    destination[offset + 2] * destAlpha * (1 - srcAlpha)
  ) / Math.max(outAlpha, 0.0001);

  destination[offset] = clampByte(nextRed);
  destination[offset + 1] = clampByte(nextGreen);
  destination[offset + 2] = clampByte(nextBlue);
  destination[offset + 3] = clampByte(outAlpha * 255);
}

export function getBitmapFillTexturePreset(textureId: BitmapFillTextureId | null | undefined): BitmapFillTexturePreset {
  return BITMAP_FILL_TEXTURE_PRESETS[textureId ?? DEFAULT_BITMAP_FILL_TEXTURE_ID] ?? BITMAP_FILL_TEXTURE_PRESETS[DEFAULT_BITMAP_FILL_TEXTURE_ID];
}

export function createBitmapFillTextureTile(
  textureId: BitmapFillTextureId | null | undefined,
  fillColor: string,
  textureSource?: CanvasImageSource | null,
): HTMLCanvasElement | null {
  const preset = getBitmapFillTexturePreset(textureId);
  if (preset.kind === 'solid') {
    return null;
  }

  if (textureSource) {
    return createTextureTileFromSource(fillColor, preset, textureSource);
  }
  if (preset.id === 'paper') {
    return createPaperTextureTile(fillColor, preset);
  }
  if (preset.id === 'linen') {
    return createLinenTextureTile(fillColor, preset);
  }
  if (preset.id === 'grain') {
    return createGrainTextureTile(fillColor, preset);
  }
  return createBrushTextureTile(fillColor, preset);
}

export function applyBitmapBucketFill(
  imageData: ImageData,
  startX: number,
  startY: number,
  style: BitmapBucketFillStyle,
  options: BitmapBucketFillOptions = {},
): boolean {
  const { width, height } = imageData;
  const clampedX = Math.max(0, Math.min(width - 1, Math.floor(startX)));
  const clampedY = Math.max(0, Math.min(height - 1, Math.floor(startY)));
  const tolerance = Math.max(0, options.tolerance ?? DEFAULT_TOLERANCE);
  const softTolerance = Math.max(tolerance, options.softTolerance ?? DEFAULT_SOFT_TOLERANCE);
  const bridgeIterations = Math.max(0, options.bridgeIterations ?? DEFAULT_BRIDGE_ITERATIONS);
  const fillColor = Color(style.fillColor).rgb().array().map((value) => clampByte(value)) as [number, number, number];
  const startColor = getPixel(imageData.data, (clampedY * width + clampedX) * 4);

  if (
    style.textureId === DEFAULT_BITMAP_FILL_TEXTURE_ID &&
    startColor.a === 255 &&
    colorsEqual(startColor, {
      r: fillColor[0],
      g: fillColor[1],
      b: fillColor[2],
      a: 255,
    })
  ) {
    return false;
  }

  const baseData = new Uint8ClampedArray(imageData.data);
  const initialMaskResult = buildFloodFillMask(imageData, clampedX, clampedY, tolerance);
  if (!initialMaskResult.bounds) {
    return false;
  }

  const bridgedMaskResult = bridgeMaskEdges(
    imageData,
    initialMaskResult.mask,
    initialMaskResult.bounds,
    initialMaskResult.target,
    softTolerance,
    bridgeIterations,
  );
  const coverage = buildCoverageMask(
    imageData,
    bridgedMaskResult.mask,
    bridgedMaskResult.bounds,
    initialMaskResult.target,
    tolerance,
    softTolerance,
  );

  const textureTile = createBitmapFillTextureTile(
    style.textureId,
    style.fillColor,
    options.textureSource,
  );
  const textureCtx = textureTile?.getContext('2d', { willReadFrequently: true }) ?? null;
  const textureData = textureCtx
    ? textureCtx.getImageData(0, 0, textureTile!.width, textureTile!.height).data
    : null;
  const textureWidth = textureTile?.width ?? 0;
  const textureHeight = textureTile?.height ?? 0;
  const scanBounds = getExpandedBounds(bridgedMaskResult.bounds, width, height, 2);

  imageData.data.set(baseData);

  for (let y = scanBounds.top; y <= scanBounds.bottom; y += 1) {
    for (let x = scanBounds.left; x <= scanBounds.right; x += 1) {
      const index = y * width + x;
      const coverageUnit = coverage[index] / 255;
      if (coverageUnit <= 0) {
        continue;
      }

      const pixelOffset = index * 4;
      const sampledColor = sampleTextureColor(
        textureData,
        textureWidth,
        textureHeight,
        x,
        y,
        fillColor,
      );
      blendPixel(imageData.data, pixelOffset, sampledColor, coverageUnit);
    }
  }

  return true;
}
