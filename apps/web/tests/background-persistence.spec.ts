import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('background persistence', () => {
  test('saving and resaving a layered background does not persist derived runtime chunks', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const [
        { createBitmapBackgroundLayer },
        { buildBackgroundConfigFromDocument, resolveBackgroundRuntimeChunkData },
        { createDefaultProject },
        { createProjectSyncPayload, db, loadProject, saveProject },
      ] = await Promise.all([
        import('/src/lib/background/backgroundDocument.ts'),
        import('/src/lib/background/backgroundDocumentRender.ts'),
        import('/src/types/index.ts'),
        import('/src/db/database.ts'),
      ]);

      await db.projectRevisions.clear();
      await db.projects.clear();
      await db.assets.clear();
      await db.reusables.clear();

      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = 64;
      sourceCanvas.height = 64;
      const sourceCtx = sourceCanvas.getContext('2d');
      if (!sourceCtx) {
        throw new Error('Failed to create background source context.');
      }
      sourceCtx.fillStyle = '#111827';
      sourceCtx.fillRect(8, 10, 38, 30);
      sourceCtx.fillStyle = 'rgba(59, 130, 246, 0.85)';
      sourceCtx.fillRect(28, 20, 22, 18);
      const source = sourceCanvas.toDataURL('image/png');

      const layer = createBitmapBackgroundLayer({
        name: 'Layer 1',
        chunks: { '0,0': source },
      });
      const backgroundDocument = {
        version: 1 as const,
        activeLayerId: layer.id,
        chunkSize: 64,
        softChunkLimit: 400,
        hardChunkLimit: 1200,
        layers: [layer],
      };

      const project = createDefaultProject('Background Persistence Fixture');
      project.scenes[0]!.background = await buildBackgroundConfigFromDocument(backgroundDocument, {
        baseColor: '#87CEEB',
      });

      const savedProject = await saveProject(project);
      const initialPayload = await createProjectSyncPayload(savedProject);
      const savedRecord = await db.projects.get(savedProject.id);
      if (!savedRecord) {
        throw new Error('Expected saved project record.');
      }
      const storedBackground = JSON.parse(savedRecord.data).scenes[0].background;

      const loadedProject = await loadProject(savedProject.id);
      if (!loadedProject?.scenes[0]?.background) {
        throw new Error('Expected loaded layered background.');
      }

      const runtimeChunks = await resolveBackgroundRuntimeChunkData(loadedProject.scenes[0].background);
      const transientProject = structuredClone(loadedProject);
      transientProject.updatedAt = new Date(savedProject.updatedAt.getTime() + 1_000);
      if (!transientProject.scenes[0]?.background) {
        throw new Error('Expected transient layered background.');
      }
      transientProject.scenes[0].background.chunks = runtimeChunks;

      const resavedProject = await saveProject(transientProject);
      const resavedPayload = await createProjectSyncPayload(resavedProject);
      const resavedRecord = await db.projects.get(resavedProject.id);
      if (!resavedRecord) {
        throw new Error('Expected resaved project record.');
      }
      const resavedStoredBackground = JSON.parse(resavedRecord.data).scenes[0].background;

      return {
        initialAssetIds: initialPayload.assetIds,
        resavedAssetIds: resavedPayload.assetIds,
        initialSerializedData: initialPayload.data,
        resavedSerializedData: resavedPayload.data,
        storedHasChunks: Object.prototype.hasOwnProperty.call(storedBackground, 'chunks'),
        resavedHasChunks: Object.prototype.hasOwnProperty.call(resavedStoredBackground, 'chunks'),
        runtimeChunkCount: Object.keys(runtimeChunks).length,
      };
    });

    expect(result.storedHasChunks).toBe(false);
    expect(result.resavedHasChunks).toBe(false);
    expect(result.runtimeChunkCount).toBeGreaterThan(0);
    expect(result.resavedAssetIds).toEqual(result.initialAssetIds);
    expect(result.resavedSerializedData).toBe(result.initialSerializedData);
  });
});
