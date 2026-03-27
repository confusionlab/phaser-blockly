import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('costume asset persistence', () => {
  test('saving one bitmap costume layout edit does not churn unrelated asset ids', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const [
        { createBitmapCostumeDocument },
        { createDefaultGameObject, createDefaultProject },
        { createProjectSyncPayload, db, saveProject },
      ] = await Promise.all([
        import('/src/lib/costume/costumeDocument.ts'),
        import('/src/types/index.ts'),
        import('/src/db/database.ts'),
      ]);

      await db.projectRevisions.clear();
      await db.projects.clear();
      await db.assets.clear();
      await db.reusables.clear();

      const createBitmapSource = (fillStyle: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to create costume source canvas.');
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = fillStyle;
        ctx.fillRect(12, 16, 52, 48);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(40, 24, 26, 34);
        return canvas.toDataURL('image/png');
      };

      const createFlattenedPreviewSource = (fillStyle: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to create flattened preview canvas.');
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = fillStyle;
        ctx.fillRect(180, 220, 240, 220);
        return canvas.toDataURL('image/png');
      };

      let project = createDefaultProject('Costume Asset Persistence Fixture');
      const object = createDefaultGameObject('Hero');
      project.scenes[0]!.objects = [object];

      const redSource = createBitmapSource('#ef4444');
      const greenSource = createBitmapSource('#22c55e');
      const blueSource = createBitmapSource('#3b82f6');

      object.costumes = [
        {
          ...object.costumes[0]!,
          name: 'Red',
          assetId: redSource,
          document: createBitmapCostumeDocument(redSource, 'Red Layer'),
        },
        {
          ...object.costumes[0]!,
          id: crypto.randomUUID(),
          name: 'Green',
          assetId: greenSource,
          document: createBitmapCostumeDocument(greenSource, 'Green Layer'),
        },
        {
          ...object.costumes[0]!,
          id: crypto.randomUUID(),
          name: 'Blue',
          assetId: blueSource,
          document: createBitmapCostumeDocument(blueSource, 'Blue Layer'),
        },
      ];
      object.currentCostumeIndex = 0;

      project = await saveProject(project);
      const initialPayload = await createProjectSyncPayload(project);

      const editedProject = structuredClone(project);
      editedProject.updatedAt = new Date(project.updatedAt.getTime() + 1_000);

      const editedCostume = editedProject.scenes[0]!.objects[0]!.costumes[0]!;
      const editedLayer = editedCostume.document.layers[0];
      if (!editedLayer || editedLayer.kind !== 'bitmap') {
        throw new Error('Expected a bitmap costume layer.');
      }

      editedLayer.bitmap.assetFrame = {
        x: 180,
        y: 220,
        width: 240,
        height: 220,
        sourceWidth: 1024,
        sourceHeight: 1024,
      };
      editedCostume.assetId = createFlattenedPreviewSource('#f97316');

      const savedEditedProject = await saveProject(editedProject);
      const editedPayload = await createProjectSyncPayload(savedEditedProject);

      const editedSavedCostume = savedEditedProject.scenes[0]!.objects[0]!.costumes[0]!;
      const editedSavedLayer = editedSavedCostume.document.layers[0];
      if (!editedSavedLayer || editedSavedLayer.kind !== 'bitmap' || !editedSavedLayer.bitmap.persistedAssetId || !editedSavedCostume.persistedAssetId) {
        throw new Error('Expected persisted costume asset metadata.');
      }

      const [persistedLayerRecord, persistedCostumeRecord] = await Promise.all([
        db.assets.get(editedSavedLayer.bitmap.persistedAssetId),
        db.assets.get(editedSavedCostume.persistedAssetId),
      ]);

      const resavedProject = await saveProject(savedEditedProject);
      const resavedPayload = await createProjectSyncPayload(resavedProject);

      const diffAssetIds = (from: string[], to: string[]) => {
        const fromSet = new Set(from);
        const toSet = new Set(to);
        return {
          added: to.filter((assetId) => !fromSet.has(assetId)),
          removed: from.filter((assetId) => !toSet.has(assetId)),
        };
      };

      return {
        initialAssetIds: initialPayload.assetIds,
        editedAssetIds: editedPayload.assetIds,
        resavedAssetIds: resavedPayload.assetIds,
        afterEdit: diffAssetIds(initialPayload.assetIds, editedPayload.assetIds),
        afterResave: diffAssetIds(editedPayload.assetIds, resavedPayload.assetIds),
        persistedLayerMimeType: persistedLayerRecord?.mimeType ?? null,
        persistedCostumeMimeType: persistedCostumeRecord?.mimeType ?? null,
      };
    });

    expect(result.afterEdit.added).toHaveLength(1);
    expect(result.afterEdit.removed.length).toBeLessThanOrEqual(1);
    expect(result.afterEdit.added.length + result.afterEdit.removed.length).toBeLessThanOrEqual(2);
    expect(result.afterResave.added).toEqual([]);
    expect(result.afterResave.removed).toEqual([]);
    expect(result.resavedAssetIds).toEqual(result.editedAssetIds);
    expect(result.persistedLayerMimeType).toBe('image/webp');
    expect(result.persistedCostumeMimeType).toBe('image/webp');
  });

  test('reuses the saved flattened asset when the runtime preview changes but the document signature does not', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const [
        { createBitmapCostumeDocument },
        { createDefaultGameObject, createDefaultProject },
        { renderCostumeDocument },
        { createProjectSyncPayload, db, saveProject },
      ] = await Promise.all([
        import('/src/lib/costume/costumeDocument.ts'),
        import('/src/types/index.ts'),
        import('/src/lib/costume/costumeDocumentRender.ts'),
        import('/src/db/database.ts'),
      ]);

      await db.projectRevisions.clear();
      await db.projects.clear();
      await db.assets.clear();
      await db.reusables.clear();

      const createBitmapSource = (fillStyle: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to create costume source canvas.');
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = fillStyle;
        ctx.fillRect(12, 16, 52, 48);
        return canvas.toDataURL('image/png');
      };

      const project = createDefaultProject('Costume Signature Reuse Fixture');
      const object = createDefaultGameObject('Hero');
      project.scenes[0]!.objects = [object];

      const redSource = createBitmapSource('#ef4444');
      object.costumes = [
        {
          ...object.costumes[0]!,
          name: 'Red',
          assetId: redSource,
          document: createBitmapCostumeDocument(redSource, 'Red Layer'),
        },
      ];

      const savedProject = await saveProject(project);
      const savedCostume = savedProject.scenes[0]!.objects[0]!.costumes[0]!;
      const initialPayload = await createProjectSyncPayload(savedProject);

      const transientProject = structuredClone(savedProject);
      transientProject.updatedAt = new Date(savedProject.updatedAt.getTime() + 1_000);
      const transientCostume = transientProject.scenes[0]!.objects[0]!.costumes[0]!;
      transientCostume.assetId = (await renderCostumeDocument(transientCostume.document)).dataUrl;

      const resavedProject = await saveProject(transientProject);
      const resavedCostume = resavedProject.scenes[0]!.objects[0]!.costumes[0]!;
      const resavedPayload = await createProjectSyncPayload(resavedProject);

      return {
        initialAssetIds: initialPayload.assetIds,
        resavedAssetIds: resavedPayload.assetIds,
        initialPersistedAssetId: savedCostume.persistedAssetId ?? null,
        resavedPersistedAssetId: resavedCostume.persistedAssetId ?? null,
        initialRenderSignature: savedCostume.renderSignature ?? null,
        resavedRenderSignature: resavedCostume.renderSignature ?? null,
      };
    });

    expect(result.resavedAssetIds).toEqual(result.initialAssetIds);
    expect(result.resavedPersistedAssetId).toBe(result.initialPersistedAssetId);
    expect(result.resavedRenderSignature).toBe(result.initialRenderSignature);
  });
});
