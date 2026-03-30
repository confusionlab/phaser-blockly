import { runInHistoryTransaction } from '@/store/universalHistory';
import type { GameObject, Project } from '@/types';
import { getNextSiblingOrder, getSceneObjectsInLayerOrder } from '@/utils/layerTree';
import { normalizeVariableDefinition, remapVariableIdsInBlocklyXml } from '@/lib/variableUtils';

const COPY_POSITION_OFFSET = 50;
const ROOT_PARENT_KEY = '__root__';

type SceneObjectClipboardMode = 'copy' | 'cut';

export type SceneObjectClipboardEntry = {
  sourceSceneId: string;
  object: GameObject;
};

export type SceneObjectClipboardState = {
  mode: SceneObjectClipboardMode;
  entries: SceneObjectClipboardEntry[];
};

let sceneObjectClipboard: SceneObjectClipboardState | null = null;

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildClipboardEntries(
  project: Project,
  sceneId: string,
  objectIds: string[],
): SceneObjectClipboardEntry[] {
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    return [];
  }

  const requestedIdSet = new Set(objectIds);
  if (requestedIdSet.size === 0) {
    return [];
  }

  return getSceneObjectsInLayerOrder(scene)
    .filter((object) => requestedIdSet.has(object.id))
    .map((object) => ({
      sourceSceneId: sceneId,
      object: cloneValue(object),
    }));
}

function remapClipboardLocalVariables(
  object: GameObject,
  newObjectId: string,
): { blocklyXml: string; localVariables: GameObject['localVariables'] } {
  if (object.componentId) {
    return {
      blocklyXml: object.blocklyXml || '',
      localVariables: cloneValue(object.localVariables || []),
    };
  }

  const variableIdMap = new Map<string, string>();
  const remappedLocalVariables = (object.localVariables || []).map((variable) => {
    const remappedId = crypto.randomUUID();
    variableIdMap.set(variable.id, remappedId);
    return normalizeVariableDefinition(
      { ...cloneValue(variable), id: remappedId },
      { scope: 'local', objectId: newObjectId },
    );
  });

  return {
    blocklyXml: remapVariableIdsInBlocklyXml(object.blocklyXml || '', variableIdMap),
    localVariables: remappedLocalVariables,
  };
}

function getClipboardPasteName(object: GameObject, mode: SceneObjectClipboardMode): string {
  if (mode === 'cut' || object.componentId) {
    return object.name;
  }
  return `${object.name} Copy`;
}

function resolveClipboardPasteParentId(
  targetProject: Project,
  targetSceneId: string,
  entry: SceneObjectClipboardEntry,
): string | null {
  const parentId = entry.object.parentId ?? null;
  if (!parentId || entry.sourceSceneId !== targetSceneId) {
    return null;
  }

  const targetScene = targetProject.scenes.find((scene) => scene.id === targetSceneId);
  if (!targetScene?.objectFolders.some((folder) => folder.id === parentId)) {
    return null;
  }

  return parentId;
}

export function clearSceneObjectClipboard(): void {
  sceneObjectClipboard = null;
}

export function hasSceneObjectClipboardContents(): boolean {
  return (sceneObjectClipboard?.entries.length ?? 0) > 0;
}

export function copySceneObjectsToClipboard(
  project: Project,
  sceneId: string,
  objectIds: string[],
  options?: { mode?: SceneObjectClipboardMode },
): boolean {
  const entries = buildClipboardEntries(project, sceneId, objectIds);
  if (entries.length === 0) {
    return false;
  }

  sceneObjectClipboard = {
    mode: options?.mode ?? 'copy',
    entries,
  };
  return true;
}

type DeleteSceneObjectsWithHistoryArgs = {
  source: string;
  sceneId: string;
  deleteIds: string[];
  orderedSceneObjectIds: string[];
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  removeObject: (sceneId: string, objectId: string) => void;
  selectObject: (objectId: string | null) => void;
  selectObjects: (objectIds: string[], primaryObjectId?: string | null) => void;
};

export function deleteSceneObjectsWithHistory({
  source,
  sceneId,
  deleteIds,
  orderedSceneObjectIds,
  selectedObjectId,
  selectedObjectIds,
  removeObject,
  selectObject,
  selectObjects,
}: DeleteSceneObjectsWithHistoryArgs): void {
  const uniqueDeleteIds = Array.from(new Set(deleteIds));
  if (uniqueDeleteIds.length === 0) return;

  runInHistoryTransaction(source, () => {
    const deleteSet = new Set(uniqueDeleteIds);
    uniqueDeleteIds.forEach((objectId) => removeObject(sceneId, objectId));

    const remainingSelectedIds = selectedObjectIds.filter((objectId) => !deleteSet.has(objectId));
    if (remainingSelectedIds.length > 0) {
      const nextPrimary = selectedObjectId && remainingSelectedIds.includes(selectedObjectId)
        ? selectedObjectId
        : remainingSelectedIds[0];
      selectObjects(remainingSelectedIds, nextPrimary);
      return;
    }

    const remainingSceneIds = orderedSceneObjectIds.filter((objectId) => !deleteSet.has(objectId));
    selectObject(remainingSceneIds[0] ?? null);
  });
}

type DuplicateSceneObjectsWithHistoryArgs = {
  source: string;
  sceneId: string;
  objectIds: string[];
  duplicateObject: (sceneId: string, objectId: string) => GameObject | null;
  selectObjects: (objectIds: string[], primaryObjectId?: string | null) => void;
};

export function duplicateSceneObjectsWithHistory({
  source,
  sceneId,
  objectIds,
  duplicateObject,
  selectObjects,
}: DuplicateSceneObjectsWithHistoryArgs): void {
  const uniqueObjectIds = Array.from(new Set(objectIds));
  if (uniqueObjectIds.length === 0) return;

  runInHistoryTransaction(source, () => {
    const duplicatedIds: string[] = [];
    uniqueObjectIds.forEach((objectId) => {
      const duplicated = duplicateObject(sceneId, objectId);
      if (duplicated) {
        duplicatedIds.push(duplicated.id);
      }
    });

    if (duplicatedIds.length > 0) {
      selectObjects(duplicatedIds, duplicatedIds[0]);
    }
  });
}

type PasteSceneObjectClipboardWithHistoryArgs = {
  source: string;
  project: Project;
  sceneId: string;
  addObject: (sceneId: string, name: string) => GameObject;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
  selectObjects: (objectIds: string[], primaryObjectId?: string | null) => void;
};

export function pasteSceneObjectClipboardWithHistory({
  source,
  project,
  sceneId,
  addObject,
  updateObject,
  selectObjects,
}: PasteSceneObjectClipboardWithHistoryArgs): string[] {
  const clipboard = sceneObjectClipboard;
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  if (!clipboard || !scene) {
    return [];
  }

  const pastedIds: string[] = [];
  const nextOrderByParent = new Map<string, number>();
  const positionOffset = clipboard.mode === 'copy' ? COPY_POSITION_OFFSET : 0;

  runInHistoryTransaction(source, () => {
    clipboard.entries.forEach((entry) => {
      const nextName = getClipboardPasteName(entry.object, clipboard.mode);
      const pastedObject = addObject(sceneId, nextName);
      const { blocklyXml, localVariables } = remapClipboardLocalVariables(entry.object, pastedObject.id);
      const parentId = resolveClipboardPasteParentId(project, sceneId, entry);
      const orderKey = parentId ?? ROOT_PARENT_KEY;
      const nextOrder = nextOrderByParent.get(orderKey) ?? getNextSiblingOrder(scene, parentId);
      nextOrderByParent.set(orderKey, nextOrder + 1);

      const {
        id: _ignoredId,
        parentId: _ignoredParentId,
        order: _ignoredOrder,
        folderId: _ignoredFolderId,
        layer: _ignoredLayer,
        ...snapshotUpdates
      } = cloneValue(entry.object);

      updateObject(sceneId, pastedObject.id, {
        ...snapshotUpdates,
        name: nextName,
        x: entry.object.x + positionOffset,
        y: entry.object.y + positionOffset,
        parentId,
        order: nextOrder,
        folderId: undefined,
        blocklyXml,
        localVariables,
      });
      pastedIds.push(pastedObject.id);
    });

    if (pastedIds.length > 0) {
      selectObjects(pastedIds, pastedIds[0]);
    }
  });

  if (clipboard.mode === 'cut' && pastedIds.length > 0) {
    sceneObjectClipboard = {
      mode: 'copy',
      entries: clipboard.entries.map((entry) => ({
        sourceSceneId: sceneId,
        object: cloneValue(entry.object),
      })),
    };
  }

  return pastedIds;
}

type CutSceneObjectsWithHistoryArgs = DeleteSceneObjectsWithHistoryArgs & {
  project: Project;
};

export function cutSceneObjectsWithHistory({
  source,
  project,
  sceneId,
  deleteIds,
  orderedSceneObjectIds,
  selectedObjectId,
  selectedObjectIds,
  removeObject,
  selectObject,
  selectObjects,
}: CutSceneObjectsWithHistoryArgs): void {
  const clipboardEntries = buildClipboardEntries(project, sceneId, deleteIds);
  if (clipboardEntries.length === 0) {
    return;
  }

  sceneObjectClipboard = {
    mode: 'cut',
    entries: clipboardEntries,
  };

  const uniqueDeleteIds = Array.from(new Set(deleteIds));
  const deleteSet = new Set(uniqueDeleteIds);

  runInHistoryTransaction(source, () => {
    uniqueDeleteIds.forEach((objectId) => removeObject(sceneId, objectId));

    const remainingSelectedIds = selectedObjectIds.filter((objectId) => !deleteSet.has(objectId));
    if (remainingSelectedIds.length > 0) {
      const nextPrimary = selectedObjectId && remainingSelectedIds.includes(selectedObjectId)
        ? selectedObjectId
        : remainingSelectedIds[0];
      selectObjects(remainingSelectedIds, nextPrimary);
      return;
    }

    const remainingSceneIds = orderedSceneObjectIds.filter((objectId) => !deleteSet.has(objectId));
    selectObject(remainingSceneIds[0] ?? null);
  });
}

type AddComponentInstanceWithHistoryArgs = {
  source: string;
  sceneId: string;
  componentId: string;
  addComponentInstance: (sceneId: string, componentId: string) => GameObject | null;
  selectObject: (objectId: string | null) => void;
};

export function addComponentInstanceWithHistory({
  source,
  sceneId,
  componentId,
  addComponentInstance,
  selectObject,
}: AddComponentInstanceWithHistoryArgs): void {
  runInHistoryTransaction(source, () => {
    const instance = addComponentInstance(sceneId, componentId);
    if (instance) {
      selectObject(instance.id);
    }
  });
}

type DeleteComponentWithHistoryArgs = {
  source: string;
  componentId: string;
  selectedComponentId: string | null;
  deleteComponent: (componentId: string) => void;
  selectComponent: (componentId: string | null) => void;
};

export function deleteComponentWithHistory({
  source,
  componentId,
  selectedComponentId,
  deleteComponent,
  selectComponent,
}: DeleteComponentWithHistoryArgs): void {
  runInHistoryTransaction(source, () => {
    deleteComponent(componentId);
    if (selectedComponentId === componentId) {
      selectComponent(null);
    }
  });
}
