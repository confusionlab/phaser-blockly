import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  normalizeAssetSelection,
  orderAssetIdsByListOrder,
  resolveAssetSelection,
} from '@/lib/editor/assetSidebarList';

function areIdArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((id, index) => id === right[index]);
}

interface UseBulkAssetSelectionOptions {
  orderedIds: readonly string[];
  activeId: string | null;
  onActivate: (id: string) => void;
}

interface ReplaceSelectionOptions {
  anchorId?: string | null;
}

export function useBulkAssetSelection({
  orderedIds,
  activeId,
  onActivate,
}: UseBulkAssetSelectionOptions) {
  const orderedIdsKey = useMemo(() => orderedIds.join('|'), [orderedIds]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => (
    activeId ? [activeId] : []
  ));
  const [anchorId, setAnchorId] = useState<string | null>(activeId);

  useEffect(() => {
    setSelectedIds((current) => {
      const normalized = normalizeAssetSelection({
        orderedIds,
        selectedIds: current,
        activeId,
      });
      return areIdArraysEqual(current, normalized) ? current : normalized;
    });
    setAnchorId((current) => {
      if (current && orderedIds.includes(current)) {
        return current;
      }
      return activeId ?? orderedIds[0] ?? null;
    });
  }, [activeId, orderedIds, orderedIdsKey]);

  const replaceSelection = useCallback((ids: readonly string[], options?: ReplaceSelectionOptions) => {
    setSelectedIds(Array.from(ids));
    setAnchorId(options?.anchorId ?? ids[ids.length - 1] ?? activeId ?? null);
  }, [activeId]);

  const handleItemClick = useCallback((
    targetId: string,
    event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  ) => {
    const append = event.metaKey || event.ctrlKey;
    const range = event.shiftKey;

    if (!append && !range) {
      replaceSelection([targetId], { anchorId: targetId });
      if (activeId !== targetId) {
        onActivate(targetId);
      } else if (!activeId) {
        onActivate(targetId);
      }
      return;
    }

    const resolved = resolveAssetSelection({
      orderedIds,
      selectedIds,
      activeId,
      anchorId,
      targetId,
      append,
      range,
    });
    replaceSelection(resolved.selectedIds, { anchorId: resolved.anchorId });
    if (!activeId) {
      onActivate(targetId);
    }
  }, [activeId, anchorId, onActivate, orderedIds, replaceSelection, selectedIds]);

  const prepareDragSelection = useCallback((targetId: string): string[] => {
    const orderedSelectedIds = orderAssetIdsByListOrder(orderedIds, selectedIds);
    if (orderedSelectedIds.length > 1 && orderedSelectedIds.includes(targetId)) {
      return orderedSelectedIds;
    }

    replaceSelection([targetId], { anchorId: targetId });
    if (activeId !== targetId) {
      onActivate(targetId);
    } else if (!activeId) {
      onActivate(targetId);
    }
    return [targetId];
  }, [activeId, onActivate, orderedIds, replaceSelection, selectedIds]);

  return {
    selectedIds,
    replaceSelection,
    handleItemClick,
    prepareDragSelection,
  };
}
