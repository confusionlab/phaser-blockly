import { expect, test } from '@playwright/test';
import {
  createDefaultColliderConfig,
  createDefaultGameObject,
  createDefaultPhysicsConfig,
  createDefaultProject,
  type ComponentDefinition,
  type Project,
} from '../src/types';

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

function createObject(id: string, costumeId: string, assetId: string) {
  const object = createDefaultGameObject(id);
  object.id = id;
  object.name = id;
  object.costumes = [
    {
      ...object.costumes[0],
      id: costumeId,
      name: `${id}-costume`,
      assetId,
      editorMode: 'vector',
    },
  ];
  object.currentCostumeIndex = 0;
  return object;
}

function createObjectWithCostumes(
  id: string,
  costumes: Array<{ id: string; name: string; assetId: string }>,
) {
  const object = createDefaultGameObject(id);
  object.id = id;
  object.name = id;
  object.costumes = costumes.map((costume) => ({
    ...object.costumes[0],
    id: costume.id,
    name: costume.name,
    assetId: costume.assetId,
    editorMode: 'vector',
  }));
  object.currentCostumeIndex = 0;
  return object;
}

async function openProject(project: Project) {
  const { useProjectStore } = await loadStores();
  useProjectStore.getState().openProject(project);
  return useProjectStore;
}

test.describe('project store costume editor boundary', () => {
  test.afterEach(async () => {
    const { useProjectStore, useEditorStore } = await loadStores();
    useProjectStore.getState().closeProject();
    useEditorStore.setState({
      selectedSceneId: null,
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedComponentId: null,
      activeObjectTab: 'code',
      costumeColliderEditorRequest: null,
      costumeUndoHandler: null,
    });
  });

  test('updates only the targeted object costume', async () => {
    const project = createDefaultProject('Costume store test');
    const scene = project.scenes[0];
    const objectA = createObject('object-a', 'costume-a', 'data:image/png;base64,AAA');
    const objectB = createObject('object-b', 'costume-b', 'data:image/png;base64,BBB');
    scene.objects = [objectA, objectB];

    const useProjectStore = await openProject(project);

    const didUpdate = useProjectStore.getState().updateCostumeFromEditor(
      {
        sceneId: scene.id,
        objectId: objectA.id,
        costumeId: 'costume-a',
      },
      {
        assetId: 'data:image/png;base64,EDITED_A',
        editorMode: 'vector',
      },
    );

    expect(didUpdate).toBe(true);

    const nextProject = useProjectStore.getState().project;
    expect(nextProject?.scenes[0]?.objects[0]?.costumes[0]?.assetId).toBe('data:image/png;base64,EDITED_A');
    expect(nextProject?.scenes[0]?.objects[1]?.costumes[0]?.assetId).toBe('data:image/png;base64,BBB');
  });

  test('rejects stale costume targets instead of overwriting another object', async () => {
    const project = createDefaultProject('Costume stale target test');
    const scene = project.scenes[0];
    const objectA = createObject('object-a', 'costume-a', 'data:image/png;base64,AAA');
    const objectB = createObject('object-b', 'costume-b', 'data:image/png;base64,BBB');
    scene.objects = [objectA, objectB];

    const useProjectStore = await openProject(project);

    const didUpdate = useProjectStore.getState().updateCostumeFromEditor(
      {
        sceneId: scene.id,
        objectId: objectB.id,
        costumeId: 'costume-a',
      },
      {
        assetId: 'data:image/png;base64,SHOULD_NOT_APPLY',
        editorMode: 'vector',
      },
    );

    expect(didUpdate).toBe(false);

    const nextProject = useProjectStore.getState().project;
    expect(nextProject?.scenes[0]?.objects[0]?.costumes[0]?.assetId).toBe('data:image/png;base64,AAA');
    expect(nextProject?.scenes[0]?.objects[1]?.costumes[0]?.assetId).toBe('data:image/png;base64,BBB');
  });

  test('updates shared component costumes through the same validated target API', async () => {
    const project = createDefaultProject('Component costume test');
    const scene = project.scenes[0];
    const sharedComponent: ComponentDefinition = {
      id: 'component-hero',
      name: 'Hero',
      blocklyXml: '',
      costumes: [
        {
          id: 'shared-costume',
          name: 'hero',
          assetId: 'data:image/png;base64,COMPONENT',
          editorMode: 'vector',
        },
      ],
      currentCostumeIndex: 0,
      physics: null,
      collider: null,
      sounds: [],
      localVariables: [],
    };
    const instance = createObject('instance-a', 'instance-costume', 'data:image/png;base64,INSTANCE');
    instance.componentId = sharedComponent.id;
    instance.costumes = [];
    scene.objects = [instance];
    project.components = [sharedComponent];

    const useProjectStore = await openProject(project);

    const didUpdate = useProjectStore.getState().updateCostumeFromEditor(
      {
        sceneId: scene.id,
        objectId: instance.id,
        costumeId: 'shared-costume',
      },
      {
        assetId: 'data:image/png;base64,UPDATED_COMPONENT',
        editorMode: 'vector',
      },
    );

    expect(didUpdate).toBe(true);

    const nextProject = useProjectStore.getState().project;
    expect(nextProject?.components[0]?.costumes[0]?.assetId).toBe('data:image/png;base64,UPDATED_COMPONENT');
    expect(nextProject?.scenes[0]?.objects[0]?.componentId).toBe(sharedComponent.id);
  });

  test('remembers object physics settings when physics is toggled off', async () => {
    const project = createDefaultProject('Physics collider sync');
    const scene = project.scenes[0];
    const object = createObject('object-a', 'costume-a', 'data:image/png;base64,AAA');
    scene.objects = [object];
    const rememberedPhysics = {
      ...createDefaultPhysicsConfig(),
      bounce: 0.65,
    };
    const rememberedCollider = createDefaultColliderConfig('box');

    const useProjectStore = await openProject(project);

    useProjectStore.getState().updateObject(scene.id, object.id, {
      physics: rememberedPhysics,
      collider: rememberedCollider,
    });

    let nextProject = useProjectStore.getState().project;
    expect(nextProject?.scenes[0]?.objects[0]?.physics).toEqual(rememberedPhysics);
    expect(nextProject?.scenes[0]?.objects[0]?.collider).toEqual(rememberedCollider);

    useProjectStore.getState().updateObject(scene.id, object.id, {
      physics: {
        ...rememberedPhysics,
        enabled: false,
      },
    });

    nextProject = useProjectStore.getState().project;
    expect(nextProject?.scenes[0]?.objects[0]?.physics).toEqual({
      ...rememberedPhysics,
      enabled: false,
    });
    expect(nextProject?.scenes[0]?.objects[0]?.collider).toEqual(rememberedCollider);

    useProjectStore.getState().updateObject(scene.id, object.id, {
      physics: rememberedPhysics,
    });

    nextProject = useProjectStore.getState().project;
    expect(nextProject?.scenes[0]?.objects[0]?.physics).toEqual(rememberedPhysics);
    expect(nextProject?.scenes[0]?.objects[0]?.collider).toEqual(rememberedCollider);

    useProjectStore.getState().updateObject(scene.id, object.id, {
      physics: null,
    });

    nextProject = useProjectStore.getState().project;
    expect(nextProject?.scenes[0]?.objects[0]?.physics).toBeNull();
    expect(nextProject?.scenes[0]?.objects[0]?.collider).toBeNull();
  });

  test('remembers component physics settings when physics is toggled off', async () => {
    const project = createDefaultProject('Component physics collider sync');
    const scene = project.scenes[0];
    const sharedComponent: ComponentDefinition = {
      id: 'component-hero',
      name: 'Hero',
      blocklyXml: '',
      costumes: [],
      currentCostumeIndex: 0,
      physics: null,
      collider: null,
      sounds: [],
      localVariables: [],
    };
    const instance = createObject('instance-a', 'instance-costume', 'data:image/png;base64,INSTANCE');
    instance.componentId = sharedComponent.id;
    instance.costumes = [];
    scene.objects = [instance];
    project.components = [sharedComponent];
    const rememberedPhysics = {
      ...createDefaultPhysicsConfig(),
      friction: 0.45,
    };
    const rememberedCollider = createDefaultColliderConfig('capsule');

    const useProjectStore = await openProject(project);

    useProjectStore.getState().updateComponent(sharedComponent.id, {
      physics: rememberedPhysics,
      collider: rememberedCollider,
    });

    let nextProject = useProjectStore.getState().project;
    expect(nextProject?.components[0]?.physics).toEqual(rememberedPhysics);
    expect(nextProject?.components[0]?.collider).toEqual(rememberedCollider);
    expect(nextProject?.scenes[0]?.objects[0]?.physics).toEqual(rememberedPhysics);
    expect(nextProject?.scenes[0]?.objects[0]?.collider).toEqual(rememberedCollider);

    useProjectStore.getState().updateComponent(sharedComponent.id, {
      physics: {
        ...rememberedPhysics,
        enabled: false,
      },
    });

    nextProject = useProjectStore.getState().project;
    expect(nextProject?.components[0]?.physics).toEqual({
      ...rememberedPhysics,
      enabled: false,
    });
    expect(nextProject?.components[0]?.collider).toEqual(rememberedCollider);
    expect(nextProject?.scenes[0]?.objects[0]?.physics).toEqual({
      ...rememberedPhysics,
      enabled: false,
    });
    expect(nextProject?.scenes[0]?.objects[0]?.collider).toEqual(rememberedCollider);

    useProjectStore.getState().updateComponent(sharedComponent.id, {
      physics: rememberedPhysics,
    });

    nextProject = useProjectStore.getState().project;
    expect(nextProject?.components[0]?.physics).toEqual(rememberedPhysics);
    expect(nextProject?.components[0]?.collider).toEqual(rememberedCollider);
    expect(nextProject?.scenes[0]?.objects[0]?.physics).toEqual(rememberedPhysics);
    expect(nextProject?.scenes[0]?.objects[0]?.collider).toEqual(rememberedCollider);
  });

  test('opens the costume editor with a scoped collider edit request', async () => {
    const { useEditorStore } = await loadStores();

    useEditorStore.getState().openCostumeColliderEditor('scene-a', 'object-a');

    expect(useEditorStore.getState().activeObjectTab).toBe('costumes');
    expect(useEditorStore.getState().costumeColliderEditorRequest).toEqual({
      sceneId: 'scene-a',
      objectId: 'object-a',
    });

    expect(useEditorStore.getState().consumeCostumeColliderEditorRequest('scene-b', 'object-a')).toBe(false);
    expect(useEditorStore.getState().costumeColliderEditorRequest).toEqual({
      sceneId: 'scene-a',
      objectId: 'object-a',
    });

    expect(useEditorStore.getState().consumeCostumeColliderEditorRequest('scene-a', 'object-a')).toBe(true);
    expect(useEditorStore.getState().costumeColliderEditorRequest).toBeNull();
  });

  test('persists the active session and renames another costume in one undo step', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const project = createDefaultProject('Costume rename transaction test');
    const scene = project.scenes[0];
    const object = createObjectWithCostumes('object-a', [
      { id: 'costume-a', name: 'idle', assetId: 'data:image/png;base64,AAA' },
      { id: 'costume-b', name: 'run', assetId: 'data:image/png;base64,BBB' },
    ]);
    scene.objects = [object];

    useProjectStore.getState().openProject(project);
    useEditorStore.getState().selectScene(scene.id, { recordHistory: false });
    useEditorStore.getState().selectObject(object.id, { recordHistory: false });

    const didUpdate = useProjectStore.getState().applyCostumeEditorOperation(
      { sceneId: scene.id, objectId: object.id },
      {
        persistedSession: {
          target: {
            sceneId: scene.id,
            objectId: object.id,
            costumeId: 'costume-a',
          },
          state: {
            assetId: 'data:image/png;base64,EDITED_A',
            editorMode: 'vector',
          },
        },
        operation: {
          type: 'rename',
          costumeId: 'costume-b',
          name: 'run-fast',
        },
      },
    );

    expect(didUpdate).toBe(true);
    expect(canUndoHistory()).toBe(true);

    let nextObject = useProjectStore.getState().project?.scenes[0]?.objects[0];
    expect(nextObject?.costumes[0]?.assetId).toBe('data:image/png;base64,EDITED_A');
    expect(nextObject?.costumes[1]?.name).toBe('run-fast');

    useEditorStore.getState().undo();

    nextObject = useProjectStore.getState().project?.scenes[0]?.objects[0];
    expect(nextObject?.costumes[0]?.assetId).toBe('data:image/png;base64,AAA');
    expect(nextObject?.costumes[1]?.name).toBe('run');
  });

  test('keeps save and costume selection in one undo step', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const project = createDefaultProject('Costume select transaction test');
    const scene = project.scenes[0];
    const object = createObjectWithCostumes('object-a', [
      { id: 'costume-a', name: 'idle', assetId: 'data:image/png;base64,AAA' },
      { id: 'costume-b', name: 'run', assetId: 'data:image/png;base64,BBB' },
    ]);
    scene.objects = [object];

    useProjectStore.getState().openProject(project);
    useEditorStore.getState().selectScene(scene.id, { recordHistory: false });
    useEditorStore.getState().selectObject(object.id, { recordHistory: false });

    const didUpdate = useProjectStore.getState().applyCostumeEditorOperation(
      { sceneId: scene.id, objectId: object.id },
      {
        persistedSession: {
          target: {
            sceneId: scene.id,
            objectId: object.id,
            costumeId: 'costume-a',
          },
          state: {
            assetId: 'data:image/png;base64,EDITED_A',
            editorMode: 'vector',
          },
        },
        operation: {
          type: 'select',
          costumeId: 'costume-b',
        },
      },
    );

    expect(didUpdate).toBe(true);
    expect(canUndoHistory()).toBe(true);

    let nextObject = useProjectStore.getState().project?.scenes[0]?.objects[0];
    expect(nextObject?.costumes[0]?.assetId).toBe('data:image/png;base64,EDITED_A');
    expect(nextObject?.currentCostumeIndex).toBe(1);

    useEditorStore.getState().undo();

    nextObject = useProjectStore.getState().project?.scenes[0]?.objects[0];
    expect(nextObject?.costumes[0]?.assetId).toBe('data:image/png;base64,AAA');
    expect(nextObject?.currentCostumeIndex).toBe(0);
  });

  test('persists the current costume before removing a different costume in one undo step', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const project = createDefaultProject('Costume remove transaction test');
    const scene = project.scenes[0];
    const object = createObjectWithCostumes('object-a', [
      { id: 'costume-a', name: 'idle', assetId: 'data:image/png;base64,AAA' },
      { id: 'costume-b', name: 'run', assetId: 'data:image/png;base64,BBB' },
      { id: 'costume-c', name: 'jump', assetId: 'data:image/png;base64,CCC' },
    ]);
    object.currentCostumeIndex = 0;
    scene.objects = [object];

    useProjectStore.getState().openProject(project);
    useEditorStore.getState().selectScene(scene.id, { recordHistory: false });
    useEditorStore.getState().selectObject(object.id, { recordHistory: false });

    const didUpdate = useProjectStore.getState().applyCostumeEditorOperation(
      { sceneId: scene.id, objectId: object.id },
      {
        persistedSession: {
          target: {
            sceneId: scene.id,
            objectId: object.id,
            costumeId: 'costume-a',
          },
          state: {
            assetId: 'data:image/png;base64,EDITED_A',
            editorMode: 'vector',
          },
        },
        operation: {
          type: 'remove',
          costumeId: 'costume-b',
        },
      },
    );

    expect(didUpdate).toBe(true);
    expect(canUndoHistory()).toBe(true);

    let nextObject = useProjectStore.getState().project?.scenes[0]?.objects[0];
    expect(nextObject?.costumes.map((costume) => costume.id)).toEqual(['costume-a', 'costume-c']);
    expect(nextObject?.costumes[0]?.assetId).toBe('data:image/png;base64,EDITED_A');

    useEditorStore.getState().undo();

    nextObject = useProjectStore.getState().project?.scenes[0]?.objects[0];
    expect(nextObject?.costumes.map((costume) => costume.id)).toEqual(['costume-a', 'costume-b', 'costume-c']);
    expect(nextObject?.costumes[0]?.assetId).toBe('data:image/png;base64,AAA');
  });

  test('adds a costume without requiring an existing editor session target', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Costume add without session test');
    const scene = project.scenes[0];
    const object = createDefaultGameObject('object-a');
    object.id = 'object-a';
    object.name = 'object-a';
    object.costumes = [];
    object.currentCostumeIndex = 0;
    scene.objects = [object];

    useProjectStore.getState().openProject(project);

    const didUpdate = useProjectStore.getState().applyCostumeEditorOperation(
      { sceneId: scene.id, objectId: object.id },
      {
        operation: {
          type: 'add',
          costume: {
            id: 'costume-a',
            name: 'idle',
            assetId: 'data:image/png;base64,AAA',
            editorMode: 'vector',
          },
        },
      },
    );

    expect(didUpdate).toBe(true);

    const nextObject = useProjectStore.getState().project?.scenes[0]?.objects[0];
    expect(nextObject?.costumes.map((costume) => costume.id)).toEqual(['costume-a']);
    expect(nextObject?.currentCostumeIndex).toBe(0);
  });

  test('object selection flushes the active costume edit in the same undo step', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const project = createDefaultProject('Costume selection transaction test');
    const scene = project.scenes[0];
    const objectA = createObject('object-a', 'costume-a', 'data:image/png;base64,AAA');
    const objectB = createObject('object-b', 'costume-b', 'data:image/png;base64,BBB');
    scene.objects = [objectA, objectB];

    useProjectStore.getState().openProject(project);
    useEditorStore.getState().selectScene(scene.id, { recordHistory: false });
    useEditorStore.getState().selectObject(objectA.id, { recordHistory: false });
    useEditorStore.setState({ activeObjectTab: 'costumes' });
    useEditorStore.getState().registerCostumeUndo({
      undo: () => undefined,
      redo: () => undefined,
      canUndo: () => false,
      canRedo: () => false,
      beforeSelectionChange: ({ recordHistory }) => {
        useProjectStore.getState().updateCostumeFromEditor(
          {
            sceneId: scene.id,
            objectId: objectA.id,
            costumeId: 'costume-a',
          },
          {
            assetId: 'data:image/png;base64,EDITED_A',
            editorMode: 'vector',
          },
          { recordHistory },
        );
      },
    });

    useEditorStore.getState().selectObject(objectB.id);

    expect(useEditorStore.getState().selectedObjectId).toBe(objectB.id);
    expect(useProjectStore.getState().project?.scenes[0]?.objects[0]?.costumes[0]?.assetId).toBe('data:image/png;base64,EDITED_A');
    expect(canUndoHistory()).toBe(true);

    useEditorStore.getState().undo();

    expect(useEditorStore.getState().selectedObjectId).toBe(objectA.id);
    expect(useProjectStore.getState().project?.scenes[0]?.objects[0]?.costumes[0]?.assetId).toBe('data:image/png;base64,AAA');
  });

  test('history-suppressed object selection does not leave a stray costume undo entry', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const project = createDefaultProject('Costume no-history selection test');
    const scene = project.scenes[0];
    const objectA = createObject('object-a', 'costume-a', 'data:image/png;base64,AAA');
    const objectB = createObject('object-b', 'costume-b', 'data:image/png;base64,BBB');
    scene.objects = [objectA, objectB];

    useProjectStore.getState().openProject(project);
    useEditorStore.getState().selectScene(scene.id, { recordHistory: false });
    useEditorStore.getState().selectObject(objectA.id, { recordHistory: false });
    useEditorStore.setState({ activeObjectTab: 'costumes' });
    useEditorStore.getState().registerCostumeUndo({
      undo: () => undefined,
      redo: () => undefined,
      canUndo: () => false,
      canRedo: () => false,
      beforeSelectionChange: ({ recordHistory }) => {
        useProjectStore.getState().updateCostumeFromEditor(
          {
            sceneId: scene.id,
            objectId: objectA.id,
            costumeId: 'costume-a',
          },
          {
            assetId: 'data:image/png;base64,EDITED_A',
            editorMode: 'vector',
          },
          { recordHistory },
        );
      },
    });

    useEditorStore.getState().selectObject(objectB.id, { recordHistory: false });

    expect(useEditorStore.getState().selectedObjectId).toBe(objectB.id);
    expect(useProjectStore.getState().project?.scenes[0]?.objects[0]?.costumes[0]?.assetId).toBe('data:image/png;base64,EDITED_A');
    expect(canUndoHistory()).toBe(false);
  });

  test('re-selecting the same object does not flush the costume editor into history', async () => {
    const { useProjectStore, useEditorStore, canUndoHistory } = await loadStores();
    const project = createDefaultProject('Costume same-selection test');
    const scene = project.scenes[0];
    const object = createObject('object-a', 'costume-a', 'data:image/png;base64,AAA');
    scene.objects = [object];

    useProjectStore.getState().openProject(project);
    useEditorStore.getState().selectScene(scene.id, { recordHistory: false });
    useEditorStore.getState().selectObject(object.id, { recordHistory: false });
    useEditorStore.setState({ activeObjectTab: 'costumes' });
    useEditorStore.getState().registerCostumeUndo({
      undo: () => undefined,
      redo: () => undefined,
      canUndo: () => false,
      canRedo: () => false,
      beforeSelectionChange: ({ recordHistory }) => {
        useProjectStore.getState().updateCostumeFromEditor(
          {
            sceneId: scene.id,
            objectId: object.id,
            costumeId: 'costume-a',
          },
          {
            assetId: 'data:image/png;base64,EDITED_A',
            editorMode: 'vector',
          },
          { recordHistory },
        );
      },
    });

    useEditorStore.getState().selectObject(object.id);

    expect(useEditorStore.getState().selectedObjectId).toBe(object.id);
    expect(useProjectStore.getState().project?.scenes[0]?.objects[0]?.costumes[0]?.assetId).toBe('data:image/png;base64,AAA');
    expect(canUndoHistory()).toBe(false);
  });
});
