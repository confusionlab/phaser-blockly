import 'fake-indexeddb/auto';
import { expect, test } from '@playwright/test';
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
  if (globals.indexedDB) {
    Dexie.dependencies.indexedDB = globals.indexedDB;
  }
  if (globals.IDBKeyRange) {
    Dexie.dependencies.IDBKeyRange = globals.IDBKeyRange;
  }
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
      listProjects,
      saveProject,
    } = await loadDatabaseModules();

    let project = createDefaultProject('Conflict Copy Fixture');
    project = await saveProject(project);

    const firstConflict = await createProjectConflictCopy(project);
    const secondConflict = await createProjectConflictCopy(project);
    const projects = await listProjects();

    expect(firstConflict.id).toBe(secondConflict.id);
    expect(firstConflict.id).toMatch(/-conflict-[0-9a-f]{8}$/);
    expect(firstConflict.id).not.toBe(project.id);
    expect(firstConflict.name).toContain('Conflict');
    expect(projects.filter((entry) => entry.id === firstConflict.id)).toHaveLength(1);
  });
});
