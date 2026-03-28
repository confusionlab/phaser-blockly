import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('project bundle persistence', () => {
  test('bundle export and import preserve layered costume assets without storing derived previews', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const [
        { createBitmapCostumeDocument },
        { createDefaultGameObject, createDefaultProject },
        { createProjectSyncPayload, db, exportProject, importProjectFromFile, saveProject },
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

      const project = createDefaultProject('Bundle Persistence Fixture');
      const object = createDefaultGameObject('Hero');
      project.scenes[0]!.objects = [object];

      const source = createBitmapSource('#0f766e');
      object.costumes = [
        {
          ...object.costumes[0]!,
          name: 'Teal',
          assetId: source,
          document: createBitmapCostumeDocument(source, 'Teal Layer'),
        },
      ];

      const savedProject = await saveProject(project);
      const originalPayload = await createProjectSyncPayload(savedProject);
      const bundle = await exportProject(savedProject);
      const importedProject = await importProjectFromFile(
        new File([bundle], 'bundle-persistence.pochacoding.zip', { type: 'application/zip' }),
      );
      const importedPayload = await createProjectSyncPayload(importedProject);
      const importedRecord = await db.projects.get(importedProject.id);

      if (!importedRecord) {
        throw new Error('Expected imported project record.');
      }

      const importedStoredData = JSON.parse(importedRecord.data);
      const importedStoredCostume = importedStoredData.scenes[0].objects[0].costumes[0];

      return {
        importedName: importedProject.name,
        importedRuntimeAssetId: importedProject.scenes[0]!.objects[0]!.costumes[0]!.assetId,
        originalAssetIds: originalPayload.assetIds,
        importedAssetIds: importedPayload.assetIds,
        storedCostumeHasAssetId: Object.prototype.hasOwnProperty.call(importedStoredCostume, 'assetId'),
        storedCostumeHasBounds: Object.prototype.hasOwnProperty.call(importedStoredCostume, 'bounds'),
        storedCostumeHasAssetFrame: Object.prototype.hasOwnProperty.call(importedStoredCostume, 'assetFrame'),
      };
    });

    expect(result.importedName).toContain('(imported)');
    expect(result.importedRuntimeAssetId).toMatch(/^data:image\//);
    expect(result.importedAssetIds).toEqual(result.originalAssetIds);
    expect(result.storedCostumeHasAssetId).toBe(false);
    expect(result.storedCostumeHasBounds).toBe(false);
    expect(result.storedCostumeHasAssetFrame).toBe(false);
  });
});
