import { expect, test } from '@playwright/test';
import { createDefaultGameObject, createDefaultProject, createDefaultScene } from '../src/types';

type StoreModules = {
  useProjectStore: typeof import('../src/store/projectStore').useProjectStore;
  useEditorStore: typeof import('../src/store/editorStore').useEditorStore;
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
  return {
    useProjectStore,
    useEditorStore,
  };
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
});

test.describe('Project open selection', () => {
  test('openProject selects the first object found in project order', async () => {
    const { useProjectStore, useEditorStore } = await loadStores();
    const project = createDefaultProject('Open selection fixture');
    const firstScene = project.scenes[0]!;
    firstScene.objects = [];

    const secondScene = createDefaultScene('Scene 2');
    secondScene.order = 1;
    const hero = createDefaultGameObject('Hero');
    hero.id = 'object_hero';
    secondScene.objects = [hero];
    project.scenes = [firstScene, secondScene];

    useProjectStore.getState().openProject(project);

    expect(useEditorStore.getState()).toMatchObject({
      selectedSceneId: secondScene.id,
      selectedFolderId: null,
      selectedObjectId: hero.id,
      selectedObjectIds: [hero.id],
      selectedComponentId: null,
    });
  });

  test('openProject keeps the first scene selected when the project has no objects', async () => {
    const { useProjectStore, useEditorStore } = await loadStores();
    const project = createDefaultProject('Open empty fixture');

    useProjectStore.getState().openProject(project);

    expect(useEditorStore.getState()).toMatchObject({
      selectedSceneId: project.scenes[0]?.id ?? null,
      selectedFolderId: null,
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedComponentId: null,
    });
  });

  test('openProject preserves valid multi-selection when reopening the same project', async () => {
    const { useProjectStore, useEditorStore } = await loadStores();
    const project = createDefaultProject('Reopen selection fixture');
    const scene = project.scenes[0]!;
    scene.objects = [];

    const objectOne = createDefaultGameObject('Object 1');
    objectOne.id = 'object_one';
    objectOne.order = 0;
    const objectTwo = createDefaultGameObject('Object 2');
    objectTwo.id = 'object_two';
    objectTwo.order = 1;
    const objectThree = createDefaultGameObject('Object 3');
    objectThree.id = 'object_three';
    objectThree.order = 2;
    scene.objects = [objectOne, objectTwo, objectThree];

    useProjectStore.getState().openProject(project);
    useEditorStore.getState().selectObjects([objectOne.id, objectTwo.id], objectTwo.id, { recordHistory: false });

    useProjectStore.getState().openProject(project);

    expect(useEditorStore.getState()).toMatchObject({
      selectedSceneId: scene.id,
      selectedFolderId: null,
      selectedObjectId: objectTwo.id,
      selectedObjectIds: [objectOne.id, objectTwo.id],
      selectedComponentId: null,
    });
  });
});
