import { expect, test } from '@playwright/test';
import { toggleScaleDirection } from '../src/phaser/scaleMath';

test.describe('scale math', () => {
  test('toggleScaleDirection preserves magnitude while flipping sign', () => {
    expect(toggleScaleDirection(1)).toBe(-1);
    expect(toggleScaleDirection(-1)).toBe(1);
    expect(toggleScaleDirection(1.25)).toBe(-1.25);
    expect(toggleScaleDirection(-1.25)).toBe(1.25);
  });
});
