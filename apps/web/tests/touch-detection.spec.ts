import { expect, test } from '@playwright/test';
import {
  areTouchSurfacesTouching,
  collectPotentialTouchPairs,
  type TouchBounds,
  type TouchSurface,
} from '../src/phaser/touchDetection';

function createBounds(minX: number, maxX: number, minY: number, maxY: number): TouchBounds {
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function createSurface(
  id: string,
  bounds: TouchBounds,
  sampleOpaqueAtWorldPoint: (worldX: number, worldY: number) => boolean,
  hasPixelMask: boolean = true,
): TouchSurface {
  return {
    id,
    bounds,
    hasPixelMask,
    sampleOpaqueAtWorldPoint,
  };
}

test.describe('touch detection', () => {
  test('ignores overlapping transparent pixels', () => {
    const hero = createSurface(
      'hero',
      createBounds(0, 10, 0, 10),
      (worldX, worldY) => worldX >= 0 && worldX < 3 && worldY >= 0 && worldY < 10,
    );
    const enemy = createSurface(
      'enemy',
      createBounds(2, 12, 0, 10),
      (worldX, worldY) => worldX >= 9 && worldX < 12 && worldY >= 0 && worldY < 10,
    );

    expect(areTouchSurfacesTouching(hero, enemy)).toBe(false);
  });

  test('detects overlap once opaque pixels intersect', () => {
    const hero = createSurface(
      'hero',
      createBounds(0, 10, 0, 10),
      (worldX, worldY) => worldX >= 0 && worldX < 6 && worldY >= 0 && worldY < 10,
    );
    const enemy = createSurface(
      'enemy',
      createBounds(4, 14, 0, 10),
      (worldX, worldY) => worldX >= 4 && worldX < 10 && worldY >= 0 && worldY < 10,
    );

    expect(areTouchSurfacesTouching(hero, enemy)).toBe(true);
  });

  test('falls back to bounds overlap when neither surface has a pixel mask', () => {
    const hero = createSurface('hero', createBounds(0, 10, 0, 10), () => true, false);
    const enemy = createSurface('enemy', createBounds(8, 18, 0, 10), () => true, false);
    const farAway = createSurface('far', createBounds(30, 40, 0, 10), () => true, false);

    expect(areTouchSurfacesTouching(hero, enemy)).toBe(true);
    expect(areTouchSurfacesTouching(hero, farAway)).toBe(false);
  });

  test('spatial broad phase only returns nearby candidate pairs', () => {
    const hero = createSurface('hero', createBounds(0, 10, 0, 10), () => true);
    const enemy = createSurface('enemy', createBounds(8, 18, 0, 10), () => true);
    const farAway = createSurface('far', createBounds(500, 510, 500, 510), () => true);

    const pairs = collectPotentialTouchPairs([hero, enemy, farAway], 64).map(([a, b]) => [a.id, b.id]);

    expect(pairs).toEqual([['hero', 'enemy']]);
  });

  test('changing the sampled opaque shape changes touch results without moving bounds', () => {
    let frameMode: 'empty' | 'solid' = 'empty';
    const hero = createSurface(
      'hero',
      createBounds(0, 10, 0, 10),
      (worldX, worldY) => worldX >= 0 && worldX < 10 && worldY >= 0 && worldY < 10,
    );
    const animatedEnemy = createSurface(
      'enemy',
      createBounds(0, 10, 0, 10),
      (worldX, worldY) => {
        if (frameMode === 'empty') {
          return false;
        }
        return worldX >= 4 && worldX < 8 && worldY >= 0 && worldY < 10;
      },
    );

    expect(areTouchSurfacesTouching(hero, animatedEnemy)).toBe(false);

    frameMode = 'solid';

    expect(areTouchSurfacesTouching(hero, animatedEnemy)).toBe(true);
  });
});
