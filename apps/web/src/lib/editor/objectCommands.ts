import { runInHistoryTransaction } from '@/store/universalHistory';
import type { GameObject } from '@/types';

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
