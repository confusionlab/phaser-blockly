import { expect, test } from '@playwright/test';
import { clearCostumeRuntimePreview, getCostumeRuntimePreview } from '../src/store/costumeRuntimePreviewStore';
import { publishCostumeRuntimePreviewFromCanvas } from '../src/lib/editor/costumeRuntimePreview';
import type { CostumeEditorSession } from '../src/lib/editor/costumeEditorSession';

const session: CostumeEditorSession = {
  sceneId: 'scene-1',
  objectId: 'object-1',
  costumeId: 'costume-1',
  key: 'scene-1:object-1:costume-1',
};

test.afterEach(() => {
  clearCostumeRuntimePreview(session);
});

test.describe('costume runtime preview publication', () => {
  test('publishes the direct bitmap preview for state-only commits', () => {
    const directCanvas = { tag: 'direct' } as unknown as HTMLCanvasElement;
    const composedCanvas = { tag: 'composed' } as unknown as HTMLCanvasElement;
    const calls: string[] = [];

    const didPublish = publishCostumeRuntimePreviewFromCanvas({
      canvasSource: {
        getDirectBitmapPreviewCanvas: (sessionKey) => {
          calls.push(`direct:${sessionKey ?? ''}`);
          return directCanvas;
        },
        getComposedPreviewCanvas: (sessionKey) => {
          calls.push(`composed:${sessionKey ?? ''}`);
          return composedCanvas;
        },
      },
      liveCanvasState: {
        editorMode: 'bitmap',
        dataUrl: 'data:image/png;base64,DIRECT',
        bitmapAssetFrame: {
          x: 10,
          y: 12,
          width: 40,
          height: 44,
          sourceWidth: 64,
          sourceHeight: 64,
        },
        bitmapBounds: {
          x: 4,
          y: 6,
          width: 30,
          height: 28,
        },
      },
      revision: 7,
      session,
      syncMode: 'stateOnly',
    });

    expect(didPublish).toBe(true);
    expect(calls).toEqual([`direct:${session.key}`]);
    expect(getCostumeRuntimePreview(session)).toEqual({
      sceneId: session.sceneId,
      objectId: session.objectId,
      costumeId: session.costumeId,
      revision: 7,
      sourceCanvas: directCanvas,
      assetFrame: {
        x: 10,
        y: 12,
        width: 40,
        height: 44,
        sourceWidth: 64,
        sourceHeight: 64,
      },
      bounds: {
        x: 4,
        y: 6,
        width: 30,
        height: 28,
      },
    });
  });

  test('publishes the composed preview for render commits', () => {
    const composedCanvas = { tag: 'composed' } as unknown as HTMLCanvasElement;
    const calls: string[] = [];
    const resolvedBounds = {
      x: 100,
      y: 120,
      width: 260,
      height: 240,
    };

    const didPublish = publishCostumeRuntimePreviewFromCanvas({
      canvasSource: {
        getDirectBitmapPreviewCanvas: (sessionKey) => {
          calls.push(`direct:${sessionKey ?? ''}`);
          return null;
        },
        getComposedPreviewCanvas: (sessionKey) => {
          calls.push(`composed:${sessionKey ?? ''}`);
          return composedCanvas;
        },
      },
      liveCanvasState: {
        editorMode: 'vector',
        dataUrl: 'data:image/png;base64:IGNORED',
      },
      resolveComposedBounds: (canvas) => {
        expect(canvas).toBe(composedCanvas);
        return resolvedBounds;
      },
      revision: 9,
      session,
      syncMode: 'render',
    });

    expect(didPublish).toBe(true);
    expect(calls).toEqual([`composed:${session.key}`]);
    expect(getCostumeRuntimePreview(session)).toEqual({
      sceneId: session.sceneId,
      objectId: session.objectId,
      costumeId: session.costumeId,
      revision: 9,
      sourceCanvas: composedCanvas,
      assetFrame: null,
      bounds: resolvedBounds,
    });
  });

  test('returns false and leaves the store untouched when no preview canvas is available', () => {
    const didPublish = publishCostumeRuntimePreviewFromCanvas({
      canvasSource: {
        getDirectBitmapPreviewCanvas: () => null,
        getComposedPreviewCanvas: () => null,
      },
      liveCanvasState: {
        editorMode: 'bitmap',
        dataUrl: 'data:image/png;base64,EMPTY',
      },
      revision: 3,
      session,
      syncMode: 'stateOnly',
    });

    expect(didPublish).toBe(false);
    expect(getCostumeRuntimePreview(session)).toBeNull();
  });
});
