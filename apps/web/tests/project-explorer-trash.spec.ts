import { expect, test } from '@playwright/test';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { PROJECT_EXPLORER_ROOT_FOLDER_ID } from '../src/lib/projectExplorer';
import { createDefaultProject } from '../src/types';

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

test.describe('project explorer trash', () => {
  test.beforeEach(async () => {
    const { db } = await loadDatabaseModules();
    await db.projectRevisions.clear();
    await db.projects.clear();
    await db.assets.clear();
    await db.reusables.clear();
    await db.projectExplorerState.clear();
  });

  test('trashes a cloud-cached root project even when local explorer metadata is missing', async () => {
    const {
      db,
      loadStoredProjectExplorerStateSnapshot,
      saveProjectWithOptions,
      trashProjectFromExplorer,
    } = await loadDatabaseModules();

    let project = createDefaultProject('Cloud Cached Root Project');
    project = await saveProjectWithOptions(project, { storageOrigin: 'cloudCache' });

    await db.projectExplorerState.clear();

    const changed = await trashProjectFromExplorer(project.id, {
      folderId: PROJECT_EXPLORER_ROOT_FOLDER_ID,
    });

    expect(changed).toBe(true);

    const explorerState = await loadStoredProjectExplorerStateSnapshot();
    expect(explorerState.projects).toHaveLength(1);
    expect(explorerState.projects[0]).toMatchObject({
      folderId: PROJECT_EXPLORER_ROOT_FOLDER_ID,
      projectId: project.id,
    });
    expect(explorerState.projects[0]?.trashedAt).toBeGreaterThan(0);
  });
});
