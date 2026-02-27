import { useState, useRef, useLayoutEffect } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { ObjectLibraryBrowser } from '../dialogs/ObjectLibraryBrowser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Tree,
  TreeItem,
  TreeItemContent,
  Collection,
  useDragAndDrop,
  Button as AriaButton,
  DropIndicator,
  type Selection,
  type Key,
} from 'react-aria-components';
import {
  Plus,
  Library,
  Pencil,
  Copy,
  Clipboard,
  Trash2,
  ChevronRight,
  ChevronDown,
  Component,
  Unlink,
  Loader2,
  Folder,
  FolderOpen,
  FolderPlus,
} from 'lucide-react';
import type { GameObject, Costume, Sound, PhysicsConfig, ColliderConfig, SceneFolder } from '@/types';
import { getEffectiveObjectProps } from '@/types';
import { uploadDataUrlToStorage, generateThumbnail } from '@/utils/convexHelpers';
import {
  getFolderNodeKey,
  getNextSiblingOrder,
  getObjectNodeKey,
  getSceneObjectsInLayerOrder,
  getSceneTree,
  moveSceneLayerNodes,
  parseLayerNodeKey,
  type LayerTreeNode,
} from '@/utils/layerTree';

// Global clipboard for cross-scene object copying
let objectClipboard: {
  name: string;
  costumes: Costume[];
  sounds: Sound[];
  blocklyXml: string;
  physics: PhysicsConfig | null;
  collider: ColliderConfig | null;
  localVariables: GameObject['localVariables'];
} | null = null;

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

function selectionToSet(selection: Selection): Set<Key> {
  if (selection === 'all') {
    return new Set<Key>();
  }
  return new Set(selection);
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
    makeComponent,
    detachFromComponent,
  } = useProjectStore();
  const {
    selectedSceneId,
    selectedObjectId,
    selectedObjectIds,
    selectObject,
    selectObjects,
    selectScene,
    collapsedFolderIdsByScene,
    setCollapsedFoldersForScene,
  } = useEditorStore();

  const [contextMenu, setContextMenu] = useState<
    | { x: number; y: number; kind: 'object'; object: GameObject }
    | { x: number; y: number; kind: 'folder'; folder: SceneFolder }
    | null
  >(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [folderEditName, setFolderEditName] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<SceneFolder | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const sceneInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const suppressNextAriaSelectionRef = useRef(false);
  const selectionAnchorObjectIdRef = useRef<string | null>(null);

  const generateUploadUrl = useMutation(api.objectLibrary.generateUploadUrl);
  const createLibraryItem = useMutation(api.objectLibrary.create);

  const selectedScene = project?.scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const folders = selectedScene?.objectFolders ?? [];

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

  const { dragAndDropHooks } = useDragAndDrop<ShelfTreeItem>({
    getItems(keys) {
      return Array.from(keys).map((key) => ({
        'text/plain': String(key),
      }));
    },
    getDropOperation() {
      return 'move';
    },
    shouldAcceptItemDrop(target) {
      const parsed = parseLayerNodeKey(String(target.key));
      return parsed?.type === 'folder';
    },
    renderDropIndicator(target) {
      return (
        <DropIndicator
          target={target}
          className={({ isDropTarget }) =>
            `mx-2 my-0.5 h-0 border-t-2 rounded border-primary/80 ${
              isDropTarget ? 'opacity-100' : 'opacity-50'
            }`
          }
        />
      );
    },
    onMove(event) {
      if (!selectedScene || !selectedSceneId) {
        return;
      }

      const movedKeys = Array.from(event.keys).map((key) => String(key));
      const targetKey = String(event.target.key);
      const dropPosition = event.target.dropPosition;

      const nextScene = moveSceneLayerNodes(
        selectedScene,
        movedKeys,
        {
          key: targetKey,
          dropPosition,
        },
      );

      updateScene(selectedSceneId, nextScene);
    },
  });

  if (!selectedScene || !selectedSceneId) return null;

  const layerTree = getSceneTree(selectedScene);
  const treeItems = toShelfTreeItems(layerTree);
  const orderedSceneObjectIds = getSceneObjectsInLayerOrder(selectedScene).map((obj) => obj.id);
  const sceneObjectIdSet = new Set(selectedScene.objects.map((obj) => obj.id));

  const selectedIdsInScene = selectedObjectIds.filter((id) => sceneObjectIdSet.has(id));
  const selectedTreeKeys = new Set<Key>(selectedIdsInScene.map((id) => getObjectNodeKey(id)));

  const collapsedFolderIds = new Set(collapsedFolderIdsByScene[selectedSceneId] ?? []);
  const expandedKeys = new Set<Key>(
    folders
      .filter((folder) => !collapsedFolderIds.has(folder.id))
      .map((folder) => getFolderNodeKey(folder.id)),
  );

  const handleExpandedChange = (nextExpandedSelection: Selection) => {
    const nextExpanded = selectionToSet(nextExpandedSelection);
    const nextCollapsed = folders
      .filter((folder) => !nextExpanded.has(getFolderNodeKey(folder.id)))
      .map((folder) => folder.id);
    setCollapsedFoldersForScene(selectedSceneId, nextCollapsed);
  };

  const handleSelectionChange = (selection: Selection) => {
    if (suppressNextAriaSelectionRef.current) {
      suppressNextAriaSelectionRef.current = false;
      return;
    }

    const nextKeys = selectionToSet(selection);
    const nextObjectIds = Array.from(nextKeys)
      .map((key) => parseLayerNodeKey(String(key)))
      .filter((entry): entry is { type: 'object'; id: string } => !!entry && entry.type === 'object')
      .map((entry) => entry.id)
      .filter((id) => sceneObjectIdSet.has(id))
      .sort((a, b) => orderedSceneObjectIds.indexOf(a) - orderedSceneObjectIds.indexOf(b));

    if (nextObjectIds.length === 0) {
      if (nextKeys.size > 0) {
        return;
      }
      selectObject(null);
      return;
    }

    const nextPrimary = selectedObjectId && nextObjectIds.includes(selectedObjectId)
      ? selectedObjectId
      : nextObjectIds[0];
    selectionAnchorObjectIdRef.current = nextPrimary;
    selectObjects(nextObjectIds, nextPrimary);
  };

  const handleObjectRowClick = (e: React.MouseEvent, objectId: string) => {
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();
    suppressNextAriaSelectionRef.current = true;

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

  const handleAddObject = () => {
    const newName = `Object ${selectedScene.objects.length + 1}`;
    const newObject = addObject(selectedSceneId, newName);
    selectObject(newObject.id);
  };

  const handleAddFolder = (parentId: string | null = null, assignObjectId?: string) => {
    const newFolder: SceneFolder = {
      id: crypto.randomUUID(),
      name: `Folder ${folders.length + 1}`,
      parentId,
      order: getNextSiblingOrder(selectedScene, parentId),
    };
    updateScene(selectedSceneId, { objectFolders: [...folders, newFolder] });

    if (assignObjectId) {
      updateObject(selectedSceneId, assignObjectId, {
        parentId: newFolder.id,
        order: getNextSiblingOrder(selectedScene, newFolder.id),
        folderId: undefined,
      });
    }
  };

  const handleAddScene = () => {
    if (!project) return;
    const newName = `Scene ${project.scenes.length + 1}`;
    addScene(newName);
    setTimeout(() => {
      const nextScene = useProjectStore.getState().project?.scenes.at(-1);
      if (nextScene) {
        selectScene(nextScene.id);
      }
    }, 0);
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

  const handleMoveObjectToFolder = (folderId: string | null) => {
    if (!contextMenu || contextMenu.kind !== 'object') return;
    updateObject(selectedSceneId, contextMenu.object.id, {
      parentId: folderId,
      order: getNextSiblingOrder(selectedScene, folderId),
      folderId: undefined,
    });
    handleCloseContextMenu();
  };

  const handleDuplicate = () => {
    if (!contextMenu || contextMenu.kind !== 'object') return;
    const duplicated = duplicateObject(selectedSceneId, contextMenu.object.id);
    if (duplicated) {
      selectObject(duplicated.id);
    }
    handleCloseContextMenu();
  };

  const handleCopy = () => {
    if (!contextMenu || contextMenu.kind !== 'object' || !project) return;
    const object = contextMenu.object;
    const effectiveProps = getEffectiveObjectProps(object, project.components || []);

    objectClipboard = {
      name: object.name,
      costumes: JSON.parse(JSON.stringify(effectiveProps.costumes)),
      sounds: JSON.parse(JSON.stringify(effectiveProps.sounds)),
      blocklyXml: effectiveProps.blocklyXml,
      physics: effectiveProps.physics ? JSON.parse(JSON.stringify(effectiveProps.physics)) : null,
      collider: effectiveProps.collider ? JSON.parse(JSON.stringify(effectiveProps.collider)) : null,
      localVariables: object.localVariables ? JSON.parse(JSON.stringify(object.localVariables)) : [],
    };
    handleCloseContextMenu();
  };

  const handlePaste = () => {
    if (!objectClipboard) return;

    const newObject = addObject(selectedSceneId, `${objectClipboard.name} (copy)`);

    const newCostumes = objectClipboard.costumes.map((costume) => ({
      ...costume,
      id: crypto.randomUUID(),
    }));
    const newSounds = objectClipboard.sounds.map((sound) => ({
      ...sound,
      id: crypto.randomUUID(),
    }));
    const newLocalVariables = (objectClipboard.localVariables || []).map((variable) => ({
      ...variable,
      id: crypto.randomUUID(),
    }));

    updateObject(selectedSceneId, newObject.id, {
      costumes: newCostumes,
      sounds: newSounds,
      blocklyXml: objectClipboard.blocklyXml,
      physics: objectClipboard.physics,
      collider: objectClipboard.collider,
      localVariables: newLocalVariables,
      currentCostumeIndex: 0,
    });

    selectObject(newObject.id);
    handleCloseContextMenu();
  };

  const handleDelete = () => {
    if (!contextMenu || contextMenu.kind !== 'object') return;

    const deleteIds = selectedIdsInScene.length > 1 && selectedIdsInScene.includes(contextMenu.object.id)
      ? selectedIdsInScene
      : [contextMenu.object.id];

    const deleteSet = new Set(deleteIds);
    deleteIds.forEach((id) => removeObject(selectedSceneId, id));

    const remainingSelectedIds = selectedIdsInScene.filter((id) => !deleteSet.has(id));
    if (remainingSelectedIds.length > 0) {
      const nextPrimary = selectedObjectId && remainingSelectedIds.includes(selectedObjectId)
        ? selectedObjectId
        : remainingSelectedIds[0];
      selectObjects(remainingSelectedIds, nextPrimary);
    } else {
      const remainingSceneIds = orderedSceneObjectIds.filter((id) => !deleteSet.has(id));
      selectObject(remainingSceneIds[0] ?? null);
    }

    handleCloseContextMenu();
  };

  const handleStartFolderEdit = (folder: SceneFolder) => {
    setEditingFolderId(folder.id);
    setFolderEditName(folder.name);
    setTimeout(() => folderInputRef.current?.focus(), 0);
  };

  const handleSaveFolderRename = () => {
    if (!editingFolderId || !folderEditName.trim()) {
      setEditingFolderId(null);
      setFolderEditName('');
      return;
    }
    const nextFolders = folders.map((folder) =>
      folder.id === editingFolderId ? { ...folder, name: folderEditName.trim() } : folder,
    );
    updateScene(selectedSceneId, { objectFolders: nextFolders });
    setEditingFolderId(null);
    setFolderEditName('');
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
  };

  const handleRequestDeleteFolder = (folder: SceneFolder) => {
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
    setEditingObjectId(objectId);
    setEditName(currentName);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSaveObjectRename = () => {
    if (editingObjectId && editName.trim()) {
      updateObject(selectedSceneId, editingObjectId, { name: editName.trim() });
    }
    setEditingObjectId(null);
    setEditName('');
  };

  const handleStartSceneEdit = (sceneId: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSceneId(sceneId);
    setEditName(currentName);
    setTimeout(() => sceneInputRef.current?.focus(), 0);
  };

  const handleSaveSceneRename = () => {
    if (editingSceneId && editName.trim()) {
      updateScene(editingSceneId, { name: editName.trim() });
    }
    setEditingSceneId(null);
    setEditName('');
  };

  const handleSaveToLibrary = async () => {
    if (!contextMenu || contextMenu.kind !== 'object' || !project) return;

    const object = contextMenu.object;
    const effectiveProps = getEffectiveObjectProps(object, project.components || []);

    handleCloseContextMenu();
    setSavingToLibrary(true);

    try {
      const costumes: Array<{
        id: string;
        name: string;
        storageId: Id<'_storage'>;
        bounds?: { x: number; y: number; width: number; height: number };
      }> = [];

      for (const costume of effectiveProps.costumes) {
        const { storageId } = await uploadDataUrlToStorage(costume.assetId, generateUploadUrl);
        costumes.push({
          id: costume.id,
          name: costume.name,
          storageId: storageId as Id<'_storage'>,
          bounds: costume.bounds,
        });
      }

      const sounds: Array<{
        id: string;
        name: string;
        storageId: Id<'_storage'>;
      }> = [];

      for (const sound of effectiveProps.sounds) {
        const { storageId } = await uploadDataUrlToStorage(sound.assetId, generateUploadUrl);
        sounds.push({
          id: sound.id,
          name: sound.name,
          storageId: storageId as Id<'_storage'>,
        });
      }

      let thumbnail = '';
      if (effectiveProps.costumes.length > 0) {
        thumbnail = await generateThumbnail(effectiveProps.costumes[0].assetId, 128);
      }

      await createLibraryItem({
        name: object.name,
        thumbnail,
        costumes,
        sounds,
        blocklyXml: effectiveProps.blocklyXml,
        physics: effectiveProps.physics ?? undefined,
        collider: effectiveProps.collider ?? undefined,
      });
    } catch (error) {
      console.error('Failed to save object to library:', error);
      alert('Failed to save object to library');
    } finally {
      setSavingToLibrary(false);
    }
  };

  const handleMakeComponent = () => {
    if (!contextMenu || contextMenu.kind !== 'object') return;
    makeComponent(selectedSceneId, contextMenu.object.id);
    handleCloseContextMenu();
  };

  const handleDetachFromComponent = () => {
    if (!contextMenu || contextMenu.kind !== 'object') return;
    detachFromComponent(selectedSceneId, contextMenu.object.id);
    handleCloseContextMenu();
  };

  const handleLibrarySelect = (data: {
    name: string;
    costumes: Costume[];
    sounds: Sound[];
    blocklyXml: string;
    physics: PhysicsConfig | null;
    collider: ColliderConfig | null;
  }) => {
    const newObject = addObject(selectedSceneId, data.name);

    updateObject(selectedSceneId, newObject.id, {
      costumes: data.costumes,
      sounds: data.sounds,
      blocklyXml: data.blocklyXml,
      physics: data.physics,
      collider: data.collider,
      currentCostumeIndex: 0,
    });

    selectObject(newObject.id);
  };

  const willDeleteSelection = !!contextMenu
    && contextMenu.kind === 'object'
    && selectedIdsInScene.length > 1
    && selectedIdsInScene.includes(contextMenu.object.id);
  const deleteLabel = willDeleteSelection ? `Delete Selected (${selectedIdsInScene.length})` : 'Delete';

  const renderTreeItem = (item: ShelfTreeItem) => {
    const object = item.object;
    const folder = item.folder;
    const isObjectEditing = item.type === 'object' && editingObjectId === item.id;
    const isFolderEditing = item.type === 'folder' && editingFolderId === item.id;
    const isComponentInstance = !!object?.componentId;
    const effectiveProps = object ? getEffectiveObjectProps(object, project?.components || []) : null;

    return (
      <TreeItem key={item.key} id={item.key} textValue={item.name}>
        <TreeItemContent>
          {({ hasChildItems, isExpanded, isSelected, isDropTarget, level }) => (
            <div
              className={`flex items-center gap-1 px-2 py-1.5 border-b select-none ${
                isSelected
                  ? 'bg-primary/10 border-l-2 border-l-primary'
                  : isDropTarget
                    ? 'bg-primary/15 border-l-2 border-l-primary/60'
                    : 'border-l-2 border-l-transparent hover:bg-accent'
              }`}
              style={{ paddingLeft: `${8 + Math.max(0, level - 1) * 16}px` }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (item.type === 'object' && object) {
                  handleStartObjectEdit(object.id, object.name);
                } else if (item.type === 'folder' && folder) {
                  handleStartFolderEdit(folder);
                }
              }}
              onClick={(e) => {
                if (item.type === 'object' && object) {
                  handleObjectRowClick(e, object.id);
                }
              }}
              onContextMenu={(e) => {
                if (item.type === 'object' && object) {
                  handleObjectContextMenu(e, object);
                } else if (item.type === 'folder' && folder) {
                  handleFolderContextMenu(e, folder);
                }
              }}
            >
              <AriaButton
                slot="chevron"
                isDisabled={!hasChildItems}
                aria-label={hasChildItems ? `Toggle ${item.name}` : undefined}
                className="h-5 w-5 rounded hover:bg-accent flex items-center justify-center"
              >
                {hasChildItems ? (
                  isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />
                ) : (
                  <span className="size-3" />
                )}
              </AriaButton>

              <AriaButton
                slot="drag"
                className="sr-only"
                aria-label={`Drag ${item.name}`}
              />

              {item.type === 'folder' ? (
                isExpanded ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded flex items-center justify-center overflow-hidden shrink-0 bg-muted relative">
                  {effectiveProps && effectiveProps.costumes.length > 0 ? (() => {
                    const costume = effectiveProps.costumes[effectiveProps.currentCostumeIndex];
                    const bounds = costume?.bounds;
                    if (bounds && bounds.width > 0 && bounds.height > 0) {
                      const scale = Math.min(1, 32 / Math.max(bounds.width, bounds.height));
                      return (
                        <div
                          className="absolute"
                          style={{
                            backgroundImage: `url(${costume.assetId})`,
                            backgroundPosition: `${-bounds.x}px ${-bounds.y}px`,
                            backgroundSize: '1024px 1024px',
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

              {isObjectEditing ? (
                <Input
                  ref={inputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleSaveObjectRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') handleSaveObjectRename();
                  }}
                  className="flex-1 h-6 px-1 text-xs"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ) : isFolderEditing ? (
                <Input
                  ref={folderInputRef}
                  value={folderEditName}
                  onChange={(e) => setFolderEditName(e.target.value)}
                  onBlur={handleSaveFolderRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveFolderRename();
                    if (e.key === 'Escape') {
                      setEditingFolderId(null);
                      setFolderEditName('');
                    }
                  }}
                  className="flex-1 h-6 px-1 text-xs"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ) : (
                <span className={`flex-1 text-xs truncate ${isComponentInstance ? 'text-purple-700 dark:text-purple-300' : ''}`}>
                  {item.name}
                  {isComponentInstance && <Component className="inline-block size-3 ml-1 opacity-60" />}
                </span>
              )}

            </div>
          )}
        </TreeItemContent>

        {item.children.length > 0 ? (
          <Collection items={item.children}>{(child) => renderTreeItem(child)}</Collection>
        ) : null}
      </TreeItem>
    );
  };

  return (
    <div className="h-full flex flex-col bg-card border-r">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 text-xs font-medium hover:text-primary transition-colors">
              {selectedScene.name}
              <ChevronRight className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            {project?.scenes.map((scene) => (
              editingSceneId === scene.id ? (
                <div
                  key={scene.id}
                  className="flex items-center px-2 py-1.5"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <Input
                    ref={sceneInputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={handleSaveSceneRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') handleSaveSceneRename();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-6 text-xs flex-1"
                    autoFocus
                  />
                </div>
              ) : (
                <DropdownMenuItem
                  key={scene.id}
                  onClick={() => selectScene(scene.id)}
                  className={`group flex items-center justify-between ${scene.id === selectedSceneId ? 'bg-accent' : ''}`}
                >
                  <span className="flex-1">{scene.name}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => handleStartSceneEdit(scene.id, scene.name, e)}
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:opacity-100"
                  >
                    <Pencil className="size-3" />
                  </Button>
                </DropdownMenuItem>
              )
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleAddScene}>
              <Plus className="size-4 mr-2" />
              New Scene
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex gap-1">
          <Button size="icon-sm" variant="ghost" onClick={handleAddObject} title="Add Object">
            <Plus className="size-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => handleAddFolder(null)} title="Add Folder">
            <FolderPlus className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setShowLibrary(true)}
            title="Object Library"
            disabled={savingToLibrary}
          >
            {savingToLibrary ? <Loader2 className="size-4 animate-spin" /> : <Library className="size-4" />}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedScene.objects.length === 0 && folders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
            <span className="text-2xl mb-2">📦</span>
            <span className="text-xs text-center">No objects yet</span>
          </div>
        ) : (
          <Tree
            aria-label="Scene hierarchy"
            items={treeItems}
            selectionMode="multiple"
            selectionBehavior="replace"
            selectedKeys={selectedTreeKeys}
            onSelectionChange={handleSelectionChange}
            expandedKeys={expandedKeys}
            onExpandedChange={handleExpandedChange}
            dragAndDropHooks={dragAndDropHooks}
            className="outline-none"
          >
            {(item) => renderTreeItem(item)}
          </Tree>
        )}
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePaste}
                  disabled={!objectClipboard}
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
                  onClick={() => handleMoveObjectToFolder(null)}
                  className="w-full justify-start rounded-none h-8"
                >
                  <FolderOpen className="size-4" />
                  Move to Root
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!contextMenu || contextMenu.kind !== 'object') return;
                    handleAddFolder(null, contextMenu.object.id);
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDetachFromComponent}
                    className="w-full justify-start rounded-none h-8"
                  >
                    <Unlink className="size-4" />
                    Detach from Component
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSaveToLibrary}
                  className="w-full justify-start rounded-none h-8"
                >
                  <Library className="size-4" />
                  Save to Library
                </Button>
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
