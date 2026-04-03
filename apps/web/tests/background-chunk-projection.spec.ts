import { expect, test } from '@playwright/test';
import { getChunkWorldBounds, projectChunkWorldBoundsToScreenRect } from '../src/lib/background/chunkMath';

test.describe('background chunk projection', () => {
  test('snaps adjacent chunk bounds onto a shared pixel grid without gaps', () => {
    const viewport = {
      left: 0,
      right: 1024,
      bottom: 0,
      top: 1024,
    };

    const first = projectChunkWorldBoundsToScreenRect(
      getChunkWorldBounds(0, 0, 512),
      viewport,
      333,
      333,
    );
    const second = projectChunkWorldBoundsToScreenRect(
      getChunkWorldBounds(1, 0, 512),
      viewport,
      333,
      333,
    );

    expect(first.x).toBe(0);
    expect(first.x + first.width).toBeGreaterThanOrEqual(second.x);
    expect(Math.max(first.x + first.width, second.x + second.width)).toBe(333);
  });
});
