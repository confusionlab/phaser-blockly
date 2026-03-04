import { expect, test } from '@playwright/test';
import {
  getChunkRangeForWorldBounds,
  parseChunkKey,
  worldToChunkCoord,
  worldToChunkKey,
} from '../src/lib/background/chunkMath';
import {
  buildTiledBackgroundConfig,
  canCreateChunk,
  evaluateChunkLimits,
} from '../src/lib/background/chunkStore';

test.describe('Background chunk math and limits', () => {
  test('maps world coordinates to chunk coordinates correctly', () => {
    expect(worldToChunkCoord(0, 0, 512)).toEqual({ cx: 0, cy: 0 });
    expect(worldToChunkCoord(511.99, 511.99, 512)).toEqual({ cx: 0, cy: 0 });
    expect(worldToChunkCoord(512, 512, 512)).toEqual({ cx: 1, cy: 1 });
    expect(worldToChunkCoord(-1, -1, 512)).toEqual({ cx: -1, cy: -1 });
    expect(worldToChunkKey(-513, 1024, 512)).toBe('-2,2');
    expect(parseChunkKey('-2,2')).toEqual({ cx: -2, cy: 2 });
  });

  test('computes visible chunk range from world bounds', () => {
    const range = getChunkRangeForWorldBounds(-256, 1024, -256, 1024, 512, 1);
    expect(range).toEqual({
      minCx: -2,
      maxCx: 2,
      minCy: -2,
      maxCy: 2,
    });
  });

  test('applies soft and hard chunk limits', () => {
    const limitsA = evaluateChunkLimits(399, 400, 1200);
    expect(limitsA.softExceeded).toBe(false);
    expect(limitsA.hardExceeded).toBe(false);

    const limitsB = evaluateChunkLimits(400, 400, 1200);
    expect(limitsB.softExceeded).toBe(true);
    expect(limitsB.hardExceeded).toBe(false);

    const limitsC = evaluateChunkLimits(1200, 400, 1200);
    expect(limitsC.softExceeded).toBe(true);
    expect(limitsC.hardExceeded).toBe(true);
    expect(canCreateChunk(1199, 400, 1200)).toBe(true);
    expect(canCreateChunk(1200, 400, 1200)).toBe(false);
  });

  test('builds tiled background config payload', () => {
    const config = buildTiledBackgroundConfig(
      { '0,0': 'data:image/png;base64,aaa' },
      { chunkSize: 512, softChunkLimit: 400, hardChunkLimit: 1200, baseColor: '#112233' },
    );
    expect(config.type).toBe('tiled');
    expect(config.value).toBe('#112233');
    expect(config.chunkSize).toBe(512);
    expect(config.softChunkLimit).toBe(400);
    expect(config.hardChunkLimit).toBe(1200);
    expect(config.chunks).toEqual({ '0,0': 'data:image/png;base64,aaa' });
  });
});
