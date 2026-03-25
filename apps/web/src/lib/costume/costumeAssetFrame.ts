import type { CostumeAssetFrame, CostumeBounds } from '@/types';

function toRoundedFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function cloneCostumeAssetFrame(
  frame: CostumeAssetFrame | null | undefined,
): CostumeAssetFrame | undefined {
  if (!frame) {
    return undefined;
  }

  return {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    sourceWidth: frame.sourceWidth,
    sourceHeight: frame.sourceHeight,
  };
}

export function areCostumeAssetFramesEqual(
  a: CostumeAssetFrame | null | undefined,
  b: CostumeAssetFrame | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.sourceWidth === b.sourceWidth &&
    a.sourceHeight === b.sourceHeight
  );
}

export function sanitizeCostumeAssetFrame(value: unknown): CostumeAssetFrame | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const maybe = value as Record<string, unknown>;
  const sourceWidth = toRoundedFiniteNumber(maybe.sourceWidth);
  const sourceHeight = toRoundedFiniteNumber(maybe.sourceHeight);
  const x = toRoundedFiniteNumber(maybe.x);
  const y = toRoundedFiniteNumber(maybe.y);
  const width = toRoundedFiniteNumber(maybe.width);
  const height = toRoundedFiniteNumber(maybe.height);

  if (
    sourceWidth === null ||
    sourceHeight === null ||
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }

  const normalizedX = clampNumber(x, 0, Math.max(0, sourceWidth - 1));
  const normalizedY = clampNumber(y, 0, Math.max(0, sourceHeight - 1));
  const normalizedWidth = clampNumber(width, 1, sourceWidth - normalizedX);
  const normalizedHeight = clampNumber(height, 1, sourceHeight - normalizedY);

  if (
    normalizedX === 0 &&
    normalizedY === 0 &&
    normalizedWidth === sourceWidth &&
    normalizedHeight === sourceHeight
  ) {
    return undefined;
  }

  return {
    x: normalizedX,
    y: normalizedY,
    width: normalizedWidth,
    height: normalizedHeight,
    sourceWidth,
    sourceHeight,
  };
}

export function getCostumeAssetFrameSignature(
  frame: CostumeAssetFrame | null | undefined,
): string {
  if (!frame) {
    return 'frame:none';
  }

  return `frame:${frame.x},${frame.y},${frame.width},${frame.height},${frame.sourceWidth},${frame.sourceHeight}`;
}

export function getCostumeAssetCenterOffset(
  frame: CostumeAssetFrame | null | undefined,
): { x: number; y: number } {
  if (!frame) {
    return { x: 0, y: 0 };
  }

  return {
    x: frame.x + (frame.width / 2) - (frame.sourceWidth / 2),
    y: frame.y + (frame.height / 2) - (frame.sourceHeight / 2),
  };
}

export function getCostumeVisibleCenterOffset(
  bounds: CostumeBounds | null | undefined,
  options: {
    assetFrame?: CostumeAssetFrame | null;
    assetWidth?: number;
    assetHeight?: number;
  } = {},
): { x: number; y: number } {
  if (!bounds) {
    return { x: 0, y: 0 };
  }

  const sourceWidth = options.assetFrame?.sourceWidth ?? Math.max(1, Math.round(options.assetWidth ?? bounds.width));
  const sourceHeight = options.assetFrame?.sourceHeight ?? Math.max(1, Math.round(options.assetHeight ?? bounds.height));

  return {
    x: bounds.x + (bounds.width / 2) - (sourceWidth / 2),
    y: bounds.y + (bounds.height / 2) - (sourceHeight / 2),
  };
}

export function getCostumeBoundsInAssetSpace(
  bounds: CostumeBounds | null | undefined,
  frame: CostumeAssetFrame | null | undefined,
): CostumeBounds | null {
  if (!bounds) {
    return null;
  }

  if (!frame) {
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }

  const left = clampNumber(bounds.x - frame.x, 0, frame.width);
  const top = clampNumber(bounds.y - frame.y, 0, frame.height);
  const right = clampNumber(bounds.x + bounds.width - frame.x, 0, frame.width);
  const bottom = clampNumber(bounds.y + bounds.height - frame.y, 0, frame.height);

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}
