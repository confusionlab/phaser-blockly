import { useCallback, useEffect, useState, useRef, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { useConvex, useConvexAuth, useMutation } from 'convex/react';
import { api } from '@convex-generated/api';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ObjectLibraryBrowser } from '../dialogs/ObjectLibraryBrowser';
import { Button } from '@/components/ui/button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { MenuItemButton, MenuSeparator } from '@/components/ui/menu-item-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Pencil,
  Copy,
  Clipboard,
  Trash2,
  ChevronRight,
  Component,
  CopyPlus,
  Scissors,
  Earth,
  Unlink,
  Folder,
  FolderOpen,
  FolderPlus,
  Library,
} from '@/components/ui/icons';
import type {
  GameObject,
  Costume,
  Sound,
  PhysicsConfig,
  ColliderConfig,
  SceneFolder,
} from '@/types';
import { getEffectiveObjectProps } from '@/types';
import {
  saveRuntimeObjectToLibrary,
} from '@/lib/objectLibrary/objectLibraryAssets';
import {
  getFolderNodeKey,
  getObjectNodeKey,
  getSceneObjectsInLayerOrder,
  getSceneTree,
  insertSceneFolder,
  moveSceneLayerNodes,
  normalizeSceneLayerDropTarget,
  type LayerTreeNode,
} from '@/utils/layerTree';
import { runInHistoryTransaction } from '@/store/universalHistory';
import { normalizeVariableDefinition, remapVariableIdsInBlocklyXml } from '@/lib/variableUtils';
import { acquireGlobalKeyboardCapture, focusKeyboardSurface, isTextEntryTarget } from '@/utils/keyboard';
import {
  hasSceneObjectClipboardContents,
} from '@/lib/editor/objectCommands';
import {
  copySceneObjectSelection,
  cutSceneObjectSelection,
  deleteSceneObjectSelection,
  duplicateSceneObjectSelection,
  pasteSceneObjectSelection,
  resolveSceneObjectActionIds,
} from '@/lib/editor/sceneObjectSelectionActions';
import { selectionSurfaceClassNames } from '@/lib/ui/selectionSurfaceTokens';
import { panelHeaderClassNames } from '@/lib/ui/panelHeaderTokens';
import { ShelfTreeRow } from './ShelfTreeRow';
import { ShelfObjectThumbnail } from './ShelfObjectThumbnail';
import { ObjectComponentLabel, getObjectComponentLabelTextClassName } from './ObjectComponentLabel';
import { getShelfRowDropPosition, getTransparentShelfDragImage, useShelfDropTargetBoundaryGuard } from './shelfDrag';
import { useModal } from '@/components/ui/modal-provider';

function remapLocalVariablesForInsertion(
  localVariables: GameObject['localVariables'],
  blocklyXml: string,
  objectId: string,
): { localVariables: GameObject['localVariables']; blocklyXml: string } {
  const idMap = new Map<string, string>();
  const remappedLocalVariables = (localVariables || []).map((variable) => {
    const remappedId = crypto.randomUUID();
    idMap.set(variable.id, remappedId);
    return normalizeVariableDefinition(
      { ...variable, id: remappedId },
      { scope: 'local', objectId },
    );
  });
  return {
    localVariables: remappedLocalVariables,
    blocklyXml: remapVariableIdsInBlocklyXml(blocklyXml || '', idMap),
  };
}

interface ShelfTreeItem {
  key: string;
  id: string;
  type: 'folder' | 'object';
  name: string;
  folder?: SceneFolder;
  object?: GameObject;
  children: ShelfTreeItem[];
}

function toShelfTreeItems(nodes: LayerTreeNode[]): ShelfTreeItem[] {
  return nodes.map((node) => {
    if (node.type === 'folder' && node.folder) {
      return {
        key: node.key,
        id: node.id,
        type: 'folder' as const,
        name: node.folder.name,
        folder: node.folder,
        children: toShelfTreeItems(node.children),
      };
    }

    return {
      key: node.key,
      id: node.id,
      type: 'object' as const,
      name: node.object?.name ?? 'Object',
      object: node.object,
      children: [],
    };
  });
}

interface RenameableShelfItem {
  key: string;
  id: string;
  type: 'folder' | 'object';
  name: string;
  folder?: SceneFolder;
  object?: GameObject;
}

interface VisibleShelfTreeEntry {
  item: ShelfTreeItem;
  level: number;
}

interface SpriteShelfProps {
  showQuickSceneSwitch?: boolean;
  showObjectLibraryButton?: boolean;
}

function collectVisibleRenameableItems(
  items: ShelfTreeItem[],
  expandedKeys: Set<string>,
): RenameableShelfItem[] {
  const visibleItems: RenameableShelfItem[] = [];

  const visit = (nodes: ShelfTreeItem[]) => {
    for (const node of nodes) {
      visibleItems.push({
        key: node.key,
        id: node.id,
        type: node.type,
        name: node.name,
        folder: node.folder,
        object: node.object,
      });

      if (node.children.length > 0 && expandedKeys.has(node.key)) {
        visit(node.children);
      }
    }
  };

  visit(items);
  return visibleItems;
}

function collectVisibleTreeEntries(
  items: ShelfTreeItem[],
  expandedKeys: Set<string>,
  level = 1,
): VisibleShelfTreeEntry[] {
  const visibleEntries: VisibleShelfTreeEntry[] = [];

  for (const item of items) {
    visibleEntries.push({ item, level });

    if (item.children.length > 0 && expandedKeys.has(item.key)) {
      visibleEntries.push(...collectVisibleTreeEntries(item.children, expandedKeys, level + 1));
    }
  }

  return visibleEntries;
}

function collectFolderDescendants(folderId: string, folders: SceneFolder[]): Set<string> {
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

export function SpriteShelf({
  showQuickSceneSwitch = true,
  showObjectLibraryButton = true,
}: SpriteShelfProps = {}) {
  const {
    project,
    addObject,
    removeObject,
    duplicateObject,
    updateObject,
    updateScene,
    makeComponent,
    detachFromComponent,
  } = useProjectStore();
  const {
    selectedSceneId,
    selectedObjectId,
    selectedObjectIds,
    selectedFolderId,
    selectedComponentId,
    selectObject,
    selectObjects,
    selectFolder,
    selectScene,
    clearSelection,
    collapsedFolderIdsByScene,
    setCollapsedFoldersForScene,
    viewMode,
    getStageEditorViewport,
  } = useEditorStore();
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { showAlert } = useModal();
  const createObjectLibraryItem = useMutation(api.objectLibrary.create);
  const generateProjectAssetUploadUrl = useMutation(api.projectAssets.generateUploadUrl);
  const upsertProjectAsset = useMutation(api.projectAssets.upsert);

  const [contextMenu, setContextMenu] = useState<
    | { x: number; y: number; kind: 'object'; object: GameObject }
    | { x: number; y: number; kind: 'folder'; folder: SceneFolder }
    | { x: number; y: number; kind: 'empty' }
    | null
  >(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [sceneDropdownOpen, setSceneDropdownOpen] = useState(false);
  const [isShelfHovered, setIsShelfHovered] = useState(false);
  const [draggedLayerKeys, setDraggedLayerKeys] = useState<string[]>([]);
  const [layerDropTarget, setLayerDropTarget] = useState<{ key: string | null; dropPosition: 'before' | 'after' | 'on' | null } | null>(null);
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [inlineRenameSessionId, setInlineRenameSessionId] = useState(0);
  const [editName, setEditName] = useState('');
  const [folderEditName, setFolderEditName] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingObjectLibrary, setSavingObjectLibrary] = useState<string | null>(null);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<SceneFolder | null>(null);
  const cancelInlineRenameOnBlurRef = useRef(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const shortcutSurfaceRef = useRef<HTMLDivElement>(null);
  const inlineRenameSessionRef = useRef(0);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const selectionAnchorObjectIdRef = useRef<string | null>(null);
  const ignoreNextEmptyShelfClickRef = useRef(false);

  const focusInputCaretAtEnd = useCallback((input: HTMLInputElement | null) => {
    if (!input) {
      return;
    }

    input.focus();
    const caretIndex = input.value.length;
    input.setSelectionRange(caretIndex, caretIndex);
  }, []);

  const stabilizeInlineRenameFocus = useCallback((input: HTMLInputElement | null) => {
    focusInputCaretAtEnd(input);
    queueMicrotask(() => {
      focusInputCaretAtEnd(input);
    });
  }, [focusInputCaretAtEnd]);

  useLayoutEffect(() => {
    if (!editingObjectId && !editingFolderId) {
      return;
    }

    stabilizeInlineRenameFocus(inputRef.current);
  }, [editingObjectId, editingFolderId, stabilizeInlineRenameFocus]);

  const selectedScene = project?.scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const folders = selectedScene?.objectFolders ?? [];
  const isInlineRenaming = !!editingObjectId || !!editingFolderId;

  useLayoutEffect(() => {
    if (!isInlineRenaming) {
      return;
    }

    return acquireGlobalKeyboardCapture();
  }, [isInlineRenaming]);

  useEffect(() => {
    if (draggedLayerKeys.length === 0 || typeof document === 'undefined') {
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
  }, [draggedLayerKeys.length]);

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
      handleCloseContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [contextMenu]);

  const focusShortcutSurface = useCallback(() => {
    focusKeyboardSurface(shortcutSurfaceRef.current);
  }, []);

  const handleShortcutSurfacePointerDownCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isTextEntryTarget(event.target)) {
      return;
    }
    focusShortcutSurface();
  }, [focusShortcutSurface]);

  useShelfDropTargetBoundaryGuard({
    active: draggedLayerKeys.length > 0,
    boundaryRef: shortcutSurfaceRef,
    onExit: () => setLayerDropTarget(null),
  });

  if (!selectedScene || !selectedSceneId) return null;

  const layerTree = getSceneTree(selectedScene);
  const treeItems = toShelfTreeItems(layerTree);
  const orderedSceneObjectIds = getSceneObjectsInLayerOrder(selectedScene).map((obj) => obj.id);
  const sceneObjectIdSet = new Set(selectedScene.objects.map((obj) => obj.id));

  const selectedIdsInScene = (
    selectedObjectIds.length > 0
      ? selectedObjectIds
      : (selectedObjectId ? [selectedObjectId] : [])
  ).filter((id) => sceneObjectIdSet.has(id));

  const collapsedFolderIds = new Set(collapsedFolderIdsByScene[selectedSceneId] ?? []);
  const expandedKeys = new Set<string>(
    folders
      .filter((folder) => !collapsedFolderIds.has(folder.id))
      .map((folder) => getFolderNodeKey(folder.id)),
  );
  const visibleTreeEntries = collectVisibleTreeEntries(treeItems, expandedKeys);
  const visibleTreeEntryIndexByKey = new Map(
    visibleTreeEntries.map((entry, index) => [entry.item.key, index]),
  );
  const visibleRenameTargets = collectVisibleRenameableItems(treeItems, expandedKeys);

  const commitFolderRename = () => {
    const nextFolderId = editingFolderId;
    const nextName = folderEditName.trim();

    setEditingFolderId(null);
    setFolderEditName('');

    if (!nextFolderId || !nextName) {
      return;
    }

    const nextFolders = folders.map((folder) =>
      folder.id === nextFolderId ? { ...folder, name: nextName } : folder,
    );
    updateScene(selectedSceneId, { objectFolders: nextFolders });
  };

  const commitObjectRename = () => {
    const nextObjectId = editingObjectId;
    const nextName = editName.trim();

    setEditingObjectId(null);
    setEditName('');

    if (!nextObjectId || !nextName) {
      return;
    }

    updateObject(selectedSceneId, nextObjectId, { name: nextName });
  };

  const commitActiveInlineRename = () => {
    if (editingObjectId) {
      commitObjectRename();
      return;
    }

    if (editingFolderId) {
      commitFolderRename();
    }
  };

  const cancelActiveInlineRename = () => {
    cancelInlineRenameOnBlurRef.current = true;
    setEditingObjectId(null);
    setEditingFolderId(null);
    setEditName('');
    setFolderEditName('');
  };

  const beginInlineRenameSession = () => {
    const nextSessionId = inlineRenameSessionRef.current + 1;
    inlineRenameSessionRef.current = nextSessionId;
    setInlineRenameSessionId(nextSessionId);
    return nextSessionId;
  };

  const handleInlineRenameBlur = (sessionId: number) => {
    if (sessionId !== inlineRenameSessionRef.current) {
      return;
    }

    if (cancelInlineRenameOnBlurRef.current) {
      cancelInlineRenameOnBlurRef.current = false;
      return;
    }

    commitActiveInlineRename();
  };

  const startRenameTarget = (target: RenameableShelfItem) => {
    if (target.type === 'object' && target.object) {
      selectionAnchorObjectIdRef.current = target.object.id;
      selectObject(target.object.id, { recordHistory: false });
      handleStartObjectEdit(target.object.id, target.object.name);
      return;
    }

    if (target.type === 'folder' && target.folder) {
      selectFolder(target.folder.id, { recordHistory: false });
      handleStartFolderEdit(target.folder);
    }
  };

  const moveInlineRename = (direction: -1 | 1) => {
    const activeTargetId = editingObjectId ?? editingFolderId;
    const activeTargetType = editingObjectId ? 'object' : (editingFolderId ? 'folder' : null);
    if (!activeTargetId || !activeTargetType) {
      return;
    }

    const currentIndex = visibleRenameTargets.findIndex(
      (target) => target.id === activeTargetId && target.type === activeTargetType,
    );
    if (currentIndex === -1) {
      commitActiveInlineRename();
      return;
    }

    const nextIndex = currentIndex + direction;
    commitActiveInlineRename();

    const nextTarget = visibleRenameTargets[nextIndex];
    if (!nextTarget) {
      return;
    }

    startRenameTarget(nextTarget);
  };

  const handleInlineRenameKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    commitRename: () => void,
    cancelRename: () => void,
  ) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const input = event.currentTarget;
      input.setSelectionRange(0, 0);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const input = event.currentTarget;
      const caretIndex = input.value.length;
      input.setSelectionRange(caretIndex, caretIndex);
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      moveInlineRename(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  };

  const handleToggleFolder = (folderId: string) => {
    const isCollapsed = collapsedFolderIds.has(folderId);
    const nextCollapsed = isCollapsed
      ? Array.from(collapsedFolderIds).filter((id) => id !== folderId)
      : [...collapsedFolderIds, folderId];
    setCollapsedFoldersForScene(selectedSceneId, nextCollapsed);
  };

  const syncSelectionForLayerDrag = (item: ShelfTreeItem): string[] => {
    if (item.type === 'object') {
      if (selectedIdsInScene.length > 1 && selectedIdsInScene.includes(item.id)) {
        return selectedIdsInScene.map((id) => getObjectNodeKey(id));
      }

      const isOnlySelectedObject = selectedIdsInScene.length === 1 && selectedIdsInScene[0] === item.id;
      if (!isOnlySelectedObject) {
        selectionAnchorObjectIdRef.current = item.id;
        selectObject(item.id, { recordHistory: false });
      }

      return [item.key];
    }

    if (selectedFolderId !== item.id) {
      selectionAnchorObjectIdRef.current = null;
      selectFolder(item.id, { recordHistory: false });
    }

    if (selectedIdsInScene.length > 0 || selectedComponentId) {
      selectionAnchorObjectIdRef.current = null;
      selectObject(null, { recordHistory: false });
    }

    return [item.key];
  };

  const clearLayerDragState = () => {
    setDraggedLayerKeys([]);
    setLayerDropTarget(null);
  };

  const handleLayerDragStart = (event: React.DragEvent<HTMLDivElement>, item: ShelfTreeItem) => {
    flushSync(() => {
      const dragKeys = syncSelectionForLayerDrag(item);
      setDraggedLayerKeys(dragKeys);
      setLayerDropTarget(null);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragKeys.join(','));
    });

    const dragImage = getTransparentShelfDragImage();
    if (dragImage) {
      event.dataTransfer.setDragImage(dragImage, 0, 0);
    }
  };

  const getDropPositionForItem = (
    item: ShelfTreeItem,
    event: React.DragEvent<HTMLDivElement>,
  ): 'before' | 'after' | 'on' => {
    const rect = event.currentTarget.getBoundingClientRect();
    return getShelfRowDropPosition({
      isFolder: item.type === 'folder',
      isExpandedFolder: item.type === 'folder' && item.children.length > 0 && expandedKeys.has(item.key),
      clientY: event.clientY,
      rect,
    });
  };

  const handleLayerDragOver = (event: React.DragEvent<HTMLDivElement>, item: ShelfTreeItem) => {
    if (draggedLayerKeys.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const dropPosition = getDropPositionForItem(item, event);
    setLayerDropTarget(normalizeSceneLayerDropTarget(selectedScene, { key: item.key, dropPosition }));
  };

  const handleLayerDrop = (event: React.DragEvent<HTMLDivElement>, item: ShelfTreeItem) => {
    if (draggedLayerKeys.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const resolvedTarget = layerDropTarget?.key === item.key
      ? layerDropTarget
      : normalizeSceneLayerDropTarget(selectedScene, {
        key: item.key,
        dropPosition: getDropPositionForItem(item, event),
      });

    const nextScene = moveSceneLayerNodes(selectedScene, draggedLayerKeys, resolvedTarget);
    updateScene(selectedSceneId, nextScene);
    clearLayerDragState();
  };

  const handleRootDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (draggedLayerKeys.length === 0 || treeItems.length === 0) {
      return;
    }

    if (event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setLayerDropTarget({ key: null, dropPosition: null });
  };

  const handleRootDropZoneDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (draggedLayerKeys.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setLayerDropTarget({ key: null, dropPosition: null });
  };

  const handleRootDropZoneDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (draggedLayerKeys.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const nextScene = moveSceneLayerNodes(selectedScene, draggedLayerKeys, {
      key: null,
      dropPosition: null,
    });
    updateScene(selectedSceneId, nextScene);
    clearLayerDragState();
  };

  const handleBlankAreaDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (draggedLayerKeys.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setLayerDropTarget(null);
  };

  const handleRootDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (draggedLayerKeys.length === 0) {
      return;
    }

    if (event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    const nextScene = moveSceneLayerNodes(selectedScene, draggedLayerKeys, {
      key: null,
      dropPosition: null,
    });
    updateScene(selectedSceneId, nextScene);
    clearLayerDragState();
  };

  const handleEmptyShelfClick = (event: React.MouseEvent<HTMLElement>) => {
    if (ignoreNextEmptyShelfClickRef.current) {
      ignoreNextEmptyShelfClickRef.current = false;
      return;
    }
    if (draggedLayerKeys.length > 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-sprite-shelf-row="true"]')) {
      return;
    }

    selectionAnchorObjectIdRef.current = null;
    clearSelection();
  };

  const handleEmptyShelfPointerDownCapture = (event: React.PointerEvent<HTMLElement>) => {
    if (draggedLayerKeys.length > 0 || event.button !== 0) {
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

    selectionAnchorObjectIdRef.current = null;
    clearSelection({ recordHistory: false });
  };

  const handleEmptyShelfContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (draggedLayerKeys.length > 0) {
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
    focusShortcutSurface();
    setContextMenuPosition({ left: event.clientX, top: event.clientY });
    setContextMenu({ x: event.clientX, y: event.clientY, kind: 'empty' });
  };

  const handleObjectRowClick = (e: React.MouseEvent, objectId: string) => {
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();
    focusShortcutSurface();

    if (e.shiftKey) {
      const anchorId = selectionAnchorObjectIdRef.current ?? selectedObjectId ?? objectId;
      const anchorIndex = orderedSceneObjectIds.indexOf(anchorId);
      const targetIndex = orderedSceneObjectIds.indexOf(objectId);
      if (anchorIndex === -1 || targetIndex === -1) {
        selectionAnchorObjectIdRef.current = objectId;
        selectObject(objectId);
        return;
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const rangeIds = orderedSceneObjectIds.slice(start, end + 1);
      selectionAnchorObjectIdRef.current = anchorId;
      selectObjects(rangeIds, objectId);
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      const current = new Set(selectedIdsInScene);
      if (current.has(objectId)) {
        current.delete(objectId);
      } else {
        current.add(objectId);
      }

      const nextIds = orderedSceneObjectIds.filter((id) => current.has(id));
      selectionAnchorObjectIdRef.current = objectId;
      if (nextIds.length === 0) {
        selectObject(null);
        return;
      }

      const nextPrimary = nextIds.includes(objectId)
        ? objectId
        : (selectedObjectId && nextIds.includes(selectedObjectId) ? selectedObjectId : nextIds[0]);
      selectObjects(nextIds, nextPrimary);
      return;
    }

    selectionAnchorObjectIdRef.current = objectId;
    selectObject(objectId);
  };

  const handleFolderRowClick = (e: React.MouseEvent, folderId: string) => {
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();
    selectionAnchorObjectIdRef.current = null;
    selectFolder(folderId);
  };

  const handleAddObject = () => {
    runInHistoryTransaction('sprite-shelf:add-object', () => {
      const newName = `Object ${selectedScene.objects.length + 1}`;
      const newObject = addObject(selectedSceneId, newName);
      selectObject(newObject.id);
      queueMicrotask(() => {
        selectObject(newObject.id, { recordHistory: false });
      });
    });
  };

  const handleEmptyShelfCreateObjectClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    ignoreNextEmptyShelfClickRef.current = true;
    handleAddObject();
  };

  const handleAddFolder = () => {
    runInHistoryTransaction('sprite-shelf:add-folder', () => {
      const newFolder: SceneFolder = {
        id: crypto.randomUUID(),
        name: `Folder ${folders.length + 1}`,
        parentId: null,
        order: 0,
      };
      const target = selectedFolderId
        ? { key: getFolderNodeKey(selectedFolderId), dropPosition: 'after' as const }
        : selectedObjectId
          ? { key: getObjectNodeKey(selectedObjectId), dropPosition: 'after' as const }
          : { key: null, dropPosition: null };
      const nextScene = insertSceneFolder(selectedScene, newFolder, target);

      updateScene(selectedSceneId, {
        objectFolders: nextScene.objectFolders,
        objects: nextScene.objects,
      });
    });
  };

  const handleObjectContextMenu = (e: React.MouseEvent, object: GameObject) => {
    e.preventDefault();
    setContextMenuPosition({ left: e.clientX, top: e.clientY });
    setContextMenu({ x: e.clientX, y: e.clientY, kind: 'object', object });
  };

  const handleFolderContextMenu = (e: React.MouseEvent, folder: SceneFolder) => {
    e.preventDefault();
    setContextMenuPosition({ left: e.clientX, top: e.clientY });
    setContextMenu({ x: e.clientX, y: e.clientY, kind: 'folder', folder });
  };

  const handleCloseContextMenu = () => {
    setContextMenuPosition(null);
    setContextMenu(null);
  };

  const getContextMenuObjectActionIds = (): string[] => {
    if (!contextMenu || contextMenu.kind !== 'object') {
      return [];
    }
    return resolveSceneObjectActionIds(contextMenu.object.id, orderedSceneObjectIds, selectedIdsInScene);
  };

  const handleDuplicate = () => {
    if (!contextMenu || contextMenu.kind !== 'object') return;
    duplicateSceneObjectSelection({
      addObject,
      duplicateObject,
      editorViewport: getStageEditorViewport(selectedSceneId),
      project,
      removeObject,
      sceneId: selectedSceneId,
      selectObject,
      selectObjects,
      selectedObjectId,
      selectedObjectIds: selectedIdsInScene,
      updateObject,
      viewMode,
    }, getContextMenuObjectActionIds(), { source: 'sprite-shelf:duplicate-object' });
    handleCloseContextMenu();
  };

  const handleCopy = () => {
    if (!contextMenu || contextMenu.kind !== 'object' || !project) return;
    copySceneObjectSelection({
      addObject,
      duplicateObject,
      editorViewport: getStageEditorViewport(selectedSceneId),
      project,
      removeObject,
      sceneId: selectedSceneId,
      selectObject,
      selectObjects,
      selectedObjectId,
      selectedObjectIds: selectedIdsInScene,
      updateObject,
      viewMode,
    }, getContextMenuObjectActionIds());
    handleCloseContextMenu();
  };

  const handlePaste = () => {
    if (!project) return;
    pasteSceneObjectSelection({
      addObject,
      duplicateObject,
      editorViewport: getStageEditorViewport(selectedSceneId),
      project,
      removeObject,
      sceneId: selectedSceneId,
      selectObject,
      selectObjects,
      selectedObjectId,
      selectedObjectIds: selectedIdsInScene,
      updateObject,
      viewMode,
    }, { source: 'sprite-shelf:paste-object' });
    handleCloseContextMenu();
  };

  const handleCut = () => {
    if (!contextMenu || contextMenu.kind !== 'object' || !project) return;
    cutSceneObjectSelection({
      addObject,
      duplicateObject,
      editorViewport: getStageEditorViewport(selectedSceneId),
      project,
      removeObject,
      sceneId: selectedSceneId,
      selectObject,
      selectObjects,
      selectedObjectId,
      selectedObjectIds: selectedIdsInScene,
      updateObject,
      viewMode,
    }, getContextMenuObjectActionIds(), { source: 'sprite-shelf:cut-object' });

    handleCloseContextMenu();
  };

  const handleDelete = () => {
    if (!contextMenu || contextMenu.kind !== 'object') return;
    deleteSceneObjectSelection({
      addObject,
      duplicateObject,
      editorViewport: getStageEditorViewport(selectedSceneId),
      project,
      removeObject,
      sceneId: selectedSceneId,
      selectObject,
      selectObjects,
      selectedObjectId,
      selectedObjectIds: selectedIdsInScene,
      updateObject,
      viewMode,
    }, getContextMenuObjectActionIds(), { source: 'sprite-shelf:delete-object' });

    handleCloseContextMenu();
  };

  const handleStartFolderEdit = (folder: SceneFolder) => {
    flushSync(() => {
      beginInlineRenameSession();
      setEditingFolderId(folder.id);
      setEditingObjectId(null);
      setFolderEditName(folder.name);
      setEditName('');
    });
    stabilizeInlineRenameFocus(inputRef.current);
  };

  const handleDeleteFolder = (folderId: string) => {
    const descendants = collectFolderDescendants(folderId, folders);
    const nextFolders = folders.filter((folder) => !descendants.has(folder.id));

    const nextObjects = selectedScene.objects.filter(
      (obj) => !(obj.parentId && descendants.has(obj.parentId)),
    );

    const nextScene = {
      ...selectedScene,
      objectFolders: nextFolders,
      objects: nextObjects,
    };

    runInHistoryTransaction('sprite-shelf:delete-folder', () => {
      updateScene(selectedSceneId, {
        objectFolders: nextFolders,
        objects: nextObjects,
      });

      if (editingFolderId && descendants.has(editingFolderId)) {
        setEditingFolderId(null);
        setFolderEditName('');
      }

      const currentCollapsed = collapsedFolderIdsByScene[selectedSceneId] ?? [];
      setCollapsedFoldersForScene(
        selectedSceneId,
        currentCollapsed.filter((id) => !descendants.has(id)),
      );

      const remainingObjectIds = new Set(nextObjects.map((obj) => obj.id));
      const remainingSelectedIds = selectedIdsInScene.filter((id) => remainingObjectIds.has(id));
      if (remainingSelectedIds.length > 0) {
        const nextPrimary = selectedObjectId && remainingSelectedIds.includes(selectedObjectId)
          ? selectedObjectId
          : remainingSelectedIds[0];
        selectObjects(remainingSelectedIds, nextPrimary);
        return;
      }

      const nextOrderedIds = getSceneObjectsInLayerOrder(nextScene).map((obj) => obj.id);
      selectObject(nextOrderedIds[0] ?? null);
    });
  };

  const handleRequestDeleteFolder = (folder: SceneFolder) => {
    const descendants = collectFolderDescendants(folder.id, folders);
    const hasChildFolders = descendants.size > 1;
    const hasChildObjects = selectedScene.objects.some(
      (obj) => !!obj.parentId && descendants.has(obj.parentId),
    );

    if (!hasChildFolders && !hasChildObjects) {
      handleDeleteFolder(folder.id);
      return;
    }

    setFolderDeleteTarget(folder);
  };

  const handleCancelDeleteFolder = () => {
    setFolderDeleteTarget(null);
  };

  const handleConfirmDeleteFolder = () => {
    if (!folderDeleteTarget) return;
    handleDeleteFolder(folderDeleteTarget.id);
    setFolderDeleteTarget(null);
  };

  const handleStartObjectEdit = (objectId: string, currentName: string) => {
    flushSync(() => {
      beginInlineRenameSession();
      setEditingObjectId(objectId);
      setEditingFolderId(null);
      setEditName(currentName);
      setFolderEditName('');
    });
    stabilizeInlineRenameFocus(inputRef.current);
  };

  const handleMakeComponent = () => {
    if (!contextMenu || contextMenu.kind !== 'object' || !project) return;

    const requestedName = contextMenu.object.name.trim();
    const normalizedRequestedName = requestedName.toLowerCase();
    const hasDuplicateName = (project.components || []).some(
      (component) => component.name.trim().toLowerCase() === normalizedRequestedName
    );
    if (hasDuplicateName) {
      void showAlert({
        title: 'Component Name Already Exists',
        description: `A component named "${requestedName}" already exists. Rename the object first.`,
      });
      return;
    }

    const created = makeComponent(selectedSceneId, contextMenu.object.id);
    if (!created) {
      void showAlert({
        title: 'Could Not Create Component',
        description: 'Could not create component. Check that the name is unique.',
        tone: 'destructive',
      });
      return;
    }

    handleCloseContextMenu();
  };

  const handleDetachFromComponent = () => {
    if (!contextMenu || contextMenu.kind !== 'object') return;
    detachFromComponent(selectedSceneId, contextMenu.object.id);
    handleCloseContextMenu();
  };

  const handleSaveObjectToLibrary = async () => {
    if (!contextMenu || contextMenu.kind !== 'object' || !project) {
      return;
    }
    if (!isAuthenticated) {
      await showAlert({
        title: 'Sign In Required',
        description: 'Sign in to save objects to the cloud library.',
      });
      return;
    }

    const effectiveProps = getEffectiveObjectProps(contextMenu.object, project.components || []);
    setSavingObjectLibrary(contextMenu.object.id);
    try {
      await saveRuntimeObjectToLibrary({
        name: contextMenu.object.name,
        costumes: effectiveProps.costumes,
        sounds: effectiveProps.sounds,
        blocklyXml: effectiveProps.blocklyXml,
        currentCostumeIndex: effectiveProps.currentCostumeIndex,
        physics: effectiveProps.physics,
        collider: effectiveProps.collider,
        localVariables: effectiveProps.localVariables,
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
      handleCloseContextMenu();
    } catch (error) {
      console.error('Failed to save object to library:', error);
      await showAlert({
        title: 'Save Failed',
        description: 'Failed to save object to library',
        tone: 'destructive',
      });
    } finally {
      setSavingObjectLibrary(null);
    }
  };

  const handleLibrarySelect = (data: {
    name: string;
    costumes: Costume[];
    sounds: Sound[];
    blocklyXml: string;
    currentCostumeIndex: number;
    physics: PhysicsConfig | null;
    collider: ColliderConfig | null;
    localVariables: GameObject['localVariables'];
  }) => {
    runInHistoryTransaction('sprite-shelf:add-from-library', () => {
      const newObject = addObject(selectedSceneId, data.name);
      const variableRemap = remapLocalVariablesForInsertion(
        data.localVariables || [],
        data.blocklyXml,
        newObject.id,
      );
      const maxCostumeIndex = Math.max(0, data.costumes.length - 1);
      const safeCostumeIndex = Math.min(Math.max(0, data.currentCostumeIndex), maxCostumeIndex);

      updateObject(selectedSceneId, newObject.id, {
        costumes: data.costumes,
        sounds: data.sounds,
        blocklyXml: variableRemap.blocklyXml,
        physics: data.physics,
        collider: data.collider,
        currentCostumeIndex: safeCostumeIndex,
        localVariables: variableRemap.localVariables,
      });

      selectObject(newObject.id);
    });
  };

  const willDeleteSelection = !!contextMenu
    && contextMenu.kind === 'object'
    && selectedIdsInScene.length > 1
    && selectedIdsInScene.includes(contextMenu.object.id);
  const deleteLabel = willDeleteSelection ? `Delete Selected (${selectedIdsInScene.length})` : 'Delete';

  const renderLayerRow = (
    item: ShelfTreeItem,
    level: number,
    options?: {
      interactive?: boolean;
      showDropIndicators?: boolean;
      rowKey?: string;
    },
  ): React.ReactNode => {
    const interactive = options?.interactive ?? true;
    const showDropIndicators = options?.showDropIndicators ?? true;
    const object = item.object;
    const folder = item.folder;
    const isObjectEditing = item.type === 'object' && editingObjectId === item.id;
    const isFolderEditing = item.type === 'folder' && editingFolderId === item.id;
    const isInlineEditing = isObjectEditing || isFolderEditing;
    const isComponentInstance = !!object?.componentId;
    const effectiveProps = object ? getEffectiveObjectProps(object, project?.components || []) : null;
    const hasChildItems = item.children.length > 0;
    const isExpanded = item.type === 'folder' && expandedKeys.has(item.key);
    const isSelected = item.type === 'object'
      ? selectedIdsInScene.includes(item.id)
      : selectedFolderId === item.id;
    const dropPosition = showDropIndicators && layerDropTarget?.key === item.key ? layerDropTarget.dropPosition : null;
    const isDropOn = dropPosition === 'on';
    const isDropBefore = dropPosition === 'before';
    const isDropAfter = dropPosition === 'after';
    const visibleEntryIndex = visibleTreeEntryIndexByKey.get(item.key) ?? -1;
    const previousVisibleItem = visibleEntryIndex > 0
      ? visibleTreeEntries[visibleEntryIndex - 1]?.item ?? null
      : null;
    const nextVisibleItem = visibleEntryIndex >= 0 && visibleEntryIndex < visibleTreeEntries.length - 1
      ? visibleTreeEntries[visibleEntryIndex + 1]?.item ?? null
      : null;
    const connectsToPrevious = isSelected
      && previousVisibleItem?.type === 'object'
      && selectedIdsInScene.includes(previousVisibleItem.id);
    const connectsToNext = isSelected
      && nextVisibleItem?.type === 'object'
      && selectedIdsInScene.includes(nextVisibleItem.id);

    return (
      <ShelfTreeRow
        rowKey={options?.rowKey ?? item.key}
        name={item.name}
        level={level}
        hasChildren={hasChildItems}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isDropOn={isDropOn}
        isDropBefore={isDropBefore}
        isDropAfter={isDropAfter}
        connectsToPrevious={connectsToPrevious}
        connectsToNext={connectsToNext}
        isEditing={isInlineEditing}
        showControls={isShelfHovered}
        draggable={interactive && !isObjectEditing && !isFolderEditing}
        onDoubleClick={interactive ? ((e) => {
          e.preventDefault();
          e.stopPropagation();
          if (item.type === 'object' && object) {
            handleStartObjectEdit(object.id, object.name);
          } else if (item.type === 'folder' && folder) {
            handleStartFolderEdit(folder);
          }
        }) : undefined}
        onClick={interactive ? ((e) => {
          if (item.type === 'object' && object) {
            handleObjectRowClick(e, object.id);
          } else if (item.type === 'folder' && folder) {
            handleFolderRowClick(e, folder.id);
          }
        }) : undefined}
        onContextMenu={interactive ? ((e) => {
          if (item.type === 'object' && object) {
            handleObjectContextMenu(e, object);
          } else if (item.type === 'folder' && folder) {
            handleFolderContextMenu(e, folder);
          }
        }) : undefined}
        onDragOver={interactive ? ((e) => handleLayerDragOver(e, item)) : undefined}
        onDrop={interactive ? ((e) => handleLayerDrop(e, item)) : undefined}
        onDragStart={interactive ? ((e) => handleLayerDragStart(e, item)) : undefined}
        onDragEnd={interactive ? clearLayerDragState : undefined}
        onToggleChildren={interactive ? ((e) => {
          e.stopPropagation();
          if (folder) {
            handleToggleFolder(folder.id);
          }
        }) : undefined}
        leadingIcon={item.type === 'folder' ? (
          isExpanded ? <FolderOpen className="size-[1.125rem] shrink-0" /> : <Folder className="size-[1.125rem] shrink-0" />
        ) : (
          effectiveProps ? (
            <ShelfObjectThumbnail
              name={object?.name ?? 'Object'}
              costumes={effectiveProps.costumes}
              currentCostumeIndex={effectiveProps.currentCostumeIndex}
              visible={object?.visible ?? true}
            />
          ) : null
        )}
        content={(
          <InlineRenameField
            key={isInlineEditing ? `rename-${inlineRenameSessionId}` : `label-${item.key}`}
            ref={inputRef}
            editing={isInlineEditing}
            value={isObjectEditing ? editName : (isFolderEditing ? folderEditName : item.name)}
            onChange={(e) => {
              if (isObjectEditing) {
                setEditName(e.target.value);
                return;
              }
              setFolderEditName(e.target.value);
            }}
            onBlur={() => handleInlineRenameBlur(inlineRenameSessionId)}
            onKeyDown={(e) => handleInlineRenameKeyDown(e, commitActiveInlineRename, cancelActiveInlineRename)}
            data-hotkeys="ignore"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex-1 min-w-0"
            outlineClassName="left-[-3px] right-0"
            textClassName={`text-xs leading-5 ${getObjectComponentLabelTextClassName(isComponentInstance)}`}
            autoFocus={isInlineEditing}
            focusBehavior="caret-end"
            displayAs="div"
            displayProps={{
              className: `flex w-full min-w-0 items-center gap-1 ${isInlineEditing ? 'overflow-visible' : 'overflow-hidden'}`,
              title: item.name,
            }}
            displayValue={
              <ObjectComponentLabel name={item.name} isComponent={isComponentInstance} className="overflow-visible" />
            }
          />
        )}
      />
    );
  };

  const renderTreeItem = (item: ShelfTreeItem, level = 1): React.ReactNode => {
    const isExpanded = item.type === 'folder' && expandedKeys.has(item.key);

    return (
      <div key={item.key}>
        {renderLayerRow(item, level)}
        {isExpanded ? item.children.map((child) => renderTreeItem(child, level + 1)) : null}
      </div>
    );
  };

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col bg-card"
      onPointerEnter={() => setIsShelfHovered(true)}
      onPointerLeave={() => setIsShelfHovered(false)}
    >
      <div className={`${panelHeaderClassNames.chrome} ${panelHeaderClassNames.row} h-auto border-b-0 py-1`}>
        <div className="relative flex min-w-0 flex-1 items-center justify-center gap-1">
          {showQuickSceneSwitch ? (
            <div className="absolute left-0 flex min-w-0 items-center justify-start">
              <DropdownMenu open={sceneDropdownOpen} onOpenChange={setSceneDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="h-6 min-w-0 max-w-32 gap-1 px-1 text-left text-xs hover:text-primary"
                    shape="default"
                    size="xs"
                    variant="ghost"
                  >
                    <Earth className="size-3.5 shrink-0" />
                    <span className="truncate">{selectedScene.name}</span>
                    <ChevronRight className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-48">
                  {project?.scenes.map((scene) => (
                    <DropdownMenuItem
                      key={scene.id}
                      onClick={() => selectScene(scene.id)}
                      className={scene.id === selectedSceneId ? selectionSurfaceClassNames.selected : ''}
                    >
                      <Earth className="size-3.5 shrink-0" />
                      <span className="truncate">{scene.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}

          <IconButton label="Add Object" onClick={handleAddObject} size="xs">
            <Plus className="size-4" />
          </IconButton>
          <IconButton label="Add Folder" onClick={handleAddFolder} size="xs">
            <FolderPlus className="size-4" />
          </IconButton>
          {showObjectLibraryButton ? (
            <IconButton
              label="Object Library"
              onClick={() => setShowLibrary(true)}
              size="xs"
            >
              <Library className="size-4" />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div
        ref={shortcutSurfaceRef}
        data-editor-shortcut-surface="scene-objects"
        tabIndex={0}
        className="flex flex-1 min-h-0 min-w-0 w-full flex-col overflow-hidden outline-none"
        onPointerDownCapture={handleShortcutSurfacePointerDownCapture}
      >
        <ScrollArea
          className="h-full min-h-0 min-w-0 w-full overflow-hidden"
          onPointerDownCapture={handleEmptyShelfPointerDownCapture}
          onDragOver={handleRootDragOver}
          onDrop={handleRootDrop}
          onClick={handleEmptyShelfClick}
          onContextMenu={handleEmptyShelfContextMenu}
          data-testid="sprite-shelf-scroll-area"
        >
          <div className="min-h-full w-0 min-w-full" onDragOver={handleBlankAreaDragOver}>
            {selectedScene.objects.length === 0 && folders.length === 0 ? (
              <div className="flex h-full items-center justify-center p-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                  shape="pill"
                  onClick={handleEmptyShelfCreateObjectClick}
                >
                  + Create an object
                </Button>
              </div>
            ) : (
              <div
                role="tree"
                aria-label="Scene hierarchy"
                className="relative min-h-full w-0 min-w-full overflow-x-hidden pb-2 outline-none"
                onClick={handleEmptyShelfClick}
                onDragOver={handleBlankAreaDragOver}
              >
                {treeItems.map((item) => renderTreeItem(item))}
                <div
                  className="absolute inset-x-2 bottom-0 z-10 h-4 rounded"
                  onClick={handleEmptyShelfClick}
                  onDragOver={handleRootDropZoneDragOver}
                  onDrop={handleRootDropZoneDrop}
                >
                  {layerDropTarget?.key === null ? (
                    <div className="absolute inset-x-0 top-1/2 h-0 -translate-y-1/2 border-t-2 rounded border-primary/80" />
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {contextMenu && (
        <>
          <Card
            ref={contextMenuRef}
            className="fixed z-50 py-1 min-w-36 gap-0"
            style={{
              left: contextMenuPosition?.left ?? contextMenu.x,
              top: contextMenuPosition?.top ?? contextMenu.y,
            }}
          >
            {contextMenu.kind === 'object' ? (
              <>
                <MenuItemButton icon={<Copy className="size-4" />} onClick={handleCopy}>
                  Copy
                </MenuItemButton>
                <MenuItemButton icon={<Scissors className="size-4" />} onClick={handleCut}>
                  Cut
                </MenuItemButton>
                {hasSceneObjectClipboardContents() ? (
                  <MenuItemButton icon={<Clipboard className="size-4" />} onClick={handlePaste}>
                    Paste
                  </MenuItemButton>
                ) : null}
                <MenuItemButton icon={<CopyPlus className="size-4" />} onClick={handleDuplicate}>
                  Duplicate
                </MenuItemButton>
                <MenuSeparator />
                <MenuItemButton
                  icon={<Pencil className="size-4" />}
                  onClick={() => {
                    handleStartObjectEdit(contextMenu.object.id, contextMenu.object.name);
                    handleCloseContextMenu();
                  }}
                >
                  Rename Object
                </MenuItemButton>
                <MenuItemButton
                  icon={<Library className="size-4" />}
                  onClick={() => {
                    void handleSaveObjectToLibrary();
                  }}
                  disabled={savingObjectLibrary === contextMenu.object.id}
                >
                  Save to Library
                </MenuItemButton>
                {!contextMenu.object.componentId ? (
                  <MenuItemButton
                    icon={<Component className="size-4" />}
                    intent="accent"
                    onClick={handleMakeComponent}
                  >
                    Make Component
                  </MenuItemButton>
                ) : (
                  <>
                    <MenuItemButton
                      icon={<Unlink className="size-4" />}
                      onClick={handleDetachFromComponent}
                    >
                      Detach from Component
                    </MenuItemButton>
                  </>
                )}
                <MenuItemButton
                  icon={<Trash2 className="size-4" />}
                  intent="destructive"
                  onClick={handleDelete}
                >
                  {deleteLabel}
                </MenuItemButton>
              </>
            ) : contextMenu.kind === 'folder' ? (
              <>
                <MenuItemButton
                  icon={<Pencil className="size-4" />}
                  onClick={() => {
                    handleStartFolderEdit(contextMenu.folder);
                    handleCloseContextMenu();
                  }}
                >
                  Rename Folder
                </MenuItemButton>
                <MenuItemButton
                  icon={<Trash2 className="size-4" />}
                  intent="destructive"
                  onClick={() => {
                    handleRequestDeleteFolder(contextMenu.folder);
                    handleCloseContextMenu();
                  }}
                >
                  Delete Folder
                </MenuItemButton>
              </>
            ) : (
              <>
                {hasSceneObjectClipboardContents() ? (
                  <MenuItemButton
                    icon={<Clipboard className="size-4" />}
                    onClick={handlePaste}
                  >
                    Paste
                  </MenuItemButton>
                ) : null}
                <MenuItemButton
                  icon={<FolderPlus className="size-4" />}
                  onClick={() => {
                    handleAddFolder();
                    handleCloseContextMenu();
                  }}
                >
                  New Folder
                </MenuItemButton>
              </>
            )}
          </Card>
        </>
      )}

      <ObjectLibraryBrowser
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelect={handleLibrarySelect}
      />

      <Dialog open={!!folderDeleteTarget} onOpenChange={(open) => !open && handleCancelDeleteFolder()}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              everything inside the folder will be deleted as well.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelDeleteFolder}>
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
