import { expect, test } from '@playwright/test';

test.describe('library editor source preservation', () => {
  test('costume library preserves Scratch Paint source metadata', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const summary = await page.evaluate(async () => {
      const [
        { CURRENT_SCHEMA_VERSION },
        { createBitmapCostumeDocument, createStaticCostumeFromDocument },
        { prepareCostumeLibraryCreatePayload, hydrateCostumeLibraryItemForInsertion },
        { createScratchPaintSvgEditorSource },
      ] = await Promise.all([
        import('/src/db/database.ts'),
        import('/src/lib/costume/costumeDocument.ts'),
        import('/src/lib/costumeLibrary/costumeLibraryAssets.ts'),
        import('/src/lib/costume/costumeEditorSource.ts'),
      ]);

      const bitmap = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0s0AAAAASUVORK5CYII=';
      const source = createScratchPaintSvgEditorSource({
        source: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
        rotationCenterX: 7,
        rotationCenterY: 8,
      });
      const costume = createStaticCostumeFromDocument({
        id: 'scratch-costume',
        name: 'Scratch Costume',
        assetId: bitmap,
        document: createBitmapCostumeDocument(bitmap, 'Layer 1'),
        editorSource: source,
      });

      const prepared = await prepareCostumeLibraryCreatePayload(costume);
      const hydrated = await hydrateCostumeLibraryItemForInsertion({
        ...prepared.payload,
        assetRefs: prepared.assetRefs.map((asset) => ({ ...asset, url: null })),
        imageUrl: null,
        scope: 'user',
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });

      return {
        payloadEngine: prepared.payload.editorSource?.engine ?? null,
        hydratedEngine: hydrated.editorSource?.engine ?? null,
        hydratedSource: hydrated.editorSource?.source ?? null,
        hydratedCenterX: hydrated.editorSource?.rotationCenterX ?? null,
        hydratedCenterY: hydrated.editorSource?.rotationCenterY ?? null,
      };
    });

    expect(summary).toEqual({
      payloadEngine: 'scratch-paint',
      hydratedEngine: 'scratch-paint',
      hydratedSource: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
      hydratedCenterX: 7,
      hydratedCenterY: 8,
    });
  });

  test('object library preserves Scratch Paint source metadata on costumes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const summary = await page.evaluate(async () => {
      const [
        { CURRENT_SCHEMA_VERSION },
        { createBitmapCostumeDocument, createStaticCostumeFromDocument },
        { prepareObjectLibraryCreatePayload, hydrateObjectLibraryItemForInsertion },
        { createScratchPaintSvgEditorSource },
      ] = await Promise.all([
        import('/src/db/database.ts'),
        import('/src/lib/costume/costumeDocument.ts'),
        import('/src/lib/objectLibrary/objectLibraryAssets.ts'),
        import('/src/lib/costume/costumeEditorSource.ts'),
      ]);

      const bitmap = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0s0AAAAASUVORK5CYII=';
      const source = createScratchPaintSvgEditorSource({
        source: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>',
        rotationCenterX: 12,
        rotationCenterY: 13,
      });
      const costume = createStaticCostumeFromDocument({
        id: 'scratch-costume',
        name: 'Scratch Costume',
        assetId: bitmap,
        document: createBitmapCostumeDocument(bitmap, 'Layer 1'),
        editorSource: source,
      });

      const prepared = await prepareObjectLibraryCreatePayload({
        name: 'Scratch Object',
        costumes: [costume],
        sounds: [],
        blocklyXml: '',
        currentCostumeIndex: 0,
        physics: null,
        collider: null,
        localVariables: [],
      });
      const hydrated = await hydrateObjectLibraryItemForInsertion({
        ...prepared.payload,
        assetRefs: prepared.assetRefs.map((asset) => ({ ...asset, url: null })),
        scope: 'user',
        schemaVersion: CURRENT_SCHEMA_VERSION,
      });
      const hydratedCostume = hydrated.costumes[0];

      return {
        payloadEngine: prepared.payload.costumes[0]?.editorSource?.engine ?? null,
        hydratedEngine: hydratedCostume?.kind === 'static' ? hydratedCostume.editorSource?.engine ?? null : null,
        hydratedSource: hydratedCostume?.kind === 'static' ? hydratedCostume.editorSource?.source ?? null : null,
        hydratedCenterX: hydratedCostume?.kind === 'static' ? hydratedCostume.editorSource?.rotationCenterX ?? null : null,
        hydratedCenterY: hydratedCostume?.kind === 'static' ? hydratedCostume.editorSource?.rotationCenterY ?? null : null,
      };
    });

    expect(summary).toEqual({
      payloadEngine: 'scratch-paint',
      hydratedEngine: 'scratch-paint',
      hydratedSource: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>',
      hydratedCenterX: 12,
      hydratedCenterY: 13,
    });
  });
});
