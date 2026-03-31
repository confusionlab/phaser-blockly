import { useCallback, useEffect, useState, useRef, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ObjectLibraryBrowser } from '../dialogs/ObjectLibraryBrowser';
import { ComponentLibraryBrowser } from '../dialogs/ComponentLibraryBrowser';
import { Button } from '@/components/ui/button';
import { getCostumeBoundsInAssetSpace } from '@/lib/costume/costumeAssetFrame';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { Card } from '@/components/ui/card';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Pencil,
  Copy,
  Clipboard,
  Trash2,
  ChevronRight,
  ChevronDown,
  Component,
  Unlink,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
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
  getFolderNodeKey,
  getNextSiblingOrder,
  getObjectNodeKey,
  getSceneObjectsInLayerOrder,
  getSceneTree,
  moveSceneLayerNodes,
  normalizeSceneLayerDropTarget,
  type LayerTreeNode,
} from '@/utils/layerTree';
import { runInHistoryTransaction } from '@/store/universalHistory';
import { normalizeVariableDefinition, remapVariableIdsInBlocklyXml } from '@/lib/variableUtils';
import { acquireGlobalKeyboardCapture, focusKeyboardSurface, isTextEntryTarget } from '@/utils/keyboard';
import {
  addComponentInstanceWithHistory,
  copySceneObjectsToClipboard,
  cutSceneObjectsWithHistory,
  deleteComponentWithHistory,
  deleteSceneObjectsWithHistory,
  duplicateSceneObjectsWithHistory,
  hasSceneObjectClipboardContents,
  pasteSceneObjectClipboardWithHistory,
} from '@/lib/editor/objectCommands';
import { freezeEditorResizeForLayoutTransition } from '@/lib/freezeEditorResize';
import { selectionSurfaceClassNames } from '@/lib/ui/selectionSurfaceTokens';
import { panelHeaderClassNames } from '@/lib/ui/panelHeaderTokens';

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

let transparentDragImage: HTMLImageElement | null = null;

function getTransparentDragImage(): HTMLImageElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  if (transparentDragImage) {
    return transparentDragImage;
  }

  const image = document.createElement('img');
  image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  image.alt = '';
  image.width = 1;
  image.height = 1;
  image.setAttribute('aria-hidden', 'true');
  image.style.position = 'fixed';
  image.style.left = '-9999px';
  image.style.top = '-9999px';
  image.style.pointerEvents = 'none';
  image.style.opacity = '0';
  document.body.appendChild(image);
  transparentDragImage = image;
  return transparentDragImage;
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

export function SpriteShelf() {
  const {
    project,
    addObject,
    removeObject,
    duplicateObject,
    updateObject,
    updateScene,
    addScene,
    removeScene,
    reorderScenes,
    makeComponent,
    deleteComponent,
    detachFromComponent,
    addComponentInstance,
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
    selectComponent,
    selectScene,
    clearSelection,
    setActiveObjectTab,
    collapsedFolderIdsByScene,
    setCollapsedFoldersForScene,
    clearSceneUiState,
  } = useEditorStore();

  const [contextMenu, setContextMenu] = useState<
    | { x: number; y: number; kind: 'object'; object: GameObject }
    | { x: number; y: number; kind: 'folder'; folder: SceneFolder }
    | null
  >(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [sceneContextMenu, setSceneContextMenu] = useState<{
    x: number;
    y: number;
    sceneId: string;
  } | null>(null);
  const [sceneContextMenuPosition, setSceneContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [sceneDropdownOpen, setSceneDropdownOpen] = useState(false);
  const [isShelfHovered, setIsShelfHovered] = useState(false);
  const [draggedSceneId, setDraggedSceneId] = useState<string | null>(null);
  const [sceneDropTarget, setSceneDropTarget] = useState<{ sceneId: string; position: 'before' | 'after' } | null>(null);
  const [draggedLayerKeys, setDraggedLayerKeys] = useState<string[]>([]);
  const [layerDropTarget, setLayerDropTarget] = useState<{ key: string | null; dropPosition: 'before' | 'after' | 'on' | null } | null>(null);
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [inlineRenameSessionId, setInlineRenameSessionId] = useState(0);
  const [editName, setEditName] = useState('');
  const [sceneEditError, setSceneEditError] = useState<string | null>(null);
  const [folderEditName, setFolderEditName] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [showComponentLibrary, setShowComponentLibrary] = useState(false);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<SceneFolder | null>(null);
  const [sceneDeleteTarget, setSceneDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const cancelInlineRenameOnBlurRef = useRef(false);
  const cancelSceneRenameOnBlurRef = useRef(false);
  const sceneRenamePointerDownTargetRef = useRef<EventTarget | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const sceneInputRef = useRef<HTMLInputElement>(null);
  const shortcutSurfaceRef = useRef<HTMLDivElement>(null);
  const inlineRenameSessionRef = useRef(0);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const sceneContextMenuRef = useRef<HTMLDivElement>(null);
  const selectionAnchorObjectIdRef = useRef<string | null>(null);

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

  useLayoutEffect(() => {
    if (!editingSceneId) {
      return;
    }

    stabilizeInlineRenameFocus(sceneInputRef.current);
  }, [editingSceneId, stabilizeInlineRenameFocus]);

  useEffect(() => {
    if (!editingSceneId || typeof document === 'undefined') {
      sceneRenamePointerDownTargetRef.current = null;
      return;
    }

    const handlePointerDownCapture = (event: PointerEvent) => {
      sceneRenamePointerDownTargetRef.current = event.target;
    };

    document.addEventListener('pointerdown', handlePointerDownCapture, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownCapture, true);
      sceneRenamePointerDownTargetRef.current = null;
    };
  }, [editingSceneId]);

  const selectedScene = project?.scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const folders = selectedScene?.objectFolders ?? [];
  const isInlineRenaming = !!editingObjectId || !!editingFolderId || !!editingSceneId;

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

  useLayoutEffect(() => {
    if (!sceneContextMenu || !sceneContextMenuRef.current || !sceneContextMenuPosition) return;

    const margin = 8;
    const menuRect = sceneContextMenuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let nextLeft = sceneContextMenuPosition.left;
    let nextTop = sceneContextMenuPosition.top;

    if (nextLeft + menuRect.width + margin > viewportWidth) {
      nextLeft = Math.max(margin, viewportWidth - menuRect.width - margin);
    }
    if (nextTop + menuRect.height + margin > viewportHeight) {
      nextTop = Math.max(margin, viewportHeight - menuRect.height - margin);
    }

    if (nextLeft !== sceneContextMenuPosition.left || nextTop !== sceneContextMenuPosition.top) {
      setSceneContextMenuPosition({ left: nextLeft, top: nextTop });
    }
  }, [sceneContextMenu, sceneContextMenuPosition]);

  const focusShortcutSurface = useCallback(() => {
    focusKeyboardSurface(shortcutSurfaceRef.current);
  }, []);

  const handleShortcutSurfacePointerDownCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isTextEntryTarget(event.target)) {
      return;
    }
    focusShortcutSurface();
  }, [focusShortcutSurface]);

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
    freezeEditorResizeForLayoutTransition();
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

    const dragImage = getTransparentDragImage();
    if (dragImage) {
      event.dataTransfer.setDragImage(dragImage, 0, 0);
    }
  };

  const getDropPositionForItem = (
    item: ShelfTreeItem,
    event: React.DragEvent<HTMLDivElement>,
  ): 'before' | 'after' | 'on' => {
    if (item.type !== 'folder') {
      const rect = event.currentTarget.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const relativeY = event.clientY - rect.top;
    const topZone = rect.height * 0.25;
    const bottomZone = rect.height * 0.75;
    const isExpandedFolder = item.children.length > 0 && expandedKeys.has(item.key);

    if (relativeY < topZone) {
      return 'before';
    }
    if (!isExpandedFolder && relativeY > bottomZone) {
      return 'after';
    }
    return 'on';
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

  const handleObjectRowClick = (e: React.MouseEvent, objectId: string) => {
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();
    focusShortcutSurface();
    freezeEditorResizeForLayoutTransition();

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
    freezeEditorResizeForLayoutTransition();
    selectionAnchorObjectIdRef.current = null;
    selectFolder(folderId);
  };

  const handleAddObject = () => {
    runInHistoryTransaction('sprite-shelf:add-object', () => {
      const newName = `Object ${selectedScene.objects.length + 1}`;
      const newObject = addObject(selectedSceneId, newName);
      selectObject(newObject.id);
    });
  };

  const handleEmptyShelfCreateObjectClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    handleAddObject();
  };

  const handleAddFolder = (parentId: string | null = null, assignObjectIds?: string[]) => {
    runInHistoryTransaction('sprite-shelf:add-folder', () => {
      const newFolder: SceneFolder = {
        id: crypto.randomUUID(),
        name: `Folder ${folders.length + 1}`,
        parentId,
        order: getNextSiblingOrder(selectedScene, parentId),
      };
      const candidateIds = Array.isArray(assignObjectIds) ? assignObjectIds : [];
      const assignSet = new Set(candidateIds);
      const orderedAssignIds = orderedSceneObjectIds.filter((id) => assignSet.has(id));

      if (orderedAssignIds.length === 0) {
        updateScene(selectedSceneId, { objectFolders: [...folders, newFolder] });
        return;
      }

      const assignedOrderById = new Map(
        orderedAssignIds.map((id, index) => [id, index]),
      );

      const nextObjects = selectedScene.objects.map((obj) => {
        const nextOrder = assignedOrderById.get(obj.id);
        if (nextOrder === undefined) {
          return obj;
        }
        return {
          ...obj,
          parentId: newFolder.id,
          order: nextOrder,
          folderId: undefined,
        };
      });

      updateScene(selectedSceneId, {
        objectFolders: [...folders, newFolder],
        objects: nextObjects,
      });
    });
  };

  const handleAddScene = () => {
    if (!project) return;
    runInHistoryTransaction('sprite-shelf:add-scene', () => {
      const newName = `Scene ${project.scenes.length + 1}`;
      addScene(newName);
      const nextScene = useProjectStore.getState().project?.scenes.at(-1);
      if (nextScene) {
        selectScene(nextScene.id);
      }
    });
  };

  const handleSceneDrop = (targetSceneId: string) => {
    if (!project || !draggedSceneId) return;

    const sourceIndex = project.scenes.findIndex((scene) => scene.id === draggedSceneId);
    const targetIndex = project.scenes.findIndex((scene) => scene.id === targetSceneId);
    if (sourceIndex === -1 || targetIndex === -1) {
      setDraggedSceneId(null);
      setSceneDropTarget(null);
      return;
    }

    const dropPosition = sceneDropTarget?.sceneId === targetSceneId ? sceneDropTarget.position : 'after';
    let insertIndex = targetIndex + (dropPosition === 'after' ? 1 : 0);
    if (sourceIndex < insertIndex) {
      insertIndex -= 1;
    }

    if (sourceIndex !== insertIndex) {
      const nextSceneIds = project.scenes.map((scene) => scene.id);
      const [movedSceneId] = nextSceneIds.splice(sourceIndex, 1);
      nextSceneIds.splice(insertIndex, 0, movedSceneId);
      reorderScenes(nextSceneIds);
    }

    setDraggedSceneId(null);
    setSceneDropTarget(null);
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
    if (selectedIdsInScene.length > 1 && selectedIdsInScene.includes(contextMenu.object.id)) {
      return selectedIdsInScene;
    }
    return [contextMenu.object.id];
  };

  const handleMoveObjectToFolder = (folderId: string | null) => {
    const objectIds = getContextMenuObjectActionIds();
    if (objectIds.length === 0) return;

    const movingIdSet = new Set(objectIds);
    const orderedMovingIds = orderedSceneObjectIds.filter((id) => movingIdSet.has(id));
    const baseOrder = getNextSiblingOrder(selectedScene, folderId);
    const nextOrderById = new Map(
      orderedMovingIds.map((id, index) => [id, baseOrder + index]),
    );

    updateScene(selectedSceneId, {
      objects: selectedScene.objects.map((obj) => {
        const nextOrder = nextOrderById.get(obj.id);
        if (nextOrder === undefined) {
          return obj;
        }
        return {
          ...obj,
          parentId: folderId,
          order: nextOrder,
          folderId: undefined,
        };
      }),
    });

    handleCloseContextMenu();
  };

  const handleDuplicate = () => {
    if (!contextMenu || contextMenu.kind !== 'object') return;
    duplicateSceneObjectsWithHistory({
      source: 'sprite-shelf:duplicate-object',
      sceneId: selectedSceneId,
      objectIds: getContextMenuObjectActionIds(),
      duplicateObject,
      selectObjects,
    });
    handleCloseContextMenu();
  };

  const handleCopy = () => {
    if (!contextMenu || contextMenu.kind !== 'object' || !project) return;
    copySceneObjectsToClipboard(project, selectedSceneId, getContextMenuObjectActionIds());
    handleCloseContextMenu();
  };

  const handlePaste = () => {
    if (!project) return;
    pasteSceneObjectClipboardWithHistory({
      source: 'sprite-shelf:paste-object',
      project,
      sceneId: selectedSceneId,
      addObject,
      updateObject,
      selectObjects,
    });
    handleCloseContextMenu();
  };

  const handleCut = () => {
    if (!contextMenu || contextMenu.kind !== 'object' || !project) return;

    cutSceneObjectsWithHistory({
      source: 'sprite-shelf:cut-object',
      project,
      sceneId: selectedSceneId,
      deleteIds: getContextMenuObjectActionIds(),
      orderedSceneObjectIds,
      selectedObjectId,
      selectedObjectIds: selectedIdsInScene,
      removeObject,
      selectObject,
      selectObjects,
    });

    handleCloseContextMenu();
  };

  const handleDelete = () => {
    if (!contextMenu || contextMenu.kind !== 'object') return;

    const deleteIds = selectedIdsInScene.length > 1 && selectedIdsInScene.includes(contextMenu.object.id)
      ? selectedIdsInScene
      : [contextMenu.object.id];

    deleteSceneObjectsWithHistory({
      source: 'sprite-shelf:delete-object',
      sceneId: selectedSceneId,
      deleteIds,
      orderedSceneObjectIds,
      selectedObjectId,
      selectedObjectIds: selectedIdsInScene,
      removeObject,
      selectObject,
      selectObjects,
    });

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

  const handleStartSceneEdit = (sceneId: string, currentName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    flushSync(() => {
      setEditingSceneId(sceneId);
      setEditName(currentName);
      setSceneEditError(null);
    });
    stabilizeInlineRenameFocus(sceneInputRef.current);
  };

  const handleSaveSceneRename = () => {
    if (cancelSceneRenameOnBlurRef.current) {
      cancelSceneRenameOnBlurRef.current = false;
      return;
    }

    if (!editingSceneId) return;

    const nextName = editName.trim();
    if (!nextName) {
      setSceneEditError('Scene name is required.');
      return;
    }

    const normalizedNextName = nextName.toLowerCase();
    const duplicateExists = !!project?.scenes.some(
      (scene) => scene.id !== editingSceneId && scene.name.trim().toLowerCase() === normalizedNextName,
    );
    if (duplicateExists) {
      setSceneEditError('Scene name must be unique.');
      return;
    }

    updateScene(editingSceneId, { name: nextName });
    setEditingSceneId(null);
    setEditName('');
    setSceneEditError(null);
  };

  const handleSceneRenameBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    const pointerTarget = sceneRenamePointerDownTargetRef.current;
    sceneRenamePointerDownTargetRef.current = null;

    const clickedOutside = pointerTarget instanceof Node && pointerTarget !== event.currentTarget;
    if (!clickedOutside) {
      queueMicrotask(() => {
        stabilizeInlineRenameFocus(sceneInputRef.current);
      });
      return;
    }

    handleSaveSceneRename();
  };

  const handleCloseSceneContextMenu = () => {
    setSceneContextMenu(null);
    setSceneContextMenuPosition(null);
  };

  const preventSceneMenuHoverFocus = editingSceneId
    ? (event: React.PointerEvent) => {
      event.preventDefault();
    }
    : undefined;

  const handleDeleteScene = (sceneId: string) => {
    if (!project || project.scenes.length <= 1) return;

    runInHistoryTransaction('sprite-shelf:delete-scene', () => {
      removeScene(sceneId);
      clearSceneUiState(sceneId);

      if (selectedSceneId === sceneId) {
        const remainingScenes = useProjectStore.getState().project?.scenes ?? [];
        selectScene(remainingScenes[0]?.id ?? null);
      }
    });
  };

  const handleRequestDeleteScene = (sceneId: string) => {
    if (!project || project.scenes.length <= 1) return;
    const scene = project.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) return;
    setSceneDeleteTarget({ id: scene.id, name: scene.name });
  };

  const handleCancelDeleteScene = () => {
    setSceneDeleteTarget(null);
  };

  const handleConfirmDeleteScene = () => {
    if (!sceneDeleteTarget) return;
    handleDeleteScene(sceneDeleteTarget.id);
    setSceneDeleteTarget(null);
  };

  const handleMakeComponent = () => {
    if (!contextMenu || contextMenu.kind !== 'object' || !project) return;

    const requestedName = contextMenu.object.name.trim();
    const normalizedRequestedName = requestedName.toLowerCase();
    const hasDuplicateName = (project.components || []).some(
      (component) => component.name.trim().toLowerCase() === normalizedRequestedName
    );
    if (hasDuplicateName) {
      window.alert(`A component named "${requestedName}" already exists. Rename the object first.`);
      return;
    }

    const created = makeComponent(selectedSceneId, contextMenu.object.id);
    if (!created) {
      window.alert('Could not create component. Check that the name is unique.');
      return;
    }

    handleCloseContextMenu();
  };

  const handleDetachFromComponent = () => {
    if (!contextMenu || contextMenu.kind !== 'object') return;
    detachFromComponent(selectedSceneId, contextMenu.object.id);
    handleCloseContextMenu();
  };

  const handleDeleteComponentById = (componentId: string) => {
    if (!project) return;
    if (!componentId) return;

    const component = (project.components || []).find((item) => item.id === componentId);
    const componentName = component?.name || 'Component';
    const instanceCount = project.scenes.reduce((count, scene) => {
      return count + scene.objects.filter((obj) => obj.componentId === componentId).length;
    }, 0);

    const confirmed = window.confirm(
      `Delete component "${componentName}"?\n\n` +
      `This will detach ${instanceCount} instance${instanceCount === 1 ? '' : 's'} and keep them as standalone objects.`
    );
    if (!confirmed) return;

    deleteComponentWithHistory({
      source: 'sprite-shelf:delete-component',
      componentId,
      selectedComponentId,
      deleteComponent,
      selectComponent,
    });
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

  const handleComponentLibrarySelect = (componentId: string) => {
    addComponentInstanceWithHistory({
      source: 'sprite-shelf:add-component-instance',
      sceneId: selectedSceneId,
      componentId,
      addComponentInstance,
      selectObject,
    });
  };

  const handleComponentLibraryDelete = (componentId: string) => {
    handleDeleteComponentById(componentId);
  };

  const handleComponentLibraryEditCode = (componentId: string) => {
    if (!project) return;

    let sceneId = selectedSceneId;
    if (!sceneId) {
      sceneId = project.scenes[0]?.id ?? null;
    }
    if (!sceneId) return;

    if (sceneId !== selectedSceneId) {
      selectScene(sceneId);
    }

    setActiveObjectTab('code');
    selectObjects([], null);
    selectComponent(componentId);
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
    const rowHighlightClass = isSelected
      ? selectionSurfaceClassNames.selected
      : isDropOn
        ? selectionSurfaceClassNames.dropTarget
        : '';
    const rowShapeClass = isSelected || isDropOn
      ? connectsToPrevious
        ? connectsToNext
          ? 'rounded-none'
          : 'rounded-t-none rounded-b-lg'
        : connectsToNext
          ? 'rounded-t-lg rounded-b-none'
          : 'rounded-lg'
      : 'rounded-lg';
    const rowPaddingClass = 'px-1 pt-1';
    const rowContentPaddingClass = 'py-1';
    const indentDepth = Math.max(0, level - 1);
    const rowHoverClass = selectionSurfaceClassNames.hover;

    return (
      <div
        key={options?.rowKey ?? item.key}
        className={`relative w-full min-w-0 max-w-full ${isInlineEditing ? 'overflow-visible' : 'overflow-hidden'}`}
      >
        {isDropBefore ? (
          <div className="pointer-events-none absolute inset-x-2 top-0 z-10 h-0 border-t-2 border-primary" />
        ) : null}
        <div
          data-sprite-shelf-row="true"
          className={`group/layer-row w-full min-w-0 max-w-full ${isInlineEditing ? 'overflow-visible' : 'overflow-hidden'} ${rowPaddingClass} select-none ${
            isObjectEditing || isFolderEditing ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
          }`}
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
        >
          <div className={`relative w-full min-w-0 max-w-full ${isInlineEditing ? 'overflow-visible' : 'overflow-hidden'}`}>
            {!isSelected && !isDropOn ? (
              <div
                className={`pointer-events-none absolute inset-0 z-0 rounded-lg opacity-0 transition-opacity group-hover/layer-row:opacity-100 ${rowHoverClass}`}
              />
            ) : null}
            {(isSelected || isDropOn) ? (
              <div
                className={`pointer-events-none absolute inset-0 z-0 ${rowShapeClass} ${rowHighlightClass}`}
              />
            ) : null}
            {isSelected && connectsToNext ? (
              <div
                className={`pointer-events-none absolute inset-x-0 top-full z-0 h-2 ${rowHighlightClass}`}
              />
            ) : null}
            <div className={`relative z-10 flex w-full min-w-0 max-w-full items-stretch rounded-lg ${rowContentPaddingClass} transition-colors`}>
            {indentDepth > 0 ? (
              <div aria-hidden="true" className="flex self-center shrink-0">
                {Array.from({ length: indentDepth }).map((_, index) => (
                  <span key={`${item.key}-indent-${index}`} className="block w-4 shrink-0" />
                ))}
              </div>
            ) : null}
            <button
              type="button"
              disabled={!hasChildItems}
              aria-label={hasChildItems ? `Toggle ${item.name}` : undefined}
              className={`-mx-1 self-stretch shrink-0 rounded px-1 flex items-center justify-center transition-opacity disabled:pointer-events-none ${
                isShelfHovered ? 'opacity-100' : 'opacity-0'
              }`}
              onClick={interactive ? ((e) => {
                e.stopPropagation();
                if (folder) {
                  handleToggleFolder(folder.id);
                }
              }) : undefined}
            >
              {hasChildItems ? (
                isExpanded ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />
              ) : (
                <span className="block h-2.5 w-2.5" />
              )}
            </button>

            {item.type === 'folder' ? (
              <div className="relative flex h-6 w-6 self-center shrink-0 items-center justify-center rounded-md">
                {isExpanded ? <FolderOpen className="size-[1.125rem] shrink-0" /> : <Folder className="size-[1.125rem] shrink-0" />}
              </div>
            ) : (
              <div
                className="relative flex h-6 w-6 self-center shrink-0 items-center justify-center overflow-hidden rounded-md"
              >
                {effectiveProps && effectiveProps.costumes.length > 0 ? (() => {
                  const costume = effectiveProps.costumes[effectiveProps.currentCostumeIndex];
                  const bounds = costume?.bounds;
                  if (bounds && bounds.width > 0 && bounds.height > 0) {
                    const scale = Math.min(1, 24 / Math.max(bounds.width, bounds.height));
                    const localBounds = getCostumeBoundsInAssetSpace(bounds, costume?.assetFrame);
                    return (
                      <div
                        className="absolute"
                        style={{
                          backgroundImage: `url(${costume.assetId})`,
                          backgroundPosition: localBounds ? `${-localBounds.x}px ${-localBounds.y}px` : '0 0',
                          backgroundSize: costume?.assetFrame
                            ? `${costume.assetFrame.width}px ${costume.assetFrame.height}px`
                            : '1024px 1024px',
                          backgroundRepeat: 'no-repeat',
                          transform: `scale(${scale})`,
                          transformOrigin: 'top left',
                          width: bounds.width,
                          height: bounds.height,
                          left: '50%',
                          top: '50%',
                          marginLeft: (-bounds.width * scale) / 2,
                          marginTop: (-bounds.height * scale) / 2,
                        }}
                      />
                    );
                  }
                  return (
                    <img
                      src={costume?.assetId}
                      alt={object?.name ?? 'Object'}
                      className="w-full h-full object-contain"
                    />
                  );
                })() : (
                  <span className="text-sm">📦</span>
                )}
              </div>
            )}

            <div className={`ml-1.5 flex flex-1 min-w-0 max-w-full items-center pr-[3px] ${isInlineEditing ? 'overflow-visible' : 'overflow-hidden'}`}>
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
                textClassName={`text-xs leading-5 ${isComponentInstance ? 'text-purple-700 dark:text-purple-300' : 'text-foreground'}`}
                autoFocus={isInlineEditing}
                focusBehavior="caret-end"
                displayAs="div"
                displayProps={{
                  className: `flex w-full min-w-0 items-center gap-1 ${isInlineEditing ? 'overflow-visible' : 'overflow-hidden'}`,
                  title: item.name,
                }}
                displayValue={
                  <>
                    <span className="block min-w-0 flex-1 truncate">{item.name}</span>
                    {isComponentInstance && <Component className="size-3 shrink-0 opacity-60" />}
                  </>
                }
              />
            </div>
            </div>
          </div>
        </div>
        {isDropAfter ? (
          <div className="pointer-events-none absolute inset-x-2 bottom-0 z-10 h-0 border-t-2 border-primary" />
        ) : null}
      </div>
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
      className="h-full flex flex-col bg-card"
      onPointerEnter={() => setIsShelfHovered(true)}
      onPointerLeave={() => setIsShelfHovered(false)}
    >
      <div className={`${panelHeaderClassNames.chrome} ${panelHeaderClassNames.splitRow}`}>
        <DropdownMenu open={sceneDropdownOpen} onOpenChange={setSceneDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex h-6 min-w-0 items-center gap-1 text-xs font-medium transition-colors hover:text-primary"
            >
              {selectedScene.name}
              <ChevronRight className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className={`min-w-48 ${sceneContextMenu ? 'pointer-events-none' : ''}`}
          >
            {project?.scenes.map((scene) => (
              editingSceneId === scene.id ? (
                <div
                  key={scene.id}
                  className={`flex items-center gap-2 rounded-sm px-2 py-1.5 ${
                    scene.id === selectedSceneId ? selectionSurfaceClassNames.selected : ''
                  }`}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <GripVertical className="size-3 shrink-0 text-muted-foreground/70" />
                  <InlineRenameField
                    ref={sceneInputRef}
                    value={editName}
                    onChange={(e) => {
                      setEditName(e.target.value);
                      setSceneEditError(null);
                    }}
                    onBlur={handleSceneRenameBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveSceneRename();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelSceneRenameOnBlurRef.current = true;
                        setEditingSceneId(null);
                        setEditName('');
                        setSceneEditError(null);
                      }
                    }}
                    data-hotkeys="ignore"
                    onClick={(e) => e.stopPropagation()}
                    invalid={!!sceneEditError}
                    className="flex-1 min-w-0"
                    textClassName="text-sm leading-5 text-foreground"
                    autoFocus
                    focusBehavior="caret-end"
                  />
                  <div className="h-6 w-6 shrink-0 opacity-0" aria-hidden="true" />
                </div>
              ) : (
                <DropdownMenuItem
                  key={scene.id}
                  draggable
                  onPointerMoveCapture={preventSceneMenuHoverFocus}
                  onClick={() => selectScene(scene.id)}
                  onDragStart={(e) => {
                    setDraggedSceneId(scene.id);
                    setSceneDropTarget(null);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', scene.id);
                  }}
                  onDragEnd={() => {
                    setDraggedSceneId(null);
                    setSceneDropTarget(null);
                  }}
                  onDragOver={(e) => {
                    if (!draggedSceneId || draggedSceneId === scene.id) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                    setSceneDropTarget({ sceneId: scene.id, position });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleSceneDrop(scene.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSceneContextMenuPosition({ left: e.clientX, top: e.clientY });
                    setSceneContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      sceneId: scene.id,
                    });
                  }}
                  className={`group flex items-center justify-between ${
                    scene.id === selectedSceneId ? selectionSurfaceClassNames.selected : ''
                  } ${
                    sceneDropTarget?.sceneId === scene.id && sceneDropTarget.position === 'before'
                      ? 'border-t-2 border-primary'
                      : ''
                  } ${
                    sceneDropTarget?.sceneId === scene.id && sceneDropTarget.position === 'after'
                      ? 'border-b-2 border-primary'
                      : ''
                  } ${selectionSurfaceClassNames.hoverFocus}`}
                >
                  <GripVertical className="size-3 text-muted-foreground/70" />
                  <span className="flex-1">{scene.name}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => handleStartSceneEdit(scene.id, scene.name, e)}
                    className={`h-6 w-6 transition-opacity ${isShelfHovered ? 'opacity-100' : 'opacity-0'}`}
                  >
                    <Pencil className="size-3" />
                  </Button>
                </DropdownMenuItem>
              )
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onPointerMoveCapture={preventSceneMenuHoverFocus} onClick={handleAddScene}>
              <Plus className="size-4 mr-2" />
              New Scene
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-1">
          <Button size="icon-xs" variant="ghost" onClick={handleAddObject} title="Add Object">
            <Plus className="size-4" />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={() => handleAddFolder(null)} title="Add Folder">
            <FolderPlus className="size-4" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setShowComponentLibrary(true)}
            title="Component Library"
          >
            <Component className="size-4" />
          </Button>
        </div>
      </div>

      <div
        ref={shortcutSurfaceRef}
        data-editor-shortcut-surface="scene-objects"
        tabIndex={0}
        className="flex-1 min-h-0 min-w-0 w-full overflow-x-hidden outline-none"
        onPointerDownCapture={handleShortcutSurfacePointerDownCapture}
      >
        <ScrollArea
          className="flex-1 min-w-0 w-full overflow-hidden"
          onDragOver={handleRootDragOver}
          onDrop={handleRootDrop}
          onClick={handleEmptyShelfClick}
          data-testid="sprite-shelf-scroll-area"
        >
          <div className="min-h-full w-0 min-w-full">
            {selectedScene.objects.length === 0 && folders.length === 0 ? (
              <div className="flex h-full items-center justify-center p-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto rounded-full px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                  onClick={handleEmptyShelfCreateObjectClick}
                >
                  + Create an object
                </Button>
              </div>
            ) : (
              <div
                role="tree"
                aria-label="Scene hierarchy"
                className="relative min-h-full w-0 min-w-full overflow-x-hidden outline-none"
                onClick={handleEmptyShelfClick}
              >
                {treeItems.map((item) => renderTreeItem(item))}
                <div
                  className="absolute inset-x-2 -bottom-2 z-10 h-4 rounded"
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
          <div className="fixed inset-0 z-40" onClick={handleCloseContextMenu} />
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
                <Button variant="ghost" size="sm" onClick={handleCopy} className="w-full justify-start rounded-none h-8">
                  <Copy className="size-4" />
                  Copy
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCut} className="w-full justify-start rounded-none h-8">
                  <Copy className="size-4" />
                  Cut
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePaste}
                  disabled={!hasSceneObjectClipboardContents()}
                  className="w-full justify-start rounded-none h-8"
                >
                  <Clipboard className="size-4" />
                  Paste
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDuplicate} className="w-full justify-start rounded-none h-8">
                  <Copy className="size-4" />
                  Duplicate
                </Button>
                <DropdownMenuSeparator />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!contextMenu || contextMenu.kind !== 'object') return;
                    handleAddFolder(null, getContextMenuObjectActionIds());
                    handleCloseContextMenu();
                  }}
                  className="w-full justify-start rounded-none h-8"
                >
                  <FolderPlus className="size-4" />
                  New Folder with Object
                </Button>
                {folders.map((folder) => (
                  <Button
                    key={folder.id}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleMoveObjectToFolder(folder.id)}
                    className="w-full justify-start rounded-none h-8"
                  >
                    <Folder className="size-4" />
                    Move to {folder.name}
                  </Button>
                ))}
                {!contextMenu.object.componentId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleMakeComponent}
                    className="w-full justify-start rounded-none h-8 text-purple-600"
                  >
                    <Component className="size-4" />
                    Make Component
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDetachFromComponent}
                      className="w-full justify-start rounded-none h-8"
                    >
                      <Unlink className="size-4" />
                      Detach from Component
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  className="w-full justify-start rounded-none h-8 text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  {deleteLabel}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    handleStartFolderEdit(contextMenu.folder);
                    handleCloseContextMenu();
                  }}
                  className="w-full justify-start rounded-none h-8"
                >
                  <Pencil className="size-4" />
                  Rename Folder
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    handleRequestDeleteFolder(contextMenu.folder);
                    handleCloseContextMenu();
                  }}
                  className="w-full justify-start rounded-none h-8 text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  Delete Folder
                </Button>
              </>
            )}
          </Card>
        </>
      )}

      {sceneContextMenu && (
        <>
          <div className="fixed inset-0 z-[9999]" onClick={handleCloseSceneContextMenu} />
          <Card
            ref={sceneContextMenuRef}
            className="fixed z-[10000] py-1 min-w-40 gap-0 pointer-events-auto"
            style={{
              left: sceneContextMenuPosition?.left ?? sceneContextMenu.x,
              top: sceneContextMenuPosition?.top ?? sceneContextMenu.y,
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                handleRequestDeleteScene(sceneContextMenu.sceneId);
                handleCloseSceneContextMenu();
              }}
              className="w-full justify-start rounded-none h-8 text-destructive hover:text-destructive"
              disabled={!project || project.scenes.length <= 1}
            >
              <Trash2 className="size-4" />
              Delete Scene
            </Button>
          </Card>
        </>
      )}

      <ObjectLibraryBrowser
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelect={handleLibrarySelect}
      />
      <ComponentLibraryBrowser
        open={showComponentLibrary}
        onOpenChange={setShowComponentLibrary}
        onSelect={handleComponentLibrarySelect}
        onDelete={handleComponentLibraryDelete}
        onEditCode={handleComponentLibraryEditCode}
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

      <Dialog open={!!sceneDeleteTarget} onOpenChange={(open) => !open && handleCancelDeleteScene()}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Scene</DialogTitle>
            <DialogDescription>
              Are you sure? everything inside the scene will be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelDeleteScene}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteScene}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
