import { expect, test } from '@playwright/test';
import { projectPhaserCameraWorldPointToScreen } from '../src/lib/phaserCameraProjection';

test.describe('phaser camera projection', () => {
  test('preserves Phaser half-pixel alignment for odd viewport sizes', () => {
    const projected = projectPhaserCameraWorldPointToScreen({
      x: 0,
      y: 0,
      width: 575,
      height: 341,
      scrollX: 0,
      scrollY: 0,
      zoomX: 1,
      zoomY: 1,
      rotation: 0,
    }, {
      x: 0,
      y: 0,
    });

    expect(projected).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  test('includes camera viewport origin, scroll, zoom, and rotation', () => {
    const projected = projectPhaserCameraWorldPointToScreen({
      x: 32,
      y: 18,
      width: 800,
      height: 600,
      scrollX: 120,
      scrollY: 45,
      zoomX: 1.5,
      zoomY: 1.5,
      rotation: Math.PI / 6,
    }, {
      x: 220,
      y: 130,
    });

    expect(projected.x).toBeCloseTo(203.5385682970);
    expect(projected.y).toBeCloseTo(-186.2931928056);
  });
});
