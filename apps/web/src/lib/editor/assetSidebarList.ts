export interface NormalizeAssetSelectionOptions {
  orderedIds: readonly string[];
  selectedIds: readonly string[];
  activeId: string | null;
}

export interface ResolveAssetSelectionOptions extends NormalizeAssetSelectionOptions {
  anchorId: string | null;
  targetId: string;
  append: boolean;
  range: boolean;
}

export interface ResolvedAssetSelection {
  selectedIds: string[];
  anchorId: string | null;
}

function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

export function orderAssetIdsByListOrder(
  orderedIds: readonly string[],
  candidateIds: readonly string[],
): string[] {
  const candidateSet = new Set(uniqueIds(candidateIds));
  return orderedIds.filter((id) => candidateSet.has(id));
}

export function normalizeAssetSelection({
  orderedIds,
  selectedIds,
  activeId,
}: NormalizeAssetSelectionOptions): string[] {
  const nextIds = orderAssetIdsByListOrder(orderedIds, selectedIds);
  if (!activeId || !orderedIds.includes(activeId)) {
    return nextIds;
  }

  if (nextIds.includes(activeId)) {
    return nextIds;
  }

  return orderAssetIdsByListOrder(orderedIds, [activeId, ...nextIds]);
}

export function resolveAssetSelection({
  orderedIds,
  selectedIds,
  activeId,
  anchorId,
  targetId,
  append,
  range,
}: ResolveAssetSelectionOptions): ResolvedAssetSelection {
  if (!append && !range) {
    return {
      selectedIds: [targetId],
      anchorId: targetId,
    };
  }

  if (range) {
    const resolvedAnchorId = anchorId ?? activeId ?? targetId;
    const anchorIndex = orderedIds.indexOf(resolvedAnchorId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (anchorIndex < 0 || targetIndex < 0) {
      return {
        selectedIds: normalizeAssetSelection({
          orderedIds,
          selectedIds: [resolvedAnchorId, targetId],
          activeId,
        }),
        anchorId: resolvedAnchorId,
      };
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return {
      selectedIds: normalizeAssetSelection({
        orderedIds,
        selectedIds: orderedIds.slice(start, end + 1),
        activeId,
      }),
      anchorId: resolvedAnchorId,
    };
  }

  const currentSelection = new Set(normalizeAssetSelection({
    orderedIds,
    selectedIds,
    activeId,
  }));

  if (targetId === activeId) {
    return {
      selectedIds: activeId ? [activeId] : [targetId],
      anchorId: targetId,
    };
  }

  if (currentSelection.has(targetId)) {
    currentSelection.delete(targetId);
  } else {
    currentSelection.add(targetId);
  }

  if (activeId) {
    currentSelection.add(activeId);
  }

  return {
    selectedIds: orderAssetIdsByListOrder(orderedIds, Array.from(currentSelection)),
    anchorId: targetId,
  };
}

export function reorderAssetList<T extends { id: string }>(
  items: readonly T[],
  movedIds: readonly string[],
  targetIndex: number,
): T[] | null {
  const orderedMovedIds = items
    .filter((item) => movedIds.includes(item.id))
    .map((item) => item.id);
  if (orderedMovedIds.length === 0) {
    return null;
  }

  const movedIdSet = new Set(orderedMovedIds);
  const remainingItems = items.filter((item) => !movedIdSet.has(item.id));
  const clampedTargetIndex = Math.max(0, Math.min(targetIndex, items.length));
  const removedBeforeTarget = items
    .slice(0, clampedTargetIndex)
    .filter((item) => movedIdSet.has(item.id))
    .length;
  const insertIndex = Math.max(0, Math.min(
    remainingItems.length,
    clampedTargetIndex - removedBeforeTarget,
  ));

  const movedItems = items.filter((item) => movedIdSet.has(item.id));
  const nextItems = remainingItems
    .slice(0, insertIndex)
    .concat(movedItems, remainingItems.slice(insertIndex));

  const didChange = nextItems.some((item, index) => item.id !== items[index]?.id);
  return didChange ? nextItems : null;
}

export function resolveNextActiveAssetIdAfterRemoval(
  orderedIds: readonly string[],
  activeId: string | null,
  removedIds: readonly string[],
): string | null {
  const removedIdSet = new Set(uniqueIds(removedIds));
  const remainingIds = orderedIds.filter((id) => !removedIdSet.has(id));
  if (remainingIds.length === 0) {
    return null;
  }

  if (!activeId || !orderedIds.includes(activeId)) {
    return remainingIds[0] ?? null;
  }

  if (!removedIdSet.has(activeId)) {
    return activeId;
  }

  const activeIndex = orderedIds.indexOf(activeId);
  return remainingIds[Math.min(activeIndex, remainingIds.length - 1)] ?? null;
}
