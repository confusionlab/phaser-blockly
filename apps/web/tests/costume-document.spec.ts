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
  test('moves the active layer to a visible neighbor when hiding the active layer', () => {
    let document = createBlankCostumeDocument();
    const bottomLayer = document.layers[0];
    const middleLayer = createBitmapLayer({ name: 'Layer 2' });
    const topLayer = createVectorLayer({ name: 'Layer 3' });

    document = insertCostumeLayerAfterActive(document, middleLayer);
    document = insertCostumeLayerAfterActive(document, topLayer);
    document = setActiveCostumeLayer(document, middleLayer.id);

    const nextDocument = setCostumeLayerVisibility(document, middleLayer.id, false);
    expect(nextDocument).not.toBeNull();
    expect(nextDocument?.layers.find((layer) => layer.id === middleLayer.id)?.visible).toBe(false);
    expect(nextDocument?.activeLayerId).toBe(bottomLayer.id);
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

  test('promotes a newly visible layer when the current active layer is hidden', () => {
    let document = createBlankCostumeDocument();
    const firstLayer = document.layers[0];
    const secondLayer = createBitmapLayer({ name: 'Layer 2', visible: false });
    document = insertCostumeLayerAfterActive(document, secondLayer);
    document = setActiveCostumeLayer(document, firstLayer.id);

    document = setCostumeLayerVisibility(document, firstLayer.id, false) ?? document;
    expect(document.layers.every((layer) => layer.visible === false)).toBe(true);
    expect(document.activeLayerId).toBe(firstLayer.id);

    const nextDocument = setCostumeLayerVisibility(document, secondLayer.id, true);
    expect(nextDocument).not.toBeNull();
    expect(nextDocument?.activeLayerId).toBe(secondLayer.id);
    expect(nextDocument?.layers.find((layer) => layer.id === secondLayer.id)?.visible).toBe(true);
  });

  test('allows hiding the last visible layer without changing the active layer id', () => {
    const document = createBlankCostumeDocument();
    const activeLayer = document.layers[0];

    const nextDocument = setCostumeLayerVisibility(document, activeLayer.id, false);
    expect(nextDocument).not.toBeNull();
    expect(nextDocument?.activeLayerId).toBe(activeLayer.id);
    expect(nextDocument?.layers[0]?.visible).toBe(false);
  });
});
