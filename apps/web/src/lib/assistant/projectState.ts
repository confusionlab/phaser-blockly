import type {
  AssistantChangeSet,
  AssistantComponent,
  AssistantObject,
  AssistantProjectOperation,
  AssistantProjectSnapshot,
  AssistantProjectState,
  AssistantScene,
  AssistantSceneFolder,
} from '../../../../../packages/ui-shared/src/assistant';
import type {
  ComponentDefinition,
  GameObject,
  Project,
  Scene,
  SceneFolder,
} from '@/types';
import {
  createDefaultGameObject,
  createDefaultScene,
} from '@/types';
import { normalizeProjectLayering, normalizeSceneLayering } from '@/utils/layerTree';

function cloneProject<T>(value: T): T {
  return structuredClone(value);
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

function sortByOrder<T extends { order: number; id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
}

function collectFolderDescendants(scene: Scene, folderId: string): Set<string> {
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

function moveFolders(
  folders: SceneFolder[],
  folderId: string,
  parentId: string | null,
  index?: number,
): SceneFolder[] {
  const target = folders.find((folder) => folder.id === folderId);
  if (!target) return folders;

  const remaining = folders.filter((folder) => folder.id !== folderId);
  const siblings = sortByOrder(remaining.filter((folder) => (folder.parentId ?? null) === parentId));
  const insertIndex = index === undefined ? siblings.length : clampIndex(index, siblings.length);
  const updatedSiblings = insertAtIndex(
    siblings.map((folder) => ({ ...folder })),
    { ...target, parentId, order: insertIndex },
    insertIndex,
  ).map((folder, siblingIndex) => ({
    ...folder,
    order: siblingIndex,
  }));

  const unaffected = remaining.filter((folder) => (folder.parentId ?? null) !== parentId);
  return [...unaffected, ...updatedSiblings];
}

function moveObjects(
  objects: GameObject[],
  objectId: string,
  parentId: string | null,
  index?: number,
): GameObject[] {
  const target = objects.find((object) => object.id === objectId);
  if (!target) return objects;

  const remaining = objects.filter((object) => object.id !== objectId);
  const siblings = sortByOrder(remaining.filter((object) => (object.parentId ?? null) === parentId));
  const insertIndex = index === undefined ? siblings.length : clampIndex(index, siblings.length);
  const updatedSiblings = insertAtIndex(
    siblings.map((object) => ({ ...object })),
    { ...target, parentId, order: insertIndex },
    insertIndex,
  ).map((object, siblingIndex) => ({
    ...object,
    order: siblingIndex,
  }));

  const unaffected = remaining.filter((object) => (object.parentId ?? null) !== parentId);
  return [...unaffected, ...updatedSiblings];
}

function toAssistantFolder(folder: SceneFolder): AssistantSceneFolder {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId ?? null,
    order: folder.order,
  };
}

function toAssistantObject(object: GameObject): AssistantObject {
  return {
    id: object.id,
    name: object.name,
    spriteAssetId: object.spriteAssetId ?? null,
    x: object.x,
    y: object.y,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
    rotation: object.rotation,
    visible: object.visible,
    parentId: object.parentId ?? null,
    order: object.order,
    componentId: object.componentId,
    physics: object.physics ? { ...object.physics } : null,
    collider: object.collider ? { ...object.collider } : null,
    blocklyXml: object.blocklyXml,
    costumes: (object.costumes || []).map((costume) => ({
      id: costume.id,
      name: costume.name,
      assetId: costume.assetId,
    })),
    currentCostumeIndex: object.currentCostumeIndex,
    sounds: (object.sounds || []).map((sound) => ({
      id: sound.id,
      name: sound.name,
      assetId: sound.assetId,
      trimStart: sound.trimStart,
      trimEnd: sound.trimEnd,
      duration: sound.duration,
    })),
    localVariables: (object.localVariables || []).map((variable) => ({ ...variable })),
  };
}

function toAssistantComponent(component: ComponentDefinition): AssistantComponent {
  return {
    id: component.id,
    name: component.name,
    blocklyXml: component.blocklyXml,
    costumes: (component.costumes || []).map((costume) => ({
      id: costume.id,
      name: costume.name,
      assetId: costume.assetId,
    })),
    currentCostumeIndex: component.currentCostumeIndex,
    physics: component.physics ? { ...component.physics } : null,
    collider: component.collider ? { ...component.collider } : null,
    sounds: (component.sounds || []).map((sound) => ({
      id: sound.id,
      name: sound.name,
      assetId: sound.assetId,
      trimStart: sound.trimStart,
      trimEnd: sound.trimEnd,
      duration: sound.duration,
    })),
    localVariables: (component.localVariables || []).map((variable) => ({ ...variable })),
  };
}

function toAssistantScene(scene: Scene): AssistantScene {
  return {
    id: scene.id,
    name: scene.name,
    order: scene.order,
    background: scene.background
      ? {
          type: scene.background.type,
          value: scene.background.value,
          scrollFactor: scene.background.scrollFactor ? { ...scene.background.scrollFactor } : undefined,
        }
      : null,
    cameraConfig: {
      followTarget: scene.cameraConfig.followTarget,
      bounds: scene.cameraConfig.bounds ? { ...scene.cameraConfig.bounds } : null,
      zoom: scene.cameraConfig.zoom,
    },
    ground: scene.ground ? { ...scene.ground } : undefined,
    objectFolders: (scene.objectFolders || []).map(toAssistantFolder),
    objects: (scene.objects || []).map(toAssistantObject),
  };
}

export function createAssistantProjectSnapshot(project: Project): AssistantProjectSnapshot {
  const normalizedProject = normalizeProjectLayering(cloneProject(project));
  const projectVersion = `${normalizedProject.id}:${normalizedProject.updatedAt.toISOString()}`;
  const state: AssistantProjectState = {
    project: {
      id: normalizedProject.id,
      name: normalizedProject.name,
      schemaVersion: normalizedProject.schemaVersion,
      updatedAtIso: normalizedProject.updatedAt.toISOString(),
    },
    settings: { ...normalizedProject.settings },
    scenes: normalizedProject.scenes.map(toAssistantScene),
    components: (normalizedProject.components || []).map(toAssistantComponent),
    globalVariables: (normalizedProject.globalVariables || []).map((variable) => ({ ...variable })),
    messages: (normalizedProject.messages || []).map((message) => ({ ...message })),
  };

  return {
    snapshotId: crypto.randomUUID(),
    projectId: normalizedProject.id,
    projectVersion,
    normalizedAtIso: new Date().toISOString(),
    state,
  };
}

export function applyAssistantChangeSetToProject(project: Project, changeSet: AssistantChangeSet): Project {
  let nextProject = normalizeProjectLayering(cloneProject(project));

  if (changeSet.baseProjectId !== nextProject.id) {
    throw new Error('Assistant change-set project id does not match the open project.');
  }

  for (const operation of changeSet.operations) {
    nextProject = applyOperation(nextProject, operation);
  }

  return normalizeProjectLayering({
    ...nextProject,
    updatedAt: new Date(),
  });
}

function applyOperation(project: Project, operation: AssistantProjectOperation): Project {
  switch (operation.kind) {
    case 'update_project_settings':
      return {
        ...project,
        settings: {
          ...project.settings,
          ...operation.settings,
        },
      };
    case 'create_scene': {
      const nextScene = createDefaultScene(
        operation.sceneId ?? crypto.randomUUID(),
        operation.name.trim() || 'Scene',
        project.scenes.length,
      );
      if (operation.properties) {
        nextScene.background = operation.properties.background ?? nextScene.background;
        nextScene.cameraConfig = operation.properties.cameraConfig ?? nextScene.cameraConfig;
        nextScene.ground = operation.properties.ground ?? nextScene.ground;
      }
      const scenes = insertAtIndex(project.scenes, nextScene, operation.insertIndex).map((scene, index) => ({
        ...scene,
        order: index,
      }));
      return { ...project, scenes };
    }
    case 'delete_scene': {
      if (project.scenes.length <= 1) {
        throw new Error('Cannot delete the last remaining scene.');
      }
      return {
        ...project,
        scenes: project.scenes
          .filter((scene) => scene.id !== operation.sceneId)
          .map((scene, index) => ({ ...scene, order: index })),
      };
    }
    case 'rename_scene':
      return {
        ...project,
        scenes: project.scenes.map((scene) =>
          scene.id === operation.sceneId
            ? { ...scene, name: operation.name.trim() || scene.name }
            : scene,
        ),
      };
    case 'reorder_scenes': {
      const byId = new Map(project.scenes.map((scene) => [scene.id, scene]));
      const reordered = operation.sceneIds
        .map((sceneId) => byId.get(sceneId))
        .filter((scene): scene is Scene => !!scene)
        .map((scene, index) => ({ ...scene, order: index }));
      if (reordered.length !== project.scenes.length) {
        throw new Error('reorder_scenes must include every scene exactly once.');
      }
      return {
        ...project,
        scenes: reordered,
      };
    }
    case 'update_scene_properties':
      return {
        ...project,
        scenes: project.scenes.map((scene) =>
          scene.id === operation.sceneId
            ? normalizeSceneLayering({
                ...scene,
                background:
                  operation.properties.background === undefined
                    ? scene.background
                    : operation.properties.background,
                cameraConfig: operation.properties.cameraConfig ?? scene.cameraConfig,
                ground: operation.properties.ground ?? scene.ground,
              })
            : scene,
        ),
      };
    case 'create_folder':
      return {
        ...project,
        scenes: project.scenes.map((scene) => {
          if (scene.id !== operation.sceneId) return scene;
          const folder: SceneFolder = {
            id: operation.folderId ?? crypto.randomUUID(),
            name: operation.name.trim() || 'Folder',
            parentId: operation.parentId ?? null,
            order: scene.objectFolders.length,
          };
          return normalizeSceneLayering({
            ...scene,
            objectFolders: moveFolders(
              [...scene.objectFolders, folder],
              folder.id,
              operation.parentId ?? null,
              operation.index,
            ),
          });
        }),
      };
    case 'delete_folder':
      return {
        ...project,
        scenes: project.scenes.map((scene) => {
          if (scene.id !== operation.sceneId) return scene;
          const descendants = collectFolderDescendants(scene, operation.folderId);
          return normalizeSceneLayering({
            ...scene,
            objectFolders: scene.objectFolders.filter((folder) => !descendants.has(folder.id)),
            objects: scene.objects.filter((object) => !object.parentId || !descendants.has(object.parentId)),
          });
        }),
      };
    case 'rename_folder':
      return {
        ...project,
        scenes: project.scenes.map((scene) =>
          scene.id === operation.sceneId
            ? normalizeSceneLayering({
                ...scene,
                objectFolders: scene.objectFolders.map((folder) =>
                  folder.id === operation.folderId
                    ? { ...folder, name: operation.name.trim() || folder.name }
                    : folder,
                ),
              })
            : scene,
        ),
      };
    case 'move_folder':
      return {
        ...project,
        scenes: project.scenes.map((scene) =>
          scene.id === operation.sceneId
            ? normalizeSceneLayering({
                ...scene,
                objectFolders: moveFolders(scene.objectFolders, operation.folderId, operation.parentId ?? null, operation.index),
              })
            : scene,
        ),
      };
    case 'create_object':
      return {
        ...project,
        scenes: project.scenes.map((scene) => {
          if (scene.id !== operation.sceneId) return scene;
          const nextObject = createDefaultGameObject(operation.name.trim() || 'Object');
          nextObject.id = operation.objectId ?? nextObject.id;
          nextObject.parentId = operation.parentId ?? null;
          Object.assign(nextObject, operation.properties ?? {});
          return normalizeSceneLayering({
            ...scene,
            objects: moveObjects(
              [...scene.objects, nextObject],
              nextObject.id,
              operation.parentId ?? null,
              operation.index,
            ),
          });
        }),
      };
    case 'delete_object':
      return {
        ...project,
        scenes: project.scenes.map((scene) =>
          scene.id === operation.sceneId
            ? normalizeSceneLayering({
                ...scene,
                objects: scene.objects.filter((object) => object.id !== operation.objectId),
                cameraConfig:
                  scene.cameraConfig.followTarget === operation.objectId
                    ? { ...scene.cameraConfig, followTarget: null }
                    : scene.cameraConfig,
              })
            : scene,
        ),
      };
    case 'rename_object':
      return {
        ...project,
        scenes: project.scenes.map((scene) =>
          scene.id === operation.sceneId
            ? normalizeSceneLayering({
                ...scene,
                objects: scene.objects.map((object) =>
                  object.id === operation.objectId
                    ? { ...object, name: operation.name.trim() || object.name }
                    : object,
                ),
              })
            : scene,
        ),
      };
    case 'move_object':
      return {
        ...project,
        scenes: project.scenes.map((scene) =>
          scene.id === operation.sceneId
            ? normalizeSceneLayering({
                ...scene,
                objects: moveObjects(scene.objects, operation.objectId, operation.parentId ?? null, operation.index),
              })
            : scene,
        ),
      };
    case 'update_object_properties':
      return {
        ...project,
        scenes: project.scenes.map((scene) =>
          scene.id === operation.sceneId
            ? normalizeSceneLayering({
                ...scene,
                objects: scene.objects.map((object) =>
                  object.id === operation.objectId
                    ? { ...object, ...operation.properties }
                    : object,
                ),
              })
            : scene,
        ),
      };
    case 'set_object_blockly_xml':
      return {
        ...project,
        scenes: project.scenes.map((scene) =>
          scene.id === operation.sceneId
            ? normalizeSceneLayering({
                ...scene,
                objects: scene.objects.map((object) =>
                  object.id === operation.objectId
                    ? { ...object, blocklyXml: operation.blocklyXml }
                    : object,
                ),
              })
            : scene,
        ),
      };
    case 'rename_component':
      return {
        ...project,
        components: (project.components || []).map((component) =>
          component.id === operation.componentId
            ? { ...component, name: operation.name.trim() || component.name }
            : component,
        ),
      };
    case 'update_component_properties':
      return {
        ...project,
        components: (project.components || []).map((component) =>
          component.id === operation.componentId
            ? { ...component, ...operation.properties }
            : component,
        ),
      };
    case 'set_component_blockly_xml':
      return {
        ...project,
        components: (project.components || []).map((component) =>
          component.id === operation.componentId
            ? { ...component, blocklyXml: operation.blocklyXml }
            : component,
        ),
      };
  }
}

export function projectContainsScene(project: Project, sceneId: string | null): boolean {
  if (!sceneId) return false;
  return project.scenes.some((scene) => scene.id === sceneId);
}

export function projectContainsObject(project: Project, sceneId: string | null, objectId: string | null): boolean {
  if (!sceneId || !objectId) return false;
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  return !!scene?.objects.some((object) => object.id === objectId);
}
