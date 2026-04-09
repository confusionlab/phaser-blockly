import { getEffectiveObjectProps } from '@/types';
import type {
  AnimatedCostumeClip,
  ComponentDefinition,
  Costume,
  CostumeAssetFrame,
  CostumeBounds,
  CostumeDocument,
  CostumeLayer,
  GameObject,
  Project,
} from '@/types';
import {
  applyCanvasStateToAnimatedCostumeClip,
  applyCanvasStateToCostumeDocument,
  cloneCostumeDocument,
  createAnimatedCostumeClipFromDocument,
  ensureCostumeDocument,
  cloneAnimatedCostumeClip,
  isAnimatedCostume,
  type ActiveLayerCanvasState,
} from '@/lib/costume/costumeDocument';
import {
  areCostumeAssetFramesEqual,
  cloneCostumeAssetFrame,
} from '@/lib/costume/costumeAssetFrame';
import {
  reorderAssetList,
  resolveNextActiveAssetIdAfterRemoval,
} from '@/lib/editor/assetSidebarList';

export interface ObjectCostumeEditorTarget {
  sceneId: string;
  objectId: string;
  costumeId: string;
}

export interface ComponentCostumeEditorTarget {
  componentId: string;
  costumeId: string;
}

export type CostumeEditorTarget = ObjectCostumeEditorTarget | ComponentCostumeEditorTarget;

export interface ObjectCostumeEditorObjectTarget {
  sceneId: string;
  objectId: string;
}

export interface ComponentCostumeEditorObjectTarget {
  componentId: string;
}

export type CostumeEditorObjectTarget =
  | ObjectCostumeEditorObjectTarget
  | ComponentCostumeEditorObjectTarget;

export type CostumeEditorSession = CostumeEditorTarget & {
  key: string;
};

export interface CostumeEditorPersistedState {
  kind: Costume['kind'];
  assetId: string;
  bounds?: CostumeBounds;
  assetFrame?: CostumeAssetFrame;
  document: CostumeDocument;
  clip?: AnimatedCostumeClip;
}

export interface CostumeEditorPersistedSession {
  target: CostumeEditorTarget;
  state: CostumeEditorPersistedState;
}

export interface ResolveCostumeEditorPersistedStateOptions {
  workingState?: CostumeEditorPersistedState | null;
  costume?: Costume | null;
  liveCanvasState?: ActiveLayerCanvasState | null;
  animatedFrameIndex?: number;
}

export type CostumeEditorOperation =
  | { type: 'rename'; costumeId: string; name: string }
  | { type: 'select'; costumeId: string }
  | { type: 'add'; costume: Costume }
  | { type: 'remove'; costumeId: string }
  | { type: 'removeMany'; costumeIds: string[] }
  | { type: 'reorder'; costumeIds: string[]; targetIndex: number };

export interface ResolvedObjectCostumeEditorObjectTarget extends ObjectCostumeEditorObjectTarget {
  object: GameObject;
  costumes: Costume[];
  currentCostumeIndex: number;
}

export interface ResolvedComponentCostumeEditorObjectTarget extends ComponentCostumeEditorObjectTarget {
  component: ComponentDefinition;
  costumes: Costume[];
  currentCostumeIndex: number;
}

export type ResolvedCostumeEditorObjectTarget =
  | ResolvedObjectCostumeEditorObjectTarget
  | ResolvedComponentCostumeEditorObjectTarget;

export interface ResolvedObjectCostumeEditorTarget extends ObjectCostumeEditorTarget {
  object: GameObject;
  costumes: Costume[];
  costume: Costume;
  costumeIndex: number;
  currentCostumeIndex: number;
}

export interface ResolvedComponentCostumeEditorTarget extends ComponentCostumeEditorTarget {
  component: ComponentDefinition;
  costumes: Costume[];
  costume: Costume;
  costumeIndex: number;
  currentCostumeIndex: number;
}

export type ResolvedCostumeEditorTarget =
  | ResolvedObjectCostumeEditorTarget
  | ResolvedComponentCostumeEditorTarget;

export function createCostumeEditorSession(target: CostumeEditorTarget): CostumeEditorSession {
  return {
    ...target,
    key: 'componentId' in target
      ? `component:${target.componentId}:${target.costumeId}`
      : `${target.sceneId}:${target.objectId}:${target.costumeId}`,
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
      a.bitmap.assetId === b.bitmap.assetId &&
      areCostumeAssetFramesEqual(a.bitmap.assetFrame, b.bitmap.assetFrame)
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

function clonePersistedState(
  state: CostumeEditorPersistedState | null | undefined,
): CostumeEditorPersistedState | null {
  if (!state) {
    return null;
  }

  return {
    kind: state.kind,
    assetId: state.assetId,
    bounds: state.bounds ? { ...state.bounds } : undefined,
    assetFrame: cloneCostumeAssetFrame(state.assetFrame),
    document: cloneCostumeDocument(state.document),
    clip: state.clip ? cloneAnimatedCostumeClip(state.clip) : undefined,
  };
}

function createPersistedStateFromCostume(costume: Costume | null | undefined): CostumeEditorPersistedState | null {
  if (!costume) {
    return null;
  }

  return {
    kind: costume.kind,
    assetId: costume.assetId,
    bounds: costume.bounds ? { ...costume.bounds } : undefined,
    assetFrame: cloneCostumeAssetFrame(costume.assetFrame),
    document: cloneCostumeDocument(ensureCostumeDocument(costume)),
    clip: isAnimatedCostume(costume) ? cloneAnimatedCostumeClip(costume.clip) : undefined,
  };
}

export function resolveCostumeEditorPersistedState(
  options: ResolveCostumeEditorPersistedStateOptions,
): CostumeEditorPersistedState | null {
  const baseState = clonePersistedState(options.workingState)
    ?? createPersistedStateFromCostume(options.costume);
  if (!baseState) {
    return null;
  }

  if (!options.liveCanvasState) {
    return baseState;
  }

  if (baseState.kind === 'animated' && baseState.clip) {
    const nextClip = applyCanvasStateToAnimatedCostumeClip(
      baseState.clip,
      options.animatedFrameIndex ?? 0,
      options.liveCanvasState,
    );
    if (!nextClip) {
      return baseState;
    }

    return {
      ...baseState,
      clip: nextClip,
    };
  }

  return {
    ...baseState,
    document: applyCanvasStateToCostumeDocument(baseState.document, options.liveCanvasState),
  };
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
  const nextKind = state.kind ?? costume.kind;
  const nextBounds = state.bounds ?? undefined;
  const nextDocument = state.document
    ? cloneCostumeDocument(state.document)
    : cloneCostumeDocument(ensureCostumeDocument(costume));
  const nextClip = nextKind === 'animated'
    ? cloneAnimatedCostumeClip(state.clip ?? (isAnimatedCostume(costume) ? costume.clip : createAnimatedCostumeClipFromDocument(nextDocument)))
    : undefined;

  const noAssetChange = costume.assetId === state.assetId;
  const noBoundsChange = areCostumeBoundsEqual(costume.bounds, nextBounds);
  const noAssetFrameChange = areCostumeAssetFramesEqual(costume.assetFrame, state.assetFrame);
  const noDocumentChange = areCostumeDocumentsEqual(costume.document, nextDocument);
  const noClipChange = nextKind !== 'animated'
    ? !isAnimatedCostume(costume)
    : (isAnimatedCostume(costume) && JSON.stringify(costume.clip) === JSON.stringify(nextClip));
  if (noAssetChange && noBoundsChange && noAssetFrameChange && noDocumentChange && noClipChange && costume.kind === nextKind) {
    return null;
  }

  return costumes.map((entry, index) =>
    index === costumeIndex
      ? (() => {
          const { clip: _existingClip, ...restEntry } = entry as Costume & { clip?: AnimatedCostumeClip };
          return {
            ...restEntry,
            kind: nextKind,
            assetId: state.assetId,
            bounds: nextBounds,
            assetFrame: cloneCostumeAssetFrame(state.assetFrame),
            document: nextDocument,
            ...(nextKind === 'animated'
              ? {
                  clip: cloneAnimatedCostumeClip(nextClip!),
                }
              : {}),
          } as Costume;
        })()
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

export function removeCostumesFromList(
  costumes: Costume[],
  targetCostumeIds: readonly string[],
): Costume[] | null {
  const targetCostumeIdSet = new Set(targetCostumeIds);
  if (targetCostumeIdSet.size === 0) {
    return null;
  }

  const nextCostumes = costumes.filter((costume) => !targetCostumeIdSet.has(costume.id));
  if (nextCostumes.length === costumes.length) {
    return null;
  }

  return nextCostumes;
}

export function reorderCostumesInList(
  costumes: Costume[],
  targetCostumeIds: readonly string[],
  targetIndex: number,
): Costume[] | null {
  return reorderAssetList(costumes, targetCostumeIds, targetIndex);
}

export function resolveNextActiveCostumeIdAfterRemoval(
  costumes: readonly Costume[],
  activeCostumeId: string | null,
  removedCostumeIds: readonly string[],
): string | null {
  return resolveNextActiveAssetIdAfterRemoval(
    costumes.map((costume) => costume.id),
    activeCostumeId,
    removedCostumeIds,
  );
}

export function resolveCostumeEditorObject(
  project: Project,
  target: CostumeEditorObjectTarget
): ResolvedCostumeEditorObjectTarget | null {
  if ('componentId' in target) {
    const component = (project.components || []).find((candidate) => candidate.id === target.componentId);
    if (!component) {
      return null;
    }

    const costumes = (component.costumes || []).map((costume) => ({
      ...costume,
      document: ensureCostumeDocument(costume),
    }));

    return {
      ...target,
      component,
      costumes,
      currentCostumeIndex: component.currentCostumeIndex ?? 0,
    };
  }

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

  const { costumes, currentCostumeIndex } = resolvedObject;
  const costumeIndex = costumes.findIndex((costume) => costume.id === target.costumeId);
  if (costumeIndex < 0) {
    return null;
  }

  if ('componentId' in resolvedObject) {
    return {
      componentId: resolvedObject.componentId,
      costumeId: target.costumeId,
      component: resolvedObject.component,
      costumes,
      costume: costumes[costumeIndex],
      costumeIndex,
      currentCostumeIndex,
    };
  }

  return {
    sceneId: resolvedObject.sceneId,
    objectId: resolvedObject.objectId,
    costumeId: target.costumeId,
    object: resolvedObject.object,
    costumes,
    costume: costumes[costumeIndex],
    costumeIndex,
    currentCostumeIndex,
  };
}
