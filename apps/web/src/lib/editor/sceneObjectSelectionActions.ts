import { getScenePasteTargetCenter } from '@/lib/editor/scenePastePlacement';
import {
  copySceneObjectsToClipboard,
  cutSceneObjectsWithHistory,
  deleteSceneObjectsWithHistory,
  duplicateSceneObjectsWithHistory,
  pasteSceneObjectClipboardWithHistory,
} from '@/lib/editor/objectCommands';
import type { StageEditorViewport, StageViewMode } from '@/lib/stageViewport';
import type { GameObject, Project } from '@/types';
import { getSceneObjectsInLayerOrder } from '@/utils/layerTree';

export type SceneObjectSelectionActionContext = {
  addObject: (sceneId: string, name: string) => GameObject;
  duplicateObject: (sceneId: string, objectId: string) => GameObject | null;
  editorViewport: StageEditorViewport | null | undefined;
  project: Project | null | undefined;
  removeObject: (sceneId: string, objectId: string) => void;
  sceneId: string | null | undefined;
  selectObject: (objectId: string | null) => void;
  selectObjects: (objectIds: string[], primaryObjectId?: string | null) => void;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
  viewMode: StageViewMode;
};

type ResolvedSceneObjectSelectionState = {
  orderedSceneObjectIds: string[];
  sceneId: string;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
};

type SceneObjectHistoryActionOptions = {
  source?: string;
};

function resolveSceneObjectSelectionState(
  context: SceneObjectSelectionActionContext,
): ResolvedSceneObjectSelectionState | null {
  if (!context.project || !context.sceneId) {
    return null;
  }

  const scene = context.project.scenes.find((candidate) => candidate.id === context.sceneId);
  if (!scene) {
    return null;
  }

  const orderedSceneObjectIds = getSceneObjectsInLayerOrder(scene).map((object) => object.id);
  const sceneObjectIdSet = new Set(orderedSceneObjectIds);
  const selectedObjectIds = context.selectedObjectIds.filter((objectId) => sceneObjectIdSet.has(objectId));
  const selectedObjectId = context.selectedObjectId && sceneObjectIdSet.has(context.selectedObjectId)
    ? context.selectedObjectId
    : (selectedObjectIds[0] ?? null);

  return {
    orderedSceneObjectIds,
    sceneId: context.sceneId,
    selectedObjectId,
    selectedObjectIds,
  };
}

export function resolveSceneObjectActionIds(
  clickedObjectId: string | null | undefined,
  orderedSceneObjectIds: string[],
  selectedObjectIds: string[],
): string[] {
  if (!clickedObjectId) {
    return [];
  }

  if (selectedObjectIds.length > 1 && selectedObjectIds.includes(clickedObjectId)) {
    return orderedSceneObjectIds.filter((objectId) => selectedObjectIds.includes(objectId));
  }

  return [clickedObjectId];
}

export function copySceneObjectSelection(
  context: SceneObjectSelectionActionContext,
  objectIds: string[],
): boolean {
  if (!context.project || !context.sceneId || objectIds.length === 0) {
    return false;
  }

  return copySceneObjectsToClipboard(context.project, context.sceneId, objectIds);
}

export function duplicateSceneObjectSelection(
  context: SceneObjectSelectionActionContext,
  objectIds: string[],
  options?: SceneObjectHistoryActionOptions,
): boolean {
  if (!context.sceneId || objectIds.length === 0) {
    return false;
  }

  duplicateSceneObjectsWithHistory({
    source: options?.source ?? 'scene-selection:duplicate',
    sceneId: context.sceneId,
    objectIds,
    duplicateObject: context.duplicateObject,
    selectObjects: context.selectObjects,
  });
  return true;
}

export function pasteSceneObjectSelection(
  context: SceneObjectSelectionActionContext,
  options?: SceneObjectHistoryActionOptions,
): boolean {
  if (!context.project || !context.sceneId) {
    return false;
  }

  const pastedIds = pasteSceneObjectClipboardWithHistory({
    source: options?.source ?? 'scene-selection:paste',
    project: context.project,
    sceneId: context.sceneId,
    targetCenter: getScenePasteTargetCenter({
      project: context.project,
      sceneId: context.sceneId,
      viewMode: context.viewMode,
      editorViewport: context.editorViewport,
    }),
    addObject: context.addObject,
    updateObject: context.updateObject,
    selectObjects: context.selectObjects,
  });

  return pastedIds.length > 0;
}

export function cutSceneObjectSelection(
  context: SceneObjectSelectionActionContext,
  objectIds: string[],
  options?: SceneObjectHistoryActionOptions,
): boolean {
  const selectionState = resolveSceneObjectSelectionState(context);
  if (!selectionState || objectIds.length === 0) {
    return false;
  }

  cutSceneObjectsWithHistory({
    source: options?.source ?? 'scene-selection:cut',
    project: context.project!,
    sceneId: selectionState.sceneId,
    deleteIds: objectIds,
    orderedSceneObjectIds: selectionState.orderedSceneObjectIds,
    selectedObjectId: selectionState.selectedObjectId,
    selectedObjectIds: selectionState.selectedObjectIds,
    removeObject: context.removeObject,
    selectObject: context.selectObject,
    selectObjects: context.selectObjects,
  });
  return true;
}

export function deleteSceneObjectSelection(
  context: SceneObjectSelectionActionContext,
  objectIds: string[],
  options?: SceneObjectHistoryActionOptions,
): boolean {
  const selectionState = resolveSceneObjectSelectionState(context);
  if (!selectionState || objectIds.length === 0) {
    return false;
  }

  deleteSceneObjectsWithHistory({
    source: options?.source ?? 'scene-selection:delete',
    sceneId: selectionState.sceneId,
    deleteIds: objectIds,
    orderedSceneObjectIds: selectionState.orderedSceneObjectIds,
    selectedObjectId: selectionState.selectedObjectId,
    selectedObjectIds: selectionState.selectedObjectIds,
    removeObject: context.removeObject,
    selectObject: context.selectObject,
    selectObjects: context.selectObjects,
  });
  return true;
}
