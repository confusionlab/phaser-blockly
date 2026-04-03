export interface NormalizedDropTarget<TKey extends string = string> {
  key: TKey | null;
  dropPosition: 'before' | 'after' | 'on' | null;
}

interface NormalizeSiblingDropTargetOptions<TKey extends string, TNodeType extends string> {
  target: NormalizedDropTarget<TKey>;
  targetNode: { key: TKey; type: TNodeType } | null;
  siblings: readonly TKey[];
  rootDestination: NormalizedDropTarget<TKey>;
  acceptsOnTarget: (node: { key: TKey; type: TNodeType }) => boolean;
}

export function normalizeSiblingDropTarget<TKey extends string, TNodeType extends string>({
  target,
  targetNode,
  siblings,
  rootDestination,
  acceptsOnTarget,
}: NormalizeSiblingDropTargetOptions<TKey, TNodeType>): NormalizedDropTarget<TKey> {
  if (!targetNode || !target.dropPosition) {
    return rootDestination;
  }

  if (target.dropPosition === 'on') {
    return acceptsOnTarget(targetNode)
      ? { key: targetNode.key, dropPosition: 'on' }
      : { key: targetNode.key, dropPosition: 'after' };
  }

  const targetIndex = siblings.indexOf(targetNode.key);
  if (targetIndex < 0) {
    return rootDestination;
  }

  const destinationIndex = targetIndex + (target.dropPosition === 'after' ? 1 : 0);
  const nextSiblingKey = siblings[destinationIndex];
  if (nextSiblingKey) {
    return { key: nextSiblingKey, dropPosition: 'before' };
  }

  return rootDestination;
}

export function normalizeLinearDropTarget<TKey extends string>(
  itemIds: readonly TKey[],
  target: Pick<NormalizedDropTarget<TKey>, 'key' | 'dropPosition'>,
): NormalizedDropTarget<TKey> {
  if (!target.key || !target.dropPosition) {
    return { key: null, dropPosition: null };
  }

  const targetKey = target.key;
  return normalizeSiblingDropTarget({
    target: { key: targetKey, dropPosition: target.dropPosition === 'on' ? 'after' : target.dropPosition },
    targetNode: itemIds.includes(targetKey) ? { key: targetKey, type: 'item' as const } : null,
    siblings: itemIds,
    rootDestination: { key: null, dropPosition: null },
    acceptsOnTarget: () => false,
  });
}
