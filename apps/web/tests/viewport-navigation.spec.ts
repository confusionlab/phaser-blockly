import { expect, test } from '@playwright/test';
import { clampCameraToWorldRect } from '../src/lib/viewportNavigation';

test.describe('viewport navigation bounds', () => {
  test('keeps a smaller world rect anchored near the viewport center', () => {
    const pixelsPerWorldUnit = 480 / 1024;
    const clamped = clampCameraToWorldRect(
      { x: 2_000, y: -900 },
      { width: 1_200, height: 900 },
      pixelsPerWorldUnit,
      { left: 0, top: 0, width: 1_024, height: 1_024 },
      160,
    );

    expect(clamped.x).toBeCloseTo(853.3333333333);
    expect(clamped.y).toBeCloseTo(170.6666666667);
  });

  test('limits overscroll when the world rect is larger than the viewport', () => {
    const clamped = clampCameraToWorldRect(
      { x: 1_500, y: -100 },
      { width: 800, height: 600 },
      2,
      { left: 0, top: 0, width: 1_024, height: 1_024 },
      160,
    );

    expect(clamped).toEqual({
      x: 904,
      y: 70,
    });
  });

  test('returns the same camera object when no clamp is needed', () => {
    const camera = { x: 512, y: 512 };
    const clamped = clampCameraToWorldRect(
      camera,
      { width: 800, height: 600 },
      2,
      { left: 0, top: 0, width: 1_024, height: 1_024 },
      160,
    );

    expect(clamped).toBe(camera);
  });
});
