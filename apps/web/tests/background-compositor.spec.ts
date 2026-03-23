import { expect, test } from '@playwright/test';
import {
  getUserSpaceViewportFromCanvasViewBox,
  getVisibleTiledBackgroundScreenChunks,
} from '../src/lib/background/compositor';
import type { BackgroundConfig } from '../src/types';

test.describe('Background compositor mapping', () => {
  test('converts canvas view boxes into user-space viewports', () => {
    const viewport = getUserSpaceViewportFromCanvasViewBox(
      { minX: 100, minY: 50, width: 800, height: 600 },
      800,
      600,
    );

    expect(viewport).toEqual({
      left: -300,
      right: 500,
      top: 250,
      bottom: -350,
    });
  });

  test('maps adjacent chunks into gap-free screen rectangles', () => {
    const background: BackgroundConfig = {
      type: 'tiled',
      value: '#87CEEB',
      chunkSize: 512,
      chunks: {
        '0,0': 'data:image/png;base64,aaa',
        '1,0': 'data:image/png;base64,bbb',
      },
    };

    const chunks = getVisibleTiledBackgroundScreenChunks(
      background,
      { left: 0, right: 1024, bottom: 0, top: 512 },
      1024,
      512,
      0,
    );

    expect(chunks).toEqual([
      {
        key: '0,0',
        dataUrl: 'data:image/png;base64,aaa',
        x: 0,
        y: 0,
        width: 512,
        height: 512,
      },
      {
        key: '1,0',
        dataUrl: 'data:image/png;base64,bbb',
        x: 512,
        y: 0,
        width: 512,
        height: 512,
      },
    ]);
  });

  test('culls chunks outside the user viewport', () => {
    const background: BackgroundConfig = {
      type: 'tiled',
      value: '#87CEEB',
      chunkSize: 256,
      chunks: {
        '-1,0': 'data:image/png;base64,left',
        '0,0': 'data:image/png;base64,center',
        '1,0': 'data:image/png;base64,right',
      },
    };

    const chunks = getVisibleTiledBackgroundScreenChunks(
      background,
      { left: 0, right: 256, bottom: 0, top: 256 },
      512,
      512,
      0,
    );

    expect(chunks.map((chunk) => chunk.key)).toEqual(['0,0']);
    expect(chunks[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 512,
      height: 512,
    });
  });
});
