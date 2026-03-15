import { expect, test } from '@playwright/test';
import type { AssistantChangeSet } from '../../../packages/ui-shared/src/assistant';
import { createAssistantProjectSnapshot } from '../src/lib/assistant/projectState';
import { createDefaultGameObject, createDefaultProject } from '../src/types';

type StoreModules = {
  useProjectStore: typeof import('../src/store/projectStore').useProjectStore;
  useEditorStore: typeof import('../src/store/editorStore').useEditorStore;
  runInHistoryTransaction: typeof import('../src/store/universalHistory').runInHistoryTransaction;
  canUndoHistory: typeof import('../src/store/universalHistory').canUndoHistory;
};

function installBrowserShims() {
  const globals = globalThis as typeof globalThis & {
    __APP_VERSION__?: string;
    localStorage?: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
      removeItem: (key: string) => void;
    };
    document?: {
      documentElement: {
        classList: {
          toggle: (className: string, force?: boolean) => void;
        };
      };
    };
    window?: {
      localStorage: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
        removeItem: (key: string) => void;
      };
      matchMedia: (query: string) => { matches: boolean };
    };
  };

  const storage = globals.localStorage ?? {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };

  globals.__APP_VERSION__ = globals.__APP_VERSION__ ?? 'test-version';
  globals.localStorage = storage;
  globals.document = {
    documentElement: {
      classList: {
        toggle: () => undefined,
      },
    },
  };
  globals.window = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
  };
}

async function loadStores(): Promise<StoreModules> {
  installBrowserShims();
  const { useProjectStore } = await import('../src/store/projectStore');
  const { useEditorStore } = await import('../src/store/editorStore');
  const { runInHistoryTransaction, canUndoHistory } = await import('../src/store/universalHistory');
  return {
    useProjectStore,
    useEditorStore,
    runInHistoryTransaction,
    canUndoHistory,
  };
}

function buildProjectFixture(updatedAt = new Date('2026-01-01T00:00:00.000Z')) {
  const project = createDefaultProject('Undo Delete Fixture');
  project.updatedAt = updatedAt;

  const scene = project.scenes[0]!;
  const hero = createDefaultGameObject('Hero');
  hero.id = 'object_hero';
  hero.order = 0;
  const enemy = createDefaultGameObject('Enemy');
  enemy.id = 'object_enemy';
  enemy.order = 1;
  scene.objects = [hero, enemy];

  return {
    project,
    sceneId: scene.id,
    heroId: hero.id,
    enemyId: enemy.id,
  };
}

function getSceneObjectIds(useProjectStore: StoreModules['useProjectStore'], sceneId: string): string[] {
  const scene = useProjectStore.getState().project?.scenes.find((candidate) => candidate.id === sceneId);
  return scene?.objects.map((object) => object.id) ?? [];
}

function createDeleteHeroChangeSet(fixture: ReturnType<typeof buildProjectFixture>): AssistantChangeSet {
  const snapshot = createAssistantProjectSnapshot(fixture.project);
  return {
    baseProjectId: fixture.project.id,
    baseProjectVersion: snapshot.version,
    summary: 'Delete Hero',
    affectedEntityIds: [fixture.sceneId, fixture.heroId],
    operations: [
      {
        kind: 'delete_object',
        sceneId: fixture.sceneId,
        objectId: fixture.heroId,
      },
    ],
  };
}

async function withFixedDate<T>(fixedDate: Date, fn: () => Promise<T> | T): Promise<T> {
  const RealDate = Date;

  class FixedDate extends RealDate {
    constructor(...args: ConstructorParameters<DateConstructor>) {
      if (args.length === 0) {
        super(fixedDate.getTime());
        return;
      }
      // @ts-expect-error Date constructor has multiple overloads that tuple inference cannot express here.
      super(...args);
    }

    static now(): number {
      return fixedDate.getTime();
    }

    static parse(dateString: string): number {
      return RealDate.parse(dateString);
    }

    static UTC(...args: Parameters<DateConstructor['UTC']>): number {
      return RealDate.UTC(...args);
    }
  }

  // @ts-expect-error Tests intentionally replace the global clock to reproduce a timestamp collision.
  globalThis.Date = FixedDate;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

test.afterEach(async () => {
  const { useProjectStore, useEditorStore } = await loadStores();
  useProjectStore.getState().closeProject();
  useEditorStore.setState({
    selectedSceneId: null,
    selectedObjectId: null,
    selectedObjectIds: [],
    selectedComponentId: null,
  });
});

test.describe('Object delete undo history', () => {
  test('manual object deletion stays undoable', async () => {
    const { useProjectStore, useEditorStore, runInHistoryTransaction, canUndoHistory } = await loadStores();
    const fixture = buildProjectFixture();

    useProjectStore.getState().openProject(fixture.project);
    useEditorStore.getState().selectScene(fixture.sceneId, { recordHistory: false });
    useEditorStore.getState().selectObject(fixture.heroId, { recordHistory: false });

    runInHistoryTransaction('test:delete-object', () => {
      useProjectStore.getState().removeObject(fixture.sceneId, fixture.heroId);
      useEditorStore.getState().selectObjects([], null);
    });

    expect(getSceneObjectIds(useProjectStore, fixture.sceneId)).toEqual([fixture.enemyId]);
    expect(canUndoHistory()).toBe(true);

    useEditorStore.getState().undo();

    expect(getSceneObjectIds(useProjectStore, fixture.sceneId)).toEqual([fixture.heroId, fixture.enemyId]);
    expect(useEditorStore.getState().selectedObjectId).toBe(fixture.heroId);
  });

  test('assistant object deletion records an undo entry even when timestamps collide', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const fixedDate = new Date('2099-01-01T00:00:00.000Z');
    const fixture = buildProjectFixture(fixedDate);

    useProjectStore.getState().openProject(fixture.project);
    useEditorStore.getState().selectScene(fixture.sceneId, { recordHistory: false });
    useEditorStore.getState().selectObject(fixture.heroId, { recordHistory: false });

    const changeSet = createDeleteHeroChangeSet(fixture);

    await withFixedDate(fixedDate, async () => {
      useProjectStore.getState().applyAssistantChangeSet(changeSet);
    });

    expect(getSceneObjectIds(useProjectStore, fixture.sceneId)).toEqual([fixture.enemyId]);
    expect(canUndoHistory()).toBe(true);

    useEditorStore.getState().undo();

    expect(getSceneObjectIds(useProjectStore, fixture.sceneId)).toEqual([fixture.heroId, fixture.enemyId]);
  });

  test('assistant selection reconciliation keeps the next undo checkpoint aligned', async () => {
    const { useProjectStore, useEditorStore } = await loadStores();
    const fixture = buildProjectFixture();

    useProjectStore.getState().openProject(fixture.project);
    useEditorStore.getState().selectScene(fixture.sceneId, { recordHistory: false });
    useEditorStore.getState().selectObject(fixture.heroId, { recordHistory: false });

    useProjectStore.getState().applyAssistantChangeSet(createDeleteHeroChangeSet(fixture));
    useEditorStore.getState().reconcileSelectionToProject(useProjectStore.getState().project, { recordHistory: false });

    expect(useEditorStore.getState().selectedObjectId).toBeNull();
    expect(useEditorStore.getState().selectedObjectIds).toEqual([]);

    useProjectStore.getState().updateProjectName('Renamed After Assistant Delete');
    useEditorStore.getState().undo();

    expect(useProjectStore.getState().project?.name).toBe('Undo Delete Fixture');
    expect(getSceneObjectIds(useProjectStore, fixture.sceneId)).toEqual([fixture.enemyId]);
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
    expect(useEditorStore.getState().selectedObjectIds).toEqual([]);
  });
});
