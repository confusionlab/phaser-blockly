import { expect, test } from '@playwright/test';
import { createDefaultProject } from '../src/types';

type StoreModules = {
  tryStartPlaying: typeof import('../src/lib/playStartGuard').tryStartPlaying;
  useEditorStore: typeof import('../src/store/editorStore').useEditorStore;
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
  const { tryStartPlaying } = await import('../src/lib/playStartGuard');
  const { useEditorStore } = await import('../src/store/editorStore');
  const { useProjectStore } = await import('../src/store/projectStore');
  return {
    tryStartPlaying,
    useEditorStore,
    useProjectStore,
  };
}

test.describe('play start guard', () => {
  test.afterEach(async () => {
    const { useEditorStore, useProjectStore } = await loadStores();
    useProjectStore.getState().closeProject();
    useEditorStore.setState({
      selectedSceneId: null,
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedComponentId: null,
      isPlaying: false,
      showPlayValidationDialog: false,
      playValidationIssues: [],
      activeObjectTab: 'code',
      costumeUndoHandler: null,
      codeUndoHandler: null,
      backgroundUndoHandler: null,
      backgroundShortcutHandler: null,
    });
  });

  test('waits for editor preparation before entering play mode', async () => {
    const { tryStartPlaying, useEditorStore, useProjectStore } = await loadStores();
    useProjectStore.getState().openProject(createDefaultProject('Prepare before play'));

    let resolvePreparation: (() => void) | null = null;
    useEditorStore.setState({
      codeUndoHandler: {
        undo: () => undefined,
        redo: () => undefined,
        prepareForPlay: () => new Promise<void>((resolve) => {
          resolvePreparation = resolve;
        }),
      },
    });

    const startPromise = tryStartPlaying();
    await Promise.resolve();

    expect(useEditorStore.getState().isPlaying).toBe(false);

    resolvePreparation?.();

    await expect(startPromise).resolves.toBe(true);
    expect(useEditorStore.getState().isPlaying).toBe(true);
  });

  test('runs each registered preparation handler once', async () => {
    const { useEditorStore } = await loadStores();
    const calls: string[] = [];

    useEditorStore.setState({
      backgroundUndoHandler: {
        undo: () => undefined,
        redo: () => undefined,
        prepareForPlay: async () => {
          calls.push('background');
        },
      },
      costumeUndoHandler: {
        undo: () => undefined,
        redo: () => undefined,
        prepareForPlay: async () => {
          calls.push('costume');
        },
      },
      codeUndoHandler: {
        undo: () => undefined,
        redo: () => undefined,
        prepareForPlay: async () => {
          calls.push('code');
        },
      },
    });

    await useEditorStore.getState().prepareForPlay();

    expect(calls).toEqual(['background', 'costume', 'code']);
  });

  test('does not start playing when preparation fails', async () => {
    const { tryStartPlaying, useEditorStore, useProjectStore } = await loadStores();
    useProjectStore.getState().openProject(createDefaultProject('Prepare failure'));

    useEditorStore.setState({
      costumeUndoHandler: {
        undo: () => undefined,
        redo: () => undefined,
        prepareForPlay: async () => {
          throw new Error('flush failed');
        },
      },
    });

    await expect(tryStartPlaying()).resolves.toBe(false);
    expect(useEditorStore.getState().isPlaying).toBe(false);
  });
});
