import { runInHistoryTransaction } from '@/store/universalHistory';

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
