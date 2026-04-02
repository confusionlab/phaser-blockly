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

test.describe('Project store messages', () => {
  test('creates, renames, and removes messages while preserving stable IDs', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Message Manager');

    useProjectStore.getState().openProject(project);

    const created = useProjectStore.getState().addMessage(' game over ');
    expect(created).toBeTruthy();
    if (!created) return;

    useProjectStore.getState().updateMessage(created.id, { name: 'victory / restart?' });

    let messages = useProjectStore.getState().project?.messages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: created.id,
      name: 'victory / restart?',
    });

    useProjectStore.getState().removeMessage(created.id);

    messages = useProjectStore.getState().project?.messages ?? [];
    expect(messages).toHaveLength(0);
  });
});
