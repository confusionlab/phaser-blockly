import { expect, test } from '@playwright/test';
import {
  getMessageReferenceImpact,
  getVariableReferenceImpact,
} from '../src/lib/projectReferenceUsage';
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

  test('blocks deleting a variable while blocks still reference it', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Variable Delete Guard');

    useProjectStore.getState().openProject(project);

    const variableId = crypto.randomUUID();
    useProjectStore.getState().addGlobalVariable({
      id: variableId,
      name: 'Score',
      type: 'number',
      defaultValue: 0,
      scope: 'global',
    });

    const sceneId = useProjectStore.getState().project?.scenes[0]?.id;
    expect(sceneId).toBeTruthy();
    if (!sceneId) return;

    const createdObject = useProjectStore.getState().addObject(sceneId, 'Player');
    useProjectStore.getState().updateObject(sceneId, createdObject.id, {
      blocklyXml: `<xml xmlns="https://developers.google.com/blockly/xml"><block type="typed_variable_get" id="block-1"><field name="VAR">${variableId}</field></block></xml>`,
    });

    const impact = useProjectStore.getState().getVariableDeletionImpact(variableId);
    expect(impact?.referenceCount).toBe(1);
    expect(impact?.usages).toEqual([
      expect.objectContaining({
        owner: { kind: 'object', sceneId, objectId: createdObject.id },
        title: 'Player',
        subtitle: 'Scene 1',
        referenceCount: 1,
      }),
    ]);

    const deleteResult = useProjectStore.getState().removeGlobalVariable(variableId);
    expect(deleteResult.deleted).toBe(false);
    expect(deleteResult.impact?.referenceCount).toBe(1);
    expect(useProjectStore.getState().project?.globalVariables.map((variable) => variable.id)).toContain(variableId);
  });

  test('blocks deleting a message while broadcast blocks still reference it', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Message Delete Guard');

    useProjectStore.getState().openProject(project);

    const message = useProjectStore.getState().addMessage('game over');
    expect(message).toBeTruthy();
    if (!message) return;

    const sceneId = useProjectStore.getState().project?.scenes[0]?.id;
    expect(sceneId).toBeTruthy();
    if (!sceneId) return;

    const createdObject = useProjectStore.getState().addObject(sceneId, 'Announcer');
    useProjectStore.getState().updateObject(sceneId, createdObject.id, {
      blocklyXml: `<xml xmlns="https://developers.google.com/blockly/xml"><block type="control_broadcast" id="block-1"><field name="MESSAGE">${message.id}</field></block></xml>`,
    });

    const impact = useProjectStore.getState().getMessageDeletionImpact(message.id);
    expect(impact?.referenceCount).toBe(1);
    expect(impact?.usages).toEqual([
      expect.objectContaining({
        owner: { kind: 'object', sceneId, objectId: createdObject.id },
        title: 'Announcer',
        subtitle: 'Scene 1',
        referenceCount: 1,
      }),
    ]);

    const deleteResult = useProjectStore.getState().removeMessage(message.id);
    expect(deleteResult.deleted).toBe(false);
    expect(deleteResult.impact?.referenceCount).toBe(1);
    expect(useProjectStore.getState().project?.messages.map((entry) => entry.id)).toContain(message.id);
  });

  test('blocks deleting a message while a legacy unique-name reference still exists', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Legacy Message Delete Guard');

    useProjectStore.getState().openProject(project);

    const message = useProjectStore.getState().addMessage('game over');
    expect(message).toBeTruthy();
    if (!message) return;

    const sceneId = useProjectStore.getState().project?.scenes[0]?.id;
    expect(sceneId).toBeTruthy();
    if (!sceneId) return;

    const createdObject = useProjectStore.getState().addObject(sceneId, 'Announcer');
    useProjectStore.getState().updateObject(sceneId, createdObject.id, {
      blocklyXml: '<xml xmlns="https://developers.google.com/blockly/xml"><block type="control_broadcast" id="block-1"><field name="MESSAGE">game over</field></block></xml>',
    });

    const impact = useProjectStore.getState().getMessageDeletionImpact(message.id);
    expect(impact?.referenceCount).toBe(1);
    expect(impact?.usages).toEqual([
      expect.objectContaining({
        owner: { kind: 'object', sceneId, objectId: createdObject.id },
        title: 'Announcer',
        subtitle: 'Scene 1',
        referenceCount: 1,
      }),
    ]);

    const deleteResult = useProjectStore.getState().removeMessage(message.id);
    expect(deleteResult.deleted).toBe(false);
    expect(deleteResult.impact?.referenceCount).toBe(1);
  });

  test('blocks direct component variable removal until code references are cleaned up', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Component Variable Guard');

    useProjectStore.getState().openProject(project);

    const component = useProjectStore.getState().addComponent('Enemy');
    expect(component).toBeTruthy();
    if (!component) return;

    const variableId = crypto.randomUUID();
    useProjectStore.getState().updateComponent(component.id, {
      localVariables: [{
        id: variableId,
        name: 'health',
        type: 'number',
        defaultValue: 10,
        scope: 'local',
      }],
      blocklyXml: `<xml xmlns="https://developers.google.com/blockly/xml"><block type="typed_variable_get" id="block-1"><field name="VAR">${variableId}</field></block></xml>`,
    });

    useProjectStore.getState().updateComponent(component.id, {
      localVariables: [],
    });
    expect(useProjectStore.getState().project?.components.find((entry) => entry.id === component.id)?.localVariables).toHaveLength(1);

    useProjectStore.getState().updateComponent(component.id, {
      blocklyXml: '<xml xmlns="https://developers.google.com/blockly/xml"></xml>',
      localVariables: [],
    });
    const nextComponent = useProjectStore.getState().project?.components.find((entry) => entry.id === component.id);
    expect(nextComponent?.localVariables).toHaveLength(0);
    expect(nextComponent?.blocklyXml).toContain('<xml');
  });

  test('blocks direct object variable removal until object code references are cleaned up', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Object Variable Guard');

    useProjectStore.getState().openProject(project);

    const sceneId = useProjectStore.getState().project?.scenes[0]?.id;
    expect(sceneId).toBeTruthy();
    if (!sceneId) return;

    const createdObject = useProjectStore.getState().addObject(sceneId, 'Player');
    const variableId = crypto.randomUUID();
    useProjectStore.getState().addLocalVariable(sceneId, createdObject.id, {
      id: variableId,
      name: 'score',
      type: 'number',
      defaultValue: 0,
      scope: 'local',
    });
    useProjectStore.getState().updateObject(sceneId, createdObject.id, {
      blocklyXml: `<xml xmlns="https://developers.google.com/blockly/xml"><block type="typed_variable_get" id="block-1"><field name="VAR">${variableId}</field></block></xml>`,
    });

    useProjectStore.getState().updateObject(sceneId, createdObject.id, {
      localVariables: [],
    });
    const unchangedObject = useProjectStore.getState().project?.scenes[0]?.objects.find((entry) => entry.id === createdObject.id);
    expect(unchangedObject?.localVariables).toHaveLength(1);

    useProjectStore.getState().updateObject(sceneId, createdObject.id, {
      blocklyXml: '<xml xmlns="https://developers.google.com/blockly/xml"></xml>',
      localVariables: [],
    });
    const updatedObject = useProjectStore.getState().project?.scenes[0]?.objects.find((entry) => entry.id === createdObject.id);
    expect(updatedObject?.localVariables).toHaveLength(0);
  });

  test('blocks removing legacy component-instance local variables through generic updates', async () => {
    const { useProjectStore } = await loadStores();
    const project = createDefaultProject('Legacy Component Variable Guard');

    useProjectStore.getState().openProject(project);

    const component = useProjectStore.getState().addComponent('Enemy');
    expect(component).toBeTruthy();
    if (!component) return;

    const sceneId = useProjectStore.getState().project?.scenes[0]?.id;
    expect(sceneId).toBeTruthy();
    if (!sceneId) return;

    const instance = useProjectStore.getState().addComponentInstance(sceneId, component.id);
    expect(instance).toBeTruthy();
    if (!instance) return;

    const variableId = crypto.randomUUID();
    useProjectStore.setState((state) => ({
      ...state,
      project: state.project
        ? {
            ...state.project,
            scenes: state.project.scenes.map((scene) =>
              scene.id === sceneId
                ? {
                    ...scene,
                    objects: scene.objects.map((object) =>
                      object.id === instance.id
                        ? {
                            ...object,
                            localVariables: [{
                              id: variableId,
                              name: 'health',
                              type: 'number',
                              defaultValue: 10,
                              scope: 'local',
                              objectId: instance.id,
                            }],
                          }
                        : object
                    ),
                  }
                : scene
            ),
          }
        : null,
    }));

    useProjectStore.getState().updateComponent(component.id, {
      blocklyXml: `<xml xmlns="https://developers.google.com/blockly/xml"><block type="typed_variable_get" id="block-1"><field name="VAR">${variableId}</field></block></xml>`,
    });

    useProjectStore.getState().updateComponent(component.id, {
      localVariables: [],
    });
    const blockedComponent = useProjectStore.getState().project?.components.find((entry) => entry.id === component.id);
    expect(blockedComponent?.localVariables).toHaveLength(0);
    const blockedInstance = useProjectStore.getState().project?.scenes[0]?.objects.find((entry) => entry.id === instance.id);
    expect(blockedInstance?.localVariables).toHaveLength(1);

    useProjectStore.getState().updateObject(sceneId, instance.id, {
      localVariables: [],
    });
    const stillBlockedInstance = useProjectStore.getState().project?.scenes[0]?.objects.find((entry) => entry.id === instance.id);
    expect(stillBlockedInstance?.localVariables).toHaveLength(1);

    useProjectStore.getState().updateComponent(component.id, {
      blocklyXml: '<xml xmlns="https://developers.google.com/blockly/xml"></xml>',
      localVariables: [],
    });
    const cleanedInstance = useProjectStore.getState().project?.scenes[0]?.objects.find((entry) => entry.id === instance.id);
    expect(cleanedInstance?.localVariables).toHaveLength(0);
  });

  test('finds references in components without duplicating them per instance', async () => {
    const project = createDefaultProject('Reference Impact Grouping');
    const variableId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    project.globalVariables.push({
      id: variableId,
      name: 'Lives',
      type: 'number',
      defaultValue: 3,
      scope: 'global',
    });
    project.messages.push({
      id: messageId,
      name: 'spawn',
    });

    const componentId = crypto.randomUUID();
    project.components.push({
      id: componentId,
      name: 'Enemy',
      folderId: null,
      order: 0,
      blocklyXml: `<xml xmlns="https://developers.google.com/blockly/xml"><block type="typed_variable_get" id="v1"><field name="VAR">${variableId}</field></block><block type="control_broadcast" id="m1"><field name="MESSAGE">${messageId}</field></block></xml>`,
      costumes: [],
      currentCostumeIndex: 0,
      physics: null,
      collider: null,
      sounds: [],
      localVariables: [],
    });

    project.scenes[0]?.objects.push({
      id: crypto.randomUUID(),
      name: 'Enemy A',
      spriteAssetId: null,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      visible: true,
      parentId: null,
      order: 0,
      componentId,
      physics: null,
      collider: null,
      blocklyXml: '',
      costumes: [],
      currentCostumeIndex: 0,
      sounds: [],
      localVariables: [],
    });
    project.scenes[0]?.objects.push({
      id: crypto.randomUUID(),
      name: 'Enemy B',
      spriteAssetId: null,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      visible: true,
      parentId: null,
      order: 1,
      componentId,
      physics: null,
      collider: null,
      blocklyXml: '',
      costumes: [],
      currentCostumeIndex: 0,
      sounds: [],
      localVariables: [],
    });

    const variableImpact = getVariableReferenceImpact(project, variableId);
    expect(variableImpact.referenceCount).toBe(1);
    expect(variableImpact.usages).toEqual([
      expect.objectContaining({
        owner: { kind: 'component', componentId },
        title: 'Enemy',
        subtitle: '2 linked objects',
        referenceCount: 1,
      }),
    ]);

    const messageImpact = getMessageReferenceImpact(project, messageId);
    expect(messageImpact.referenceCount).toBe(1);
    expect(messageImpact.usages).toEqual([
      expect.objectContaining({
        owner: { kind: 'component', componentId },
        title: 'Enemy',
        subtitle: '2 linked objects',
        referenceCount: 1,
      }),
    ]);
  });
});
