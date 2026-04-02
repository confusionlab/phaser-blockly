import { expect, test } from '@playwright/test';
import { createDefaultProject } from '../src/types';

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

test.describe('Project store component creation', () => {
  test('addComponent creates a component definition without inserting a scene instance', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Component Create Fixture');

    useProjectStore.getState().openProject(project);

    const created = useProjectStore.getState().addComponent();
    const nextProject = useProjectStore.getState().project;

    expect(created).not.toBeNull();
    expect(nextProject?.components).toHaveLength(1);
    expect(nextProject?.components[0]?.id).toBe(created?.id);
    expect(nextProject?.components[0]?.name).toBe('Component 1');
    expect(nextProject?.components[0]?.costumes).toHaveLength(1);
    expect(nextProject?.components[0]?.sounds).toEqual([]);
    expect(nextProject?.scenes[0]?.objects).toEqual([]);
  });

  test('addComponent keeps names unique when callers request the same base name', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Component Unique Names');

    useProjectStore.getState().openProject(project);

    const first = useProjectStore.getState().addComponent('Enemy');
    const second = useProjectStore.getState().addComponent('Enemy');

    expect(first?.name).toBe('Enemy');
    expect(second?.name).toBe('Enemy 2');
    expect(useProjectStore.getState().project?.components.map((component) => component.name)).toEqual([
      'Enemy',
      'Enemy 2',
    ]);
  });
});
