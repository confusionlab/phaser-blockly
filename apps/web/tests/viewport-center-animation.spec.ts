import { expect, test } from '@playwright/test';
import {
  easeOutViewportCenterProgress,
  interpolateViewportCenter,
} from '../src/lib/editor/viewportCenterAnimation';

test.describe('viewport center animation', () => {
  test('uses an ease-out curve clamped to the unit interval', () => {
    expect(easeOutViewportCenterProgress(-1)).toBe(0);
    expect(easeOutViewportCenterProgress(0)).toBe(0);
    expect(easeOutViewportCenterProgress(0.5)).toBeCloseTo(0.875, 8);
    expect(easeOutViewportCenterProgress(1)).toBe(1);
    expect(easeOutViewportCenterProgress(2)).toBe(1);
  });

  test('interpolates between viewport centers with easing applied', () => {
    expect(interpolateViewportCenter(
      { x: 100, y: -50 },
      { x: 300, y: 150 },
      0,
    )).toEqual({ x: 100, y: -50 });

    expect(interpolateViewportCenter(
      { x: 100, y: -50 },
      { x: 300, y: 150 },
      0.5,
    )).toEqual({
      x: 275,
      y: 125,
    });

    expect(interpolateViewportCenter(
      { x: 100, y: -50 },
      { x: 300, y: 150 },
      1,
    )).toEqual({ x: 300, y: 150 });
  });
});
