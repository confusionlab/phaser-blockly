import { useCallback, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { flushSync } from 'react-dom';
import {
  getShelfRowDropPosition,
  getTransparentShelfDragImage,
  useShelfDropTargetBoundaryGuard,
} from '@/components/stage/shelfDrag';
import { normalizeLinearDropTarget, type NormalizedDropTarget } from '@/utils/dropTargets';

interface UseAssetSidebarDragOptions {
  itemIds: readonly string[];
  dataTransferType: string;
  onPrepareDrag: (itemId: string) => string[];
  onReorder: (itemIds: string[], targetIndex: number) => void;
}

function parseDraggedItemIds(event: ReactDragEvent<HTMLDivElement>, dataTransferType: string): string[] {
  const rawValue = event.dataTransfer.getData(dataTransferType);
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export function useAssetSidebarDrag({
  itemIds,
  dataTransferType,
  onPrepareDrag,
  onReorder,
}: UseAssetSidebarDragOptions) {
  const dropBoundaryRef = useRef<HTMLDivElement | null>(null);
  const [draggedItemIds, setDraggedItemIds] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<NormalizedDropTarget<string> | null>(null);

  const clearDragState = useCallback(() => {
    setDraggedItemIds([]);
    setDropTarget(null);
  }, []);

  useShelfDropTargetBoundaryGuard({
    active: draggedItemIds.length > 0,
    boundaryRef: dropBoundaryRef,
    onExit: () => setDropTarget(null),
  });

  const handleDragStart = useCallback((event: ReactDragEvent<HTMLDivElement>, itemId: string) => {
    flushSync(() => {
      const dragIds = onPrepareDrag(itemId);
      setDraggedItemIds(dragIds);
      setDropTarget(null);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(dataTransferType, JSON.stringify(dragIds));
      event.dataTransfer.setData('text/plain', dragIds.join(','));
    });

    const dragImage = getTransparentShelfDragImage();
    if (dragImage) {
      event.dataTransfer.setDragImage(dragImage, 0, 0);
    }
  }, [dataTransferType, onPrepareDrag]);

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>, index: number) => {
    if (draggedItemIds.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const dropPosition = getShelfRowDropPosition({
      isFolder: false,
      isExpandedFolder: false,
      clientY: event.clientY,
      rect,
    });
    setDropTarget(normalizeLinearDropTarget(itemIds, {
      key: itemIds[index] ?? null,
      dropPosition: dropPosition === 'before' ? 'before' : 'after',
    }));
  }, [draggedItemIds.length, itemIds]);

  const handleTailDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (draggedItemIds.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget({ key: null, dropPosition: null });
  }, [draggedItemIds.length]);

  const resolveTargetIndex = useCallback((target: NormalizedDropTarget<string> | null): number | null => {
    if (!target) {
      return null;
    }

    if (target.key === null || target.dropPosition === null) {
      return itemIds.length;
    }

    const itemIndex = itemIds.indexOf(target.key);
    if (itemIndex < 0) {
      return null;
    }

    return itemIndex + (target.dropPosition === 'after' ? 1 : 0);
  }, [itemIds]);

  const resolveFallbackTarget = useCallback((event: ReactDragEvent<HTMLDivElement>, index: number): NormalizedDropTarget<string> | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dropPosition = getShelfRowDropPosition({
      isFolder: false,
      isExpandedFolder: false,
      clientY: event.clientY,
      rect,
    });

    return normalizeLinearDropTarget(itemIds, {
      key: itemIds[index] ?? null,
      dropPosition: dropPosition === 'before' ? 'before' : 'after',
    });
  }, [itemIds]);

  const commitDrop = useCallback((event: ReactDragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    const droppedItemIds = draggedItemIds.length > 0
      ? draggedItemIds
      : parseDraggedItemIds(event, dataTransferType);

    const resolvedTarget = dropTarget && dropTarget.key === (itemIds[index] ?? null)
      ? dropTarget
      : resolveFallbackTarget(event, index);
    const targetIndex = resolveTargetIndex(resolvedTarget);

    if (targetIndex === null || droppedItemIds.length === 0) {
      clearDragState();
      return;
    }

    onReorder(droppedItemIds, targetIndex);
    clearDragState();
  }, [
    clearDragState,
    dataTransferType,
    draggedItemIds,
    dropTarget,
    itemIds,
    onReorder,
    resolveFallbackTarget,
    resolveTargetIndex,
  ]);

  const commitTailDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const droppedItemIds = draggedItemIds.length > 0
      ? draggedItemIds
      : parseDraggedItemIds(event, dataTransferType);
    const targetIndex = resolveTargetIndex(dropTarget ?? { key: null, dropPosition: null });

    if (targetIndex === null || droppedItemIds.length === 0) {
      clearDragState();
      return;
    }

    onReorder(droppedItemIds, targetIndex);
    clearDragState();
  }, [clearDragState, dataTransferType, draggedItemIds, dropTarget, onReorder, resolveTargetIndex]);

  return {
    dropBoundaryRef,
    draggedItemIds,
    dropTarget,
    clearDragState,
    handleDragStart,
    handleDragOver,
    handleTailDragOver,
    handleDrop: commitDrop,
    handleTailDrop: commitTailDrop,
  };
}
