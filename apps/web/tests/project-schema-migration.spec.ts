import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('project schema migration', () => {
  test('loads schema v10 projects and rewrites legacy numeric variable tags to number', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const [
        { createDefaultGameObject, createDefaultProject },
        { db, loadProject },
        { parsePersistedProjectData, stringifyPersistedProjectData },
      ] = await Promise.all([
        import('/src/types/index.ts'),
        import('/src/db/database.ts'),
        import('/src/lib/persistence/projectDataCodec.ts'),
      ]);

      await db.projectRevisions.clear();
      await db.projects.clear();
      await db.assets.clear();
      await db.reusables.clear();

      const legacyProject = createDefaultProject('Legacy Numeric Variables');
      legacyProject.globalVariables = [{
        id: 'global-score',
        name: 'Score',
        type: 'integer',
        defaultValue: '12.5',
        scope: 'global',
      } as any];

      legacyProject.components.push({
        id: 'component-1',
        name: 'Enemy Logic',
        blocklyXml: '',
        costumes: [],
        currentCostumeIndex: 0,
        physics: null,
        collider: null,
        sounds: [],
        localVariables: [{
          id: 'component-threshold',
          name: 'Threshold',
          type: 'float',
          defaultValue: '7.25',
          scope: 'local',
        } as any],
      });

      const legacyObject = createDefaultGameObject('Legacy Object');
      legacyObject.localVariables = [{
        id: 'object-speeds',
        name: 'Speeds',
        type: 'integer',
        cardinality: 'array',
        defaultValue: ['1', 2.75, 'bad'],
        scope: 'local',
      } as any];
      legacyProject.scenes[0]!.objects.push(legacyObject);

      const { id, name, createdAt, updatedAt, ...projectData } = legacyProject;
      await db.projects.put({
        id,
        name,
        createdAt,
        updatedAt,
        data: stringifyPersistedProjectData(projectData as any),
        schemaVersion: 10,
      });

      const migratedProject = await loadProject(id);
      if (!migratedProject) {
        throw new Error('Expected migrated project.');
      }

      const migratedRecord = await db.projects.get(id);
      if (!migratedRecord) {
        throw new Error('Expected migrated project record.');
      }

      const storedData = parsePersistedProjectData(migratedRecord.data) as any;

      return {
        schemaVersion: migratedRecord.schemaVersion,
        globalVariable: migratedProject.globalVariables[0],
        componentVariable: migratedProject.components[0]?.localVariables?.[0] ?? null,
        objectVariable: migratedProject.scenes[0]?.objects[0]?.localVariables?.[0] ?? null,
        storedGlobalType: storedData.globalVariables?.[0]?.type ?? null,
        storedComponentType: storedData.components?.[0]?.localVariables?.[0]?.type ?? null,
        storedObjectType: storedData.scenes?.[0]?.objects?.[0]?.localVariables?.[0]?.type ?? null,
      };
    });

    expect(result.schemaVersion).toBe(11);
    expect(result.globalVariable).toMatchObject({
      type: 'number',
      defaultValue: 12.5,
      scope: 'global',
    });
    expect(result.componentVariable).toMatchObject({
      type: 'number',
      defaultValue: 7.25,
      scope: 'local',
    });
    expect(result.objectVariable).toMatchObject({
      type: 'number',
      cardinality: 'array',
      defaultValue: [1, 2.75, 0],
      scope: 'local',
    });
    expect(result.storedGlobalType).toBe('number');
    expect(result.storedComponentType).toBe('number');
    expect(result.storedObjectType).toBe('number');
  });

  test('imports older project files by migrating legacy numeric variable tags forward', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const [
        { createDefaultGameObject, createDefaultProject },
        { CURRENT_PROJECT_SCHEMA_VERSION },
        { db, importProject },
      ] = await Promise.all([
        import('/src/types/index.ts'),
        import('/src/lib/persistence/schemaVersion.ts'),
        import('/src/db/database.ts'),
      ]);

      await db.projectRevisions.clear();
      await db.projects.clear();
      await db.assets.clear();
      await db.reusables.clear();

      const legacyProject = createDefaultProject('Legacy Import Fixture');
      legacyProject.globalVariables = [{
        id: 'global-lives',
        name: 'Lives',
        type: 'integer',
        defaultValue: '3.5',
        scope: 'global',
      } as any];

      const legacyObject = createDefaultGameObject('Imported Object');
      legacyObject.localVariables = [{
        id: 'object-velocity',
        name: 'Velocity',
        type: 'float',
        cardinality: 'array',
        defaultValue: ['4.25', 'oops'],
        scope: 'local',
      } as any];
      legacyProject.scenes[0]!.objects.push(legacyObject);

      const importedProject = await importProject(JSON.stringify({
        type: 'pochacoding-project',
        exportedAt: new Date().toISOString(),
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION - 1,
        project: legacyProject,
      }));

      const storedRecord = await db.projects.get(importedProject.id);
      if (!storedRecord) {
        throw new Error('Expected imported project record.');
      }

      return {
        importedName: importedProject.name,
        schemaVersion: storedRecord.schemaVersion,
        globalVariable: importedProject.globalVariables[0],
        objectVariable: importedProject.scenes[0]?.objects[0]?.localVariables?.[0] ?? null,
      };
    });

    expect(result.importedName).toBe('Legacy Import Fixture (imported)');
    expect(result.schemaVersion).toBe(11);
    expect(result.globalVariable).toMatchObject({
      type: 'number',
      defaultValue: 3.5,
      scope: 'global',
    });
    expect(result.objectVariable).toMatchObject({
      type: 'number',
      cardinality: 'array',
      defaultValue: [4.25, 0],
      scope: 'local',
    });
  });
});
