import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type {
  Project,
  Scene,
  GameObject,
  Costume,
  Variable,
  ComponentDefinition,
  ComponentFolder,
  SceneFolder,
  MessageDefinition,
} from '../types';
import type { AssistantChangeSet } from '../../../../packages/ui-shared/src/assistant';
import { normalizeBlocklyXml } from '../../../../packages/ui-shared/src/blocklyXml';
import { normalizePhysicsColliderState } from '../../../../packages/ui-shared/src/physicsCollider';
import {
  createDefaultColliderConfig,
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
  normalizeFolderedHierarchy,
  type FolderedItemShape,
} from '@/utils/hierarchyTree';
import {
  hasVariableNameConflict,
  isValidVariableName,
  normalizeVariableDefinition,
  normalizeVariableDefinitions,
  remapVariableIdsInBlocklyXml,
} from '@/lib/variableUtils';
import { validateProjectName } from '@/lib/projectName';
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
import {
  cloneCostume,
  ensureCostumeDocument,
} from '@/lib/costume/costumeDocument';
import {
  cloneBackgroundDocument,
  ensureBackgroundDocument,
} from '@/lib/background/backgroundDocument';
import { useEditorStore } from '@/store/editorStore';

interface ProjectStore {
  project: Project | null;
  isDirty: boolean;

  // Project actions
  newProject: (name: string) => void;
  openProject: (project: Project) => void;
  saveCurrentProject: () => Promise<void>;
  acknowledgeProjectSaved: (project: Project) => boolean;
  closeProject: () => void;
  updateProjectName: (name: string) => void;
  updateProjectSettings: (settings: Partial<Project['settings']>) => void;
  applyAssistantChangeSet: (changeSet: AssistantChangeSet) => Project | null;
  addMessage: (name: string) => MessageDefinition | null;
  updateMessage: (messageId: string, updates: Partial<MessageDefinition>) => void;

  // Scene actions
  addScene: (name: string) => void;
  addSceneFromTemplate: (template: {
    name: string;
    scene: Scene;
    components: ComponentDefinition[];
    componentFolders: ComponentFolder[];
  }) => Scene | null;
  removeScene: (sceneId: string) => void;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  reorderScenes: (sceneIds: string[]) => void;
  updateSceneOrganization: (scenes: Scene[], sceneFolders: SceneFolder[]) => void;

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
  addComponentFromLibrary: (data: {
    name: string;
    costumes: Costume[];
    sounds: GameObject['sounds'];
    blocklyXml: string;
    currentCostumeIndex: number;
    physics: GameObject['physics'];
    collider: GameObject['collider'];
    localVariables: Variable[];
  }) => ComponentDefinition | null;
  makeComponent: (sceneId: string, objectId: string) => ComponentDefinition | null;
  updateComponent: (componentId: string, updates: Partial<ComponentDefinition>) => void;
  updateComponentOrganization: (components: ComponentDefinition[], componentFolders: ComponentFolder[]) => void;
  deleteComponent: (componentId: string) => void;
  addComponentInstance: (sceneId: string, componentId: string) => GameObject | null;
  detachFromComponent: (sceneId: string, objectId: string) => void;

  // Helpers
  getScene: (sceneId: string) => Scene | undefined;
  getObject: (sceneId: string, objectId: string) => GameObject | undefined;
  getComponent: (componentId: string) => ComponentDefinition | undefined;
}

type ProjectStoreHook = UseBoundStore<StoreApi<ProjectStore>>;
type ProjectStoreGlobal = typeof globalThis & {
  __pochaProjectStore?: ProjectStoreHook;
};

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
  return (costumes || []).map((costume) =>
    cloneCostume({
      ...costume,
      document: ensureCostumeDocument(costume),
    })
  );
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

function cloneBackgroundConfig(background: Scene['background']): Scene['background'] {
  if (!background) {
    return null;
  }

  return {
    ...background,
    scrollFactor: background.scrollFactor ? { ...background.scrollFactor } : undefined,
    chunks: background.chunks ? { ...background.chunks } : undefined,
    document: background.document ? cloneBackgroundDocument(ensureBackgroundDocument(background)) : undefined,
  };
}

type PhysicsColliderEntity = {
  physics: GameObject['physics'];
  collider: GameObject['collider'];
};

function normalizePhysicsCollider<TEntity extends PhysicsColliderEntity>(entity: TEntity): TEntity {
  return normalizePhysicsColliderState(entity, () => createDefaultColliderConfig());
}

function cloneVariableDefinitions(variables: GameObject['localVariables']): GameObject['localVariables'] {
  return (variables || []).map((variable) => ({ ...variable }));
}

function normalizeComponentName(name: string): string {
  return name.trim().toLowerCase();
}

function getUniqueComponentName(
  requestedName: string,
  usedNames: Set<string>,
): string {
  const baseName = requestedName.trim() || 'Component';
  let nextName = baseName;
  let suffix = 2;
  while (usedNames.has(normalizeComponentName(nextName))) {
    nextName = `${baseName} ${suffix}`;
    suffix += 1;
  }
  usedNames.add(normalizeComponentName(nextName));
  return nextName;
}

const sceneHierarchyConfig = {
  itemKeyPrefix: 'scene',
  setItemFolderId: (scene: Scene, folderId: string | null): Scene => ({
    ...scene,
    folderId,
  }),
  setItemOrder: (scene: Scene, order: number): Scene => ({
    ...scene,
    order,
  }),
};

const componentHierarchyConfig = {
  itemKeyPrefix: 'component',
  setItemFolderId: (component: ComponentDefinition, folderId: string | null): ComponentDefinition => ({
    ...component,
    folderId,
  }),
  setItemOrder: (component: ComponentDefinition, order: number): ComponentDefinition => ({
    ...component,
    order,
  }),
};

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
  const normalizedPhysicsCollider = normalizePhysicsCollider({
    physics: clonePhysicsConfig(obj.physics),
    collider: cloneColliderConfig(obj.collider),
  });

  return {
    name: obj.name,
    blocklyXml: normalizeBlocklyXml(obj.blocklyXml),
    costumes: cloneCostumes(obj.costumes),
    currentCostumeIndex: obj.currentCostumeIndex,
    physics: normalizedPhysicsCollider.physics,
    collider: normalizedPhysicsCollider.collider,
    sounds: cloneSounds(obj.sounds),
    localVariables: cloneVariableDefinitions(obj.localVariables),
  };
}

function toComponentBackedObjectFields(component: ComponentDefinition): ComponentBackedObjectFields {
  const costumes = cloneCostumes(component.costumes || []);
  const maxCostumeIndex = Math.max(0, costumes.length - 1);
  const safeCostumeIndex = Math.min(Math.max(component.currentCostumeIndex || 0, 0), maxCostumeIndex);
  const normalizedPhysicsCollider = normalizePhysicsCollider({
    physics: clonePhysicsConfig(component.physics ?? null),
    collider: cloneColliderConfig(component.collider ?? null),
  });

  return {
    name: component.name,
    blocklyXml: normalizeBlocklyXml(component.blocklyXml),
    costumes,
    currentCostumeIndex: safeCostumeIndex,
    physics: normalizedPhysicsCollider.physics,
    collider: normalizedPhysicsCollider.collider,
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

function normalizeSceneHierarchy(
  scenes: Scene[],
  sceneFolders: SceneFolder[],
): { scenes: Scene[]; sceneFolders: SceneFolder[] } {
  const normalized = normalizeFolderedHierarchy(sceneFolders, scenes, sceneHierarchyConfig);
  return {
    scenes: normalized.items,
    sceneFolders: normalized.folders,
  };
}

function normalizeComponentHierarchy(
  components: ComponentDefinition[],
  componentFolders: ComponentFolder[],
): { components: ComponentDefinition[]; componentFolders: ComponentFolder[] } {
  const normalized = normalizeFolderedHierarchy(componentFolders, components, componentHierarchyConfig);
  return {
    components: normalized.items,
    componentFolders: normalized.folders,
  };
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
    const component = (project.components || []).find((candidate) => candidate.id === componentId);
    if (!component) {
      return null;
    }
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
    const componentSyncKeys = COMPONENT_SYNC_KEYS as (keyof ComponentBackedObjectFields)[];

    const syncedUpdates: Partial<ComponentDefinition> = {};
    const instanceUpdates: Partial<GameObject> = {};

    for (const key of Object.keys(normalizedUpdates) as (keyof GameObject)[]) {
      if (instanceOnlyKeys.has(key)) {
        (instanceUpdates as Record<string, unknown>)[key] = normalizedUpdates[key];
      } else if (componentSyncKeys.includes(key as keyof ComponentBackedObjectFields)) {
        (syncedUpdates as Record<string, unknown>)[key] = normalizedUpdates[key];
      } else {
        (instanceUpdates as Record<string, unknown>)[key] = normalizedUpdates[key];
      }
    }

    if (Object.keys(syncedUpdates).length > 0) {
      const nextComponent = normalizePhysicsCollider({
        ...component,
        ...syncedUpdates,
      });
      const nextSyncedObjectFields = toComponentBackedObjectFields(nextComponent);
      const syncedKeysToApply = new Set<keyof ComponentBackedObjectFields>(
        Object.keys(syncedUpdates) as (keyof ComponentBackedObjectFields)[],
      );
      if (syncedUpdates.physics !== undefined || syncedUpdates.collider !== undefined) {
        syncedKeysToApply.add('physics');
        syncedKeysToApply.add('collider');
      }

      return {
        ...project,
        components: (project.components || []).map((component) =>
          component.id === componentId ? nextComponent : component
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
                if (!syncedKeysToApply.has(syncKey)) {
                  continue;
                }

                const value = nextSyncedObjectFields[syncKey];
                if (value !== undefined || syncKey === 'physics' || syncKey === 'collider') {
                  (syncedObjectUpdates as Record<string, unknown>)[syncKey] = value;
                }
              }

              if (candidateObject.id === objectId) {
                return normalizePhysicsCollider({ ...candidateObject, ...syncedObjectUpdates, ...instanceUpdates });
              }

              return normalizePhysicsCollider({ ...candidateObject, ...syncedObjectUpdates });
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
                  candidateObject.id === objectId
                    ? normalizePhysicsCollider({ ...candidateObject, ...instanceUpdates })
                    : candidateObject
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
              candidateObject.id === objectId
                ? normalizePhysicsCollider({ ...candidateObject, ...normalizedUpdates })
                : candidateObject
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
): Partial<ComponentBackedObjectFields> | null {
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
    const persistedTarget = persistedSession.target;
    const targetsMatch = 'componentId' in target
      ? ('componentId' in persistedTarget && persistedTarget.componentId === target.componentId)
      : (!('componentId' in persistedTarget)
        && persistedTarget.sceneId === target.sceneId
        && persistedTarget.objectId === target.objectId);
    if (!targetsMatch) {
      return null;
    }

    const persistedCostumeIndex = nextCostumes.findIndex(
      (costume) => costume.id === persistedTarget.costumeId,
    );
    if (persistedCostumeIndex < 0) {
      return null;
    }

    const persistedCostumes = applyCostumeEditorState(
      nextCostumes,
      persistedTarget.costumeId,
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

  const updates: Partial<ComponentBackedObjectFields> = {};
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
  const normalizedSceneHierarchy = normalizeSceneHierarchy(
    Array.isArray(project.scenes) ? project.scenes : [],
    Array.isArray(project.sceneFolders) ? project.sceneFolders : [],
  );
  const normalizedGlobalVariables = normalizeVariableDefinitions(project.globalVariables || [], { scope: 'global' });
  const normalizedComponents = (Array.isArray(project.components) ? project.components : []).map((component) =>
    normalizePhysicsCollider({
      ...component,
      folderId: component.folderId ?? null,
      order: Number.isFinite(component.order) ? component.order : 0,
      blocklyXml: normalizeBlocklyXml(component.blocklyXml || ''),
      costumes: cloneCostumes(component.costumes || []),
      localVariables: normalizeVariableDefinitions(component.localVariables || [], { scope: 'local' }),
    })
  );
  const normalizedComponentHierarchy = normalizeComponentHierarchy(
    normalizedComponents,
    Array.isArray(project.componentFolders) ? project.componentFolders : [],
  );

  return normalizeProjectLayering({
    ...project,
    sceneFolders: normalizedSceneHierarchy.sceneFolders,
    messages: (Array.isArray(project.messages) ? project.messages : []).filter(
      (message): message is MessageDefinition =>
        typeof message?.id === 'string' &&
        message.id.trim().length > 0 &&
        typeof message?.name === 'string' &&
        message.name.trim().length > 0,
    ),
    globalVariables: normalizedGlobalVariables,
    components: normalizedComponentHierarchy.components,
    componentFolders: normalizedComponentHierarchy.componentFolders,
    scenes: normalizedSceneHierarchy.scenes.map((scene) => {
      const objectFolders: SceneFolder[] = Array.isArray(scene.objectFolders) ? scene.objectFolders : [];
      const objects: GameObject[] = (Array.isArray(scene.objects) ? scene.objects : []).map((obj) =>
        normalizePhysicsCollider({
          ...obj,
          blocklyXml: normalizeBlocklyXml(obj.blocklyXml || ''),
          costumes: cloneCostumes(obj.costumes || []),
          localVariables: normalizeVariableDefinitions(obj.localVariables || [], {
            scope: 'local',
            objectId: obj.componentId ? null : obj.id,
          }),
        })
      );
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

function createProjectStore(): ProjectStoreHook {
  return create<ProjectStore>((set, get) => ({
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
    const previousProject = get().project;
    const normalizedProject = normalizeProject(project);
    seedUpdatedAt(normalizedProject);
    set({ project: normalizedProject, isDirty: false });
    resetHistory();
    const editorStore = useEditorStore.getState();
    if (previousProject?.id === normalizedProject.id) {
      editorStore.reconcileSelectionToProject(normalizedProject, { recordHistory: false });
      return;
    }
    editorStore.initializeSelectionForProject(normalizedProject, { recordHistory: false });
  },

  saveCurrentProject: async () => {
    const { project } = get();
    if (!project) return;

    const savedProject = await saveProject(project);
    set({ project: normalizeProject(savedProject), isDirty: false });
  },

  acknowledgeProjectSaved: (project: Project) => {
    const currentProject = get().project;
    if (!currentProject) {
      return false;
    }

    if (
      currentProject.id !== project.id
      || currentProject.updatedAt.getTime() !== project.updatedAt.getTime()
    ) {
      return false;
    }

    const normalizedProject = normalizeProject(project);
    seedUpdatedAt(normalizedProject);
    set({ project: normalizedProject, isDirty: false });
    return true;
  },

  closeProject: () => {
    set({ project: null, isDirty: false });
    resetHistory();
  },

  updateProjectName: (name: string) => {
    const validation = validateProjectName(name);
    if (!validation.valid) {
      return;
    }

    set(state => ({
      project: state.project ? { ...state.project, name: validation.normalized, updatedAt: createUpdatedAt() } : null,
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

      const normalizedHierarchy = normalizeSceneHierarchy(
        state.project.scenes,
        state.project.sceneFolders || [],
      );
      const newScene = createDefaultScene(
        crypto.randomUUID(),
        name,
        normalizedHierarchy.scenes.length,
      );
      const nextHierarchy = normalizeSceneHierarchy(
        [...normalizedHierarchy.scenes, newScene],
        normalizedHierarchy.sceneFolders,
      );

      return {
        project: {
          ...state.project,
          scenes: nextHierarchy.scenes,
          sceneFolders: nextHierarchy.sceneFolders,
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:add-scene' });
  },

  addSceneFromTemplate: (template) => {
    const state = get();
    if (!state.project) {
      return null;
    }

    const existingProject = state.project;
    const componentNameSet = new Set(
      (existingProject.components || []).map((component) => normalizeComponentName(component.name)),
    );

    const componentFolderIdMap = new Map<string, string>();
    const importedComponentFolders = (template.componentFolders || []).map((folder) => {
      const nextId = crypto.randomUUID();
      componentFolderIdMap.set(folder.id, nextId);
      return {
        ...folder,
        id: nextId,
        parentId: folder.parentId ? (componentFolderIdMap.get(folder.parentId) ?? folder.parentId) : null,
      };
    }).map((folder) => ({
      ...folder,
      parentId: folder.parentId && componentFolderIdMap.has(folder.parentId)
        ? componentFolderIdMap.get(folder.parentId) ?? null
        : folder.parentId,
    }));

    const componentIdMap = new Map<string, string>();
    const importedComponents = (template.components || []).map((component) => {
      const nextId = crypto.randomUUID();
      componentIdMap.set(component.id, nextId);
      return normalizePhysicsCollider({
        ...component,
        id: nextId,
        name: getUniqueComponentName(component.name, componentNameSet),
        folderId: component.folderId ? (componentFolderIdMap.get(component.folderId) ?? null) : null,
        costumes: cloneCostumes(component.costumes),
        sounds: cloneSounds(component.sounds),
        physics: clonePhysicsConfig(component.physics),
        collider: cloneColliderConfig(component.collider),
        localVariables: cloneVariableDefinitions(component.localVariables || []).map((variable) => ({
          ...variable,
          objectId: undefined,
        })),
      });
    });

    const objectFolderIdMap = new Map<string, string>();
    const importedObjectFolders = (template.scene.objectFolders || []).map((folder) => {
      const nextId = crypto.randomUUID();
      objectFolderIdMap.set(folder.id, nextId);
      return {
        ...folder,
        id: nextId,
      };
    }).map((folder) => ({
      ...folder,
      parentId: folder.parentId && objectFolderIdMap.has(folder.parentId)
        ? objectFolderIdMap.get(folder.parentId) ?? null
        : folder.parentId,
    }));

    const objectIdMap = new Map<string, string>();
    const importedObjects = (template.scene.objects || []).map((object) => {
      const nextId = crypto.randomUUID();
      objectIdMap.set(object.id, nextId);
      return normalizePhysicsCollider({
        ...object,
        id: nextId,
        folderId: object.folderId ? (objectFolderIdMap.get(object.folderId) ?? null) : null,
        parentId: object.parentId,
        componentId: object.componentId ? (componentIdMap.get(object.componentId) ?? object.componentId) : undefined,
        costumes: cloneCostumes(object.costumes),
        sounds: cloneSounds(object.sounds),
        physics: clonePhysicsConfig(object.physics),
        collider: cloneColliderConfig(object.collider),
        localVariables: cloneVariableDefinitions(object.localVariables).map((variable) => ({
          ...variable,
          objectId: nextId,
        })),
      });
    }).map((object) => ({
      ...object,
      parentId: object.parentId ? (objectIdMap.get(object.parentId) ?? null) : null,
    }));

    const sceneId = crypto.randomUUID();
    const nextSceneOrder = normalizeSceneHierarchy(existingProject.scenes, existingProject.sceneFolders || []).scenes.length;
    const importedScene = normalizeSceneLayering({
      ...template.scene,
      id: sceneId,
      name: template.name || template.scene.name,
      order: nextSceneOrder,
      folderId: null,
      background: cloneBackgroundConfig(template.scene.background),
      objectFolders: importedObjectFolders,
      objects: importedObjects,
      cameraConfig: {
        ...template.scene.cameraConfig,
        bounds: template.scene.cameraConfig.bounds ? { ...template.scene.cameraConfig.bounds } : null,
        followTarget: template.scene.cameraConfig.followTarget
          ? (objectIdMap.get(template.scene.cameraConfig.followTarget) ?? null)
          : null,
      },
      ground: template.scene.ground ? { ...template.scene.ground } : undefined,
      worldBoundary: template.scene.worldBoundary
        ? {
            enabled: template.scene.worldBoundary.enabled,
            points: template.scene.worldBoundary.points.map((point) => ({ ...point })),
          }
        : undefined,
    });

    const nextComponentHierarchy = normalizeComponentHierarchy(
      [...(existingProject.components || []), ...importedComponents],
      [...(existingProject.componentFolders || []), ...importedComponentFolders],
    );
    const nextSceneHierarchy = normalizeSceneHierarchy(
      [...existingProject.scenes, importedScene],
      existingProject.sceneFolders || [],
    );

    set((currentState) => ({
      project: currentState.project
        ? {
            ...currentState.project,
            scenes: nextSceneHierarchy.scenes,
            sceneFolders: nextSceneHierarchy.sceneFolders,
            components: nextComponentHierarchy.components,
            componentFolders: nextComponentHierarchy.componentFolders,
            updatedAt: createUpdatedAt(),
          }
        : null,
      isDirty: true,
    }));
    recordHistoryChange({ source: 'project:add-scene-from-template' });

    return importedScene;
  },

  removeScene: (sceneId: string) => {
    set(state => {
      if (!state.project || state.project.scenes.length <= 1) return state;

      const nextHierarchy = normalizeSceneHierarchy(
        state.project.scenes.filter((scene) => scene.id !== sceneId),
        state.project.sceneFolders || [],
      );

      return {
        project: {
          ...state.project,
          scenes: nextHierarchy.scenes,
          sceneFolders: nextHierarchy.sceneFolders,
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

      const nextScenes = state.project.scenes.map((scene) =>
        scene.id === sceneId ? normalizeSceneLayering({ ...scene, ...updates }) : scene,
      );
      const nextHierarchy = normalizeSceneHierarchy(nextScenes, state.project.sceneFolders || []);

      return {
        project: {
          ...state.project,
          scenes: nextHierarchy.scenes,
          sceneFolders: nextHierarchy.sceneFolders,
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
      const nextHierarchy = normalizeSceneHierarchy(reorderedScenes, state.project.sceneFolders || []);

      return {
        project: {
          ...state.project,
          scenes: nextHierarchy.scenes,
          sceneFolders: nextHierarchy.sceneFolders,
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:reorder-scenes' });
  },

  updateSceneOrganization: (scenes, sceneFolders) => {
    set((state) => {
      if (!state.project) return state;
      const nextHierarchy = normalizeSceneHierarchy(scenes, sceneFolders);
      return {
        project: {
          ...state.project,
          scenes: nextHierarchy.scenes,
          sceneFolders: nextHierarchy.sceneFolders,
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:update-scene-organization' });
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

      const nextProject = 'componentId' in target
        ? (() => {
            const component = (state.project.components || []).find((candidate) => candidate.id === target.componentId);
            if (!component) return null;
            const nextComponents = (state.project.components || []).map((candidate) =>
              candidate.id === target.componentId
                ? normalizePhysicsCollider({ ...component, costumes: nextCostumes })
                : candidate,
            );
            const nextHierarchy = normalizeComponentHierarchy(nextComponents, state.project.componentFolders || []);
            return {
              ...state.project,
              components: nextHierarchy.components,
              componentFolders: nextHierarchy.componentFolders,
              scenes: state.project.scenes.map((scene) => ({
                ...normalizeSceneLayering({
                  ...scene,
                  objects: scene.objects.map((obj) =>
                    obj.componentId === target.componentId
                      ? normalizePhysicsCollider({ ...obj, costumes: nextCostumes })
                      : obj,
                  ),
                }),
              })),
              updatedAt: createUpdatedAt(state.project.updatedAt),
            };
          })()
        : applyObjectUpdatesToProject(state.project, target.sceneId, target.objectId, {
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
      recordHistoryChange({ source: 'project:update-costume', allowMerge: true });
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

      const nextProject = 'componentId' in target
        ? (() => {
            const component = (state.project.components || []).find((candidate) => candidate.id === target.componentId);
            if (!component) return null;
            const nextComponents = (state.project.components || []).map((candidate) =>
              candidate.id === target.componentId
                ? normalizePhysicsCollider({ ...component, ...updates })
                : candidate,
            );
            const nextHierarchy = normalizeComponentHierarchy(nextComponents, state.project.componentFolders || []);
            return {
              ...state.project,
              components: nextHierarchy.components,
              componentFolders: nextHierarchy.componentFolders,
              scenes: state.project.scenes.map((scene) => ({
                ...normalizeSceneLayering({
                  ...scene,
                  objects: scene.objects.map((obj) =>
                    obj.componentId === target.componentId
                      ? normalizePhysicsCollider({ ...obj, ...updates })
                      : obj,
                  ),
                }),
              })),
              updatedAt: createUpdatedAt(state.project.updatedAt),
            };
          })()
        : applyObjectUpdatesToProject(state.project, target.sceneId, target.objectId, updates);
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
  addComponentFromLibrary: (data) => {
    const state = get();
    if (!state.project) return null;

    const normalizedComponentHierarchy = normalizeComponentHierarchy(
      state.project.components || [],
      state.project.componentFolders || [],
    );
    const componentNameSet = new Set(
      (state.project.components || []).map((component) => normalizeComponentName(component.name)),
    );
    const safeCostumeIndex = data.costumes.length === 0
      ? 0
      : Math.min(Math.max(0, data.currentCostumeIndex), data.costumes.length - 1);
    const normalizedPhysicsCollider = normalizePhysicsCollider({
      physics: clonePhysicsConfig(data.physics),
      collider: cloneColliderConfig(data.collider),
    });
    const component: ComponentDefinition = {
      id: crypto.randomUUID(),
      name: getUniqueComponentName(data.name, componentNameSet),
      folderId: null,
      order: normalizedComponentHierarchy.components.length,
      blocklyXml: normalizeBlocklyXml(data.blocklyXml),
      costumes: cloneCostumes(data.costumes),
      currentCostumeIndex: safeCostumeIndex,
      physics: normalizedPhysicsCollider.physics,
      collider: normalizedPhysicsCollider.collider,
      sounds: cloneSounds(data.sounds),
      localVariables: normalizeVariableDefinitions(data.localVariables, { scope: 'local' }),
    };
    const nextComponentHierarchy = normalizeComponentHierarchy(
      [...normalizedComponentHierarchy.components, component],
      normalizedComponentHierarchy.componentFolders,
    );

    set((currentState) => ({
      project: currentState.project
        ? {
            ...currentState.project,
            components: nextComponentHierarchy.components,
            componentFolders: nextComponentHierarchy.componentFolders,
            updatedAt: createUpdatedAt(),
          }
        : null,
      isDirty: true,
    }));
    recordHistoryChange({ source: 'project:add-component-from-library' });

    return component;
  },

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
    const normalizedComponentHierarchy = normalizeComponentHierarchy(
      state.project.components || [],
      state.project.componentFolders || [],
    );
    const componentId = crypto.randomUUID();
    const component: ComponentDefinition = {
      id: componentId,
      folderId: null,
      order: normalizedComponentHierarchy.components.length,
      ...toComponentBackedFieldsFromObject(obj),
    };
    const nextComponentHierarchy = normalizeComponentHierarchy(
      [...normalizedComponentHierarchy.components, component],
      normalizedComponentHierarchy.componentFolders,
    );

    set(state => ({
      project: state.project
        ? {
            ...state.project,
            components: nextComponentHierarchy.components,
            componentFolders: nextComponentHierarchy.componentFolders,
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

      const currentComponent = (state.project.components || []).find((component) => component.id === componentId);
      if (!currentComponent) return state;

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
      const nextComponent = normalizePhysicsCollider({
        ...currentComponent,
        ...normalizedUpdates,
      });
      const nextSyncedObjectFields = toComponentBackedObjectFields(nextComponent);
      const syncedKeysToApply = new Set<keyof ComponentBackedObjectFields>(
        Object.keys(syncedInstanceUpdates) as (keyof ComponentBackedObjectFields)[],
      );
      if (normalizedUpdates.physics !== undefined || normalizedUpdates.collider !== undefined) {
        syncedKeysToApply.add('physics');
        syncedKeysToApply.add('collider');
      }

      return {
        project: {
          ...state.project,
          ...(() => {
            const nextComponents = (state.project.components || []).map((component) =>
              component.id === componentId ? nextComponent : component,
            );
            const nextHierarchy = normalizeComponentHierarchy(nextComponents, state.project.componentFolders || []);
            return {
              components: nextHierarchy.components,
              componentFolders: nextHierarchy.componentFolders,
            };
          })(),
          scenes: hasSyncedUpdates
            ? state.project.scenes.map((scene) => ({
                ...normalizeSceneLayering({
                  ...scene,
                  objects: scene.objects.map((obj) => {
                    if (obj.componentId !== componentId) {
                      return obj;
                    }

                    const nextObjectUpdates: Partial<ComponentBackedObjectFields> = {};
                    for (const key of COMPONENT_SYNC_KEYS) {
                      if (!syncedKeysToApply.has(key)) {
                        continue;
                      }

                      (nextObjectUpdates as Record<string, unknown>)[key] = nextSyncedObjectFields[key];
                    }

                    return normalizePhysicsCollider({ ...obj, ...nextObjectUpdates });
                  }),
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

  updateComponentOrganization: (components, componentFolders) => {
    set((state) => {
      if (!state.project) return state;
      const nextHierarchy = normalizeComponentHierarchy(components, componentFolders);
      return {
        project: {
          ...state.project,
          components: nextHierarchy.components,
          componentFolders: nextHierarchy.componentFolders,
          updatedAt: createUpdatedAt(),
        },
        isDirty: true,
      };
    });
    recordHistoryChange({ source: 'project:update-component-organization' });
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
          ...(() => {
            const nextHierarchy = normalizeComponentHierarchy(
              (state.project.components || []).filter((component) => component.id !== componentId),
              state.project.componentFolders || [],
            );
            return {
              components: nextHierarchy.components,
              componentFolders: nextHierarchy.componentFolders,
            };
          })(),
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
      lockScaleProportions: true,
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
}

const projectStoreGlobal = globalThis as ProjectStoreGlobal;

export const useProjectStore = projectStoreGlobal.__pochaProjectStore
  ?? (projectStoreGlobal.__pochaProjectStore = createProjectStore());

registerProjectHistoryBridge(
  () => useProjectStore.getState().project,
  (project) => {
    useProjectStore.setState({
      project,
    });
  },
);
