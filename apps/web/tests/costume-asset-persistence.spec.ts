import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('costume asset persistence', () => {
  test('saving one bitmap costume layout edit does not persist derived flattened preview assets', async ({ page }) => {
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
      const editedRecord = await db.projects.get(savedEditedProject.id);

      const editedSavedCostume = savedEditedProject.scenes[0]!.objects[0]!.costumes[0]!;
      const editedSavedLayer = editedSavedCostume.document.layers[0];
      if (!editedSavedLayer || editedSavedLayer.kind !== 'bitmap' || !editedSavedLayer.bitmap.persistedAssetId) {
        throw new Error('Expected persisted bitmap layer asset metadata.');
      }

      if (!editedRecord) {
        throw new Error('Expected edited project record.');
      }

      const storedEditedData = JSON.parse(editedRecord.data);
      const storedEditedCostume = storedEditedData.scenes[0].objects[0].costumes[0];
      const storedEditedLayer = storedEditedCostume.document.layers[0];

      const persistedLayerRecord = await db.assets.get(editedSavedLayer.bitmap.persistedAssetId);

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
        editedRuntimeAssetId: editedSavedCostume.assetId,
        persistedLayerMimeType: persistedLayerRecord?.mimeType ?? null,
        storedCostumeHasAssetId: Object.prototype.hasOwnProperty.call(storedEditedCostume, 'assetId'),
        storedCostumeHasBounds: Object.prototype.hasOwnProperty.call(storedEditedCostume, 'bounds'),
        storedCostumeHasAssetFrame: Object.prototype.hasOwnProperty.call(storedEditedCostume, 'assetFrame'),
        storedCostumeHasPersistedAssetId: Object.prototype.hasOwnProperty.call(storedEditedCostume, 'persistedAssetId'),
        storedCostumeHasRenderSignature: Object.prototype.hasOwnProperty.call(storedEditedCostume, 'renderSignature'),
        storedLayerAssetId: storedEditedLayer.bitmap.assetId,
        storedLayerHasPersistedAssetId: Object.prototype.hasOwnProperty.call(storedEditedLayer.bitmap, 'persistedAssetId'),
        runtimeLayerPersistedAssetId: editedSavedLayer.bitmap.persistedAssetId,
      };
    });

    expect(result.afterEdit.added).toEqual([]);
    expect(result.afterEdit.removed).toEqual([]);
    expect(result.afterResave.added).toEqual([]);
    expect(result.afterResave.removed).toEqual([]);
    expect(result.resavedAssetIds).toEqual(result.editedAssetIds);
    expect(result.editedRuntimeAssetId).toMatch(/^data:image\//);
    expect(result.persistedLayerMimeType).toBe('image/webp');
    expect(result.storedCostumeHasAssetId).toBe(false);
    expect(result.storedCostumeHasBounds).toBe(false);
    expect(result.storedCostumeHasAssetFrame).toBe(false);
    expect(result.storedCostumeHasPersistedAssetId).toBe(false);
    expect(result.storedCostumeHasRenderSignature).toBe(false);
    expect(result.storedLayerAssetId).toBe(result.runtimeLayerPersistedAssetId);
    expect(result.storedLayerHasPersistedAssetId).toBe(false);
  });

  test('ignores transient flattened runtime preview changes when serializing layered costumes', async ({ page }) => {
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
      const initialRecord = await db.projects.get(savedProject.id);

      const transientProject = structuredClone(savedProject);
      transientProject.updatedAt = new Date(savedProject.updatedAt.getTime() + 1_000);
      const transientCostume = transientProject.scenes[0]!.objects[0]!.costumes[0]!;
      transientCostume.assetId = (await renderCostumeDocument(transientCostume.document)).dataUrl;

      const resavedProject = await saveProject(transientProject);
      const resavedCostume = resavedProject.scenes[0]!.objects[0]!.costumes[0]!;
      const resavedPayload = await createProjectSyncPayload(resavedProject);
      const resavedRecord = await db.projects.get(resavedProject.id);

      if (!initialRecord || !resavedRecord) {
        throw new Error('Expected stored project records.');
      }

      const storedResavedData = JSON.parse(resavedRecord.data);
      const storedResavedCostume = storedResavedData.scenes[0].objects[0].costumes[0];

      return {
        initialAssetIds: initialPayload.assetIds,
        resavedAssetIds: resavedPayload.assetIds,
        initialSerializedData: initialPayload.data,
        resavedSerializedData: resavedPayload.data,
        savedRuntimeAssetId: savedCostume.assetId,
        resavedRuntimeAssetId: resavedCostume.assetId,
        storedCostumeHasAssetId: Object.prototype.hasOwnProperty.call(storedResavedCostume, 'assetId'),
      };
    });

    expect(result.resavedAssetIds).toEqual(result.initialAssetIds);
    expect(result.resavedSerializedData).toBe(result.initialSerializedData);
    expect(result.savedRuntimeAssetId).toMatch(/^data:image\//);
    expect(result.resavedRuntimeAssetId).toMatch(/^data:image\//);
    expect(result.storedCostumeHasAssetId).toBe(false);
  });
});
