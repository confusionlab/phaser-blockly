import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Library, Loader2 } from '@/components/ui/icons';
import {
  CollectionSelectionCheckbox,
  CollectionViewControls,
  collectionCardClassName,
  collectionRowClassName,
  type CollectionViewMode,
} from '@/components/shared/CollectionBrowserChrome';
import { orderAssetIdsByListOrder } from '@/lib/editor/assetSidebarList';
import { cn } from '@/lib/utils';
import { shouldIgnoreGlobalKeyboardEvent } from '@/utils/keyboard';

interface LibraryBrowserItemRenderState {
  opening: boolean;
  selected: boolean;
  selectionMode: boolean;
  viewMode: CollectionViewMode;
}

interface LibraryBrowserToolbarState<T> {
  clearSelection: () => void;
  exitSelectionMode: () => void;
  selectedItems: T[];
  selectionMode: boolean;
  viewMode: CollectionViewMode;
}

interface LibraryBrowserDialogProps<T> {
  canDeleteItem?: (item: T) => boolean;
  description?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
  emptyTitle: string;
  getItemId: (item: T) => string;
  getItemName?: (item: T) => string;
  initialViewMode?: CollectionViewMode;
  itemLabelPlural?: string;
  itemLabelSingular: string;
  items: readonly T[] | undefined;
  loading?: boolean;
  loadingLabel?: string;
  onDeleteSelected?: (items: T[]) => Promise<void> | void;
  onItemOpen: (item: T) => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  renderCard: (item: T, state: LibraryBrowserItemRenderState) => ReactNode;
  renderRow: (item: T, state: LibraryBrowserItemRenderState) => ReactNode;
  title: string;
  toolbarActions?: ReactNode | ((state: LibraryBrowserToolbarState<T>) => ReactNode);
}

function formatItemCountLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getSelectionRange(orderedIds: readonly string[], fromId: string, toId: string): string[] {
  const fromIndex = orderedIds.indexOf(fromId);
  const toIndex = orderedIds.indexOf(toId);

  if (fromIndex < 0 || toIndex < 0) {
    return [toId];
  }

  const [start, end] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
  return orderedIds.slice(start, end + 1);
}

export function LibraryBrowserDialog<T>({
  canDeleteItem,
  description,
  emptyDescription,
  emptyIcon,
  emptyTitle,
  getItemId,
  getItemName,
  initialViewMode = 'card',
  itemLabelPlural,
  itemLabelSingular,
  items,
  loading = false,
  loadingLabel,
  onDeleteSelected,
  onItemOpen,
  onOpenChange,
  open,
  renderCard,
  renderRow,
  title,
  toolbarActions,
}: LibraryBrowserDialogProps<T>) {
  const resolvedItems = useMemo(() => items ?? [], [items]);
  const orderedIds = useMemo(
    () => resolvedItems.map((item) => getItemId(item)),
    [getItemId, resolvedItems],
  );
  const itemById = useMemo(
    () => new Map(resolvedItems.map((item) => [getItemId(item), item])),
    [getItemId, resolvedItems],
  );
  const [viewMode, setViewMode] = useState<CollectionViewMode>(initialViewMode);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [openingItemId, setOpeningItemId] = useState<string | null>(null);
  const [isDeletingSelection, setIsDeletingSelection] = useState(false);

  useEffect(() => {
    if (open) {
      return;
    }

    setSelectionMode(false);
    setSelectedIds([]);
    setSelectionAnchorId(null);
    setOpeningItemId(null);
    setIsDeletingSelection(false);
    setViewMode(initialViewMode);
  }, [initialViewMode, open]);

  useEffect(() => {
    setSelectedIds((current) => orderAssetIdsByListOrder(orderedIds, current));
    setSelectionAnchorId((current) => (current && orderedIds.includes(current) ? current : null));
  }, [orderedIds]);

  const selectedItems = useMemo(
    () => selectedIds
      .map((id) => itemById.get(id))
      .filter((item): item is T => !!item),
    [itemById, selectedIds],
  );
  const deletableSelectedItems = useMemo(
    () => selectedItems.filter((item) => (canDeleteItem ? canDeleteItem(item) : true)),
    [canDeleteItem, selectedItems],
  );
  const isBusy = !!openingItemId || isDeletingSelection;
  const resolvedGetItemName = useCallback((item: T) => {
    return getItemName?.(item) ?? getItemId(item);
  }, [getItemId, getItemName]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectionAnchorId(null);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    clearSelection();
  }, [clearSelection]);

  useEffect(() => {
    if (!open || !selectionMode) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalKeyboardEvent(event)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        exitSelectionMode();
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && deletableSelectedItems.length > 0 && onDeleteSelected) {
        event.preventDefault();
        void (async () => {
          setIsDeletingSelection(true);
          try {
            await onDeleteSelected(deletableSelectedItems);
          } finally {
            setIsDeletingSelection(false);
          }
        })();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deletableSelectedItems, exitSelectionMode, onDeleteSelected, open, selectionMode]);

  const handleSelectionInteraction = useCallback((
    itemId: string,
    event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  ) => {
    const append = event.metaKey || event.ctrlKey;
    const range = event.shiftKey;

    if (!selectionMode) {
      setSelectionMode(true);
    }

    if (range) {
      const anchorId = selectionAnchorId ?? selectedIds[selectedIds.length - 1] ?? itemId;
      const rangeIds = getSelectionRange(orderedIds, anchorId, itemId);
      setSelectedIds((current) => orderAssetIdsByListOrder(
        orderedIds,
        Array.from(new Set([...current, ...rangeIds])),
      ));
      setSelectionAnchorId(itemId);
      return;
    }

    setSelectedIds((current) => {
      if (!selectionMode && !append) {
        return [itemId];
      }

      if (current.includes(itemId)) {
        return current.filter((id) => id !== itemId);
      }

      return orderAssetIdsByListOrder(orderedIds, [...current, itemId]);
    });
    setSelectionAnchorId(itemId);
  }, [orderedIds, selectedIds, selectionAnchorId, selectionMode]);

  const handleItemActivate = useCallback(async (
    item: T,
    event?: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  ) => {
    const itemId = getItemId(item);
    const hasModifier = !!event && (event.metaKey || event.ctrlKey || event.shiftKey);

    if (selectionMode || hasModifier) {
      handleSelectionInteraction(itemId, event ?? {
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      });
      return;
    }

    setOpeningItemId(itemId);
    try {
      await onItemOpen(item);
      onOpenChange(false);
    } catch {
      // Caller is responsible for surfacing errors to the user.
    } finally {
      setOpeningItemId(null);
    }
  }, [getItemId, handleSelectionInteraction, onItemOpen, onOpenChange, selectionMode]);

  const handleDeleteSelected = useCallback(async () => {
    if (!onDeleteSelected || deletableSelectedItems.length === 0) {
      return;
    }

    setIsDeletingSelection(true);
    try {
      await onDeleteSelected(deletableSelectedItems);
    } finally {
      setIsDeletingSelection(false);
    }
  }, [deletableSelectedItems, onDeleteSelected]);

  const statusLabel = useMemo(() => {
    if (loading || !items) {
      return loadingLabel ?? `Loading ${itemLabelPlural ?? `${itemLabelSingular}s`}...`;
    }
    if (resolvedItems.length === 0) {
      return emptyTitle;
    }
    return formatItemCountLabel(resolvedItems.length, itemLabelSingular, itemLabelPlural);
  }, [emptyTitle, itemLabelPlural, itemLabelSingular, items, loading, loadingLabel, resolvedItems.length]);
  const resolvedToolbarActions = useMemo(() => (
    typeof toolbarActions === 'function'
      ? toolbarActions({
          clearSelection,
          exitSelectionMode,
          selectedItems,
          selectionMode,
          viewMode,
        })
      : toolbarActions
  ), [clearSelection, exitSelectionMode, selectedItems, selectionMode, toolbarActions, viewMode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(calc(100vh-2.5rem),960px)] max-h-[min(calc(100vh-2.5rem),960px)] w-[calc(100vw-2.5rem)] max-w-none border-none bg-transparent p-4 shadow-none sm:p-6">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-border/70 bg-background shadow-[0_40px_120px_-52px_rgba(15,23,42,0.58)]">
          <div className="shrink-0 border-b border-border/70 px-6 py-6 pr-16">
            <DialogHeader className="gap-2 text-left">
              <DialogTitle className="text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
                {title}
              </DialogTitle>
              {description ? (
                <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {description}
                </DialogDescription>
              ) : null}
            </DialogHeader>
          </div>

          <section className="relative flex min-h-0 flex-1 flex-col bg-card/80">
            <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                {resolvedToolbarActions}
                <div className="text-sm font-medium text-foreground/80">
                  {statusLabel}
                </div>
              </div>

              <CollectionViewControls
                ariaLabel={`${title} view`}
                deleteDisabled={isBusy}
                deleteLabel={
                  deletableSelectedItems.length === 1
                    ? `Delete selected ${itemLabelSingular}`
                    : `Delete ${deletableSelectedItems.length} selected ${itemLabelPlural ?? `${itemLabelSingular}s`}`
                }
                disabled={isBusy}
                onDeleteSelected={onDeleteSelected ? () => void handleDeleteSelected() : undefined}
                onToggleSelectionMode={() => {
                  if (isBusy) {
                    return;
                  }
                  if (selectionMode) {
                    exitSelectionMode();
                    return;
                  }
                  setSelectionMode(true);
                }}
                onViewModeChange={setViewMode}
                selectionCount={deletableSelectedItems.length}
                selectionMode={selectionMode}
                viewMode={viewMode}
              />
            </div>

            <div
              className="min-h-0 flex-1 overflow-auto"
              onClick={() => {
                if (selectionMode) {
                  clearSelection();
                }
              }}
            >
              {loading || !items ? (
                <div className="flex h-full min-h-[320px] items-center justify-center text-muted-foreground">
                  <Loader2 className="size-7 animate-spin" />
                </div>
              ) : resolvedItems.length === 0 ? (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 px-6 text-center text-muted-foreground">
                  <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    {emptyIcon ?? <Library className="size-8" />}
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-foreground">{emptyTitle}</div>
                    {emptyDescription ? (
                      <div className="mt-2 text-sm leading-6">
                        {emptyDescription}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : viewMode === 'card' ? (
                <div className="grid auto-rows-fr gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {resolvedItems.map((item) => {
                    const itemId = getItemId(item);
                    const isSelected = selectedIds.includes(itemId);
                    const isOpening = openingItemId === itemId;

                    return (
                      <div
                        key={itemId}
                        aria-label={resolvedGetItemName(item)}
                        aria-selected={isSelected}
                        className={collectionCardClassName({ selected: isSelected })}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isBusy && !isOpening) {
                            return;
                          }
                          void handleItemActivate(item, event.nativeEvent);
                        }}
                        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            void handleItemActivate(item);
                          }
                        }}
                      >
                        {selectionMode ? (
                          <CollectionSelectionCheckbox checked={isSelected} className="absolute left-3 top-3 z-10 shadow-sm" />
                        ) : null}

                        {renderCard(item, {
                          opening: isOpening,
                          selected: isSelected,
                          selectionMode,
                          viewMode,
                        })}

                        {isOpening ? (
                          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/55 backdrop-blur-[2px]">
                            <Loader2 className="size-6 animate-spin text-foreground/80" />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col">
                  {resolvedItems.map((item) => {
                    const itemId = getItemId(item);
                    const isSelected = selectedIds.includes(itemId);
                    const isOpening = openingItemId === itemId;

                    return (
                      <div
                        key={itemId}
                        aria-label={resolvedGetItemName(item)}
                        aria-selected={isSelected}
                        className={collectionRowClassName({ selected: isSelected })}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isBusy && !isOpening) {
                            return;
                          }
                          void handleItemActivate(item, event.nativeEvent);
                        }}
                        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            void handleItemActivate(item);
                          }
                        }}
                      >
                        {selectionMode ? (
                          <CollectionSelectionCheckbox checked={isSelected} className="absolute left-4 top-4 z-10 shadow-sm" />
                        ) : null}

                        <div className={cn('flex min-w-0 flex-1 items-center gap-4', selectionMode && 'pl-7')}>
                          {renderRow(item, {
                            opening: isOpening,
                            selected: isSelected,
                            selectionMode,
                            viewMode,
                          })}
                        </div>

                        {isOpening ? (
                          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50 backdrop-blur-[2px]">
                            <Loader2 className="size-6 animate-spin text-foreground/80" />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
