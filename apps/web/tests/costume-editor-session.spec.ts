import { expect, test } from '@playwright/test';
import {
  createBitmapCostumeDocument,
  createBitmapLayer,
  insertCostumeLayerAfterActive,
  setActiveCostumeLayer,
} from '../src/lib/costume/costumeDocument';
import { resolveCostumeEditorPersistedState } from '../src/lib/editor/costumeEditorSession';

test.describe('costume editor session state reconciliation', () => {
  test('merges live active-layer canvas data into the latest working document', () => {
    let document = createBitmapCostumeDocument('data:image/png;base64,BASE_ACTIVE', 'Layer 1');
    const hiddenLayer = createBitmapLayer({
      name: 'Layer 2',
      assetId: 'data:image/png;base64,HIDDEN',
      visible: false,
    });
    document = insertCostumeLayerAfterActive(document, hiddenLayer);
    document = setActiveCostumeLayer(document, document.layers[0]?.id ?? '');

    const workingState = {
      assetId: 'data:image/png;base64,FLATTENED_OLD',
      document,
    };

    const resolved = resolveCostumeEditorPersistedState({
      workingState,
      liveCanvasState: {
        editorMode: 'bitmap',
        dataUrl: 'data:image/png;base64,ACTIVE_EDITED',
      },
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.assetId).toBe('data:image/png;base64,FLATTENED_OLD');
    const activeLayer = resolved?.document.layers[0];
    const preservedHiddenLayer = resolved?.document.layers[1];
    expect(activeLayer?.kind).toBe('bitmap');
    expect(preservedHiddenLayer?.kind).toBe('bitmap');
    if (!activeLayer || activeLayer.kind !== 'bitmap' || !preservedHiddenLayer || preservedHiddenLayer.kind !== 'bitmap') {
      throw new Error('Expected bitmap layers in reconciled costume document.');
    }
    expect(activeLayer.bitmap.assetId).toBe('data:image/png;base64,ACTIVE_EDITED');
    expect(preservedHiddenLayer.bitmap.assetId).toBe('data:image/png;base64,HIDDEN');
    expect(preservedHiddenLayer.visible).toBe(false);
  });

  test('falls back to the costume document when no working snapshot exists', () => {
    const costume = {
      id: 'costume-a',
      name: 'Costume A',
      assetId: 'data:image/png;base64,FLATTENED',
      document: createBitmapCostumeDocument('data:image/png;base64,BASE_ACTIVE', 'Layer 1'),
    };

    const resolved = resolveCostumeEditorPersistedState({
      costume,
      liveCanvasState: {
        editorMode: 'bitmap',
        dataUrl: 'data:image/png;base64,ACTIVE_EDITED',
      },
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.assetId).toBe('data:image/png;base64,FLATTENED');
    expect(resolved?.document.activeLayerId).toBe(costume.document.activeLayerId);
    const activeLayer = resolved?.document.layers[0];
    expect(activeLayer?.kind).toBe('bitmap');
    if (!activeLayer || activeLayer.kind !== 'bitmap') {
      throw new Error('Expected active bitmap layer in reconciled costume document.');
    }
    expect(activeLayer.bitmap.assetId).toBe('data:image/png;base64,ACTIVE_EDITED');
  });
});
