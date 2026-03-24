import { create } from 'zustand';
import type {
  Project,
  Scene,
  GameObject,
  Costume,
  Variable,
  ComponentDefinition,
  SceneFolder,
  MessageDefinition,
} from '../types';
import type { AssistantChangeSet } from '../../../../packages/ui-shared/src/assistant';
import { normalizeBlocklyXml } from '../../../../packages/ui-shared/src/blocklyXml';
import {
  createDefaultProject,
  createDefaultScene,
  createDefaultGameObject,
  createDefaultMessage,
} from '../types';
import { saveProject } from '../db/database';
import {
  getNextSiblingOrder,
  getObjectNodeKey,
  getSceneObjectsInLayerOrder,
  moveSceneLayerNodes,
  normalizeProjectLayering,
  normalizeSceneLayering,
} from '@/utils/layerTree';
import {
  hasVariableNameConflict,
  isValidVariableName,
  normalizeVariableDefinition,
  normalizeVariableDefinitions,
  remapVariableIdsInBlocklyXml,
} from '@/lib/variableUtils';
import { applyAssistantChangeSetToProject } from '@/lib/assistant/projectState';
import {
  recordHistoryChange,
  registerProjectHistoryBridge,
  resetHistory,
  runInHistoryTransaction,
} from '@/store/universalHistory';
import {
  applyCostumeEditorState,
  type CostumeEditorObjectTarget,
  type CostumeEditorOperation,
  type CostumeEditorPersistedSession,
  removeCostumeFromList,
  renameCostumeInList,
  resolveCostumeEditorObject,
  resolveCostumeEditorTarget,
  type CostumeEditorPersistedState,
  type CostumeEditorTarget,
} from '@/lib/editor/costumeEditorSession';

interface ProjectStore {
  project: Project | null;
  isDirty: boolean;

  // Project actions
  newProject: (name: string) => void;
  openProject: (project: Project) => void;
  saveCurrentProject: () => Promise<void>;
  closeProject: () => void;
  updateProjectName: (name: string) => void;
  updateProjectSettings: (settings: Partial<Project['settings']>) => void;
  applyAssistantChangeSet: (changeSet: AssistantChangeSet) => Project | null;
  addMessage: (name: string) => MessageDefinition | null;
  updateMessage: (messageId: string, updates: Partial<MessageDefinition>) => void;

  // Scene actions
  addScene: (name: string) => void;
  removeScene: (sceneId: string) => void;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  reorderScenes: (sceneIds: string[]) => void;

  // Object actions
  addObject: (sceneId: string, name: string) => GameObject;
  removeObject: (sceneId: string, objectId: string) => void;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
  updateCostumeFromEditor: (
    target: CostumeEditorTarget,
    state: CostumeEditorPersistedState,
    options?: { recordHistory?: boolean }
  ) => boolean;
  applyCostumeEditorOperation: (
    target: CostumeEditorObjectTarget,
    options: {
      persistedSession?: CostumeEditorPersistedSession;
      operation: CostumeEditorOperation;
    }
  ) => boolean;
  selectObjectCostume: (sceneId: string, objectId: string, costumeId: string) => boolean;
  addObjectCostume: (sceneId: string, objectId: string, costume: Costume) => boolean;
  removeObjectCostume: (target: CostumeEditorTarget) => boolean;
  renameObjectCostume: (target: CostumeEditorTarget, name: string) => boolean;
  duplicateObject: (sceneId: string, objectId: string) => GameObject | null;
  reorderObject: (sceneId: string, fromIndex: number, toIndex: number) => void;

  // Variable actions (global)
  addGlobalVariable: (variable: Variable) => void;
  removeGlobalVariable: (variableId: string) => void;
  updateGlobalVariable: (variableId: string, updates: Partial<Variable>) => void;

  // Variable actions (local - per object)
  addLocalVariable: (sceneId: string, objectId: string, variable: Variable) => void;
  removeLocalVariable: (sceneId: string, objectId: string, variableId: string) => void;
  updateLocalVariable: (sceneId: string, objectId: string, variableId: string, updates: Partial<Variable>) => void;

  // Legacy aliases
  addVariable: (variable: Variable) => void;
  removeVariable: (variableId: string) => void;
  updateVariable: (variableId: string, updates: Partial<Variable>) => void;

  // Component actions
  makeComponent: (sceneId: string, objectId: string) => ComponentDefinition | null;
  updateComponent: (componentId: string, updates: Partial<ComponentDefinition>) => void;
  deleteComponent: (componentId: string) => void;
  addComponentInstance: (sceneId: string, componentId: string) => GameObject | null;
  detachFromComponent: (sceneId: string, objectId: string) => void;

  // Helpers
  getScene: (sceneId: string) => Scene | undefined;
  getObject: (sceneId: string, objectId: string) => GameObject | undefined;
  getComponent: (componentId: string) => ComponentDefinition | undefined;
}

let lastUpdatedAtMs = 0;

type ComponentBackedObjectFields = Pick<
  GameObject,
  'name' | 'blocklyXml' | 'costumes' | 'currentCostumeIndex' | 'physics' | 'collider' | 'sounds' | 'localVariables'
>;

const COMPONENT_SYNC_KEYS: (keyof ComponentBackedObjectFields)[] = [
  'name',
  'blocklyXml',
  'costumes',
  'currentCostumeIndex',
  'physics',
  'collider',
  'sounds',
  'localVariables',
];

function seedUpdatedAt(project: Pick<Project, 'updatedAt'> | null | undefined): void {
  if (!(project?.updatedAt instanceof Date)) return;
  lastUpdatedAtMs = Math.max(lastUpdatedAtMs, project.updatedAt.getTime());
}

function createUpdatedAt(previous: Date | null = null): Date {
  const now = Date.now();
  const previousMs = previous instanceof Date ? previous.getTime() : 0;
  lastUpdatedAtMs = Math.max(now, previousMs + 1, lastUpdatedAtMs + 1);
  return new Date(lastUpdatedAtMs);
}

function cloneCostumes(costumes: GameObject['costumes']): GameObject['costumes'] {
  return (costumes || []).map((costume) => ({
    ...costume,
    bounds: costume.bounds ? { ...costume.bounds } : undefined,
    vectorDocument: costume.vectorDocument ? { ...costume.vectorDocument } : undefined,
  }));
}

function cloneSounds(sounds: GameObject['sounds']): GameObject['sounds'] {
  return (sounds || []).map((sound) => ({ ...sound }));
}

function clonePhysicsConfig(physics: GameObject['physics']): GameObject['physics'] {
  return physics ? { ...physics } : null;
}

function cloneColliderConfig(collider: GameObject['collider']): GameObject['collider'] {
  return collider ? { ...collider } : null;
}

function cloneVariableDefinitions(variables: GameObject['localVariables']): GameObject['localVariables'] {
  return (variables || []).map((variable) => ({ ...variable }));
}

function normalizeComponentName(name: string): string {
  return name.trim().toLowerCase();
}

function hasDuplicateVariableNames(variables: Variable[]): boolean {
  const seen = new Set<string>();
  for (const variable of variables) {
    const normalizedName = variable.name.trim().toLowerCase();
    if (!normalizedName) continue;
    if (seen.has(normalizedName)) return true;
    seen.add(normalizedName);
  }
  return false;
}

function toComponentBackedFieldsFromObject(obj: GameObject): Omit<ComponentDefinition, 'id'> {
  return {
    name: obj.name,
    blocklyXml: normalizeBlocklyXml(obj.blocklyXml),
    costumes: cloneCostumes(obj.costumes),
    currentCostumeIndex: obj.currentCostumeIndex,
    physics: clonePhysicsConfig(obj.physics),
    collider: cloneColliderConfig(obj.collider),
    sounds: cloneSounds(obj.sounds),
    localVariables: cloneVariableDefinitions(obj.localVariables),
  };
}

function toComponentBackedObjectFields(component: ComponentDefinition): ComponentBackedObjectFields {
  const costumes = cloneCostumes(component.costumes || []);
  const maxCostumeIndex = Math.max(0, costumes.length - 1);
  const safeCostumeIndex = Math.min(Math.max(component.currentCostumeIndex || 0, 0), maxCostumeIndex);

  return {
    name: component.name,
    blocklyXml: normalizeBlocklyXml(component.blocklyXml),
    costumes,
    currentCostumeIndex: safeCostumeIndex,
    physics: clonePhysicsConfig(component.physics ?? null),
    collider: cloneColliderConfig(component.collider ?? null),
    sounds: cloneSounds(component.sounds || []),
    localVariables: cloneVariableDefinitions(component.localVariables || []),
  };
}

function getEffectiveComponentLocalVariables(
  project: Project,
  componentId: string,
  preferredObjectId?: string,
): GameObject['localVariables'] {
  const component = (project.components || []).find((componentItem) => componentItem.id === componentId);
  const componentLocalVariables = component?.localVariables || [];
  if (componentLocalVariables.length > 0) {
    return cloneVariableDefinitions(componentLocalVariables);
  }

  if (preferredObjectId) {
    for (const scene of project.scenes) {
      const preferredObject = scene.objects.find((objectItem) => objectItem.id === preferredObjectId);
      if (preferredObject?.componentId === componentId && (preferredObject.localVariables || []).length > 0) {
        return cloneVariableDefinitions(preferredObject.localVariables || []);
      }
    }
  }

  for (const scene of project.scenes) {
    const existingInstance = scene.objects.find(
      (objectItem) => objectItem.componentId === componentId && (objectItem.localVariables || []).length > 0
    );
    if (existingInstance) {
      return cloneVariableDefinitions(existingInstance.localVariables || []);
    }
  }

  return [];
}

function applyObjectUpdatesToProject(
  project: Project,
  sceneId: string,
  objectId: string,
  updates: Partial<GameObject>,
): Project | null {
  const normalizedUpdates: Partial<GameObject> = {
    ...updates,
    ...(updates.blocklyXml !== undefined
      ? { blocklyXml: normalizeBlocklyXml(updates.blocklyXml) }
      : {}),
  };

  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  const obj = scene?.objects.find((candidate) => candidate.id === objectId);
  if (!obj) {
    return null;
  }

  if (obj.componentId) {
    const componentId = obj.componentId;
    const instanceOnlyKeys = new Set<keyof GameObject>([
      'x',
      'y',
      'scaleX',
      'scaleY',
      'visible',
      'rotation',
      'parentId',
      'order',
      'folderId',
      'layer',
    ]);
    const componentSyncKeys = COMPONENT_SYNC_KEYS as (keyof ComponentDefinition & keyof GameObject)[];

    const syncedUpdates: Partial<ComponentDefinition> = {};
    const instanceUpdates: Partial<GameObject> = {};

    for (const key of Object.keys(normalizedUpdates) as (keyof GameObject)[]) {
      if (instanceOnlyKeys.has(key)) {
        (instanceUpdates as Record<string, unknown>)[key] = normalizedUpdates[key];
      } else if ((componentSyncKeys as (keyof GameObject)[]).includes(key)) {
        (syncedUpdates as Record<string, unknown>)[key] = normalizedUpdates[key];
      } else {
        (instanceUpdates as Record<string, unknown>)[key] = normalizedUpdates[key];
      }
    }

    if (Object.keys(syncedUpdates).length > 0) {
      return {
        ...project,
        components: (project.components || []).map((component) =>
          component.id === componentId ? { ...component, ...syncedUpdates } : component
        ),
        scenes: project.scenes.map((candidateScene) => ({
          ...normalizeSceneLayering({
            ...candidateScene,
            objects: candidateScene.objects.map((candidateObject) => {
              if (candidateObject.componentId !== componentId) {
                return candidateObject;
              }

              const syncedObjectUpdates: Partial<GameObject> = {};
              for (const syncKey of componentSyncKeys) {
                const value = syncedUpdates[syncKey];
                if (value !== undefined) {
                  (syncedObjectUpdates as Record<string, unknown>)[syncKey] = value;
                }
              }

              if (candidateObject.id === objectId) {
                return { ...candidateObject, ...syncedObjectUpdates, ...instanceUpdates };
              }

              return { ...candidateObject, ...syncedObjectUpdates };
            }),
          }),
        })),
        updatedAt: createUpdatedAt(project.updatedAt),
      };
    }

    if (Object.keys(instanceUpdates).length > 0) {
      return {
        ...project,
        scenes: project.scenes.map((candidateScene) =>
          candidateScene.id === sceneId
            ? normalizeSceneLayering({
                ...candidateScene,
                objects: candidateScene.objects.map((candidateObject) =>
                  candidateObject.id === objectId ? { ...candidateObject, ...instanceUpdates } : candidateObject
                ),
              })
            : candidateScene
        ),
        updatedAt: createUpdatedAt(project.updatedAt),
      };
    }

    return null;
  }

  return {
    ...project,
    scenes: project.scenes.map((candidateScene) =>
      candidateScene.id === sceneId
        ? normalizeSceneLayering({
            ...candidateScene,
            objects: candidateScene.objects.map((candidateObject) =>
              candidateObject.id === objectId ? { ...candidateObject, ...normalizedUpdates } : candidateObject
            ),
          })
        : candidateScene
    ),
    updatedAt: createUpdatedAt(project.updatedAt),
  };
}

function buildCostumeEditorOperationUpdates(
  project: Project,
  target: CostumeEditorObjectTarget,
  options: {
    persistedSession?: CostumeEditorPersistedSession;
    operation: CostumeEditorOperation;
  },
): Partial<GameObject> | null {
  const resolvedObject = resolveCostumeEditorObject(project, target);
  if (!resolvedObject) {
    return null;
  }

  let nextCostumes = resolvedObject.costumes;
  let costumesChanged = false;
  let nextCostumeIndex = resolvedObject.currentCostumeIndex;
  const persistedSession = options.persistedSession;
  const operation = options.operation;

  if (persistedSession) {
    if (
      persistedSession.target.sceneId !== target.sceneId ||
      persistedSession.target.objectId !== target.objectId
    ) {
      return null;
    }

    const persistedCostumeIndex = nextCostumes.findIndex(
      (costume) => costume.id === persistedSession.target.costumeId,
    );
    if (persistedCostumeIndex < 0) {
      return null;
    }

    const persistedCostumes = applyCostumeEditorState(
      nextCostumes,
      persistedSession.target.costumeId,
      persistedSession.state,
    );
    if (persistedCostumes) {
      nextCostumes = persistedCostumes;
      costumesChanged = true;
    }
  }

  switch (operation.type) {
    case 'rename': {
      const renamedCostumes = renameCostumeInList(nextCostumes, operation.costumeId, operation.name);
      if (renamedCostumes) {
        nextCostumes = renamedCostumes;
        costumesChanged = true;
      }
      break;
    }
    case 'select': {
      const requestedIndex = nextCostumes.findIndex((costume) => costume.id === operation.costumeId);
      if (requestedIndex < 0) {
        return null;
      }
      nextCostumeIndex = requestedIndex;
      break;
    }
    case 'add': {
      nextCostumes = cloneCostumes([...nextCostumes, operation.costume]);
      costumesChanged = true;
      nextCostumeIndex = nextCostumes.length - 1;
      break;
    }
    case 'remove': {
      if (nextCostumes.length <= 1) {
        return null;
      }

      const removal = removeCostumeFromList(nextCostumes, operation.costumeId);
      if (!removal || removal.costumes.length === 0) {
        return null;
      }

      nextCostumes = removal.costumes;
      costumesChanged = true;
      nextCostumeIndex = resolvedObject.currentCostumeIndex > removal.removedIndex
        ? resolvedObject.currentCostumeIndex - 1
        : Math.min(resolvedObject.currentCostumeIndex, removal.costumes.length - 1);
      break;
    }
  }

  const updates: Partial<GameObject> = {};
  if (costumesChanged) {
    updates.costumes = cloneCostumes(nextCostumes);
  }
  if (nextCostumeIndex !== resolvedObject.currentCostumeIndex) {
    updates.currentCostumeIndex = nextCostumeIndex;
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

function getCostumeEditorOperationHistoryOptions(operation: CostumeEditorOperation): { source: string; allowMerge?: boolean } {
  switch (operation.type) {
    case 'rename':
      return { source: 'project:rename-object-costume', allowMerge: true };
    case 'select':
      return { source: 'project:select-object-costume' };
    case 'add':
      return { source: 'project:add-object-costume' };
    case 'remove':
      return { source: 'project:remove-object-costume' };
  }
}

function normalizeProject(project: Project): Project {
  const normalizedGlobalVariables = normalizeVariableDefinitions(project.globalVariables || [], { scope: 'global' });
  const normalizedComponents = (Array.isArray(project.components) ? project.components : []).map((component) => ({
    ...component,
    blocklyXml: normalizeBlocklyXml(component.blocklyXml || ''),
    localVariables: normalizeVariableDefinitions(component.localVariables || [], { scope: 'local' }),
  }));

  return normalizeProjectLayering({
    ...project,
    messages: (Array.isArray(project.messages) ? project.messages : []).filter(
      (message): message is MessageDefinition =>
        typeof message?.id === 'string' &&
        message.id.trim().length > 0 &&
        typeof message?.name === 'string' &&
        message.name.trim().length > 0,
    ),
    globalVariables: normalizedGlobalVariables,
    components: normalizedComponents,
    scenes: (Array.isArray(project.scenes) ? project.scenes : []).map((scene) => {
      const objectFolders: SceneFolder[] = Array.isArray(scene.objectFolders) ? scene.objectFolders : [];
      const objects: GameObject[] = (Array.isArray(scene.objects) ? scene.objects : []).map((obj) => ({
        ...obj,
        blocklyXml: normalizeBlocklyXml(obj.blocklyXml || ''),
        localVariables: normalizeVariableDefinitions(obj.localVariables || [], {
          scope: 'local',
          objectId: obj.componentId ? null : obj.id,
        }),
      }));
      return normalizeSceneLayering({
        ...scene,
        worldBoundary: scene.worldBoundary
          ? {
              enabled: !!scene.worldBoundary.enabled,
              points: Array.isArray(scene.worldBoundary.points)
                ? scene.worldBoundary.points
                    .filter(
                      (point): point is { x: number; y: number } =>
                        !!point && Number.isFinite(point.x) && Number.isFinite(point.y),
                    )
                    .map((point) => ({ x: point.x, y: point.y }))
                : [],
            }
          : {
              enabled: false,
              points: [],
            },
        objectFolders,
        objects,
      });
    }),
  });
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  isDirty: false,

  // Project actions
  newProject: (name: string) => {
    const project = createDefaultProject(name);
    seedUpdatedAt(project);
    set({ project, isDirty: true });
    resetHistory();
  },

  openProject: (project: Project) => {
    const normalizedProject = normalizeProject(project);
    seedUpdatedAt(normalizedProject);
    set({ project: normalizedProject, isDirty: false });
    resetHistory();
  },

  saveCurrentProject: async () => {
    const { project } = get();
    if (!project) return;

    const savedProject = await saveProject(project);
    set({ project: normalizeProject(savedProject), isDirty: false });
  },

  closeProject: () => {
    set({ project: null, isDirty: false });
    resetHistory();
  },

  updateProjectName: (name: string) => {
    set(state => ({
      project: state.project ? { ...state.project, name, updatedAt: createUpdatedAt() } : null,
      isDirty: true,
    }));
    recordHistoryChange({ source: 'project:update-name' });
  },

  updateProjectSettings: (settings: Partial<Project['settings']>) => {
    set(state => ({
      project: state.project
        ? {
            ...state.project,
            settings: { ...state.project.settings, ...settings },
            updatedAt: createUpdatedAt(),
          }
        : null,
      isDirty: true,
    }));
    recordHistoryChange({ source: 'project:update-settings', allowMerge: true });
  },

  applyAssistantChangeSet: (changeSet: AssistantChangeSet) => {
    const currentProject = get().project;
    if (!currentProject) return null;

    let nextProject: Project | null = null;
    runInHistoryTransaction('assistant:apply', () => {
      nextProject = {
        ...applyAssistantChangeSetToProject(currentProject, changeSet),
        updatedAt: createUpdatedAt(currentProject.updatedAt),
      };
      set({
        project: nextProject,
        isDirty: true,
      });
    });

    return nextProject;
  },

  addMessage: (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || !get().project) return null;

    const newMessage = createDefaultMessage(trimmedName);
    set(state => ({
      project: state.project
        ? {
            ...state.project,
            messages: [...(state.project.messages || []), newMessage],
            updatedAt: createUpdatedAt(),
          }
        : null,
      isDirty: true,
    }));
    recordHistoryChange({ source: 'project:add-message' });

    return newMessage;
  },

  updateMessage: (messageId: string, updates: Partial<MessageDefinition>) => {
    set(state => ({
      project: state.project
        ? {
            ...state.project,
            messages: (state.project.messages || []).map((message) =>
              message.id === messageId ? { ...message, ...updates } : message
            ),
            updatedAt: createUpdatedAt(),
          }
        : null,
      isDirty: true,
    }));
    recordHistoryChange({ source: 'project:update-message', allowMerge: true });
  },

  // Scene actions
  addScene: (name: string) => {
    set(state => {
      if (!state.project) return state;

      const newScene = createDefaultScene(
        crypto.randomUUID(),
        name,
        state.project.scenes.length
      );

      return {
        project: {
          ...state.project,
          scenes: [...state.project.scenes, newScene],
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:add-scene' });
  },

  removeScene: (sceneId: string) => {
    set(state => {
      if (!state.project || state.project.scenes.length <= 1) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.filter(s => s.id !== sceneId),
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:remove-scene' });
  },

  updateScene: (sceneId: string, updates: Partial<Scene>) => {
    set(state => {
      if (!state.project) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId ? normalizeSceneLayering({ ...s, ...updates }) : s
          ),
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:update-scene', allowMerge: true });
  },

  reorderScenes: (sceneIds: string[]) => {
    set(state => {
      if (!state.project) return state;

      const sceneMap = new Map(state.project.scenes.map(s => [s.id, s]));
      const reorderedScenes = sceneIds
        .map((id, index) => {
          const scene = sceneMap.get(id);
          return scene ? { ...scene, order: index } : null;
        })
        .filter((s): s is Scene => s !== null);

      return {
        project: {
          ...state.project,
          scenes: reorderedScenes,
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:reorder-scenes' });
  },

  // Object actions
  addObject: (sceneId: string, name: string) => {
    const scene = get().project?.scenes.find((s) => s.id === sceneId);
    const newObject = {
      ...createDefaultGameObject(name),
      parentId: null,
      order: scene ? getNextSiblingOrder(scene, null) : 0,
      folderId: undefined,
      layer: undefined,
    };

    set(state => {
      if (!state.project) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? normalizeSceneLayering({ ...s, objects: [...s.objects, newObject] })
              : s
          ),
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:add-object' });

    return newObject;
  },

  removeObject: (sceneId: string, objectId: string) => {
    set(state => {
      if (!state.project) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? normalizeSceneLayering({ ...s, objects: s.objects.filter(o => o.id !== objectId) })
              : s
          ),
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:remove-object' });
  },

  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => {
    let didUpdate = false;
    set((state) => {
      if (!state.project) return state;

      const nextProject = applyObjectUpdatesToProject(state.project, sceneId, objectId, updates);
      if (!nextProject) {
        return state;
      }

      didUpdate = true;
      return {
        project: nextProject,
        isDirty: true,
      };
    });
    if (didUpdate) {
      recordHistoryChange({ source: 'project:update-object', allowMerge: true });
    }
  },

  updateCostumeFromEditor: (target, costumeState, options) => {
    let didUpdate = false;
    set((state) => {
      if (!state.project) return state;

      const resolvedTarget = resolveCostumeEditorTarget(state.project, target);
      if (!resolvedTarget) {
        return state;
      }

      const nextCostumes = applyCostumeEditorState(
        resolvedTarget.costumes,
        target.costumeId,
        costumeState,
      );
      if (!nextCostumes) {
        return state;
      }

      const nextProject = applyObjectUpdatesToProject(state.project, target.sceneId, target.objectId, {
        costumes: nextCostumes,
      });
      if (!nextProject) {
        return state;
      }

      didUpdate = true;
      return {
        project: nextProject,
        isDirty: true,
      };
    });
    if (didUpdate && options?.recordHistory !== false) {
      recordHistoryChange({ source: 'project:update-object-costume', allowMerge: true });
    }
    return didUpdate;
  },

  applyCostumeEditorOperation: (target, options) => {
    let didUpdate = false;
    set((state) => {
      if (!state.project) return state;

      const updates = buildCostumeEditorOperationUpdates(state.project, target, options);
      if (!updates) {
        return state;
      }

      const nextProject = applyObjectUpdatesToProject(state.project, target.sceneId, target.objectId, updates);
      if (!nextProject) {
        return state;
      }

      didUpdate = true;
      return {
        project: nextProject,
        isDirty: true,
      };
    });
    if (didUpdate) {
      recordHistoryChange(getCostumeEditorOperationHistoryOptions(options.operation));
    }
    return didUpdate;
  },

  selectObjectCostume: (sceneId, objectId, costumeId) => {
    return get().applyCostumeEditorOperation(
      { sceneId, objectId },
      { operation: { type: 'select', costumeId } },
    );
  },

  addObjectCostume: (sceneId, objectId, costume) => {
    return get().applyCostumeEditorOperation(
      { sceneId, objectId },
      { operation: { type: 'add', costume } },
    );
  },

  removeObjectCostume: (target) => {
    return get().applyCostumeEditorOperation(
      { sceneId: target.sceneId, objectId: target.objectId },
      { operation: { type: 'remove', costumeId: target.costumeId } },
    );
  },

  renameObjectCostume: (target, name) => {
    return get().applyCostumeEditorOperation(
      { sceneId: target.sceneId, objectId: target.objectId },
      { operation: { type: 'rename', costumeId: target.costumeId, name } },
    );
  },

  duplicateObject: (sceneId: string, objectId: string) => {
    const state = get();
    if (!state.project) return null;

    const scene = state.project.scenes.find(s => s.id === sceneId);
    const original = scene?.objects.find(o => o.id === objectId);
    if (!original) return null;
    const originalIndex = scene?.objects.findIndex(o => o.id === objectId) ?? -1;

    const duplicateId = crypto.randomUUID();
    let duplicateBlocklyXml = original.blocklyXml;
    let duplicateLocalVariables = cloneVariableDefinitions(original.localVariables || []);

    if (!original.componentId) {
      const variableIdMap = new Map<string, string>();
      duplicateLocalVariables = (original.localVariables || []).map((variable) => {
        const remappedId = crypto.randomUUID();
        variableIdMap.set(variable.id, remappedId);
        return normalizeVariableDefinition(
          { ...variable, id: remappedId },
          { scope: 'local', objectId: duplicateId },
        );
      });
      duplicateBlocklyXml = remapVariableIdsInBlocklyXml(original.blocklyXml || '', variableIdMap);
    }
    duplicateBlocklyXml = normalizeBlocklyXml(duplicateBlocklyXml);

    const duplicate: GameObject = {
      ...original,
      id: duplicateId,
      // Component instances keep the original name (they're instances of the same component)
      name: original.componentId ? original.name : `${original.name} Copy`,
      x: original.x + 50,
      y: original.y + 50,
      order: original.order + 1,
      blocklyXml: duplicateBlocklyXml,
      localVariables: duplicateLocalVariables,
    };

    set(state => ({
      project: state.project
        ? {
            ...state.project,
            scenes: state.project.scenes.map(s =>
              s.id === sceneId
                ? normalizeSceneLayering({
                    ...s,
                    objects: (() => {
                      const originalParentId = original.parentId ?? null;
                      const next = s.objects.map((obj) => {
                        if (obj.id === original.id) return obj;
                        if ((obj.parentId ?? null) !== originalParentId) return obj;
                        if (obj.order >= duplicate.order) {
                          return { ...obj, order: obj.order + 1 };
                        }
                        return obj;
                      });
                      const insertIndex = originalIndex >= 0 ? originalIndex + 1 : next.length;
                      next.splice(insertIndex, 0, duplicate);
                      return next;
                    })(),
                  })
                : s
            ),
            updatedAt: createUpdatedAt(),
          }
        : null,
      isDirty: true,
    }));
    recordHistoryChange({ source: 'project:duplicate-object' });

    return duplicate;
  },

  reorderObject: (sceneId: string, fromIndex: number, toIndex: number) => {
    set(state => {
      if (!state.project) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => {
            if (s.id !== sceneId) return s;

            const orderedObjects = getSceneObjectsInLayerOrder(s);
            const boundedFrom = Math.max(0, Math.min(fromIndex, orderedObjects.length - 1));
            const boundedTo = Math.max(0, Math.min(toIndex, orderedObjects.length - 1));
            const moved = orderedObjects[boundedFrom];
            const target = orderedObjects[boundedTo];
            if (!moved || !target || moved.id === target.id) return s;

            return moveSceneLayerNodes(
              s,
              [getObjectNodeKey(moved.id)],
              {
                key: getObjectNodeKey(target.id),
                dropPosition: boundedTo > boundedFrom ? 'after' : 'before',
              },
            );
          }),
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:reorder-object' });
  },

  // Variable actions (global)
  addGlobalVariable: (variable: Variable) => {
    set(state => {
      if (!state.project) return state;

      const nextVariable = normalizeVariableDefinition(variable, { scope: 'global' });
      if (!isValidVariableName(nextVariable.name)) return state;
      if (state.project.globalVariables.some((existing) => existing.id === nextVariable.id)) return state;
      if (hasVariableNameConflict(state.project.globalVariables, nextVariable.name)) return state;

      return {
        project: {
          ...state.project,
          globalVariables: [...state.project.globalVariables, nextVariable],
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:add-global-variable' });
  },

  removeGlobalVariable: (variableId: string) => {
    set(state => ({
      project: state.project
        ? {
            ...state.project,
            globalVariables: state.project.globalVariables.filter(v => v.id !== variableId),
            updatedAt: createUpdatedAt(),
          }
        : null,
      isDirty: true,
    }));
    recordHistoryChange({ source: 'project:remove-global-variable' });
  },

  updateGlobalVariable: (variableId: string, updates: Partial<Variable>) => {
    set(state => {
      if (!state.project) return state;

      const current = state.project.globalVariables.find((variable) => variable.id === variableId);
      if (!current) return state;

      const nextVariable = normalizeVariableDefinition(
        { ...current, ...updates, id: current.id },
        { scope: 'global' },
      );
      if (!isValidVariableName(nextVariable.name)) return state;
      if (hasVariableNameConflict(state.project.globalVariables, nextVariable.name, variableId)) return state;

      return {
        project: {
          ...state.project,
          globalVariables: state.project.globalVariables.map((variable) =>
            variable.id === variableId ? nextVariable : variable
          ),
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:update-global-variable', allowMerge: true });
  },

  // Variable actions (local - per object)
  addLocalVariable: (sceneId: string, objectId: string, variable: Variable) => {
    set(state => {
      if (!state.project) return state;

      const scene = state.project.scenes.find((s) => s.id === sceneId);
      const targetObject = scene?.objects.find((o) => o.id === objectId);
      if (!targetObject) return state;

      if (targetObject.componentId) {
        const componentId = targetObject.componentId;
        const component = (state.project.components || []).find((c) => c.id === componentId);
        if (!component) return state;

        const currentLocalVariables = getEffectiveComponentLocalVariables(state.project, componentId, objectId);
        const normalizedVariable = normalizeVariableDefinition(variable, { scope: 'local' });
        if (!isValidVariableName(normalizedVariable.name)) return state;
        if (currentLocalVariables.some((existing) => existing.id === normalizedVariable.id)) {
          return state;
        }
        if (hasVariableNameConflict(currentLocalVariables, normalizedVariable.name)) {
          return state;
        }
        const nextLocalVariables: Variable[] = [...currentLocalVariables, normalizedVariable];

        return {
          project: {
            ...state.project,
            components: (state.project.components || []).map((componentItem) =>
              componentItem.id === componentId
                ? { ...componentItem, localVariables: cloneVariableDefinitions(nextLocalVariables) }
                : componentItem
            ),
            scenes: state.project.scenes.map((sceneItem) => ({
              ...sceneItem,
              objects: sceneItem.objects.map((objectItem) =>
                objectItem.componentId === componentId
                  ? { ...objectItem, localVariables: cloneVariableDefinitions(nextLocalVariables) }
                  : objectItem
              ),
            })),
            updatedAt: createUpdatedAt(),
          },
          isDirty: true,
        };
      }

      const currentLocalVariables = targetObject.localVariables || [];
      const normalizedVariable = normalizeVariableDefinition(variable, { scope: 'local', objectId });
      if (!isValidVariableName(normalizedVariable.name)) return state;
      if (currentLocalVariables.some((existing) => existing.id === normalizedVariable.id)) return state;
      if (hasVariableNameConflict(currentLocalVariables, normalizedVariable.name)) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? {
                  ...s,
                  objects: s.objects.map(o =>
                    o.id === objectId
                      ? { ...o, localVariables: [...(o.localVariables || []), normalizedVariable] }
                      : o
                  ),
                }
              : s
          ),
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:add-local-variable' });
  },

  removeLocalVariable: (sceneId: string, objectId: string, variableId: string) => {
    set(state => {
      if (!state.project) return state;

      const scene = state.project.scenes.find((s) => s.id === sceneId);
      const targetObject = scene?.objects.find((o) => o.id === objectId);
      if (!targetObject) return state;

      if (targetObject.componentId) {
        const componentId = targetObject.componentId;
        const component = (state.project.components || []).find((c) => c.id === componentId);
        if (!component) return state;

        const currentLocalVariables = getEffectiveComponentLocalVariables(state.project, componentId, objectId);
        if (!currentLocalVariables.some((existing) => existing.id === variableId)) {
          return state;
        }
        const nextLocalVariables: Variable[] = currentLocalVariables.filter((existing) => existing.id !== variableId);

        return {
          project: {
            ...state.project,
            components: (state.project.components || []).map((componentItem) =>
              componentItem.id === componentId
                ? { ...componentItem, localVariables: cloneVariableDefinitions(nextLocalVariables) }
                : componentItem
            ),
            scenes: state.project.scenes.map((sceneItem) => ({
              ...sceneItem,
              objects: sceneItem.objects.map((objectItem) =>
                objectItem.componentId === componentId
                  ? { ...objectItem, localVariables: cloneVariableDefinitions(nextLocalVariables) }
                  : objectItem
              ),
            })),
            updatedAt: createUpdatedAt(),
          },
          isDirty: true,
        };
      }

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? {
                  ...s,
                  objects: s.objects.map(o =>
                    o.id === objectId
                      ? { ...o, localVariables: (o.localVariables || []).filter(v => v.id !== variableId) }
                      : o
                  ),
                }
              : s
          ),
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:remove-local-variable' });
  },

  updateLocalVariable: (sceneId: string, objectId: string, variableId: string, updates: Partial<Variable>) => {
    set(state => {
      if (!state.project) return state;

      const scene = state.project.scenes.find((s) => s.id === sceneId);
      const targetObject = scene?.objects.find((o) => o.id === objectId);
      if (!targetObject) return state;

      if (targetObject.componentId) {
        const componentId = targetObject.componentId;
        const component = (state.project.components || []).find((c) => c.id === componentId);
        if (!component) return state;

        const currentLocalVariables = getEffectiveComponentLocalVariables(state.project, componentId, objectId);
        const currentVariable = currentLocalVariables.find((existing) => existing.id === variableId);
        if (!currentVariable) {
          return state;
        }
        const nextVariable = normalizeVariableDefinition(
          { ...currentVariable, ...updates, id: currentVariable.id },
          { scope: 'local' },
        );
        if (!isValidVariableName(nextVariable.name)) return state;
        if (hasVariableNameConflict(currentLocalVariables, nextVariable.name, variableId)) return state;
        const nextLocalVariables: Variable[] = currentLocalVariables.map((existing) =>
          existing.id === variableId ? nextVariable : existing
        );

        return {
          project: {
            ...state.project,
            components: (state.project.components || []).map((componentItem) =>
              componentItem.id === componentId
                ? { ...componentItem, localVariables: cloneVariableDefinitions(nextLocalVariables) }
                : componentItem
            ),
            scenes: state.project.scenes.map((sceneItem) => ({
              ...sceneItem,
              objects: sceneItem.objects.map((objectItem) =>
                objectItem.componentId === componentId
                  ? { ...objectItem, localVariables: cloneVariableDefinitions(nextLocalVariables) }
                  : objectItem
              ),
            })),
            updatedAt: createUpdatedAt(),
          },
          isDirty: true,
        };
      }

      const currentLocalVariables = targetObject.localVariables || [];
      const currentVariable = currentLocalVariables.find((existing) => existing.id === variableId);
      if (!currentVariable) return state;
      const nextVariable = normalizeVariableDefinition(
        { ...currentVariable, ...updates, id: currentVariable.id },
        { scope: 'local', objectId },
      );
      if (!isValidVariableName(nextVariable.name)) return state;
      if (hasVariableNameConflict(currentLocalVariables, nextVariable.name, variableId)) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? {
                  ...s,
                  objects: s.objects.map(o =>
                    o.id === objectId
                      ? {
                          ...o,
                          localVariables: (o.localVariables || []).map(v =>
                            v.id === variableId ? nextVariable : v
                          ),
                        }
                      : o
                  ),
                }
              : s
          ),
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:update-local-variable', allowMerge: true });
  },

  // Legacy aliases
  addVariable: (variable: Variable) => {
    get().addGlobalVariable(variable);
  },

  removeVariable: (variableId: string) => {
    get().removeGlobalVariable(variableId);
  },

  updateVariable: (variableId: string, updates: Partial<Variable>) => {
    get().updateGlobalVariable(variableId, updates);
  },

  // Component actions
  makeComponent: (sceneId: string, objectId: string) => {
    const state = get();
    if (!state.project) return null;

    const scene = state.project.scenes.find(s => s.id === sceneId);
    const obj = scene?.objects.find(o => o.id === objectId);
    if (!obj) return null;

    // Don't convert if already a component instance
    if (obj.componentId) return null;

    // Enforce unique component names (case-insensitive).
    const requestedName = normalizeComponentName(obj.name || '');
    if (!requestedName) return null;
    const hasDuplicateName = (state.project.components || []).some(
      (component) => normalizeComponentName(component.name) === requestedName
    );
    if (hasDuplicateName) return null;

    // Create component definition from the object
    const componentId = crypto.randomUUID();
    const component: ComponentDefinition = {
      id: componentId,
      ...toComponentBackedFieldsFromObject(obj),
    };

    set(state => ({
      project: state.project
        ? {
            ...state.project,
            components: [...(state.project.components || []), component],
            scenes: state.project.scenes.map(s =>
              s.id === sceneId
                ? {
                    ...s,
                    objects: s.objects.map(o =>
                      o.id === objectId
                        ? { ...o, componentId }
                        : o
                    ),
                  }
                : s
            ),
            updatedAt: createUpdatedAt(),
          }
        : null,
      isDirty: true,
    }));
    recordHistoryChange({ source: 'project:make-component' });

    return component;
  },

  updateComponent: (componentId: string, updates: Partial<ComponentDefinition>) => {
    set(state => {
      if (!state.project) return state;

      const componentExists = (state.project.components || []).some((component) => component.id === componentId);
      if (!componentExists) return state;

      const normalizedUpdates: Partial<ComponentDefinition> = { ...updates };
      if (updates.blocklyXml !== undefined) {
        normalizedUpdates.blocklyXml = normalizeBlocklyXml(updates.blocklyXml);
      }
      if (updates.localVariables !== undefined) {
        const normalizedLocalVariables = normalizeVariableDefinitions(updates.localVariables, { scope: 'local' });
        if (hasDuplicateVariableNames(normalizedLocalVariables)) return state;
        normalizedUpdates.localVariables = normalizedLocalVariables;
      }

      const syncedInstanceUpdates: Partial<ComponentBackedObjectFields> = {};
      for (const key of COMPONENT_SYNC_KEYS) {
        const value = normalizedUpdates[key];
        if (value !== undefined) {
          (syncedInstanceUpdates as Record<string, unknown>)[key] = value;
        }
      }
      const hasSyncedUpdates = Object.keys(syncedInstanceUpdates).length > 0;

      return {
        project: {
          ...state.project,
          components: (state.project.components || []).map((component) =>
            component.id === componentId ? { ...component, ...normalizedUpdates } : component
          ),
          scenes: hasSyncedUpdates
            ? state.project.scenes.map((scene) => ({
                ...normalizeSceneLayering({
                  ...scene,
                  objects: scene.objects.map((obj) =>
                    obj.componentId === componentId ? { ...obj, ...syncedInstanceUpdates } : obj
                  ),
                }),
              }))
            : state.project.scenes,
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:update-component', allowMerge: true });
  },

  deleteComponent: (componentId: string) => {
    set(state => {
      if (!state.project) return state;

      // Detach all instances first
      const updatedScenes = state.project.scenes.map(scene =>
        normalizeSceneLayering({
          ...scene,
          objects: scene.objects.map(obj => {
            if (obj.componentId === componentId) {
              const component = (state.project!.components || []).find(c => c.id === componentId);
              if (component) {
                // Copy component data back to the object
                return {
                  ...obj,
                  componentId: undefined,
                  ...toComponentBackedObjectFields(component),
                };
              }
            }
            return obj;
          }),
        }),
      );

      return {
        project: {
          ...state.project,
          components: (state.project.components || []).filter(c => c.id !== componentId),
          scenes: updatedScenes,
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:delete-component' });
  },

  addComponentInstance: (sceneId: string, componentId: string) => {
    const state = get();
    if (!state.project) return null;

    const component = (state.project.components || []).find(c => c.id === componentId);
    if (!component) return null;
    const scene = state.project.scenes.find((s) => s.id === sceneId);
    const componentFields = toComponentBackedObjectFields(component);
    componentFields.localVariables = getEffectiveComponentLocalVariables(state.project, componentId);

    const newObject: GameObject = {
      id: crypto.randomUUID(),
      ...componentFields,
      spriteAssetId: null,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      visible: true,
      parentId: null,
      order: scene ? getNextSiblingOrder(scene, null) : 0,
      layer: undefined,
      componentId,
    };

    set(state => ({
      project: state.project
        ? {
            ...state.project,
            scenes: state.project.scenes.map(s =>
              s.id === sceneId
                ? normalizeSceneLayering({ ...s, objects: [...s.objects, newObject] })
                : s
            ),
            updatedAt: createUpdatedAt(),
          }
        : null,
      isDirty: true,
    }));
    recordHistoryChange({ source: 'project:add-component-instance' });

    return newObject;
  },

  detachFromComponent: (sceneId: string, objectId: string) => {
    set(state => {
      if (!state.project) return state;

      const scene = state.project.scenes.find(s => s.id === sceneId);
      const obj = scene?.objects.find(o => o.id === objectId);
      if (!obj?.componentId) return state;

      const component = (state.project.components || []).find(c => c.id === obj.componentId);
      if (!component) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? {
                  ...s,
                  objects: s.objects.map(o =>
                    o.id === objectId
                      ? {
                          ...o,
                          componentId: undefined,
                          ...toComponentBackedObjectFields(component),
                        }
                      : o
                  ),
                }
              : s
          ),
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:detach-component' });
  },

  // Helpers
  getScene: (sceneId: string) => {
    const { project } = get();
    return project?.scenes.find(s => s.id === sceneId);
  },

  getObject: (sceneId: string, objectId: string) => {
    const scene = get().getScene(sceneId);
    return scene?.objects.find(o => o.id === objectId);
  },

  getComponent: (componentId: string) => {
    const { project } = get();
    return (project?.components || []).find(c => c.id === componentId);
  },
}));

registerProjectHistoryBridge(
  () => useProjectStore.getState().project,
  (project) => {
    useProjectStore.setState({
      project,
    });
  },
);
