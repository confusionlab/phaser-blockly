import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useConvex, useConvexAuth, useMutation } from 'convex/react';
import { api } from '@convex-generated/api';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { Card } from '@/components/ui/card';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SpriteShelf } from './SpriteShelf';
import { ObjectLibraryBrowser } from '@/components/dialogs/ObjectLibraryBrowser';
import { SceneLibraryBrowser } from '@/components/dialogs/SceneLibraryBrowser';
import {
  Clipboard,
  Copy,
  CopyPlus,
  Earth,
  Folder,
  FolderOpen,
  FolderPlus,
  Library,
  Layers3,
  Pencil,
  Plus,
  Scissors,
  Trash2,
} from '@/components/ui/icons';
import { ShelfTreeRow } from './ShelfTreeRow';
import { ShelfObjectThumbnail } from './ShelfObjectThumbnail';
import { ObjectComponentLabel } from './ObjectComponentLabel';
import { getShelfRowDropPosition, getTransparentShelfDragImage, setDraggedComponentId, useShelfDropTargetBoundaryGuard } from './shelfDrag';
import type { ComponentDefinition, ComponentFolder, HierarchyFolder, Scene, SceneFolder } from '@/types';
import {
  getFolderedHierarchyTree,
  getHierarchyFolderNodeKey,
  getHierarchyItemNodeKey,
  insertFolderedHierarchyFolder,
  moveFolderedHierarchyNodes,
  normalizeFolderedHierarchyDropTarget,
  type FolderedItemShape,
  type HierarchyDropTarget,
  type HierarchyTreeNode,
} from '@/utils/hierarchyTree';
import { panelHeaderClassNames } from '@/lib/ui/panelHeaderTokens';
import { cn } from '@/lib/utils';
import { deleteComponentWithHistory } from '@/lib/editor/objectCommands';
import {
  getFolderedHierarchyClipboard,
  hasFolderedHierarchyClipboardContents,
  setFolderedHierarchyClipboard,
  type FolderedHierarchyClipboardKind,
  type FolderedHierarchyClipboardMode,
} from '@/lib/editor/folderedHierarchyClipboard';
import { useModal } from '@/components/ui/modal-provider';
import { saveRuntimeObjectToLibrary } from '@/lib/objectLibrary/objectLibraryAssets';
import {
  ensureSceneLibraryAssetRefsInCloud,
  prepareSceneLibraryCreatePayload,
} from '@/lib/sceneLibrary/sceneLibraryAssets';

type SceneItem = Scene & FolderedItemShape;
type ComponentItem = ComponentDefinition & FolderedItemShape;

function collectFolderDescendants(folderId: string, folders: HierarchyFolder[]): Set<string> {
  const descendants = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (!descendants.has(folder.id) && folder.parentId && descendants.has(folder.parentId)) {
        descendants.add(folder.id);
        changed = true;
      }
    }
  }
  return descendants;
}

interface FolderedHierarchyPaneProps<TItem extends FolderedItemShape> {
  title: string;
  itemLabel: string;
  emptyLabel: string;
  folders: HierarchyFolder[];
  items: TItem[];
  itemKeyPrefix: string;
  selectedItemId: string | null;
  selectedItemIds: string[];
  onSelectItem: (item: TItem) => void;
  onSelectItems: (itemIds: string[], primaryItemId?: string | null) => void;
  onAddItem: () => void;
  onAddFolder: () => void;
  onRenameItem: (itemId: string, name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteItem: (itemId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onMove: (items: TItem[], folders: HierarchyFolder[]) => void;
  renderItemIcon?: (item: TItem) => React.ReactNode;
  renderItemLabel?: (item: TItem) => React.ReactNode;
  renderHeaderActions?: React.ReactNode;
  onItemDragStart?: (event: React.DragEvent<HTMLDivElement>, item: TItem) => void;
  onItemDragEnd?: (item: TItem) => void;
  renderItemContextMenuActions?: (item: TItem, closeMenu: () => void) => React.ReactNode;
  clipboard?: {
    kind: FolderedHierarchyClipboardKind;
    serializeItem: (item: TItem) => unknown;
    pasteItems: (entries: unknown[], mode: FolderedHierarchyClipboardMode, target: HierarchyDropTarget) => string[];
    removeItemsForCut: (itemIds: string[]) => void;
    canCutItems?: (itemIds: string[]) => boolean;
  };
}

function FolderedHierarchyPane<TItem extends FolderedItemShape>({
  title,
  itemLabel,
  emptyLabel,
  folders,
  items,
  itemKeyPrefix,
  selectedItemId,
  selectedItemIds,
  onSelectItem,
  onSelectItems,
  onAddItem,
  onAddFolder,
  onRenameItem,
  onRenameFolder,
  onDeleteItem,
  onDeleteFolder,
  onMove,
  renderItemIcon,
  renderItemLabel,
  renderHeaderActions,
  onItemDragStart,
  onItemDragEnd,
  renderItemContextMenuActions,
  clipboard,
}: FolderedHierarchyPaneProps<TItem>) {
  const [isPaneHovered, setIsPaneHovered] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draggedKeys, setDraggedKeys] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<HierarchyDropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | { x: number; y: number; kind: 'item'; item: TItem }
    | { x: number; y: number; kind: 'folder'; folder: HierarchyFolder }
    | { x: number; y: number; kind: 'empty' }
    | null
  >(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<HierarchyFolder | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const selectionAnchorItemIdRef = useRef<string | null>(null);
  const dropSurfaceRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(
    () => getFolderedHierarchyTree(folders, items, {
      itemKeyPrefix,
      setItemFolderId: (item, folderId) => ({ ...item, folderId }),
      setItemOrder: (item, order) => ({ ...item, order }),
    }),
    [folders, itemKeyPrefix, items],
  );
  const orderedItemIds = useMemo(() => {
    const orderedIds: string[] = [];
    const visit = (nodes: HierarchyTreeNode<TItem>[]) => {
      for (const node of nodes) {
        if (node.type === 'item' && node.item) {
          orderedIds.push(node.item.id);
        }
        if (node.children.length > 0) {
          visit(node.children);
        }
      }
    };
    visit(tree);
    return orderedIds;
  }, [tree]);
  const visibleItemIds = useMemo(() => {
    const visibleIds: string[] = [];
    const visit = (nodes: HierarchyTreeNode<TItem>[]) => {
      for (const node of nodes) {
        if (node.type === 'item' && node.item) {
          visibleIds.push(node.item.id);
        }
        if (node.type === 'folder' && node.folder && !collapsedFolders.has(node.folder.id) && node.children.length > 0) {
          visit(node.children);
        }
      }
    };
    visit(tree);
    return visibleIds;
  }, [collapsedFolders, tree]);

  useEffect(() => {
    if (draggedKeys.length === 0 || typeof document === 'undefined') {
      return;
    }

    const { body, documentElement } = document;
    const previousBodyCursor = body.style.cursor;
    const previousDocumentCursor = documentElement.style.cursor;

    body.style.cursor = 'grabbing';
    documentElement.style.cursor = 'grabbing';

    return () => {
      body.style.cursor = previousBodyCursor;
      documentElement.style.cursor = previousDocumentCursor;
    };
  }, [draggedKeys.length]);

  useShelfDropTargetBoundaryGuard({
    active: draggedKeys.length > 0,
    boundaryRef: dropSurfaceRef,
    onExit: () => setDropTarget(null),
  });

  const commitRename = () => {
    const nextName = draftName.trim();
    if (!nextName) {
      setEditingFolderId(null);
      setEditingItemId(null);
      setDraftName('');
      return;
    }

    if (editingFolderId) {
      onRenameFolder(editingFolderId, nextName);
    }
    if (editingItemId) {
      onRenameItem(editingItemId, nextName);
    }
    setEditingFolderId(null);
    setEditingItemId(null);
    setDraftName('');
  };

  const handleDrop = (target: HierarchyDropTarget) => {
    if (draggedKeys.length === 0) return;
    const normalizedTarget = normalizeFolderedHierarchyDropTarget(
      folders,
      items,
      target,
      {
        itemKeyPrefix,
        setItemFolderId: (item, folderId) => ({ ...item, folderId }),
        setItemOrder: (item, order) => ({ ...item, order }),
      },
    );
    const nextHierarchy = moveFolderedHierarchyNodes(
      folders,
      items,
      draggedKeys,
      normalizedTarget,
      {
        itemKeyPrefix,
        setItemFolderId: (item, folderId) => ({ ...item, folderId }),
        setItemOrder: (item, order) => ({ ...item, order }),
      },
    );
    onMove(nextHierarchy.items, nextHierarchy.folders);
    setDraggedKeys([]);
    setDropTarget(null);
  };

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current || !contextMenuPosition) return;

    const margin = 8;
    const menuRect = contextMenuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let nextLeft = contextMenuPosition.left;
    let nextTop = contextMenuPosition.top;

    if (nextLeft + menuRect.width + margin > viewportWidth) {
      nextLeft = Math.max(margin, viewportWidth - menuRect.width - margin);
    }
    if (nextTop + menuRect.height + margin > viewportHeight) {
      nextTop = Math.max(margin, viewportHeight - menuRect.height - margin);
    }

    if (nextLeft !== contextMenuPosition.left || nextTop !== contextMenuPosition.top) {
      setContextMenuPosition({ left: nextLeft, top: nextTop });
    }
  }, [contextMenu, contextMenuPosition]);

  useEffect(() => {
    if (!contextMenu || typeof document === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      closeContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [contextMenu]);

  const closeContextMenu = () => {
    setContextMenu(null);
    setContextMenuPosition(null);
  };

  const getContextMenuItemActionIds = useCallback((): string[] => {
    if (!contextMenu || contextMenu.kind !== 'item') {
      return [];
    }

    if (selectedItemIds.length > 1 && selectedItemIds.includes(contextMenu.item.id)) {
      return orderedItemIds.filter((id) => selectedItemIds.includes(id));
    }

    return [contextMenu.item.id];
  }, [contextMenu, orderedItemIds, selectedItemIds]);

  const getClipboardPasteTarget = useCallback((): HierarchyDropTarget => {
    if (!contextMenu || contextMenu.kind === 'empty') {
      return { key: null, dropPosition: null };
    }
    if (contextMenu.kind === 'folder') {
      return {
        key: getHierarchyFolderNodeKey(contextMenu.folder.id),
        dropPosition: 'on',
      };
    }
    return {
      key: getHierarchyItemNodeKey(itemKeyPrefix, contextMenu.item.id),
      dropPosition: 'after',
    };
  }, [contextMenu, itemKeyPrefix]);

  const handleCopyItems = useCallback((mode: FolderedHierarchyClipboardMode = 'copy') => {
    if (!clipboard) {
      return false;
    }

    const actionIds = getContextMenuItemActionIds();
    if (actionIds.length === 0) {
      return false;
    }

    const itemById = new Map(items.map((item) => [item.id, item]));
    const entries = actionIds
      .map((id) => itemById.get(id))
      .filter((item): item is TItem => !!item)
      .map((item) => clipboard.serializeItem(item));

    if (entries.length === 0) {
      return false;
    }

    setFolderedHierarchyClipboard({
      kind: clipboard.kind,
      mode,
      entries,
    });
    return true;
  }, [clipboard, getContextMenuItemActionIds, items]);

  const handleCutItems = useCallback(() => {
    if (!clipboard) {
      return;
    }

    const actionIds = getContextMenuItemActionIds();
    if (actionIds.length === 0) {
      return;
    }
    if (clipboard.canCutItems && !clipboard.canCutItems(actionIds)) {
      return;
    }
    if (!handleCopyItems('cut')) {
      return;
    }

    clipboard.removeItemsForCut(actionIds);

    const remainingIds = selectedItemIds.filter((id) => !actionIds.includes(id));
    if (remainingIds.length > 0) {
      onSelectItems(remainingIds, remainingIds[0]);
    } else {
      onSelectItems([], null);
    }
    closeContextMenu();
  }, [clipboard, getContextMenuItemActionIds, handleCopyItems, onSelectItems, selectedItemIds]);

  const handlePasteItems = useCallback((modeOverride?: FolderedHierarchyClipboardMode) => {
    if (!clipboard) {
      return;
    }

    const clipboardState = getFolderedHierarchyClipboard(clipboard.kind);
    if (!clipboardState) {
      return;
    }

    const nextMode = modeOverride ?? clipboardState.mode;
    const pastedIds = clipboard.pasteItems(clipboardState.entries, nextMode, getClipboardPasteTarget());
    if (pastedIds.length > 0) {
      onSelectItems(pastedIds, pastedIds[0]);
      if (clipboardState.mode === 'cut' && !modeOverride) {
        setFolderedHierarchyClipboard({
          kind: clipboard.kind,
          mode: 'copy',
          entries: clipboardState.entries,
        });
      }
    }
    closeContextMenu();
  }, [clipboard, getClipboardPasteTarget, onSelectItems]);

  const handleDuplicateItems = useCallback(() => {
    if (!handleCopyItems('copy')) {
      return;
    }
    handlePasteItems('copy');
  }, [handleCopyItems, handlePasteItems]);

  const handleRequestDeleteFolder = (folder: HierarchyFolder) => {
    const descendants = collectFolderDescendants(folder.id, folders);
    const hasChildFolders = descendants.size > 1;
    const hasChildItems = items.some((item) => !!item.folderId && descendants.has(item.folderId));
    if (!hasChildFolders && !hasChildItems) {
      onDeleteFolder(folder.id);
      return;
    }
    setFolderDeleteTarget(folder);
  };

  const handleConfirmDeleteFolder = () => {
    if (!folderDeleteTarget) return;
    onDeleteFolder(folderDeleteTarget.id);
    setFolderDeleteTarget(null);
  };

  const handleRootDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (draggedKeys.length === 0) {
      return;
    }

    if (event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    handleDrop({ key: null, dropPosition: null });
  };

  const handleRootDropZoneDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (draggedKeys.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget({ key: null, dropPosition: null });
  };

  const handleRootDropZoneDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (draggedKeys.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleDrop({ key: null, dropPosition: null });
  };

  const handleBlankAreaDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (draggedKeys.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(null);
  };

  const handleEmptyPaneContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (draggedKeys.length > 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-sprite-shelf-row="true"]')) {
      return;
    }

    const interactiveTarget = target?.closest(
      'button, input, textarea, select, [contenteditable="true"], [role="button"]',
    );
    if (interactiveTarget && interactiveTarget !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    setContextMenuPosition({ left: event.clientX, top: event.clientY });
    setContextMenu({ x: event.clientX, y: event.clientY, kind: 'empty' });
  };

  const handleItemRowClick = (event: React.MouseEvent, item: TItem) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey) {
      const anchorId = selectionAnchorItemIdRef.current ?? selectedItemId ?? item.id;
      const anchorIndex = visibleItemIds.indexOf(anchorId);
      const targetIndex = visibleItemIds.indexOf(item.id);
      if (anchorIndex === -1 || targetIndex === -1) {
        selectionAnchorItemIdRef.current = item.id;
        const fallbackIds = selectedItemId && selectedItemId !== item.id
          ? orderedItemIds.filter((id) => id === selectedItemId || id === item.id)
          : [item.id];
        onSelectItems(fallbackIds, selectedItemId ?? item.id);
        return;
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const rangeIds = visibleItemIds.slice(start, end + 1);
      const nextRangeIds = selectedItemId && !rangeIds.includes(selectedItemId)
        ? orderedItemIds.filter((id) => id === selectedItemId || rangeIds.includes(id))
        : rangeIds;
      selectionAnchorItemIdRef.current = anchorId;
      onSelectItems(nextRangeIds, selectedItemId ?? anchorId);
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      const current = new Set(selectedItemIds);
      if (current.has(item.id)) {
        current.delete(item.id);
      } else {
        current.add(item.id);
      }

      if (selectedItemId) {
        current.add(selectedItemId);
      }

      const nextIds = orderedItemIds.filter((id) => current.has(id));
      selectionAnchorItemIdRef.current = item.id;
      if (nextIds.length === 0) {
        onSelectItems([], null);
        return;
      }

      onSelectItems(nextIds, selectedItemId ?? item.id);
      return;
    }

    selectionAnchorItemIdRef.current = item.id;
    onSelectItem(item);
  };

  const syncSelectionForDrag = (item: TItem): string[] => {
    if (selectedItemIds.length > 1 && selectedItemIds.includes(item.id)) {
      return orderedItemIds
        .filter((id) => selectedItemIds.includes(id))
        .map((id) => getHierarchyItemNodeKey(itemKeyPrefix, id));
    }

    return [getHierarchyItemNodeKey(itemKeyPrefix, item.id)];
  };

  const renderNodes = (nodes: HierarchyTreeNode<TItem>[], level = 1): React.ReactNode => nodes.map((node) => {
    const isFolder = node.type === 'folder';
    const folder = node.folder;
    const item = node.item;
    const key = node.key;
    const isExpanded = isFolder && folder ? !collapsedFolders.has(folder.id) : false;
    const isEditing = (folder && editingFolderId === folder.id) || (item && editingItemId === item.id);
    const isSelected = !!item?.id && selectedItemIds.includes(item.id);
    const visibleItemIndex = item ? visibleItemIds.indexOf(item.id) : -1;
    const previousVisibleItemId = visibleItemIndex > 0 ? visibleItemIds[visibleItemIndex - 1] ?? null : null;
    const nextVisibleItemId = visibleItemIndex >= 0 && visibleItemIndex < visibleItemIds.length - 1
      ? visibleItemIds[visibleItemIndex + 1] ?? null
      : null;
    const connectsToPrevious = !!item && isSelected && !!previousVisibleItemId && selectedItemIds.includes(previousVisibleItemId);
    const connectsToNext = !!item && isSelected && !!nextVisibleItemId && selectedItemIds.includes(nextVisibleItemId);

    return (
      <div key={key}>
        <ShelfTreeRow
          rowKey={key}
          name={folder?.name ?? (item as { name?: string } | undefined)?.name ?? itemLabel}
          level={level}
          hasChildren={node.children.length > 0}
          isExpanded={isExpanded}
          isSelected={isSelected}
          isDropOn={dropTarget?.key === key && dropTarget.dropPosition === 'on'}
          isDropBefore={dropTarget?.key === key && dropTarget.dropPosition === 'before'}
          isDropAfter={dropTarget?.key === key && dropTarget.dropPosition === 'after'}
          connectsToPrevious={connectsToPrevious}
          connectsToNext={connectsToNext}
          isEditing={isEditing}
          showControls={isPaneHovered}
          draggable
          onDragStart={(event) => {
            const nextDraggedKeys = isFolder || !item ? [key] : syncSelectionForDrag(item);
            setDraggedKeys(nextDraggedKeys);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', nextDraggedKeys.join(','));
            const dragImage = getTransparentShelfDragImage();
            if (dragImage) {
              event.dataTransfer.setDragImage(dragImage, 0, 0);
            }
            if (!isFolder && item && onItemDragStart) {
              onItemDragStart(event, item);
            }
          }}
          onDragEnd={() => {
            if (!isFolder && item && onItemDragEnd) {
              onItemDragEnd(item);
            }
            setDraggedKeys([]);
            setDropTarget(null);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            const rect = event.currentTarget.getBoundingClientRect();
            const nextDropPosition: HierarchyDropTarget['dropPosition'] = getShelfRowDropPosition({
              isFolder,
              isExpandedFolder: !!(isFolder && node.children.length > 0 && isExpanded),
              clientY: event.clientY,
              rect,
            });
            setDropTarget({ key, dropPosition: nextDropPosition });
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleDrop(dropTarget?.key === key ? dropTarget : { key, dropPosition: 'after' });
          }}
          onToggleChildren={isFolder && folder ? ((event) => {
            event.stopPropagation();
            setCollapsedFolders((current) => {
              const next = new Set(current);
              if (next.has(folder.id)) {
                next.delete(folder.id);
              } else {
                next.add(folder.id);
              }
              return next;
            });
          }) : undefined}
          onClick={!isFolder && item ? ((event) => handleItemRowClick(event, item)) : undefined}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (folder) {
              setContextMenuPosition({ left: event.clientX, top: event.clientY });
              setContextMenu({ x: event.clientX, y: event.clientY, kind: 'folder', folder });
              return;
            }
            if (item) {
              setContextMenuPosition({ left: event.clientX, top: event.clientY });
              setContextMenu({ x: event.clientX, y: event.clientY, kind: 'item', item });
            }
          }}
          onDoubleClick={() => {
            if (folder) {
              setEditingFolderId(folder.id);
              setEditingItemId(null);
              setDraftName(folder.name);
              return;
            }
            if (item) {
              setEditingItemId(item.id);
              setEditingFolderId(null);
              setDraftName((item as { name?: string }).name ?? itemLabel);
            }
          }}
          leadingIcon={isFolder && folder ? (
            isExpanded ? <FolderOpen className="size-[1.125rem] shrink-0" /> : <Folder className="size-[1.125rem] shrink-0" />
          ) : (
            renderItemIcon ? renderItemIcon(item as TItem) : <Layers3 className="size-[1.125rem] shrink-0 text-muted-foreground" />
          )}
          content={isEditing ? (
            <InlineRenameField
              ref={inputRef}
              editing={true}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') {
                  setEditingFolderId(null);
                  setEditingItemId(null);
                  setDraftName('');
                }
              }}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              className="flex-1 min-w-0"
              outlineClassName="left-[-3px] right-0"
              textClassName="text-xs leading-5 text-foreground"
              autoFocus
              focusBehavior="caret-end"
            />
          ) : (
            folder ? (
              <div className="flex w-full min-w-0 items-center overflow-hidden" title={folder.name}>
                <span className="block min-w-0 flex-1 truncate text-xs leading-5 text-foreground">
                  {folder.name}
                </span>
              </div>
            ) : item ? (
              renderItemLabel ? renderItemLabel(item) : (
                <div className="flex w-full min-w-0 items-center overflow-hidden" title={(item as { name?: string } | undefined)?.name ?? itemLabel}>
                  <span className="block min-w-0 flex-1 truncate text-xs leading-5 text-foreground">
                    {(item as { name?: string } | undefined)?.name ?? itemLabel}
                  </span>
                </div>
              )
            ) : null
          )}
        />
        {isFolder && folder && isExpanded ? renderNodes(node.children, level + 1) : null}
      </div>
    );
  });

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col bg-card"
      onPointerEnter={() => setIsPaneHovered(true)}
      onPointerLeave={() => setIsPaneHovered(false)}
    >
      <div className={cn(panelHeaderClassNames.chrome, panelHeaderClassNames.row, 'h-auto border-b-0 py-1')}>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
          <Button type="button" size="icon-xs" variant="ghost" onClick={onAddItem} title={`Add ${itemLabel}`}>
            <Plus className="size-4" />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" onClick={onAddFolder} title="Add Folder">
            <FolderPlus className="size-4" />
          </Button>
          {renderHeaderActions}
        </div>
      </div>
      <div ref={dropSurfaceRef} className="min-h-0 flex-1">
      <ScrollArea className="min-h-0 flex-1" onContextMenu={handleEmptyPaneContextMenu}>
        <div
          className="min-h-full w-0 min-w-full"
          onDragOver={handleBlankAreaDragOver}
          onDrop={handleRootDrop}
        >
          {tree.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 py-10 text-sm text-muted-foreground">
              {emptyLabel}
            </div>
          ) : (
            <div
              role="tree"
              aria-label={title}
              className="relative min-h-full w-0 min-w-full overflow-x-hidden pb-2 outline-none"
              onContextMenu={handleEmptyPaneContextMenu}
              onDragOver={handleBlankAreaDragOver}
            >
              {renderNodes(tree)}
              <div
                className="absolute inset-x-2 bottom-0 z-10 h-4 rounded"
                onDragOver={handleRootDropZoneDragOver}
                onDrop={handleRootDropZoneDrop}
                onContextMenu={handleEmptyPaneContextMenu}
              >
                {draggedKeys.length > 0 && dropTarget?.key === null ? (
                  <div className="absolute inset-x-0 top-1/2 h-0 -translate-y-1/2 rounded border-t-2 border-primary/80" />
                ) : null}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
      </div>

      {contextMenu ? (
        <>
          <Card
            ref={contextMenuRef}
            className="fixed z-50 min-w-36 gap-0 py-1"
            style={{
              left: contextMenuPosition?.left ?? contextMenu.x,
              top: contextMenuPosition?.top ?? contextMenu.y,
            }}
          >
            {contextMenu.kind === 'item' ? (
              <>
                {clipboard ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        handleCopyItems('copy');
                        closeContextMenu();
                      }}
                      className="h-8 w-full justify-start rounded-none"
                    >
                      <Copy className="size-4" />
                      Copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCutItems}
                      disabled={clipboard.canCutItems ? !clipboard.canCutItems(getContextMenuItemActionIds()) : false}
                      className="h-8 w-full justify-start rounded-none"
                    >
                      <Scissors className="size-4" />
                      Cut
                    </Button>
                    {hasFolderedHierarchyClipboardContents(clipboard.kind) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePasteItems()}
                        className="h-8 w-full justify-start rounded-none"
                      >
                        <Clipboard className="size-4" />
                        Paste
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDuplicateItems}
                      className="h-8 w-full justify-start rounded-none"
                    >
                      <CopyPlus className="size-4" />
                      Duplicate
                    </Button>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onSelectItem(contextMenu.item);
                    setEditingItemId(contextMenu.item.id);
                    setEditingFolderId(null);
                    setDraftName((contextMenu.item as { name?: string }).name ?? itemLabel);
                    closeContextMenu();
                  }}
                  className="h-8 w-full justify-start rounded-none"
                >
                  <Pencil className="size-4" />
                  Rename {itemLabel}
                </Button>
                {renderItemContextMenuActions ? renderItemContextMenuActions(contextMenu.item, closeContextMenu) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onDeleteItem(contextMenu.item.id);
                    closeContextMenu();
                  }}
                  className="h-8 w-full justify-start rounded-none text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  Delete {itemLabel}
                </Button>
              </>
            ) : contextMenu.kind === 'folder' ? (
              <>
                {clipboard && hasFolderedHierarchyClipboardContents(clipboard.kind) ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePasteItems()}
                      className="h-8 w-full justify-start rounded-none"
                    >
                      <Clipboard className="size-4" />
                      Paste
                    </Button>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingFolderId(contextMenu.folder.id);
                    setEditingItemId(null);
                    setDraftName(contextMenu.folder.name);
                    closeContextMenu();
                  }}
                  className="h-8 w-full justify-start rounded-none"
                >
                  <Pencil className="size-4" />
                  Rename Folder
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    handleRequestDeleteFolder(contextMenu.folder);
                    closeContextMenu();
                  }}
                  className="h-8 w-full justify-start rounded-none text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  Delete Folder
                </Button>
              </>
            ) : (
              <>
                {clipboard && hasFolderedHierarchyClipboardContents(clipboard.kind) ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePasteItems()}
                      className="h-8 w-full justify-start rounded-none"
                    >
                      <Clipboard className="size-4" />
                      Paste
                    </Button>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onAddFolder();
                    closeContextMenu();
                  }}
                  className="h-8 w-full justify-start rounded-none"
                >
                  <FolderPlus className="size-4" />
                  New Folder
                </Button>
              </>
            )}
          </Card>
        </>
      ) : null}

      <Dialog open={!!folderDeleteTarget} onOpenChange={(open) => !open && setFolderDeleteTarget(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              everything inside the folder will be deleted as well.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteFolder}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SceneHierarchyTab() {
  const {
    project,
    addScene,
    addSceneFromTemplate,
    updateScene,
    removeScene,
    updateSceneOrganization,
  } = useProjectStore();
  const {
    selectedSceneId,
    selectedSceneIds,
    selectScene,
    selectScenes,
    setActiveHierarchyTab,
  } = useEditorStore();
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const createSceneLibraryItem = useMutation(api.sceneLibrary.create);
  const generateProjectAssetUploadUrl = useMutation(api.projectAssets.generateUploadUrl);
  const upsertProjectAsset = useMutation(api.projectAssets.upsert);
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingSceneId, setSavingSceneId] = useState<string | null>(null);
  const scenes = project?.scenes ?? [];
  const sceneFolders = project?.sceneFolders ?? [];
  const { showAlert } = useModal();

  const cloneSceneTemplate = useCallback((scene: Scene, name: string) => ({
    name,
    scene,
    components: [] as ComponentDefinition[],
    componentFolders: [] as ComponentFolder[],
  }), []);

  const pasteScenesFromClipboard = useCallback((
    entries: unknown[],
    mode: FolderedHierarchyClipboardMode,
    target: HierarchyDropTarget,
  ): string[] => {
    const snapshots = entries as Scene[];
    if (snapshots.length === 0) {
      return [];
    }

    const pastedIds: string[] = [];

    runInHistoryTransaction('hierarchy-panel:paste-scenes', () => {
      snapshots.forEach((scene) => {
        const created = addSceneFromTemplate(
          cloneSceneTemplate(
            scene,
            mode === 'cut' ? scene.name : `${scene.name} Copy`,
          ),
        );
        if (created) {
          pastedIds.push(created.id);
        }
      });

      if (pastedIds.length === 0) {
        return;
      }

      const nextProject = useProjectStore.getState().project;
      if (!nextProject) {
        return;
      }

      const nextHierarchy = moveFolderedHierarchyNodes(
        nextProject.sceneFolders || [],
        nextProject.scenes,
        pastedIds.map((sceneId) => getHierarchyItemNodeKey('scene', sceneId)),
        normalizeFolderedHierarchyDropTarget(
          nextProject.sceneFolders || [],
          nextProject.scenes,
          target,
          {
            itemKeyPrefix: 'scene',
            setItemFolderId: (scene, folderId) => ({ ...scene, folderId }),
            setItemOrder: (scene, order) => ({ ...scene, order }),
          },
        ),
        {
          itemKeyPrefix: 'scene',
          setItemFolderId: (scene, folderId) => ({ ...scene, folderId }),
          setItemOrder: (scene, order) => ({ ...scene, order }),
        },
      );
      updateSceneOrganization(nextHierarchy.items, nextHierarchy.folders);
    });

    return pastedIds;
  }, [addSceneFromTemplate, cloneSceneTemplate, updateSceneOrganization]);

  const removeScenesForCut = useCallback((sceneIds: string[]) => {
    const cutIdSet = new Set(sceneIds);
    const nextScenes = scenes.filter((scene) => !cutIdSet.has(scene.id));
    updateSceneOrganization(nextScenes, sceneFolders);
  }, [sceneFolders, scenes, updateSceneOrganization]);

  const handleInsertSceneTemplate = (data: {
    name: string;
    scene: Scene;
    components: ComponentDefinition[];
    componentFolders: ComponentFolder[];
  }) => {
    const insertedScene = addSceneFromTemplate(data);
    if (insertedScene) {
      selectScene(insertedScene.id);
      setActiveHierarchyTab('scene');
    }
  };

  const handleSaveSceneToLibrary = async (scene: Scene) => {
    if (!project) {
      return;
    }
    if (!isAuthenticated) {
      await showAlert({
        title: 'Sign In Required',
        description: 'Sign in to save scenes to the cloud library.',
      });
      return;
    }

    const includedComponents = project.components || [];
    const includedComponentFolders = project.componentFolders || [];

    setSavingSceneId(scene.id);
    try {
      const payload = await prepareSceneLibraryCreatePayload({
        name: scene.name,
        scene,
        components: includedComponents,
        componentFolders: includedComponentFolders,
      });

      await ensureSceneLibraryAssetRefsInCloud(payload.assetRefs, {
        listMissingAssetIds: async (assetIds) => {
          return await convex.query(api.projectAssets.listMissing, { assetIds }) as string[];
        },
        generateUploadUrl: generateProjectAssetUploadUrl,
        upsertAsset: async (args) => {
          return await upsertProjectAsset({
            assetId: args.assetId,
            kind: args.kind,
            mimeType: args.mimeType,
            size: args.size,
            storageId: args.storageId,
          });
        },
      });

      await createSceneLibraryItem(payload);
    } catch (error) {
      console.error('Failed to save scene to library:', error);
      await showAlert({
        title: 'Save Failed',
        description: 'Failed to save scene to library',
        tone: 'destructive',
      });
    } finally {
      setSavingSceneId(null);
    }
  };

  return (
    <>
      <FolderedHierarchyPane<SceneItem>
        title="Scenes"
        itemLabel="Scene"
        emptyLabel="No scenes yet"
        folders={sceneFolders}
        items={scenes}
        itemKeyPrefix="scene"
        selectedItemId={selectedSceneId}
        selectedItemIds={selectedSceneIds}
        onSelectItem={(scene) => {
          selectScene(scene.id);
          setActiveHierarchyTab('scene');
        }}
        onSelectItems={(sceneIds, primarySceneId) => {
          selectScenes(sceneIds, primarySceneId, { recordHistory: false });
        }}
        onAddItem={() => addScene(`Scene ${scenes.length + 1}`)}
        onAddFolder={() => {
          const newFolder: SceneFolder = {
            id: crypto.randomUUID(),
            name: `Folder ${sceneFolders.length + 1}`,
            parentId: null,
            order: 0,
          };
          const nextHierarchy = insertFolderedHierarchyFolder(
            sceneFolders,
            scenes,
            newFolder,
            selectedSceneId
              ? { key: getHierarchyItemNodeKey('scene', selectedSceneId), dropPosition: 'after' }
              : { key: null, dropPosition: null },
            {
              itemKeyPrefix: 'scene',
              setItemFolderId: (scene, folderId) => ({ ...scene, folderId }),
              setItemOrder: (scene, order) => ({ ...scene, order }),
            },
          );
          updateSceneOrganization(nextHierarchy.items, nextHierarchy.folders);
        }}
        onRenameItem={(sceneId, name) => updateScene(sceneId, { name })}
        onRenameFolder={(folderId, name) => {
          updateSceneOrganization(
            scenes,
            sceneFolders.map((folder) => (folder.id === folderId ? { ...folder, name } : folder)),
          );
        }}
        onDeleteItem={(sceneId) => removeScene(sceneId)}
        onDeleteFolder={(folderId) => {
          const descendants = collectFolderDescendants(folderId, sceneFolders);
          updateSceneOrganization(
            scenes.map((scene) => descendants.has(scene.folderId ?? '') ? { ...scene, folderId: null } : scene),
            sceneFolders.filter((folder) => !descendants.has(folder.id)),
          );
        }}
        onMove={(nextScenes, nextFolders) => updateSceneOrganization(nextScenes, nextFolders)}
        renderItemIcon={() => <Earth className="size-4 shrink-0 text-muted-foreground" />}
        renderHeaderActions={(
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => setShowLibrary(true)}
            title="Scene Library"
          >
            <Library className="size-4" />
          </Button>
        )}
        renderItemContextMenuActions={(scene, closeMenu) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleSaveSceneToLibrary(scene);
                closeMenu();
              }}
              disabled={savingSceneId === scene.id}
              className="h-8 w-full justify-start rounded-none"
            >
              <Library className="size-4" />
              Save to Library
            </Button>
          </>
        )}
        clipboard={{
          kind: 'scene',
          serializeItem: (scene) => scene,
          pasteItems: pasteScenesFromClipboard,
          removeItemsForCut: removeScenesForCut,
          canCutItems: (sceneIds) => scenes.length - sceneIds.length >= 1,
        }}
      />
      <SceneLibraryBrowser
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelect={handleInsertSceneTemplate}
      />
    </>
  );
}

function ComponentHierarchyTab() {
  const {
    project,
    addComponent,
    addComponentFromLibrary,
    addComponentInstance,
    deleteComponent,
    updateComponent,
    updateComponentOrganization,
  } = useProjectStore();
  const {
    selectedSceneId,
    selectedSceneIds,
    selectedComponentId,
    selectedComponentIds,
    selectComponent,
    selectComponents,
    setActiveHierarchyTab,
  } = useEditorStore();
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingComponentLibraryId, setSavingComponentLibraryId] = useState<string | null>(null);
  const components = project?.components ?? [];
  const componentFolders = project?.componentFolders ?? [];
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const createObjectLibraryItem = useMutation(api.objectLibrary.create);
  const generateProjectAssetUploadUrl = useMutation(api.projectAssets.generateUploadUrl);
  const upsertProjectAsset = useMutation(api.projectAssets.upsert);
  const { showAlert, showConfirm } = useModal();

  const pasteComponentsFromClipboard = useCallback((
    entries: unknown[],
    mode: FolderedHierarchyClipboardMode,
    target: HierarchyDropTarget,
  ): string[] => {
    const snapshots = entries as ComponentDefinition[];
    if (snapshots.length === 0) {
      return [];
    }

    const pastedIds: string[] = [];

    runInHistoryTransaction('hierarchy-panel:paste-components', () => {
      snapshots.forEach((component) => {
        const created = addComponentFromLibrary({
          name: mode === 'cut' ? component.name : `${component.name} Copy`,
          costumes: component.costumes,
          sounds: component.sounds,
          blocklyXml: component.blocklyXml,
          currentCostumeIndex: component.currentCostumeIndex,
          physics: component.physics,
          collider: component.collider,
          localVariables: component.localVariables ?? [],
        });
        if (created) {
          pastedIds.push(created.id);
        }
      });

      if (pastedIds.length === 0) {
        return;
      }

      const nextProject = useProjectStore.getState().project;
      if (!nextProject) {
        return;
      }

      const nextHierarchy = moveFolderedHierarchyNodes(
        nextProject.componentFolders || [],
        nextProject.components || [],
        pastedIds.map((componentId) => getHierarchyItemNodeKey('component', componentId)),
        normalizeFolderedHierarchyDropTarget(
          nextProject.componentFolders || [],
          nextProject.components || [],
          target,
          {
            itemKeyPrefix: 'component',
            setItemFolderId: (component, folderId) => ({ ...component, folderId }),
            setItemOrder: (component, order) => ({ ...component, order }),
          },
        ),
        {
          itemKeyPrefix: 'component',
          setItemFolderId: (component, folderId) => ({ ...component, folderId }),
          setItemOrder: (component, order) => ({ ...component, order }),
        },
      );
      updateComponentOrganization(nextHierarchy.items, nextHierarchy.folders);
    });

    return pastedIds;
  }, [addComponentFromLibrary, updateComponentOrganization]);

  const removeComponentsForCut = useCallback((componentIds: string[]) => {
    const cutIdSet = new Set(componentIds);
    const nextComponents = components.filter((component) => !cutIdSet.has(component.id));
    updateComponentOrganization(nextComponents, componentFolders);
  }, [componentFolders, components, updateComponentOrganization]);

  const handleCreateComponent = () => {
    const created = addComponent();
    if (!created) return;
    selectComponent(created.id);
    setActiveHierarchyTab('component');
  };

  const handleLibrarySelect = (data: {
    name: string;
    costumes: import('@/types').Costume[];
    sounds: import('@/types').Sound[];
    blocklyXml: string;
    currentCostumeIndex: number;
    physics: import('@/types').PhysicsConfig | null;
    collider: import('@/types').ColliderConfig | null;
    localVariables: import('@/types').Variable[];
  }) => {
    const created = addComponentFromLibrary(data);
    if (!created) {
      void showAlert({
        title: 'Add Failed',
        description: 'Failed to add component from library',
        tone: 'destructive',
      });
      return;
    }
    selectComponent(created.id);
    setActiveHierarchyTab('component');
  };

  const handleDeleteComponent = async (componentId: string) => {
    if (!project || !componentId) return;

    const component = components.find((item) => item.id === componentId);
    const componentName = component?.name || 'Component';
    const instanceCount = project.scenes.reduce((count, scene) => {
      return count + scene.objects.filter((obj) => obj.componentId === componentId).length;
    }, 0);

    const confirmed = await showConfirm({
      title: `Delete component "${componentName}"?`,
      description: `This will detach ${instanceCount} instance${instanceCount === 1 ? '' : 's'} and keep them as standalone objects.`,
      confirmLabel: 'Delete Component',
      tone: 'destructive',
    });
    if (!confirmed) return;

    deleteComponentWithHistory({
      source: 'hierarchy-panel:delete-component',
      componentId,
      selectedComponentId,
      deleteComponent,
      selectComponent,
    });
  };

  const handleSaveComponentToLibrary = async (component: ComponentDefinition) => {
    if (!isAuthenticated) {
      await showAlert({
        title: 'Sign In Required',
        description: 'Sign in to save objects to the cloud library.',
      });
      return;
    }

    setSavingComponentLibraryId(component.id);
    try {
      await saveRuntimeObjectToLibrary({
        name: component.name,
        costumes: component.costumes,
        sounds: component.sounds,
        blocklyXml: component.blocklyXml,
        currentCostumeIndex: component.currentCostumeIndex,
        physics: component.physics,
        collider: component.collider,
        localVariables: component.localVariables ?? [],
      }, {
        listMissingAssetIds: async (assetIds) => {
          return await convex.query(api.projectAssets.listMissing, { assetIds }) as string[];
        },
        generateUploadUrl: generateProjectAssetUploadUrl,
        upsertAsset: async (args) => {
          return await upsertProjectAsset({
            assetId: args.assetId,
            kind: args.kind,
            mimeType: args.mimeType,
            size: args.size,
            storageId: args.storageId,
          });
        },
        createItem: async (payload) => {
          return await createObjectLibraryItem(payload);
        },
      });
    } catch (error) {
      console.error('Failed to save component to library:', error);
      await showAlert({
        title: 'Save Failed',
        description: 'Failed to save component to library',
        tone: 'destructive',
      });
    } finally {
      setSavingComponentLibraryId(null);
    }
  };

  return (
    <>
      <FolderedHierarchyPane<ComponentItem>
        title="Components"
        itemLabel="Component"
        emptyLabel="No components yet"
        folders={componentFolders}
        items={components}
        itemKeyPrefix="component"
        selectedItemId={selectedComponentId}
        selectedItemIds={selectedComponentIds}
        onSelectItem={(component) => {
          selectComponent(component.id);
          setActiveHierarchyTab('component');
        }}
        onSelectItems={(componentIds, primaryComponentId) => {
          selectComponents(componentIds, primaryComponentId, { recordHistory: false });
        }}
        onAddItem={handleCreateComponent}
        onAddFolder={() => {
          const newFolder: ComponentFolder = {
            id: crypto.randomUUID(),
            name: `Folder ${componentFolders.length + 1}`,
            parentId: null,
            order: 0,
          };
          const nextHierarchy = insertFolderedHierarchyFolder(
            componentFolders,
            components,
            newFolder,
            selectedComponentId
              ? { key: getHierarchyItemNodeKey('component', selectedComponentId), dropPosition: 'after' }
              : { key: null, dropPosition: null },
            {
              itemKeyPrefix: 'component',
              setItemFolderId: (component, folderId) => ({ ...component, folderId }),
              setItemOrder: (component, order) => ({ ...component, order }),
            },
          );
          updateComponentOrganization(nextHierarchy.items, nextHierarchy.folders);
        }}
        onRenameItem={(componentId, name) => updateComponent(componentId, { name })}
        onRenameFolder={(folderId, name) => {
          updateComponentOrganization(
            components,
            componentFolders.map((folder) => (folder.id === folderId ? { ...folder, name } : folder)),
          );
        }}
        onDeleteItem={handleDeleteComponent}
        onDeleteFolder={(folderId) => {
          const descendants = collectFolderDescendants(folderId, componentFolders);
          updateComponentOrganization(
            components.map((component) => descendants.has(component.folderId ?? '') ? { ...component, folderId: null } : component),
            componentFolders.filter((folder) => !descendants.has(folder.id)),
          );
        }}
        onMove={(nextComponents, nextFolders) => updateComponentOrganization(nextComponents, nextFolders)}
        renderHeaderActions={(
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => setShowLibrary(true)}
            title="Object Library"
          >
            <Library className="size-4" />
          </Button>
        )}
        renderItemIcon={(component) => (
          <ShelfObjectThumbnail
            name={component.name}
            costumes={component.costumes}
            currentCostumeIndex={component.currentCostumeIndex}
          />
        )}
        renderItemLabel={(component) => (
          <ObjectComponentLabel name={component.name} isComponent />
        )}
        onItemDragStart={(event, component) => {
          setDraggedComponentId(component.id);
          event.dataTransfer.effectAllowed = 'copyMove';
          event.dataTransfer.setData('application/x-pocha-component-id', component.id);
        }}
        onItemDragEnd={() => {
          setDraggedComponentId(null);
        }}
        renderItemContextMenuActions={(component, closeMenu) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                selectComponent(component.id);
                if (selectedSceneId) {
                  addComponentInstance(selectedSceneId, component.id);
                }
                closeMenu();
              }}
              disabled={!selectedSceneId}
              className="h-8 w-full justify-start rounded-none"
            >
              <Plus className="size-4" />
              Add to Scene
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleSaveComponentToLibrary(component);
                closeMenu();
              }}
              disabled={savingComponentLibraryId === component.id}
              className="h-8 w-full justify-start rounded-none"
            >
              <Library className="size-4" />
              Save to Library
            </Button>
          </>
        )}
        clipboard={{
          kind: 'component',
          serializeItem: (component) => component,
          pasteItems: pasteComponentsFromClipboard,
          removeItemsForCut: removeComponentsForCut,
        }}
      />
      <ObjectLibraryBrowser
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelect={handleLibrarySelect}
      />
    </>
  );
}

export function HierarchyPanel() {
  const activeHierarchyTab = useEditorStore((state) => state.activeHierarchyTab);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <div className="min-h-0 flex-1">
        {activeHierarchyTab === 'scene' ? <SceneHierarchyTab /> : null}
        {activeHierarchyTab === 'object' ? (
          <SpriteShelf showQuickSceneSwitch={false} showObjectLibraryButton={true} />
        ) : null}
        {activeHierarchyTab === 'component' ? <ComponentHierarchyTab /> : null}
      </div>
    </div>
  );
}
