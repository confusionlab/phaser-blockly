import { expect, test } from '@playwright/test';
import {
  createBlankCostumeDocument,
  createBitmapLayer,
  createVectorLayer,
  insertCostumeLayerAfterActive,
  setActiveCostumeLayer,
  setCostumeLayerVisibility,
} from '../src/lib/costume/costumeDocument';

test.describe('costume document visibility', () => {
  test('clears the active layer selection when hiding the active layer', () => {
    let document = createBlankCostumeDocument();
    const middleLayer = createBitmapLayer({ name: 'Layer 2' });
    const topLayer = createVectorLayer({ name: 'Layer 3' });

    document = insertCostumeLayerAfterActive(document, middleLayer);
    document = insertCostumeLayerAfterActive(document, topLayer);
    document = setActiveCostumeLayer(document, middleLayer.id);

    const nextDocument = setCostumeLayerVisibility(document, middleLayer.id, false);
    expect(nextDocument).not.toBeNull();
    expect(nextDocument?.layers.find((layer) => layer.id === middleLayer.id)?.visible).toBe(false);
    expect(nextDocument?.activeLayerId).toBeNull();
  });

  test('keeps the active layer when toggling another layer visibility', () => {
    let document = createBlankCostumeDocument();
    const activeLayer = document.layers[0];
    const otherLayer = createBitmapLayer({ name: 'Layer 2' });
    document = insertCostumeLayerAfterActive(document, otherLayer);
    document = setActiveCostumeLayer(document, activeLayer.id);

    const nextDocument = setCostumeLayerVisibility(document, otherLayer.id, false);
    expect(nextDocument).not.toBeNull();
    expect(nextDocument?.activeLayerId).toBe(activeLayer.id);
  });

  test('keeps no selected layer when revealing another layer while the hidden active layer is deselected', () => {
    let document = createBlankCostumeDocument();
    const firstLayer = document.layers[0];
    const secondLayer = createBitmapLayer({ name: 'Layer 2', visible: false });
    document = insertCostumeLayerAfterActive(document, secondLayer);
    document = setActiveCostumeLayer(document, firstLayer.id);

    document = setCostumeLayerVisibility(document, firstLayer.id, false) ?? document;
    expect(document.layers.every((layer) => layer.visible === false)).toBe(true);
    expect(document.activeLayerId).toBeNull();

    const nextDocument = setCostumeLayerVisibility(document, secondLayer.id, true);
    expect(nextDocument).not.toBeNull();
    expect(nextDocument?.activeLayerId).toBeNull();
    expect(nextDocument?.layers.find((layer) => layer.id === secondLayer.id)?.visible).toBe(true);
  });

  test('allows hiding the last visible layer and leaves no selected layer', () => {
    const document = createBlankCostumeDocument();
    const activeLayer = document.layers[0];

    const nextDocument = setCostumeLayerVisibility(document, activeLayer.id, false);
    expect(nextDocument).not.toBeNull();
    expect(nextDocument?.activeLayerId).toBeNull();
    expect(nextDocument?.layers[0]?.visible).toBe(false);
  });
});
