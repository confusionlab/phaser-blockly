import { expect, test } from '@playwright/test';
import { createDefaultProject, type ComponentDefinition } from '../src/types';

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
    panX: 0,
    panY: 0,
    zoom: 1,
  });
});

test.describe('Object spawn position', () => {
  test('addObject starts at world center even if the editor view has moved', async () => {
    const { useProjectStore, useEditorStore } = await loadStores();
    const project = createDefaultProject('Spawn Fixture');
    const scene = project.scenes[0]!;

    useProjectStore.getState().openProject(project);
    useEditorStore.setState({
      panX: 240,
      panY: -135,
      zoom: 0.75,
    });

    const created = useProjectStore.getState().addObject(scene.id, 'Object 1');
    const stored = useProjectStore.getState().project?.scenes[0]?.objects[0];

    expect(created.x).toBe(0);
    expect(created.y).toBe(0);
    expect(stored?.x).toBe(0);
    expect(stored?.y).toBe(0);
  });

  test('addObject defaults to world center', async () => {
    const { useProjectStore, useEditorStore } = await loadStores();
    const project = createDefaultProject('Spawn Fallback Fixture');
    const scene = project.scenes[0]!;

    useProjectStore.getState().openProject(project);
    useEditorStore.setState({
      panX: 999,
      panY: 999,
      zoom: 1,
    });

    const created = useProjectStore.getState().addObject(scene.id, 'Object 1');

    expect(created.x).toBe(0);
    expect(created.y).toBe(0);
  });

  test('component instances also spawn at world center', async () => {
    const { useProjectStore, useEditorStore } = await loadStores();
    const project = createDefaultProject('Component Spawn Fixture');
    const scene = project.scenes[0]!;
    const component: ComponentDefinition = {
      id: 'component_enemy',
      name: 'Enemy',
      blocklyXml: '<xml></xml>',
      costumes: [],
      currentCostumeIndex: 0,
      physics: null,
      collider: null,
      sounds: [],
      localVariables: [],
    };
    project.components = [component];

    useProjectStore.getState().openProject(project);
    useEditorStore.setState({
      panX: -180,
      panY: 90,
      zoom: 0.5,
    });

    const created = useProjectStore.getState().addComponentInstance(scene.id, component.id);

    expect(created).not.toBeNull();
    expect(created?.x).toBe(0);
    expect(created?.y).toBe(0);
  });
});
