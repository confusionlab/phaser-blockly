import { expect, test } from '@playwright/test';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { createDefaultProject, type Project } from '../src/types';

test.describe.configure({ mode: 'serial' });

type DatabaseModule = typeof import('../src/db/database');

function installAppVersionShim() {
  const globals = globalThis as typeof globalThis & {
    __APP_VERSION__?: string;
  };
  globals.__APP_VERSION__ = globals.__APP_VERSION__ ?? 'test-version';
}

async function loadDatabaseModules(): Promise<DatabaseModule> {
  installAppVersionShim();
  const Dexie = (await import('dexie')).default;
  const globals = globalThis as typeof globalThis & {
    IDBKeyRange?: typeof IDBKeyRange;
    indexedDB?: IDBFactory;
  };

  globals.indexedDB = indexedDB;
  globals.IDBKeyRange = IDBKeyRange;
  Dexie.dependencies.indexedDB = indexedDB;
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  return await import('../src/db/database');
}

function withUpdatedProject(
  project: Project,
  updates: Partial<Project['settings']>,
): Project {
  return {
    ...project,
    settings: {
      ...project.settings,
      ...updates,
    },
    updatedAt: new Date(project.updatedAt.getTime() + 1_000),
  };
}

test.describe('project revision deltas', () => {
  test.beforeEach(async () => {
    const dbModule = await loadDatabaseModules();
    const { db } = dbModule;
    await db.projectRevisions.clear();
    await db.projects.clear();
    await db.assets.clear();
    await db.reusables.clear();
  });

  test('creates auto checkpoints as deltas and restores them', async () => {
    const {
      createAutoCheckpoint,
      createManualCheckpoint,
      listProjectRevisions,
      restoreAsNewProject,
      saveProject,
    } = await loadDatabaseModules();

    let project = createDefaultProject('Delta Restore Fixture');
    project = await saveProject(project);

    const baseRevision = await createManualCheckpoint(project, 'Base');
    expect(baseRevision?.kind).toBe('snapshot');

    const changedProject = withUpdatedProject(project, {
      backgroundColor: '#123456',
    });
    const deltaRevision = await createAutoCheckpoint(changedProject);

    expect(deltaRevision).not.toBeNull();
    expect(deltaRevision?.kind).toBe('delta');

    const revisions = await listProjectRevisions(project.id);
    expect(revisions[0]?.kind).toBe('delta');

    const restoredProject = await restoreAsNewProject(project.id, deltaRevision!.id);
    expect(restoredProject.settings.backgroundColor).toBe('#123456');
  });

  test('round-trips delta revisions through cloud sync payloads', async () => {
    const {
      createAutoCheckpoint,
      createManualCheckpoint,
      getProjectRevisionsForSync,
      listProjectRevisions,
      restoreAsNewProject,
      saveProject,
      syncProjectRevisionsFromCloud,
      db,
    } = await loadDatabaseModules();

    let project = createDefaultProject('Delta Cloud Fixture');
    project = await saveProject(project);

    await createManualCheckpoint(project, 'Base');
    const changedProject = withUpdatedProject(project, {
      backgroundColor: '#abcdef',
    });
    const deltaRevision = await createAutoCheckpoint(changedProject);
    expect(deltaRevision?.kind).toBe('delta');

    const revisionPayloads = await getProjectRevisionsForSync(project.id);

    await db.projectRevisions.clear();

    const syncResult = await syncProjectRevisionsFromCloud(project.id, revisionPayloads);
    expect(syncResult.created).toBe(revisionPayloads.length);

    const revisions = await listProjectRevisions(project.id);
    expect(revisions[0]?.kind).toBe('delta');

    const restoredProject = await restoreAsNewProject(project.id, deltaRevision!.id);
    expect(restoredProject.settings.backgroundColor).toBe('#abcdef');
  });

  test('migrates legacy revision snapshots to the current number schema before reuse', async () => {
    const [
      { createDefaultProject },
      { parsePersistedProjectData, stringifyPersistedProjectData },
      {
        CURRENT_SCHEMA_VERSION,
        db,
        getProjectRevisionsForSync,
        loadProject,
        listProjectRevisions,
      },
    ] = await Promise.all([
      import('../src/types'),
      import('../src/lib/persistence/projectDataCodec'),
      loadDatabaseModules(),
    ]);

    const legacyProject = createDefaultProject('Legacy Revision Fixture');
    legacyProject.globalVariables = [{
      id: 'legacy-score',
      name: 'Score',
      type: 'integer',
      defaultValue: '12.5',
      scope: 'global',
    } as any];

    const { id, name, createdAt, updatedAt, ...projectData } = legacyProject;
    const serializedLegacyData = stringifyPersistedProjectData(projectData as any);
    const revisionId = 'legacy-revision-1';

    await db.projects.put({
      id,
      name,
      createdAt,
      updatedAt,
      data: serializedLegacyData,
      schemaVersion: 10,
    });

    await db.projectRevisions.put({
      id: revisionId,
      projectId: id,
      kind: 'snapshot',
      baseRevisionId: revisionId,
      snapshotData: serializedLegacyData,
      contentHash: 'legacy-hash',
      createdAt,
      updatedAt: createdAt,
      schemaVersion: 10,
      reason: 'manual_checkpoint',
      checkpointName: 'Legacy',
      isCheckpoint: true,
      assetIds: [],
    });

    const loadedProject = await loadProject(id);
    expect(loadedProject?.globalVariables[0]).toMatchObject({
      type: 'number',
      defaultValue: 12.5,
    });

    const revisions = await listProjectRevisions(id);
    expect(revisions[0]?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(revisions[0]?.kind).toBe('snapshot');

    const storedRevision = await db.projectRevisions.get(revisionId);
    const storedData = parsePersistedProjectData(storedRevision?.snapshotData ?? '{}') as any;
    expect(storedRevision?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(storedRevision?.kind).toBe('snapshot');
    expect(storedRevision?.patch).toBeUndefined();
    expect(storedData.globalVariables?.[0]).toMatchObject({
      type: 'number',
      defaultValue: 12.5,
    });

    const syncPayloads = await getProjectRevisionsForSync(id);
    expect(syncPayloads).toHaveLength(1);
    expect(syncPayloads[0]).toMatchObject({
      revisionId,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'snapshot',
    });
  });

  test('migrates legacy cloud revision payloads before storing them locally', async () => {
    const [
      { createDefaultProject },
      { parsePersistedProjectData, stringifyPersistedProjectData },
      {
        CURRENT_SCHEMA_VERSION,
        db,
        getProjectRevisionsForSync,
        saveProject,
        syncProjectRevisionsFromCloud,
      },
    ] = await Promise.all([
      import('../src/types'),
      import('../src/lib/persistence/projectDataCodec'),
      loadDatabaseModules(),
    ]);

    let project = createDefaultProject('Legacy Cloud Revision Fixture');
    project = await saveProject(project);

    const legacyProject = createDefaultProject('Legacy Cloud Payload');
    legacyProject.globalVariables = [{
      id: 'legacy-counter',
      name: 'Counter',
      type: 'float',
      defaultValue: '7.25',
      scope: 'global',
    } as any];

    const { id: _legacyId, name: _legacyName, createdAt: _legacyCreatedAt, updatedAt: _legacyUpdatedAt, ...legacyData } = legacyProject;
    const serializedLegacyData = stringifyPersistedProjectData(legacyData as any);
    const revisionId = 'legacy-cloud-revision';

    const result = await syncProjectRevisionsFromCloud(project.id, [{
      localProjectId: project.id,
      revisionId,
      kind: 'snapshot',
      baseRevisionId: revisionId,
      data: serializedLegacyData,
      assetIds: [],
      contentHash: 'cloud-legacy-hash',
      createdAt: project.createdAt.getTime(),
      updatedAt: project.updatedAt.getTime(),
      schemaVersion: 10,
      reason: 'manual_checkpoint',
      checkpointName: 'Imported Legacy',
      isCheckpoint: true,
    }]);

    expect(result).toMatchObject({
      created: 1,
      updated: 0,
      skipped: 0,
      migrated: 1,
    });

    const storedRevision = await db.projectRevisions.get(revisionId);
    const storedData = parsePersistedProjectData(storedRevision?.snapshotData ?? '{}') as any;
    expect(storedRevision?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(storedRevision?.kind).toBe('snapshot');
    expect(storedRevision?.patch).toBeUndefined();
    expect(storedData.globalVariables?.[0]).toMatchObject({
      type: 'number',
      defaultValue: 7.25,
    });

    const syncPayloads = await getProjectRevisionsForSync(project.id);
    expect(syncPayloads.find((payload) => payload.revisionId === revisionId)).toMatchObject({
      revisionId,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'snapshot',
    });
  });

  test('updates persisted revision sync state when an older checkpoint is renamed', async () => {
    const {
      createManualCheckpoint,
      getProjectRevisionSyncState,
      renameCheckpoint,
      saveProject,
    } = await loadDatabaseModules();

    let project = createDefaultProject('Revision Sync State Fixture');
    project = await saveProject(project);

    const firstCheckpoint = await createManualCheckpoint(project, 'First');
    expect(firstCheckpoint).not.toBeNull();

    const changedProject = withUpdatedProject(project, {
      backgroundColor: '#654321',
    });
    const secondCheckpoint = await createManualCheckpoint(changedProject, 'Second');
    expect(secondCheckpoint).not.toBeNull();

    const beforeRename = await getProjectRevisionSyncState(project.id);
    await renameCheckpoint(project.id, firstCheckpoint!.id, 'First Renamed');
    const afterRename = await getProjectRevisionSyncState(project.id);

    expect(afterRename.latestRevisionId).toBe(secondCheckpoint!.id);
    expect(afterRename.revisionCount).toBe(beforeRename.revisionCount);
    expect(afterRename.revisionsUpdatedAt).toBeGreaterThan(beforeRename.revisionsUpdatedAt ?? 0);
  });

  test('creates a stable conflict copy for the same project version', async () => {
    const {
      createProjectConflictCopy,
      db,
      listProjects,
      saveProject,
    } = await loadDatabaseModules();

    let project = createDefaultProject('Conflict Copy Fixture');
    project = await saveProject(project);

    const firstConflict = await createProjectConflictCopy(project);
    const secondConflict = await createProjectConflictCopy(project);
    const visibleProjects = await listProjects();
    const allProjects = await listProjects({ includeConflictCopies: true });
    const storedConflict = await db.projects.get(firstConflict.id);

    expect(firstConflict.id).toBe(secondConflict.id);
    expect(firstConflict.id).toMatch(/-conflict-[0-9a-f]{8}$/);
    expect(firstConflict.id).not.toBe(project.id);
    expect(firstConflict.name).toContain('Conflict');
    expect(storedConflict?.storageOrigin).toBe('conflictCopy');
    expect(visibleProjects.filter((entry) => entry.id === firstConflict.id)).toHaveLength(0);
    expect(allProjects.filter((entry) => entry.id === firstConflict.id)).toHaveLength(1);
  });

  test('hides legacy conflict ids from default project listings', async () => {
    const {
      createProjectConflictCopy,
      db,
      listProjects,
      saveProject,
    } = await loadDatabaseModules();

    let project = createDefaultProject('Legacy Conflict Fixture');
    project = await saveProject(project);

    const conflictProject = await createProjectConflictCopy(project);
    await db.projects.update(conflictProject.id, {
      storageOrigin: 'localDraft',
      cloudBacked: false,
    });

    const visibleProjects = await listProjects();
    const allProjects = await listProjects({ includeConflictCopies: true });
    const storedConflict = await db.projects.get(conflictProject.id);

    expect(storedConflict?.storageOrigin).toBe('localDraft');
    expect(visibleProjects.some((entry) => entry.id === conflictProject.id)).toBe(false);
    expect(allProjects.some((entry) => entry.id === conflictProject.id)).toBe(true);
  });

  test('prunes local-only cached projects that are absent from cloud', async () => {
    const {
      loadProject,
      pruneLocalProjectsNotInCloud,
      saveProject,
    } = await loadDatabaseModules();

    let project = createDefaultProject('Cached Project');
    project = await saveProject(project);

    const pruneResult = await pruneLocalProjectsNotInCloud([]);

    expect(pruneResult.deleted).toBe(1);
    expect(await loadProject(project.id)).toBeNull();
  });
});
