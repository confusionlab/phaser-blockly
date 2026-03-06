import {
  findUnsupportedBlocklyBlockTypes,
  normalizeBlocklyXml,
  validateBlocklyXmlStructure,
} from './blocklyXml';
import {
  compileAssistantLogicProgram,
  type AssistantLogicProgram,
} from './assistantLogic';

export type AssistantVariableType = 'string' | 'integer' | 'float' | 'boolean';

export interface AssistantVariable {
  id: string;
  name: string;
  type: AssistantVariableType;
  defaultValue: number | string | boolean;
  scope: 'global' | 'local';
  objectId?: string;
}

export interface AssistantMessageDefinition {
  id: string;
  name: string;
}

export interface AssistantPhysicsConfig {
  enabled: boolean;
  bodyType: 'dynamic' | 'static';
  gravityY: number;
  velocityX: number;
  velocityY: number;
  bounce: number;
  friction: number;
  allowRotation: boolean;
}

export interface AssistantColliderConfig {
  type: 'none' | 'box' | 'circle' | 'capsule';
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  radius: number;
}

export interface AssistantCostumeSummary {
  id: string;
  name: string;
}

export interface AssistantSoundSummary {
  id: string;
  name: string;
  trimStart?: number;
  trimEnd?: number;
  duration?: number;
}

export type AssistantBackgroundConfig =
  | {
      type: 'color';
      color: string;
    }
  | {
      type: 'image' | 'tiled';
      hasAsset: boolean;
      scrollFactor?: { x: number; y: number };
    };

export interface AssistantGroundConfig {
  enabled: boolean;
  y: number;
  color: string;
}

export interface AssistantCameraConfig {
  followTarget: string | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
  zoom: number;
}

export interface AssistantProjectSettings {
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
}

export interface AssistantSceneFolder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
}

export interface AssistantObject {
  id: string;
  name: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  visible: boolean;
  parentId: string | null;
  order: number;
  componentId?: string;
  physics: AssistantPhysicsConfig | null;
  collider: AssistantColliderConfig | null;
  blocklyXml: string;
  costumes: AssistantCostumeSummary[];
  currentCostumeIndex: number;
  sounds: AssistantSoundSummary[];
  localVariables: AssistantVariable[];
}

export interface AssistantComponent {
  id: string;
  name: string;
  blocklyXml: string;
  costumes: AssistantCostumeSummary[];
  currentCostumeIndex: number;
  physics: AssistantPhysicsConfig | null;
  collider: AssistantColliderConfig | null;
  sounds: AssistantSoundSummary[];
  localVariables: AssistantVariable[];
}

export interface AssistantScene {
  id: string;
  name: string;
  order: number;
  background: AssistantBackgroundConfig | null;
  cameraConfig: AssistantCameraConfig;
  ground?: AssistantGroundConfig;
  objectFolders: AssistantSceneFolder[];
  objects: AssistantObject[];
}

export interface AssistantProjectState {
  project: {
    id: string;
    name: string;
    schemaVersion: number;
    updatedAtIso: string;
  };
  settings: AssistantProjectSettings;
  scenes: AssistantScene[];
  components: AssistantComponent[];
  globalVariables: AssistantVariable[];
  messages: AssistantMessageDefinition[];
}

export interface AssistantProjectSnapshot {
  snapshotId: string;
  projectId: string;
  projectVersion: string;
  normalizedAtIso: string;
  state: AssistantProjectState;
}

export type AssistantReferenceEntityType = 'scene' | 'folder' | 'object' | 'component';

export interface AssistantFolderObjectSummary {
  id: string;
  name: string;
  order: number;
  componentId?: string;
}

export interface AssistantFolderSummary {
  scene: {
    id: string;
    name: string;
  };
  folder: AssistantSceneFolder;
  parentFolder: AssistantSceneFolder | null;
  childFolders: AssistantSceneFolder[];
  childObjects: AssistantFolderObjectSummary[];
}

export interface AssistantReferenceLink {
  relation:
    | 'scene_contains_folder'
    | 'scene_contains_object'
    | 'folder_in_scene'
    | 'folder_in_folder'
    | 'folder_contains_folder'
    | 'folder_contains_object'
    | 'object_in_scene'
    | 'object_in_folder'
    | 'object_uses_component'
    | 'scene_camera_follows_object'
    | 'component_used_by_object';
  sceneId?: string;
  sceneName?: string;
  folderId?: string;
  folderName?: string;
  objectId?: string;
  objectName?: string;
  componentId?: string;
  componentName?: string;
}

export interface AssistantReferenceReport {
  entityType: AssistantReferenceEntityType;
  target: {
    id: string;
    name: string;
    sceneId?: string;
    sceneName?: string;
  };
  references: AssistantReferenceLink[];
}

export type AssistantObjectProperties = Partial<
  Pick<
    AssistantObject,
    | 'name'
    | 'x'
    | 'y'
    | 'scaleX'
    | 'scaleY'
    | 'rotation'
    | 'visible'
    | 'physics'
    | 'collider'
    | 'currentCostumeIndex'
  >
>;

export type AssistantComponentProperties = Partial<
  Pick<
    AssistantComponent,
    | 'name'
    | 'physics'
    | 'collider'
    | 'currentCostumeIndex'
  >
>;

export type AssistantComponentInstanceProperties = Partial<
  Pick<
    AssistantObject,
    | 'name'
    | 'x'
    | 'y'
    | 'scaleX'
    | 'scaleY'
    | 'rotation'
    | 'visible'
  >
>;

export type AssistantSceneProperties = Partial<
  Pick<AssistantScene, 'cameraConfig' | 'ground'>
>;

export type AssistantProjectOperation =
  | {
      kind: 'update_project_settings';
      settings: Partial<AssistantProjectSettings>;
    }
  | {
      kind: 'create_scene';
      name: string;
      sceneId?: string;
      properties?: AssistantSceneProperties;
      insertIndex?: number;
    }
  | {
      kind: 'delete_scene';
      sceneId: string;
    }
  | {
      kind: 'rename_scene';
      sceneId: string;
      name: string;
    }
  | {
      kind: 'reorder_scenes';
      sceneIds: string[];
    }
  | {
      kind: 'update_scene_properties';
      sceneId: string;
      properties: AssistantSceneProperties;
    }
  | {
      kind: 'create_folder';
      sceneId: string;
      name: string;
      folderId?: string;
      parentId?: string | null;
      index?: number;
    }
  | {
      kind: 'delete_folder';
      sceneId: string;
      folderId: string;
    }
  | {
      kind: 'rename_folder';
      sceneId: string;
      folderId: string;
      name: string;
    }
  | {
      kind: 'move_folder';
      sceneId: string;
      folderId: string;
      parentId?: string | null;
      index?: number;
    }
  | {
      kind: 'create_object';
      sceneId: string;
      name: string;
      objectId?: string;
      parentId?: string | null;
      index?: number;
      properties?: AssistantObjectProperties;
    }
  | {
      kind: 'delete_object';
      sceneId: string;
      objectId: string;
    }
  | {
      kind: 'rename_object';
      sceneId: string;
      objectId: string;
      name: string;
    }
  | {
      kind: 'move_object';
      sceneId: string;
      objectId: string;
      parentId?: string | null;
      index?: number;
    }
  | {
      kind: 'duplicate_object';
      sceneId: string;
      objectId: string;
      duplicateObjectId?: string;
    }
  | {
      kind: 'update_object_properties';
      sceneId: string;
      objectId: string;
      properties: AssistantObjectProperties;
    }
  | {
      kind: 'set_object_blockly_xml';
      sceneId: string;
      objectId: string;
      blocklyXml: string;
    }
  | {
      kind: 'set_object_logic';
      sceneId: string;
      objectId: string;
      logic: AssistantLogicProgram;
    }
  | {
      kind: 'make_component';
      sceneId: string;
      objectId: string;
      componentId?: string;
      name?: string;
    }
  | {
      kind: 'delete_component';
      componentId: string;
    }
  | {
      kind: 'add_component_instance';
      sceneId: string;
      componentId: string;
      objectId?: string;
      parentId?: string | null;
      index?: number;
      properties?: AssistantComponentInstanceProperties;
    }
  | {
      kind: 'detach_from_component';
      sceneId: string;
      objectId: string;
    }
  | {
      kind: 'rename_component';
      componentId: string;
      name: string;
    }
  | {
      kind: 'update_component_properties';
      componentId: string;
      properties: AssistantComponentProperties;
    }
  | {
      kind: 'set_component_blockly_xml';
      componentId: string;
      blocklyXml: string;
    }
  | {
      kind: 'set_component_logic';
      componentId: string;
      logic: AssistantLogicProgram;
    };

export interface AssistantChangeSet {
  baseProjectId: string;
  baseProjectVersion: string;
  operations: AssistantProjectOperation[];
  summary: string;
  affectedEntityIds: string[];
}

export interface AssistantValidationIssue {
  code: string;
  message: string;
  entityIds: string[];
}

export interface AssistantOperationResult {
  state: AssistantProjectState;
  createdEntities: Array<{ type: 'scene' | 'folder' | 'object' | 'component'; id: string; name: string }>;
  affectedEntityIds: string[];
  issues: AssistantValidationIssue[];
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function materializeAssistantOperationIds<T extends AssistantProjectOperation>(operation: T): T {
  switch (operation.kind) {
    case 'create_scene':
      return (operation.sceneId ? operation : { ...operation, sceneId: createId('scene') }) as T;
    case 'create_folder':
      return (operation.folderId ? operation : { ...operation, folderId: createId('folder') }) as T;
    case 'create_object':
      return (operation.objectId ? operation : { ...operation, objectId: createId('object') }) as T;
    case 'duplicate_object':
      return (operation.duplicateObjectId ? operation : { ...operation, duplicateObjectId: createId('object') }) as T;
    case 'make_component':
      return (operation.componentId ? operation : { ...operation, componentId: createId('component') }) as T;
    case 'add_component_instance':
      return (operation.objectId ? operation : { ...operation, objectId: createId('object') }) as T;
    default:
      return operation;
  }
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function sortByOrder<T extends { order: number; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(Math.floor(index), length));
}

function insertAtIndex<T>(items: readonly T[], item: T, index?: number): T[] {
  const next = [...items];
  const insertIndex = index === undefined ? next.length : clampIndex(index, next.length);
  next.splice(insertIndex, 0, item);
  return next;
}

function normalizeSiblingOrder<T extends { order: number }>(items: T[]): T[] {
  return items.map((item, index) => ({ ...item, order: index }));
}

function normalizeScene(scene: AssistantScene): AssistantScene {
  const normalizedFolders = normalizeFolderTree(scene.objectFolders);
  const normalizedObjects = normalizeObjectTree(scene.objects, normalizedFolders);
  return {
    ...scene,
    objectFolders: normalizedFolders,
    objects: normalizedObjects,
  };
}

function normalizeScenes(scenes: AssistantScene[]): AssistantScene[] {
  return normalizeSiblingOrder(sortByOrder(scenes)).map((scene) => normalizeScene(scene));
}

function normalizeFolderTree(folders: AssistantSceneFolder[]): AssistantSceneFolder[] {
  const uniqueFolders: AssistantSceneFolder[] = [];
  const seen = new Set<string>();

  for (const folder of sortByOrder(folders)) {
    if (!folder.id || seen.has(folder.id)) continue;
    seen.add(folder.id);
    uniqueFolders.push({
      ...folder,
      parentId: typeof folder.parentId === 'string' && folder.parentId.trim().length > 0 ? folder.parentId : null,
    });
  }

  const folderIds = new Set(uniqueFolders.map((folder) => folder.id));
  const nextFolders = uniqueFolders.map((folder) => {
    if (!folder.parentId || !folderIds.has(folder.parentId) || folder.parentId === folder.id) {
      return { ...folder, parentId: null };
    }
    return folder;
  });

  const childrenByParent = new Map<string | null, AssistantSceneFolder[]>();
  for (const folder of nextFolders) {
    const key = folder.parentId ?? null;
    const current = childrenByParent.get(key) ?? [];
    current.push(folder);
    childrenByParent.set(key, current);
  }

  const normalized: AssistantSceneFolder[] = [];
  const visit = (parentId: string | null) => {
    const siblings = normalizeSiblingOrder(sortByOrder(childrenByParent.get(parentId) ?? []));
    for (const sibling of siblings) {
      normalized.push(sibling);
      visit(sibling.id);
    }
  };

  visit(null);
  return normalized;
}

function normalizeObjectTree(
  objects: AssistantObject[],
  folders: AssistantSceneFolder[],
): AssistantObject[] {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const nextObjects = sortByOrder(objects).map((object) => ({
    ...object,
    parentId:
      typeof object.parentId === 'string' && folderIds.has(object.parentId)
        ? object.parentId
        : null,
  }));

  const objectsByParent = new Map<string | null, AssistantObject[]>();
  for (const object of nextObjects) {
    const key = object.parentId ?? null;
    const current = objectsByParent.get(key) ?? [];
    current.push(object);
    objectsByParent.set(key, current);
  }

  const normalized: AssistantObject[] = [];
  for (const [parentId, siblings] of objectsByParent.entries()) {
    const ordered = normalizeSiblingOrder(sortByOrder(siblings)).map((object) => ({
      ...object,
      parentId,
    }));
    normalized.push(...ordered);
  }

  return sortByOrder(normalized);
}

function cloneLocalVariables(variables: AssistantVariable[]): AssistantVariable[] {
  return variables.map((variable) => ({ ...variable }));
}

function remapVariableIdsInBlocklyXml(
  blocklyXml: string,
  variableIdMap: Map<string, string>,
): string {
  if (!blocklyXml.trim() || variableIdMap.size === 0) return blocklyXml;

  return blocklyXml.replace(
    /(<field\b[^>]*\bname=["']VAR["'][^>]*>)([^<]+)(<\/field>)/g,
    (fullMatch, start, rawValue, end) => {
      const value = String(rawValue ?? '').trim();
      const remapped = variableIdMap.get(value);
      if (!remapped || remapped === value) return fullMatch;
      return `${start}${remapped}${end}`;
    },
  );
}

function createDuplicatedObject(original: AssistantObject, duplicateId = createId('object')): AssistantObject {
  let duplicateBlocklyXml = original.blocklyXml;
  let duplicateLocalVariables = cloneLocalVariables(original.localVariables || []);

  if (!original.componentId) {
    const variableIdMap = new Map<string, string>();
    duplicateLocalVariables = (original.localVariables || []).map((variable) => {
      const nextId = createId('variable');
      variableIdMap.set(variable.id, nextId);
      return {
        ...variable,
        id: nextId,
        objectId: duplicateId,
      };
    });
    duplicateBlocklyXml = remapVariableIdsInBlocklyXml(original.blocklyXml || '', variableIdMap);
  }

  return {
    ...cloneState(original),
    id: duplicateId,
    name: original.componentId ? original.name : `${original.name} Copy`,
    x: original.x + 50,
    y: original.y + 50,
    order: original.order + 1,
    blocklyXml: duplicateBlocklyXml,
    localVariables: duplicateLocalVariables,
  };
}

function createDefaultScene(name: string, order: number, sceneId?: string): AssistantScene {
  return {
    id: sceneId ?? createId('scene'),
    name,
    order,
    background: { type: 'color', color: '#87CEEB' },
    cameraConfig: {
      followTarget: null,
      bounds: null,
      zoom: 1,
    },
    objectFolders: [],
    objects: [],
  };
}

function createDefaultObject(name: string, order: number, objectId?: string): AssistantObject {
  return {
    id: objectId ?? createId('object'),
    name,
    x: 400,
    y: 300,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    visible: true,
    parentId: null,
    order,
    physics: null,
    collider: null,
    blocklyXml: '',
    costumes: [],
    currentCostumeIndex: 0,
    sounds: [],
    localVariables: [],
  };
}

function createComponentFromObject(
  object: AssistantObject,
  componentId = createId('component'),
  name?: string,
): AssistantComponent {
  return {
    id: componentId,
    name: name?.trim() || object.name,
    blocklyXml: normalizeBlocklyXml(object.blocklyXml),
    costumes: cloneState(object.costumes || []),
    currentCostumeIndex: object.currentCostumeIndex,
    physics: cloneState(object.physics),
    collider: cloneState(object.collider),
    sounds: cloneState(object.sounds || []),
    localVariables: cloneLocalVariables(object.localVariables || []),
  };
}

function toComponentBackedObjectFields(component: AssistantComponent): Pick<
  AssistantObject,
  'name' | 'blocklyXml' | 'costumes' | 'currentCostumeIndex' | 'physics' | 'collider' | 'sounds' | 'localVariables'
> {
  return {
    name: component.name,
    blocklyXml: normalizeBlocklyXml(component.blocklyXml),
    costumes: cloneState(component.costumes || []),
    currentCostumeIndex: component.currentCostumeIndex,
    physics: cloneState(component.physics),
    collider: cloneState(component.collider),
    sounds: cloneState(component.sounds || []),
    localVariables: cloneLocalVariables(component.localVariables || []),
  };
}

function createObjectFromComponent(
  component: AssistantComponent,
  order: number,
  objectId?: string,
  properties?: AssistantComponentInstanceProperties,
): AssistantObject {
  return {
    ...createDefaultObject(component.name, order, objectId),
    ...toComponentBackedObjectFields(component),
    componentId: component.id,
    x: 0,
    y: 0,
    ...properties,
  };
}

function ensureScene(state: AssistantProjectState, sceneId: string): AssistantScene {
  const scene = state.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    throw new Error(`Scene "${sceneId}" was not found.`);
  }
  return scene;
}

function ensureComponent(state: AssistantProjectState, componentId: string): AssistantComponent {
  const component = state.components.find((item) => item.id === componentId);
  if (!component) {
    throw new Error(`Component "${componentId}" was not found.`);
  }
  return component;
}

function ensureFolder(scene: AssistantScene, folderId: string): AssistantSceneFolder {
  const folder = scene.objectFolders.find((item) => item.id === folderId);
  if (!folder) {
    throw new Error(`Folder "${folderId}" was not found in scene "${scene.id}".`);
  }
  return folder;
}

function ensureObject(scene: AssistantScene, objectId: string): AssistantObject {
  const object = scene.objects.find((item) => item.id === objectId);
  if (!object) {
    throw new Error(`Object "${objectId}" was not found in scene "${scene.id}".`);
  }
  return object;
}

export function getAssistantFolderSummary(
  state: AssistantProjectState,
  sceneId: string,
  folderId: string,
): AssistantFolderSummary {
  const scene = ensureScene(state, sceneId);
  const folder = ensureFolder(scene, folderId);
  const parentFolder = folder.parentId
    ? scene.objectFolders.find((candidate) => candidate.id === folder.parentId) ?? null
    : null;

  return {
    scene: {
      id: scene.id,
      name: scene.name,
    },
    folder,
    parentFolder,
    childFolders: sortByOrder(
      scene.objectFolders.filter((candidate) => candidate.parentId === folderId),
    ),
    childObjects: sortByOrder(
      scene.objects.filter((candidate) => candidate.parentId === folderId),
    ).map((object) => ({
      id: object.id,
      name: object.name,
      order: object.order,
      componentId: object.componentId,
    })),
  };
}

export function listAssistantEntityReferences(
  state: AssistantProjectState,
  entityType: AssistantReferenceEntityType,
  id: string,
  sceneId?: string,
): AssistantReferenceReport {
  switch (entityType) {
    case 'scene': {
      const scene = ensureScene(state, id);
      return {
        entityType,
        target: {
          id: scene.id,
          name: scene.name,
        },
        references: [
          ...sortByOrder(scene.objectFolders).map((folder) => ({
            relation: 'scene_contains_folder' as const,
            sceneId: scene.id,
            sceneName: scene.name,
            folderId: folder.id,
            folderName: folder.name,
          })),
          ...sortByOrder(scene.objects).map((object) => ({
            relation: 'scene_contains_object' as const,
            sceneId: scene.id,
            sceneName: scene.name,
            objectId: object.id,
            objectName: object.name,
          })),
        ],
      };
    }
    case 'folder': {
      if (!sceneId) {
        throw new Error('sceneId is required when listing references for a folder.');
      }
      const summary = getAssistantFolderSummary(state, sceneId, id);
      return {
        entityType,
        target: {
          id: summary.folder.id,
          name: summary.folder.name,
          sceneId: summary.scene.id,
          sceneName: summary.scene.name,
        },
        references: [
          {
            relation: 'folder_in_scene',
            sceneId: summary.scene.id,
            sceneName: summary.scene.name,
            folderId: summary.folder.id,
            folderName: summary.folder.name,
          },
          ...(summary.parentFolder
            ? [
                {
                  relation: 'folder_in_folder' as const,
                  sceneId: summary.scene.id,
                  sceneName: summary.scene.name,
                  folderId: summary.parentFolder.id,
                  folderName: summary.parentFolder.name,
                },
              ]
            : []),
          ...summary.childFolders.map((folder) => ({
            relation: 'folder_contains_folder' as const,
            sceneId: summary.scene.id,
            sceneName: summary.scene.name,
            folderId: folder.id,
            folderName: folder.name,
          })),
          ...summary.childObjects.map((object) => ({
            relation: 'folder_contains_object' as const,
            sceneId: summary.scene.id,
            sceneName: summary.scene.name,
            folderId: summary.folder.id,
            folderName: summary.folder.name,
            objectId: object.id,
            objectName: object.name,
            componentId: object.componentId,
          })),
        ],
      };
    }
    case 'object': {
      if (!sceneId) {
        throw new Error('sceneId is required when listing references for an object.');
      }
      const scene = ensureScene(state, sceneId);
      const object = ensureObject(scene, id);
      const parentFolder = object.parentId
        ? scene.objectFolders.find((candidate) => candidate.id === object.parentId) ?? null
        : null;
      const linkedComponent = object.componentId
        ? state.components.find((candidate) => candidate.id === object.componentId) ?? null
        : null;

      return {
        entityType,
        target: {
          id: object.id,
          name: object.name,
          sceneId: scene.id,
          sceneName: scene.name,
        },
        references: [
          {
            relation: 'object_in_scene',
            sceneId: scene.id,
            sceneName: scene.name,
            objectId: object.id,
            objectName: object.name,
          },
          ...(parentFolder
            ? [
                {
                  relation: 'object_in_folder' as const,
                  sceneId: scene.id,
                  sceneName: scene.name,
                  folderId: parentFolder.id,
                  folderName: parentFolder.name,
                  objectId: object.id,
                  objectName: object.name,
                },
              ]
            : []),
          ...(linkedComponent
            ? [
                {
                  relation: 'object_uses_component' as const,
                  sceneId: scene.id,
                  sceneName: scene.name,
                  objectId: object.id,
                  objectName: object.name,
                  componentId: linkedComponent.id,
                  componentName: linkedComponent.name,
                },
              ]
            : []),
          ...state.scenes
            .filter((candidate) => candidate.cameraConfig.followTarget === object.id)
            .map((candidate) => ({
              relation: 'scene_camera_follows_object' as const,
              sceneId: candidate.id,
              sceneName: candidate.name,
              objectId: object.id,
              objectName: object.name,
            })),
        ],
      };
    }
    case 'component': {
      const component = ensureComponent(state, id);
      return {
        entityType,
        target: {
          id: component.id,
          name: component.name,
        },
        references: state.scenes.flatMap((scene) =>
          scene.objects
            .filter((object) => object.componentId === component.id)
            .map((object) => ({
              relation: 'component_used_by_object' as const,
              sceneId: scene.id,
              sceneName: scene.name,
              objectId: object.id,
              objectName: object.name,
              componentId: component.id,
              componentName: component.name,
            })),
        ),
      };
    }
  }

  throw new Error(`Unsupported reference entity type "${entityType}".`);
}

function collectFolderDescendants(scene: AssistantScene, folderId: string): Set<string> {
  const descendants = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of scene.objectFolders) {
      if (!descendants.has(folder.id) && folder.parentId && descendants.has(folder.parentId)) {
        descendants.add(folder.id);
        changed = true;
      }
    }
  }
  return descendants;
}

function collectAffectedEntitiesFromOperation(operation: AssistantProjectOperation): string[] {
  switch (operation.kind) {
    case 'update_project_settings':
      return [];
    case 'create_scene':
      return operation.sceneId ? [operation.sceneId] : [];
    case 'delete_scene':
    case 'rename_scene':
    case 'update_scene_properties':
      return [operation.sceneId];
    case 'reorder_scenes':
      return operation.sceneIds;
    case 'create_folder':
      return operation.folderId ? [operation.sceneId, operation.folderId] : [operation.sceneId];
    case 'delete_folder':
    case 'rename_folder':
    case 'move_folder':
      return [operation.sceneId, operation.folderId];
    case 'create_object':
      return operation.objectId ? [operation.sceneId, operation.objectId] : [operation.sceneId];
    case 'delete_object':
    case 'rename_object':
    case 'move_object':
    case 'update_object_properties':
    case 'set_object_blockly_xml':
    case 'set_object_logic':
      return [operation.sceneId, operation.objectId];
    case 'duplicate_object':
      return operation.duplicateObjectId
        ? [operation.sceneId, operation.objectId, operation.duplicateObjectId]
        : [operation.sceneId, operation.objectId];
    case 'make_component':
      return operation.componentId
        ? [operation.sceneId, operation.objectId, operation.componentId]
        : [operation.sceneId, operation.objectId];
    case 'add_component_instance':
      return operation.objectId
        ? [operation.sceneId, operation.componentId, operation.objectId]
        : [operation.sceneId, operation.componentId];
    case 'detach_from_component':
      return [operation.sceneId, operation.objectId];
    case 'delete_component':
    case 'rename_component':
    case 'update_component_properties':
    case 'set_component_blockly_xml':
    case 'set_component_logic':
      return [operation.componentId];
  }
}

function moveWithinSiblings<T extends { id: string; parentId: string | null; order: number }>(
  items: T[],
  targetId: string,
  nextParentId: string | null,
  nextIndex?: number,
): T[] {
  const currentItem = items.find((item) => item.id === targetId);
  if (!currentItem) return items;

  const remaining = items.filter((item) => item.id !== targetId);
  const siblingPool = sortByOrder(remaining.filter((item) => (item.parentId ?? null) === nextParentId));
  const insertIndex = nextIndex === undefined ? siblingPool.length : clampIndex(nextIndex, siblingPool.length);
  const nextSiblingPool = insertAtIndex(
    siblingPool.map((item) => ({ ...item })),
    { ...currentItem, parentId: nextParentId, order: insertIndex },
    insertIndex,
  ).map((item, index) => ({ ...item, order: index }));

  const unaffected = remaining.filter((item) => (item.parentId ?? null) !== nextParentId);
  return [...unaffected, ...nextSiblingPool];
}

export function validateAssistantProjectState(state: AssistantProjectState): AssistantValidationIssue[] {
  const issues: AssistantValidationIssue[] = [];

  if (!state.project.id) {
    issues.push({
      code: 'project.missing_id',
      message: 'Project id is required.',
      entityIds: [],
    });
  }

  if (state.scenes.length === 0) {
    issues.push({
      code: 'project.no_scenes',
      message: 'Project must contain at least one scene.',
      entityIds: [],
    });
  }

  const sceneIds = new Set<string>();
  for (const scene of state.scenes) {
    if (sceneIds.has(scene.id)) {
      issues.push({
        code: 'scene.duplicate_id',
        message: `Duplicate scene id "${scene.id}".`,
        entityIds: [scene.id],
      });
      continue;
    }
    sceneIds.add(scene.id);

    const folderIds = new Set<string>();
    for (const folder of scene.objectFolders) {
      if (folderIds.has(folder.id)) {
        issues.push({
          code: 'folder.duplicate_id',
          message: `Duplicate folder id "${folder.id}" in scene "${scene.id}".`,
          entityIds: [scene.id, folder.id],
        });
        continue;
      }
      folderIds.add(folder.id);
      if (folder.parentId && !scene.objectFolders.some((candidate) => candidate.id === folder.parentId)) {
        issues.push({
          code: 'folder.missing_parent',
          message: `Folder "${folder.id}" references missing parent "${folder.parentId}".`,
          entityIds: [scene.id, folder.id],
        });
      }
    }

    const objectIds = new Set<string>();
    for (const object of scene.objects) {
      if (objectIds.has(object.id)) {
        issues.push({
          code: 'object.duplicate_id',
          message: `Duplicate object id "${object.id}" in scene "${scene.id}".`,
          entityIds: [scene.id, object.id],
        });
        continue;
      }
      objectIds.add(object.id);
      if (object.parentId && !folderIds.has(object.parentId)) {
        issues.push({
          code: 'object.invalid_parent',
          message: `Object "${object.id}" references missing folder "${object.parentId}".`,
          entityIds: [scene.id, object.id],
        });
      }

      const normalizedBlocklyXml = normalizeBlocklyXml(object.blocklyXml);
      const blocklyXmlIssue = validateBlocklyXmlStructure(normalizedBlocklyXml);
      if (blocklyXmlIssue) {
        issues.push({
          code: 'object.invalid_blockly_xml',
          message: `Object "${object.id}" has invalid Blockly XML: ${blocklyXmlIssue}`,
          entityIds: [scene.id, object.id],
        });
      }
      const unsupportedBlockTypes = findUnsupportedBlocklyBlockTypes(normalizedBlocklyXml);
      if (unsupportedBlockTypes.length > 0) {
        issues.push({
          code: 'object.unsupported_blockly_block_types',
          message: `Object "${object.id}" uses unsupported Blockly block types: ${unsupportedBlockTypes.join(', ')}.`,
          entityIds: [scene.id, object.id],
        });
      }
    }

    const cameraTarget = scene.cameraConfig.followTarget;
    if (cameraTarget && !scene.objects.some((object) => object.id === cameraTarget)) {
      issues.push({
        code: 'scene.invalid_camera_target',
        message: `Scene "${scene.id}" followTarget references missing object "${cameraTarget}".`,
        entityIds: [scene.id, cameraTarget],
      });
    }
  }

  const componentIds = new Set<string>();
  for (const component of state.components) {
    if (componentIds.has(component.id)) {
      issues.push({
        code: 'component.duplicate_id',
        message: `Duplicate component id "${component.id}".`,
        entityIds: [component.id],
      });
      continue;
    }
    componentIds.add(component.id);

    const normalizedBlocklyXml = normalizeBlocklyXml(component.blocklyXml);
    const blocklyXmlIssue = validateBlocklyXmlStructure(normalizedBlocklyXml);
    if (blocklyXmlIssue) {
      issues.push({
        code: 'component.invalid_blockly_xml',
        message: `Component "${component.id}" has invalid Blockly XML: ${blocklyXmlIssue}`,
        entityIds: [component.id],
      });
    }
    const unsupportedBlockTypes = findUnsupportedBlocklyBlockTypes(normalizedBlocklyXml);
    if (unsupportedBlockTypes.length > 0) {
      issues.push({
        code: 'component.unsupported_blockly_block_types',
        message: `Component "${component.id}" uses unsupported Blockly block types: ${unsupportedBlockTypes.join(', ')}.`,
        entityIds: [component.id],
      });
    }
  }

  for (const scene of state.scenes) {
    for (const object of scene.objects) {
      if (object.componentId && !componentIds.has(object.componentId)) {
        issues.push({
          code: 'object.invalid_component',
          message: `Object "${object.id}" references missing component "${object.componentId}".`,
          entityIds: [scene.id, object.id, object.componentId],
        });
      }
    }
  }

  return issues;
}

export function applyAssistantProjectOperations(
  initialState: AssistantProjectState,
  operations: readonly AssistantProjectOperation[],
): AssistantOperationResult {
  let state = cloneState(initialState);
  const createdEntities: AssistantOperationResult['createdEntities'] = [];
  const affectedEntityIds = new Set<string>();

  for (const operation of operations) {
    for (const entityId of collectAffectedEntitiesFromOperation(operation)) {
      if (entityId) {
        affectedEntityIds.add(entityId);
      }
    }

    switch (operation.kind) {
      case 'update_project_settings': {
        state.settings = {
          ...state.settings,
          ...operation.settings,
        };
        break;
      }
      case 'create_scene': {
        const nextScene = createDefaultScene(
          operation.name.trim() || 'Scene',
          state.scenes.length,
          operation.sceneId,
        );
        if (operation.properties) {
          nextScene.cameraConfig = operation.properties.cameraConfig ?? nextScene.cameraConfig;
          nextScene.ground = operation.properties.ground ?? nextScene.ground;
        }
        state.scenes = normalizeScenes(insertAtIndex(state.scenes, nextScene, operation.insertIndex));
        createdEntities.push({ type: 'scene', id: nextScene.id, name: nextScene.name });
        affectedEntityIds.add(nextScene.id);
        break;
      }
      case 'delete_scene': {
        if (state.scenes.length <= 1) {
          throw new Error('Cannot delete the last remaining scene.');
        }
        state.scenes = normalizeScenes(state.scenes.filter((scene) => scene.id !== operation.sceneId));
        break;
      }
      case 'rename_scene': {
        ensureScene(state, operation.sceneId);
        state.scenes = state.scenes.map((scene) =>
          scene.id === operation.sceneId ? { ...scene, name: operation.name.trim() || scene.name } : scene,
        );
        break;
      }
      case 'reorder_scenes': {
        const currentById = new Map(state.scenes.map((scene) => [scene.id, scene]));
        const nextScenes = operation.sceneIds
          .map((sceneId) => currentById.get(sceneId))
          .filter((scene): scene is AssistantScene => !!scene);
        if (nextScenes.length !== state.scenes.length) {
          throw new Error('reorder_scenes must include every scene id exactly once.');
        }
        state.scenes = normalizeScenes(nextScenes);
        break;
      }
      case 'update_scene_properties': {
        ensureScene(state, operation.sceneId);
        state.scenes = state.scenes.map((scene) =>
          scene.id === operation.sceneId
            ? normalizeScene({
                ...scene,
                cameraConfig: operation.properties.cameraConfig ?? scene.cameraConfig,
                ground: operation.properties.ground ?? scene.ground,
              })
            : scene,
        );
        break;
      }
      case 'create_folder': {
        const scene = ensureScene(state, operation.sceneId);
        if (operation.parentId) {
          ensureFolder(scene, operation.parentId);
        }
        const siblings = sortByOrder(
          scene.objectFolders.filter((folder) => (folder.parentId ?? null) === (operation.parentId ?? null)),
        );
        const insertIndex = operation.index === undefined ? siblings.length : clampIndex(operation.index, siblings.length);
        const nextFolder: AssistantSceneFolder = {
          id: operation.folderId ?? createId('folder'),
          name: operation.name.trim() || 'Folder',
          parentId: operation.parentId ?? null,
          order: insertIndex,
        };
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objectFolders: moveWithinSiblings(
                  [...candidate.objectFolders, nextFolder],
                  nextFolder.id,
                  operation.parentId ?? null,
                  operation.index,
                ),
              })
            : candidate,
        );
        createdEntities.push({ type: 'folder', id: nextFolder.id, name: nextFolder.name });
        affectedEntityIds.add(nextFolder.id);
        break;
      }
      case 'delete_folder': {
        const scene = ensureScene(state, operation.sceneId);
        ensureFolder(scene, operation.folderId);
        const descendants = collectFolderDescendants(scene, operation.folderId);
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objectFolders: candidate.objectFolders.filter((folder) => !descendants.has(folder.id)),
                objects: candidate.objects.filter((object) => !object.parentId || !descendants.has(object.parentId)),
              })
            : candidate,
        );
        break;
      }
      case 'rename_folder': {
        const scene = ensureScene(state, operation.sceneId);
        ensureFolder(scene, operation.folderId);
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objectFolders: candidate.objectFolders.map((folder) =>
                  folder.id === operation.folderId
                    ? { ...folder, name: operation.name.trim() || folder.name }
                    : folder,
                ),
              })
            : candidate,
        );
        break;
      }
      case 'move_folder': {
        const scene = ensureScene(state, operation.sceneId);
        ensureFolder(scene, operation.folderId);
        if (operation.parentId) {
          ensureFolder(scene, operation.parentId);
          if (operation.parentId === operation.folderId) {
            throw new Error('Folder cannot become its own parent.');
          }
          const descendants = collectFolderDescendants(scene, operation.folderId);
          if (descendants.has(operation.parentId)) {
            throw new Error('Folder cannot be moved into one of its descendants.');
          }
        }

        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objectFolders: moveWithinSiblings(
                  candidate.objectFolders,
                  operation.folderId,
                  operation.parentId ?? null,
                  operation.index,
                ),
              })
            : candidate,
        );
        break;
      }
      case 'create_object': {
        const scene = ensureScene(state, operation.sceneId);
        if (operation.parentId) {
          ensureFolder(scene, operation.parentId);
        }
        const siblings = sortByOrder(
          scene.objects.filter((object) => (object.parentId ?? null) === (operation.parentId ?? null)),
        );
        const insertIndex = operation.index === undefined ? siblings.length : clampIndex(operation.index, siblings.length);
        const nextObject = {
          ...createDefaultObject(operation.name.trim() || 'Object', insertIndex, operation.objectId),
          parentId: operation.parentId ?? null,
          ...operation.properties,
        };
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objects: moveWithinSiblings(
                  [...candidate.objects, nextObject],
                  nextObject.id,
                  operation.parentId ?? null,
                  operation.index,
                ),
              })
            : candidate,
        );
        createdEntities.push({ type: 'object', id: nextObject.id, name: nextObject.name });
        affectedEntityIds.add(nextObject.id);
        break;
      }
      case 'delete_object': {
        const scene = ensureScene(state, operation.sceneId);
        ensureObject(scene, operation.objectId);
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objects: candidate.objects.filter((object) => object.id !== operation.objectId),
                cameraConfig:
                  candidate.cameraConfig.followTarget === operation.objectId
                    ? { ...candidate.cameraConfig, followTarget: null }
                    : candidate.cameraConfig,
              })
            : candidate,
        );
        break;
      }
      case 'rename_object': {
        const scene = ensureScene(state, operation.sceneId);
        ensureObject(scene, operation.objectId);
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objects: candidate.objects.map((object) =>
                  object.id === operation.objectId
                    ? { ...object, name: operation.name.trim() || object.name }
                    : object,
                ),
              })
            : candidate,
        );
        break;
      }
      case 'move_object': {
        const scene = ensureScene(state, operation.sceneId);
        ensureObject(scene, operation.objectId);
        if (operation.parentId) {
          ensureFolder(scene, operation.parentId);
        }
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objects: moveWithinSiblings(
                  candidate.objects,
                  operation.objectId,
                  operation.parentId ?? null,
                  operation.index,
                ),
              })
            : candidate,
        );
        break;
      }
      case 'duplicate_object': {
        const scene = ensureScene(state, operation.sceneId);
        const original = ensureObject(scene, operation.objectId);
        const duplicate = createDuplicatedObject(original, operation.duplicateObjectId);
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objects: moveWithinSiblings(
                  [...candidate.objects, duplicate],
                  duplicate.id,
                  original.parentId ?? null,
                  original.order + 1,
                ),
              })
            : candidate,
        );
        createdEntities.push({ type: 'object', id: duplicate.id, name: duplicate.name });
        affectedEntityIds.add(duplicate.id);
        break;
      }
      case 'update_object_properties': {
        const scene = ensureScene(state, operation.sceneId);
        ensureObject(scene, operation.objectId);
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objects: candidate.objects.map((object) =>
                  object.id === operation.objectId ? { ...object, ...operation.properties } : object,
                ),
              })
            : candidate,
        );
        break;
      }
      case 'set_object_blockly_xml': {
        const normalizedBlocklyXml = normalizeBlocklyXml(operation.blocklyXml);
        const scene = ensureScene(state, operation.sceneId);
        ensureObject(scene, operation.objectId);
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objects: candidate.objects.map((object) =>
                  object.id === operation.objectId ? { ...object, blocklyXml: normalizedBlocklyXml } : object,
                ),
              })
            : candidate,
        );
        break;
      }
      case 'set_object_logic': {
        const compiledBlocklyXml = normalizeBlocklyXml(compileAssistantLogicProgram(operation.logic));
        const scene = ensureScene(state, operation.sceneId);
        ensureObject(scene, operation.objectId);
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objects: candidate.objects.map((object) =>
                  object.id === operation.objectId ? { ...object, blocklyXml: compiledBlocklyXml } : object,
                ),
              })
            : candidate,
        );
        break;
      }
      case 'make_component': {
        const scene = ensureScene(state, operation.sceneId);
        const object = ensureObject(scene, operation.objectId);
        if (object.componentId) {
          throw new Error(`Object "${operation.objectId}" is already backed by component "${object.componentId}".`);
        }
        const nextComponent = createComponentFromObject(object, operation.componentId, operation.name);
        state.components = [...state.components, nextComponent];
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objects: candidate.objects.map((item) =>
                  item.id === operation.objectId
                    ? {
                        ...item,
                        componentId: nextComponent.id,
                        ...(operation.name?.trim() ? { name: nextComponent.name } : {}),
                      }
                    : item,
                ),
              })
            : candidate,
        );
        createdEntities.push({ type: 'component', id: nextComponent.id, name: nextComponent.name });
        affectedEntityIds.add(nextComponent.id);
        break;
      }
      case 'delete_component': {
        const component = ensureComponent(state, operation.componentId);
        const detachedFields = toComponentBackedObjectFields(component);
        state.components = state.components.filter((item) => item.id !== operation.componentId);
        state.scenes = state.scenes.map((scene) =>
          normalizeScene({
            ...scene,
            objects: scene.objects.map((object) =>
              object.componentId === operation.componentId
                ? {
                    ...object,
                    componentId: undefined,
                    ...detachedFields,
                  }
                : object,
            ),
          }),
        );
        break;
      }
      case 'add_component_instance': {
        const scene = ensureScene(state, operation.sceneId);
        const component = ensureComponent(state, operation.componentId);
        if (operation.parentId) {
          ensureFolder(scene, operation.parentId);
        }
        const siblings = sortByOrder(
          scene.objects.filter((object) => (object.parentId ?? null) === (operation.parentId ?? null)),
        );
        const insertIndex = operation.index === undefined ? siblings.length : clampIndex(operation.index, siblings.length);
        const nextObject = {
          ...createObjectFromComponent(component, insertIndex, operation.objectId, operation.properties),
          parentId: operation.parentId ?? null,
        };
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objects: moveWithinSiblings(
                  [...candidate.objects, nextObject],
                  nextObject.id,
                  operation.parentId ?? null,
                  operation.index,
                ),
              })
            : candidate,
        );
        createdEntities.push({ type: 'object', id: nextObject.id, name: nextObject.name });
        affectedEntityIds.add(nextObject.id);
        break;
      }
      case 'detach_from_component': {
        const scene = ensureScene(state, operation.sceneId);
        const object = ensureObject(scene, operation.objectId);
        if (!object.componentId) {
          throw new Error(`Object "${operation.objectId}" is not backed by a component.`);
        }
        const component = ensureComponent(state, object.componentId);
        const detachedFields = toComponentBackedObjectFields(component);
        state.scenes = state.scenes.map((candidate) =>
          candidate.id === scene.id
            ? normalizeScene({
                ...candidate,
                objects: candidate.objects.map((item) =>
                  item.id === operation.objectId
                    ? {
                        ...item,
                        componentId: undefined,
                        ...detachedFields,
                      }
                    : item,
                ),
              })
            : candidate,
        );
        break;
      }
      case 'rename_component': {
        ensureComponent(state, operation.componentId);
        const nextComponents = state.components.map((component) =>
          component.id === operation.componentId
            ? { ...component, name: operation.name.trim() || component.name }
            : component,
        );
        const nextComponent = nextComponents.find((component) => component.id === operation.componentId)!;
        state.components = nextComponents;
        state.scenes = state.scenes.map((scene) =>
          normalizeScene({
            ...scene,
            objects: scene.objects.map((object) =>
              object.componentId === operation.componentId
                ? { ...object, name: nextComponent.name }
                : object,
            ),
          }),
        );
        break;
      }
      case 'update_component_properties': {
        ensureComponent(state, operation.componentId);
        const nextComponents = state.components.map((component) =>
          component.id === operation.componentId
            ? { ...component, ...operation.properties }
            : component,
        );
        const nextComponent = nextComponents.find((component) => component.id === operation.componentId)!;
        state.components = nextComponents;
        state.scenes = state.scenes.map((scene) =>
          normalizeScene({
            ...scene,
            objects: scene.objects.map((object) => {
              if (object.componentId !== operation.componentId) return object;
              const updates: Partial<AssistantObject> = {};
              if (operation.properties.name !== undefined) updates.name = nextComponent.name;
              if (operation.properties.physics !== undefined) updates.physics = cloneState(nextComponent.physics);
              if (operation.properties.collider !== undefined) updates.collider = cloneState(nextComponent.collider);
              if (operation.properties.currentCostumeIndex !== undefined) {
                updates.currentCostumeIndex = nextComponent.currentCostumeIndex;
              }
              return { ...object, ...updates };
            }),
          }),
        );
        break;
      }
      case 'set_component_blockly_xml': {
        const normalizedBlocklyXml = normalizeBlocklyXml(operation.blocklyXml);
        ensureComponent(state, operation.componentId);
        state.components = state.components.map((component) =>
          component.id === operation.componentId
            ? { ...component, blocklyXml: normalizedBlocklyXml }
            : component,
        );
        state.scenes = state.scenes.map((scene) =>
          normalizeScene({
            ...scene,
            objects: scene.objects.map((object) =>
              object.componentId === operation.componentId
                ? { ...object, blocklyXml: normalizedBlocklyXml }
                : object,
            ),
          }),
        );
        break;
      }
      case 'set_component_logic': {
        const compiledBlocklyXml = normalizeBlocklyXml(compileAssistantLogicProgram(operation.logic));
        ensureComponent(state, operation.componentId);
        state.components = state.components.map((component) =>
          component.id === operation.componentId
            ? { ...component, blocklyXml: compiledBlocklyXml }
            : component,
        );
        state.scenes = state.scenes.map((scene) =>
          normalizeScene({
            ...scene,
            objects: scene.objects.map((object) =>
              object.componentId === operation.componentId
                ? { ...object, blocklyXml: compiledBlocklyXml }
                : object,
            ),
          }),
        );
        break;
      }
    }
  }

  state = {
    ...state,
    scenes: normalizeScenes(state.scenes),
    project: {
      ...state.project,
      updatedAtIso: new Date().toISOString(),
    },
  };

  const issues = validateAssistantProjectState(state);

  return {
    state,
    createdEntities,
    affectedEntityIds: [...affectedEntityIds],
    issues,
  };
}
