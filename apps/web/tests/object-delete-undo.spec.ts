import { expect, test } from '@playwright/test';
import type { AssistantChangeSet } from '../../../packages/ui-shared/src/assistant';
import {
  addComponentInstanceWithHistory,
  clearSceneObjectClipboard,
  copySceneObjectsToClipboard,
  cutSceneObjectsWithHistory,
  deleteComponentWithHistory,
  deleteSceneObjectsWithHistory,
  duplicateSceneObjectsWithHistory,
  pasteSceneObjectClipboardWithHistory,
} from '../src/lib/editor/objectCommands';
import { createAssistantProjectSnapshot } from '../src/lib/assistant/projectState';
import { createDefaultGameObject, createDefaultProject, type ComponentDefinition } from '../src/types';

type StoreModules = {
  useProjectStore: typeof import('../src/store/projectStore').useProjectStore;
  useEditorStore: typeof import('../src/store/editorStore').useEditorStore;
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
  const { canUndoHistory } = await import('../src/store/universalHistory');
  return {
    useProjectStore,
    useEditorStore,
    canUndoHistory,
  };
}

function buildProjectFixture(updatedAt = new Date('2026-01-01T00:00:00.000Z')) {
  const project = createDefaultProject('Undo Delete Fixture');
  project.updatedAt = updatedAt;

  const scene = project.scenes[0]!;
  const componentId = 'component_enemy';
  const hero = createDefaultGameObject('Hero');
  hero.id = 'object_hero';
  hero.order = 0;
  const enemy = createDefaultGameObject('Enemy');
  enemy.id = 'object_enemy';
  enemy.order = 1;
  enemy.componentId = componentId;
  scene.objects = [hero, enemy];

  const component: ComponentDefinition = {
    id: componentId,
    name: 'EnemyComponent',
    blocklyXml: '<xml></xml>',
    costumes: [],
    currentCostumeIndex: 0,
    physics: null,
    collider: null,
    sounds: [],
    localVariables: [],
  };
  project.components = [component];

  return {
    project,
    sceneId: scene.id,
    heroId: hero.id,
    enemyId: enemy.id,
    componentId,
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
    selectedFolderId: null,
    selectedObjectId: null,
    selectedObjectIds: [],
    selectedComponentId: null,
  });
  clearSceneObjectClipboard();
});

test.describe('Object delete undo history', () => {
  test('clear selection preserves the scene and restores on undo', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const fixture = buildProjectFixture();

    useProjectStore.getState().openProject(fixture.project);
    useEditorStore.getState().selectScene(fixture.sceneId, { recordHistory: false });
    useEditorStore.getState().selectObject(fixture.heroId, { recordHistory: false });

    useEditorStore.getState().clearSelection();

    expect(useEditorStore.getState().selectedSceneId).toBe(fixture.sceneId);
    expect(useEditorStore.getState().selectedFolderId).toBeNull();
    expect(useEditorStore.getState().selectedObjectId).toBeNull();
    expect(useEditorStore.getState().selectedObjectIds).toEqual([]);
    expect(useEditorStore.getState().selectedComponentId).toBeNull();
    expect(canUndoHistory()).toBe(true);

    useEditorStore.getState().undo();

    expect(useEditorStore.getState().selectedSceneId).toBe(fixture.sceneId);
    expect(useEditorStore.getState().selectedObjectId).toBe(fixture.heroId);
    expect(useEditorStore.getState().selectedObjectIds).toEqual([fixture.heroId]);
  });

  test('shared object deletion command keeps delete and fallback selection in one undo step', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const fixture = buildProjectFixture();

    useProjectStore.getState().openProject(fixture.project);
    useEditorStore.getState().selectScene(fixture.sceneId, { recordHistory: false });
    useEditorStore.getState().selectObject(fixture.heroId, { recordHistory: false });

    deleteSceneObjectsWithHistory({
      source: 'test:delete-object',
      sceneId: fixture.sceneId,
      deleteIds: [fixture.heroId],
      orderedSceneObjectIds: [fixture.heroId, fixture.enemyId],
      selectedObjectId: fixture.heroId,
      selectedObjectIds: [fixture.heroId],
      removeObject: useProjectStore.getState().removeObject,
      selectObject: useEditorStore.getState().selectObject,
      selectObjects: useEditorStore.getState().selectObjects,
    });

    expect(getSceneObjectIds(useProjectStore, fixture.sceneId)).toEqual([fixture.enemyId]);
    expect(useEditorStore.getState().selectedObjectId).toBe(fixture.enemyId);
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

  test('shared duplicate command keeps duplicate and selection in one undo step', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const fixture = buildProjectFixture();

    useProjectStore.getState().openProject(fixture.project);
    useEditorStore.getState().selectScene(fixture.sceneId, { recordHistory: false });
    useEditorStore.getState().selectObject(fixture.heroId, { recordHistory: false });

    duplicateSceneObjectsWithHistory({
      source: 'test:duplicate-object',
      sceneId: fixture.sceneId,
      objectIds: [fixture.heroId],
      duplicateObject: useProjectStore.getState().duplicateObject,
      selectObjects: useEditorStore.getState().selectObjects,
    });

    const idsAfterDuplicate = getSceneObjectIds(useProjectStore, fixture.sceneId);
    expect(idsAfterDuplicate).toHaveLength(3);
    expect(idsAfterDuplicate.filter((id) => id !== fixture.heroId && id !== fixture.enemyId)).toHaveLength(1);
    expect(useEditorStore.getState().selectedObjectId).toBe(idsAfterDuplicate.find((id) => id !== fixture.heroId && id !== fixture.enemyId));
    expect(canUndoHistory()).toBe(true);

    useEditorStore.getState().undo();

    expect(getSceneObjectIds(useProjectStore, fixture.sceneId)).toEqual([fixture.heroId, fixture.enemyId]);
    expect(useEditorStore.getState().selectedObjectId).toBe(fixture.heroId);
  });

  test('shared object clipboard copy/paste preserves object state and remaps local variables', async () => {
    const { useProjectStore, useEditorStore } = await loadStores();
    const fixture = buildProjectFixture();
    const heroVariableId = 'var_hero_health';
    fixture.project.scenes[0]!.objects[0] = {
      ...fixture.project.scenes[0]!.objects[0]!,
      x: 120,
      y: -40,
      localVariables: [
        {
          id: heroVariableId,
          name: 'health',
          type: 'integer',
          defaultValue: 100,
          scope: 'local',
          objectId: fixture.heroId,
        },
      ],
      blocklyXml: `<xml><block type="typed_variable_get"><field name="VAR">${heroVariableId}</field></block></xml>`,
    };

    useProjectStore.getState().openProject(fixture.project);
    useEditorStore.getState().selectScene(fixture.sceneId, { recordHistory: false });
    useEditorStore.getState().selectObject(fixture.heroId, { recordHistory: false });

    const copied = copySceneObjectsToClipboard(useProjectStore.getState().project!, fixture.sceneId, [fixture.heroId]);
    expect(copied).toBe(true);

    const pastedIds = pasteSceneObjectClipboardWithHistory({
      source: 'test:paste-object',
      project: useProjectStore.getState().project!,
      sceneId: fixture.sceneId,
      addObject: useProjectStore.getState().addObject,
      updateObject: useProjectStore.getState().updateObject,
      selectObjects: useEditorStore.getState().selectObjects,
    });

    expect(pastedIds).toHaveLength(1);

    const pastedObject = useProjectStore
      .getState()
      .project?.scenes
      .find((scene) => scene.id === fixture.sceneId)
      ?.objects.find((object) => object.id === pastedIds[0]);

    expect(pastedObject).toBeTruthy();
    expect(pastedObject?.name).toBe('Hero Copy');
    expect(pastedObject?.x).toBe(170);
    expect(pastedObject?.y).toBe(10);
    expect(pastedObject?.localVariables).toHaveLength(1);
    expect(pastedObject?.localVariables[0]?.id).not.toBe(heroVariableId);
    expect(pastedObject?.blocklyXml).toContain(pastedObject?.localVariables[0]?.id ?? '');
    expect(useEditorStore.getState().selectedObjectIds).toEqual(pastedIds);
  });

  test('shared object clipboard cut/paste removes and restores the object in one flow', async () => {
    const { useProjectStore, useEditorStore } = await loadStores();
    const fixture = buildProjectFixture();

    useProjectStore.getState().openProject(fixture.project);
    useEditorStore.getState().selectScene(fixture.sceneId, { recordHistory: false });
    useEditorStore.getState().selectObject(fixture.heroId, { recordHistory: false });

    cutSceneObjectsWithHistory({
      source: 'test:cut-object',
      project: useProjectStore.getState().project!,
      sceneId: fixture.sceneId,
      deleteIds: [fixture.heroId],
      orderedSceneObjectIds: [fixture.heroId, fixture.enemyId],
      selectedObjectId: fixture.heroId,
      selectedObjectIds: [fixture.heroId],
      removeObject: useProjectStore.getState().removeObject,
      selectObject: useEditorStore.getState().selectObject,
      selectObjects: useEditorStore.getState().selectObjects,
    });

    expect(getSceneObjectIds(useProjectStore, fixture.sceneId)).toEqual([fixture.enemyId]);

    const pastedIds = pasteSceneObjectClipboardWithHistory({
      source: 'test:paste-cut-object',
      project: useProjectStore.getState().project!,
      sceneId: fixture.sceneId,
      addObject: useProjectStore.getState().addObject,
      updateObject: useProjectStore.getState().updateObject,
      selectObjects: useEditorStore.getState().selectObjects,
    });

    expect(pastedIds).toHaveLength(1);

    const restoredObject = useProjectStore
      .getState()
      .project?.scenes
      .find((scene) => scene.id === fixture.sceneId)
      ?.objects.find((object) => object.id === pastedIds[0]);

    expect(restoredObject?.name).toBe('Hero');
    expect(restoredObject?.x).toBe(0);
    expect(restoredObject?.y).toBe(0);
    expect(useEditorStore.getState().selectedObjectIds).toEqual(pastedIds);
  });

  test('adding a component instance is one undoable command', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const fixture = buildProjectFixture();

    useProjectStore.getState().openProject(fixture.project);
    useEditorStore.getState().selectScene(fixture.sceneId, { recordHistory: false });
    useEditorStore.getState().selectObject(fixture.heroId, { recordHistory: false });

    addComponentInstanceWithHistory({
      source: 'test:add-component-instance',
      sceneId: fixture.sceneId,
      componentId: fixture.componentId,
      addComponentInstance: useProjectStore.getState().addComponentInstance,
      selectObject: useEditorStore.getState().selectObject,
    });

    expect(getSceneObjectIds(useProjectStore, fixture.sceneId)).toHaveLength(3);
    expect(useEditorStore.getState().selectedObjectId).not.toBe(fixture.heroId);
    expect(canUndoHistory()).toBe(true);

    useEditorStore.getState().undo();

    expect(getSceneObjectIds(useProjectStore, fixture.sceneId)).toEqual([fixture.heroId, fixture.enemyId]);
    expect(useEditorStore.getState().selectedObjectId).toBe(fixture.heroId);
  });

  test('deleting a selected component is one undoable command', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const fixture = buildProjectFixture();

    useProjectStore.getState().openProject(fixture.project);
    useEditorStore.getState().selectComponent(fixture.componentId, { recordHistory: false });

    deleteComponentWithHistory({
      source: 'test:delete-component',
      componentId: fixture.componentId,
      selectedComponentId: useEditorStore.getState().selectedComponentId,
      deleteComponent: useProjectStore.getState().deleteComponent,
      selectComponent: useEditorStore.getState().selectComponent,
    });

    expect(useProjectStore.getState().project?.components).toEqual([]);
    expect(useEditorStore.getState().selectedComponentId).toBeNull();
    expect(canUndoHistory()).toBe(true);

    useEditorStore.getState().undo();

    expect(useProjectStore.getState().project?.components.map((component) => component.id)).toEqual([fixture.componentId]);
    expect(useEditorStore.getState().selectedComponentId).toBe(fixture.componentId);
  });
});
