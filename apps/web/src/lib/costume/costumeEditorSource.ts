import type { CostumeEditorSource, ScratchPaintCostumeEditorSource } from '@/types';

function sanitizeRotationCenter(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function sanitizeCostumeEditorSource(value: unknown): CostumeEditorSource | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const maybe = value as Record<string, unknown>;
  if (
    maybe.engine !== 'scratch-paint' ||
    maybe.version !== 1 ||
    maybe.format !== 'svg' ||
    typeof maybe.source !== 'string' ||
    maybe.source.trim().length === 0
  ) {
    return undefined;
  }

  return {
    engine: 'scratch-paint',
    version: 1,
    format: 'svg',
    source: maybe.source,
    rotationCenterX: sanitizeRotationCenter(maybe.rotationCenterX, 0),
    rotationCenterY: sanitizeRotationCenter(maybe.rotationCenterY, 0),
  };
}

export function cloneCostumeEditorSource(
  source: CostumeEditorSource | null | undefined,
): CostumeEditorSource | undefined {
  const sanitized = sanitizeCostumeEditorSource(source);
  return sanitized ? { ...sanitized } : undefined;
}

export function areCostumeEditorSourcesEqual(
  a: CostumeEditorSource | null | undefined,
  b: CostumeEditorSource | null | undefined,
): boolean {
  const left = sanitizeCostumeEditorSource(a);
  const right = sanitizeCostumeEditorSource(b);
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.engine === right.engine &&
    left.version === right.version &&
    left.format === right.format &&
    left.source === right.source &&
    left.rotationCenterX === right.rotationCenterX &&
    left.rotationCenterY === right.rotationCenterY
  );
}

export function createScratchPaintSvgEditorSource(options: {
  source: string;
  rotationCenterX: number;
  rotationCenterY: number;
}): ScratchPaintCostumeEditorSource {
  return {
    engine: 'scratch-paint',
    version: 1,
    format: 'svg',
    source: options.source,
    rotationCenterX: options.rotationCenterX,
    rotationCenterY: options.rotationCenterY,
  };
}
