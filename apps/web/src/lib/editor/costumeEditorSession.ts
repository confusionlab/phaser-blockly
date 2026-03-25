import { getEffectiveObjectProps } from '@/types';
import type {
  Costume,
  CostumeBounds,
  CostumeDocument,
  CostumeLayer,
  GameObject,
  Project,
} from '@/types';
import {
  cloneCostumeDocument,
  ensureCostumeDocument,
} from '@/lib/costume/costumeDocument';

export interface CostumeEditorTarget {
  sceneId: string;
  objectId: string;
  costumeId: string;
}

export interface CostumeEditorObjectTarget {
  sceneId: string;
  objectId: string;
}

export interface CostumeEditorSession extends CostumeEditorTarget {
  key: string;
}

export interface CostumeEditorPersistedState {
  assetId: string;
  bounds?: CostumeBounds;
  document: CostumeDocument;
}

export interface CostumeEditorPersistedSession {
  target: CostumeEditorTarget;
  state: CostumeEditorPersistedState;
}

export type CostumeEditorOperation =
  | { type: 'rename'; costumeId: string; name: string }
  | { type: 'select'; costumeId: string }
  | { type: 'add'; costume: Costume }
  | { type: 'remove'; costumeId: string };

export interface ResolvedCostumeEditorObjectTarget extends CostumeEditorObjectTarget {
  object: GameObject;
  costumes: Costume[];
  currentCostumeIndex: number;
}

export interface ResolvedCostumeEditorTarget extends CostumeEditorTarget {
  object: GameObject;
  costumes: Costume[];
  costume: Costume;
  costumeIndex: number;
  currentCostumeIndex: number;
}

export function createCostumeEditorSession(target: CostumeEditorTarget): CostumeEditorSession {
  return {
    ...target,
    key: `${target.sceneId}:${target.objectId}:${target.costumeId}`,
  };
}

export function areCostumeBoundsEqual(a: CostumeBounds | undefined, b: CostumeBounds | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function areCostumeDocumentsEqual(
  a: CostumeDocument | undefined,
  b: CostumeDocument | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.version !== b.version || a.activeLayerId !== b.activeLayerId || a.layers.length !== b.layers.length) {
    return false;
  }

  for (let index = 0; index < a.layers.length; index += 1) {
    if (!areCostumeLayersEqual(a.layers[index], b.layers[index])) {
      return false;
    }
  }

  return true;
}

function areCostumeLayersEqual(a: CostumeLayer | undefined, b: CostumeLayer | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.kind !== b.kind ||
    a.visible !== b.visible ||
    a.locked !== b.locked ||
    a.opacity !== b.opacity ||
    a.blendMode !== b.blendMode ||
    a.mask !== b.mask ||
    a.effects.length !== b.effects.length
  ) {
    return false;
  }

  if (a.kind === 'bitmap' && b.kind === 'bitmap') {
    return (
      a.width === b.width &&
      a.height === b.height &&
      a.bitmap.assetId === b.bitmap.assetId
    );
  }

  if (a.kind === 'vector' && b.kind === 'vector') {
    return (
      a.vector.engine === b.vector.engine &&
      a.vector.version === b.vector.version &&
      a.vector.fabricJson === b.vector.fabricJson
    );
  }

  return false;
}

export function applyCostumeEditorState(
  costumes: Costume[],
  targetCostumeId: string,
  state: CostumeEditorPersistedState
): Costume[] | null {
  const costumeIndex = costumes.findIndex((costume) => costume.id === targetCostumeId);
  if (costumeIndex < 0) {
    return null;
  }

  const costume = costumes[costumeIndex];
  const nextBounds = state.bounds ?? undefined;
  const nextDocument = state.document
    ? cloneCostumeDocument(state.document)
    : cloneCostumeDocument(ensureCostumeDocument(costume));

  const noAssetChange = costume.assetId === state.assetId;
  const noBoundsChange = areCostumeBoundsEqual(costume.bounds, nextBounds);
  const noDocumentChange = areCostumeDocumentsEqual(costume.document, nextDocument);
  if (noAssetChange && noBoundsChange && noDocumentChange) {
    return null;
  }

  return costumes.map((entry, index) =>
    index === costumeIndex
      ? {
          ...entry,
          assetId: state.assetId,
          bounds: nextBounds,
          document: nextDocument,
        }
      : entry
  );
}

export function renameCostumeInList(
  costumes: Costume[],
  targetCostumeId: string,
  name: string
): Costume[] | null {
  const costumeIndex = costumes.findIndex((costume) => costume.id === targetCostumeId);
  if (costumeIndex < 0) {
    return null;
  }

  const costume = costumes[costumeIndex];
  if (costume.name === name) {
    return null;
  }

  return costumes.map((entry, index) => (index === costumeIndex ? { ...entry, name } : entry));
}

export function removeCostumeFromList(
  costumes: Costume[],
  targetCostumeId: string
): { costumes: Costume[]; removedIndex: number } | null {
  const removedIndex = costumes.findIndex((costume) => costume.id === targetCostumeId);
  if (removedIndex < 0) {
    return null;
  }

  return {
    costumes: costumes.filter((costume) => costume.id !== targetCostumeId),
    removedIndex,
  };
}

export function resolveCostumeEditorObject(
  project: Project,
  target: CostumeEditorObjectTarget
): ResolvedCostumeEditorObjectTarget | null {
  const scene = project.scenes.find((candidate) => candidate.id === target.sceneId);
  const object = scene?.objects.find((candidate) => candidate.id === target.objectId);
  if (!object) {
    return null;
  }

  const effectiveProps = getEffectiveObjectProps(object, project.components || []);
  const costumes = (effectiveProps.costumes || []).map((costume) => ({
    ...costume,
    document: ensureCostumeDocument(costume),
  }));

  return {
    ...target,
    object,
    costumes,
    currentCostumeIndex: effectiveProps.currentCostumeIndex ?? 0,
  };
}

export function resolveCostumeEditorTarget(
  project: Project,
  target: CostumeEditorTarget
): ResolvedCostumeEditorTarget | null {
  const resolvedObject = resolveCostumeEditorObject(project, target);
  if (!resolvedObject) {
    return null;
  }

  const { object, costumes, currentCostumeIndex } = resolvedObject;
  const costumeIndex = costumes.findIndex((costume) => costume.id === target.costumeId);
  if (costumeIndex < 0) {
    return null;
  }

  return {
    ...target,
    object,
    costumes,
    costume: costumes[costumeIndex],
    costumeIndex,
    currentCostumeIndex,
  };
}
