import { expect, test } from '@playwright/test';
import {
  applyCanvasStateToAnimatedCostumeClip,
  applyCanvasStateToCostumeDocument,
  cloneAnimatedCostumeCel,
  cloneAnimatedCostumeClip,
  createAnimatedCostumeClipFromDocument,
  createBlankCostumeDocument,
  createBitmapCostumeDocument,
  createBitmapLayer,
  createEmptyCostumeVectorDocument,
  createVectorLayer,
  insertCostumeLayerAfterActive,
  pasteAnimatedCostumeTrackCel,
  resolveActiveCostumeLayerEditorLoadState,
  setActiveCostumeLayer,
  setCostumeLayerVisibility,
  updateAnimatedCostumeTrackCelSpan,
} from '../src/lib/costume/costumeDocument';
import { getCostumeDocumentPreviewSignature } from '../src/lib/costume/costumeDocumentRender';

test.describe('costume document visibility', () => {
  test('keeps the active layer selected when hiding the active layer', () => {
    let document = createBlankCostumeDocument();
    const middleLayer = createBitmapLayer({ name: 'Layer 2' });
    const topLayer = createVectorLayer({ name: 'Layer 3' });

    document = insertCostumeLayerAfterActive(document, middleLayer);
    document = insertCostumeLayerAfterActive(document, topLayer);
    document = setActiveCostumeLayer(document, middleLayer.id);

    const nextDocument = setCostumeLayerVisibility(document, middleLayer.id, false);
    expect(nextDocument).not.toBeNull();
    expect(nextDocument?.layers.find((layer) => layer.id === middleLayer.id)?.visible).toBe(false);
    expect(nextDocument?.activeLayerId).toBe(middleLayer.id);
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

  test('keeps the current active layer when revealing another layer while active is hidden', () => {
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
    expect(nextDocument?.activeLayerId).toBe(firstLayer.id);
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

  test('resolves active bitmap editor load state from the document only', () => {
    const document = createBlankCostumeDocument();
    const bitmapLayer = createBitmapLayer({
      name: 'Bitmap Layer',
      assetId: 'data:image/png;base64,ACTIVE_BITMAP',
    });
    const withBitmap = setActiveCostumeLayer(
      insertCostumeLayerAfterActive(document, bitmapLayer),
      bitmapLayer.id,
    );

    const loadState = resolveActiveCostumeLayerEditorLoadState(withBitmap);
    expect(loadState.activeLayerId).toBe(bitmapLayer.id);
    expect(loadState.editorMode).toBe('bitmap');
    expect(loadState.bitmapAssetId).toBe('data:image/png;base64,ACTIVE_BITMAP');
    expect(loadState.vectorDocument).toBeNull();
  });

  test('resolves missing documents to an empty vector editor state', () => {
    const loadState = resolveActiveCostumeLayerEditorLoadState(null);
    expect(loadState.activeLayerId).toBeNull();
    expect(loadState.editorMode).toBe('vector');
    expect(loadState.bitmapAssetId).toBeNull();
    expect(loadState.vectorDocument).toEqual(createEmptyCostumeVectorDocument());
  });

  test('keeps the same preview signature when only the active layer selection changes', () => {
    let document = createBlankCostumeDocument();
    const secondLayer = createBitmapLayer({
      name: 'Layer 2',
      assetId: 'data:image/png;base64,LAYER_2',
    });

    document = insertCostumeLayerAfterActive(document, secondLayer);
    const baseSignature = getCostumeDocumentPreviewSignature(document);
    const switchedDocument = setActiveCostumeLayer(document, secondLayer.id);

    expect(getCostumeDocumentPreviewSignature(switchedDocument)).toBe(baseSignature);
  });

  test('changes the preview signature when a visible layer presentation changes', () => {
    let document = createBlankCostumeDocument();
    const secondLayer = createBitmapLayer({
      name: 'Layer 2',
      assetId: 'data:image/png;base64,LAYER_2',
    });

    document = insertCostumeLayerAfterActive(document, secondLayer);
    const baseSignature = getCostumeDocumentPreviewSignature(document);
    const hiddenDocument = setCostumeLayerVisibility(document, secondLayer.id, false);

    expect(hiddenDocument).not.toBeNull();
    expect(getCostumeDocumentPreviewSignature(hiddenDocument!)).not.toBe(baseSignature);
  });

  test('preserves trimmed bitmap asset frames when applying canvas state', () => {
    const document = createBlankCostumeDocument();
    const bitmapLayer = createBitmapLayer({
      name: 'Bitmap Layer',
      assetId: 'data:image/png;base64,ORIGINAL',
    });
    const withBitmap = setActiveCostumeLayer(
      insertCostumeLayerAfterActive(document, bitmapLayer),
      bitmapLayer.id,
    );

    const nextDocument = applyCanvasStateToCostumeDocument(withBitmap, {
      editorMode: 'bitmap',
      dataUrl: 'data:image/png;base64,UPDATED',
      bitmapAssetFrame: {
        x: 128,
        y: 256,
        width: 320,
        height: 240,
      },
    });

    const activeLayer = nextDocument.layers.find((layer) => layer.id === bitmapLayer.id);
    expect(activeLayer?.kind).toBe('bitmap');
    expect(activeLayer?.bitmap.assetId).toBe('data:image/png;base64,UPDATED');
    expect(activeLayer?.bitmap.assetFrame).toEqual({
      x: 128,
      y: 256,
      width: 320,
      height: 240,
    });
  });

  test('editing a bitmap animated cel rewrites the full cel in place', () => {
    const document = createBitmapCostumeDocument('data:image/png;base64,ORIGINAL');
    const clip = createAnimatedCostumeClipFromDocument(document, { totalFrames: 6 });

    const nextClip = applyCanvasStateToAnimatedCostumeClip(clip, 2, {
      editorMode: 'bitmap',
      dataUrl: 'data:image/png;base64,UPDATED',
    });

    expect(nextClip).not.toBeNull();
    expect(nextClip?.tracks).toHaveLength(1);
    expect(nextClip?.tracks[0]?.cels).toHaveLength(1);
    expect(nextClip?.tracks[0]?.cels[0]).toMatchObject({
      startFrame: 0,
      durationFrames: 6,
      kind: 'bitmap',
      bitmap: {
        assetId: 'data:image/png;base64,UPDATED',
      },
    });
  });

  test('editing a vector animated cel rewrites the full cel in place', () => {
    const document = createBlankCostumeDocument();
    const clip = createAnimatedCostumeClipFromDocument(document, { totalFrames: 6 });

    const nextClip = applyCanvasStateToAnimatedCostumeClip(clip, 3, {
      editorMode: 'vector',
      dataUrl: 'ignored-for-vector',
      vectorDocument: {
        engine: 'fabric',
        version: 1,
        fabricJson: '{"version":"7.0.0","objects":[{"type":"circle","radius":24}]}',
      },
    });

    expect(nextClip).not.toBeNull();
    expect(nextClip?.tracks).toHaveLength(1);
    expect(nextClip?.tracks[0]?.cels).toHaveLength(1);
    expect(nextClip?.tracks[0]?.cels[0]).toMatchObject({
      startFrame: 0,
      durationFrames: 6,
      kind: 'vector',
      vector: {
        engine: 'fabric',
        version: 1,
        fabricJson: '{"version":"7.0.0","objects":[{"type":"circle","radius":24}]}',
      },
    });
  });

  test('pastes a cel into an empty same-kind track and preserves duration when space allows', () => {
    let document = createBitmapCostumeDocument('data:image/png;base64,SOURCE');
    const targetLayer = createBitmapLayer({
      name: 'Target',
      assetId: 'data:image/png;base64,TARGET',
    });
    document = insertCostumeLayerAfterActive(document, targetLayer);

    let clip = createAnimatedCostumeClipFromDocument(document, { totalFrames: 6 });
    const sourceTrack = clip.tracks[0];
    const targetTrack = clip.tracks[1];
    clip = updateAnimatedCostumeTrackCelSpan(clip, targetTrack.id, targetTrack.cels[0].id, 0, 2) ?? clip;

    const nextClip = pasteAnimatedCostumeTrackCel(clip, targetTrack.id, 2, sourceTrack.cels[0]);
    expect(nextClip).not.toBeNull();
    expect(nextClip?.tracks[1]?.cels).toHaveLength(2);
    expect(nextClip?.tracks[1]?.cels[1]).toMatchObject({
      startFrame: 2,
      durationFrames: 4,
      kind: 'bitmap',
      bitmap: {
        assetId: 'data:image/png;base64,SOURCE',
      },
    });
  });

  test('truncates pasted cel duration to fit before the next cel', () => {
    let document = createBitmapCostumeDocument('data:image/png;base64,SOURCE');
    const targetLayer = createBitmapLayer({
      name: 'Target',
      assetId: 'data:image/png;base64,TARGET',
    });
    document = insertCostumeLayerAfterActive(document, targetLayer);

    let clip = createAnimatedCostumeClipFromDocument(document, { totalFrames: 6 });
    const sourceTrack = clip.tracks[0];
    const targetTrackId = clip.tracks[1].id;
    clip = updateAnimatedCostumeTrackCelSpan(clip, targetTrackId, clip.tracks[1].cels[0].id, 0, 2) ?? clip;

    const setupClip = cloneAnimatedCostumeClip(clip);
    const setupTrack = setupClip.tracks[1];
    const trailingCel = cloneAnimatedCostumeCel(setupTrack.cels[0]);
    trailingCel.id = crypto.randomUUID();
    trailingCel.startFrame = 5;
    trailingCel.durationFrames = 1;
    setupTrack.cels.push(trailingCel as typeof setupTrack.cels[number]);
    setupTrack.cels.sort((left, right) => left.startFrame - right.startFrame);

    const nextClip = pasteAnimatedCostumeTrackCel(setupClip, targetTrackId, 2, sourceTrack.cels[0]);
    expect(nextClip).not.toBeNull();
    expect(nextClip?.tracks[1]?.cels[1]).toMatchObject({
      startFrame: 2,
      durationFrames: 3,
    });
  });

  test('rejects paste into occupied frames or across mismatched track kinds', () => {
    const bitmapClip = createAnimatedCostumeClipFromDocument(
      createBitmapCostumeDocument('data:image/png;base64,SOURCE'),
      { totalFrames: 6 },
    );

    const occupiedPaste = pasteAnimatedCostumeTrackCel(
      bitmapClip,
      bitmapClip.tracks[0].id,
      1,
      bitmapClip.tracks[0].cels[0],
    );
    expect(occupiedPaste).toBeNull();

    const vectorClip = createAnimatedCostumeClipFromDocument(createBlankCostumeDocument(), { totalFrames: 6 });
    const mismatchedPaste = pasteAnimatedCostumeTrackCel(
      vectorClip,
      vectorClip.tracks[0].id,
      1,
      bitmapClip.tracks[0].cels[0],
    );
    expect(mismatchedPaste).toBeNull();
  });
});
