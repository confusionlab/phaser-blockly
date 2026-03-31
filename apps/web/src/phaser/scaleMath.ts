const MIN_SCALE_MAGNITUDE = 0.01;

export function getScaleSign(value: number): number {
  return value < 0 ? -1 : 1;
}

export function clampScaleMagnitude(value: number): number {
  return Math.max(MIN_SCALE_MAGNITUDE, Math.abs(value));
}

export function toggleScaleDirection(value: number): number {
  return -getScaleSign(value) * clampScaleMagnitude(value);
}
