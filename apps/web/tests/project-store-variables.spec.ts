import { expect, test } from '@playwright/test';
import { createDefaultProject } from '../src/types';

type StoreModules = {
  useProjectStore: typeof import('../src/store/projectStore').useProjectStore;
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
  return { useProjectStore };
}

test.afterEach(async () => {
  const { useProjectStore } = await loadStores();
  useProjectStore.getState().closeProject();
});

test.describe('Project store variables', () => {
  test('keeps variable IDs stable while allowing display names with spaces and punctuation', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Variable Display Names');

    useProjectStore.getState().openProject(project);

    const variableId = crypto.randomUUID();
    useProjectStore.getState().addGlobalVariable({
      id: variableId,
      name: ' Player score (%) ',
      type: 'number',
      defaultValue: 0,
      scope: 'global',
    });

    useProjectStore.getState().updateGlobalVariable(variableId, {
      name: 'Player score / bonus!',
    });

    const variables = useProjectStore.getState().project?.globalVariables ?? [];
    expect(variables).toHaveLength(1);
    expect(variables[0]).toMatchObject({
      id: variableId,
      name: 'Player score / bonus!',
      type: 'number',
      scope: 'global',
    });
  });

  test('allows local variable display names with punctuation and preserves IDs on rename', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Local Variable Display Names');

    useProjectStore.getState().openProject(project);

    const sceneId = useProjectStore.getState().project?.scenes[0]?.id;
    expect(sceneId).toBeTruthy();
    if (!sceneId) return;

    const createdObject = useProjectStore.getState().addObject(sceneId, 'Object 1');
    const variableId = crypto.randomUUID();

    useProjectStore.getState().addLocalVariable(sceneId, createdObject.id, {
      id: variableId,
      name: ' Enemy HP: Phase 1 ',
      type: 'number',
      defaultValue: 10,
      scope: 'local',
    });

    useProjectStore.getState().updateLocalVariable(sceneId, createdObject.id, variableId, {
      name: 'Enemy HP: Phase 2 / Boss?',
    });

    const objectLocalVariables = useProjectStore.getState().project?.scenes[0]?.objects[0]?.localVariables ?? [];
    expect(objectLocalVariables).toHaveLength(1);
    expect(objectLocalVariables[0]).toMatchObject({
      id: variableId,
      name: 'Enemy HP: Phase 2 / Boss?',
      type: 'number',
      scope: 'local',
      objectId: createdObject.id,
    });
  });

  test('normalizes array variable defaults and preserves cardinality metadata', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Array Variable Defaults');

    useProjectStore.getState().openProject(project);

    const variableId = crypto.randomUUID();
    const sourceDefaultValue = ['1', 2.9, 'bad'];

    useProjectStore.getState().addGlobalVariable({
      id: variableId,
      name: 'Level scores',
      type: 'number',
      cardinality: 'array',
      defaultValue: sourceDefaultValue,
      scope: 'global',
    });

    sourceDefaultValue.push('99');

    useProjectStore.getState().updateGlobalVariable(variableId, {
      name: 'Level scores (best runs)',
    });

    const variables = useProjectStore.getState().project?.globalVariables ?? [];
    expect(variables).toHaveLength(1);
    expect(variables[0]).toMatchObject({
      id: variableId,
      name: 'Level scores (best runs)',
      type: 'number',
      cardinality: 'array',
      defaultValue: [1, 2.9, 0],
      scope: 'global',
    });
  });
});
