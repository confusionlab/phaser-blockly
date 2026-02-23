import { useState, useRef } from 'react';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Library, Pencil, Copy, Clipboard, Trash2, ChevronRight, ChevronDown, Component, Unlink, Loader2, Folder, FolderOpen, FolderPlus } from 'lucide-react';
import type { GameObject, Costume, Sound, PhysicsConfig, ColliderConfig, SceneFolder } from '@/types';

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
import { getEffectiveObjectProps } from '@/types';
import { uploadDataUrlToStorage, generateThumbnail } from '@/utils/convexHelpers';

interface SortableObjectItemProps {
  object: GameObject;
  isSelected: boolean;
  isEditing: boolean;
  isComponentInstance: boolean;
  effectiveCostumes: { assetId: string; bounds?: { x: number; y: number; width: number; height: number } }[];
  effectiveCostumeIndex: number;
  editName: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (e: React.MouseEvent) => void;
  onStartEdit: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onEditNameChange: (value: string) => void;
  onSaveRename: () => void;
}

const FOLDER_DROP_PREFIX = 'folder-drop:';

function getFolderDropId(folderId: string): string {
  return `${FOLDER_DROP_PREFIX}${folderId}`;
}

function parseFolderDropId(id: string): string | null {
  return id.startsWith(FOLDER_DROP_PREFIX) ? id.slice(FOLDER_DROP_PREFIX.length) : null;
}

function SortableObjectItem({
  object,
  isSelected,
  isEditing,
  isComponentInstance,
  effectiveCostumes,
  effectiveCostumeIndex,
  editName,
  inputRef,
  onSelect,
  onStartEdit,
  onContextMenu,
  onEditNameChange,
  onSaveRename,
}: SortableObjectItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: object.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      onSelect(e);
      return;
    }

    if (isSelected && !isEditing && e.detail === 2) {
      // Rename on double click for selected item
      onStartEdit();
    } else {
      onSelect(e);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      className={`flex items-center gap-2 px-2 py-1.5 cursor-grab active:cursor-grabbing border-b transition-colors select-none ${
        isSelected
          ? 'bg-primary/10 border-l-2 border-l-primary'
          : 'hover:bg-accent border-l-2 border-l-transparent'
      }`}
    >
      {/* Thumbnail - zoomed to bounds */}
      <div className="w-8 h-8 rounded flex items-center justify-center overflow-hidden shrink-0 bg-muted relative">
        {effectiveCostumes && effectiveCostumes.length > 0 ? (() => {
          const costume = effectiveCostumes[effectiveCostumeIndex];
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
                  marginLeft: -bounds.width * scale / 2,
                  marginTop: -bounds.height * scale / 2,
                }}
              />
            );
          }
          return (
            <img
              src={costume?.assetId}
              alt={object.name}
              className="w-full h-full object-contain"
            />
          );
        })() : (
          <span className="text-sm">📦</span>
        )}
      </div>

      {/* Name */}
      {isEditing ? (
        <Input
          ref={inputRef}
          value={editName}
          onChange={e => onEditNameChange(e.target.value)}
          onBlur={onSaveRename}
          onKeyDown={e => {
            if (e.key === 'Enter') onSaveRename();
            if (e.key === 'Escape') onSaveRename();
          }}
          className="flex-1 h-6 px-1 text-xs select-text"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        />
      ) : (
        <span className={`flex-1 text-xs truncate ${isComponentInstance ? 'text-purple-700 dark:text-purple-300' : ''}`}>
          {object.name}
          {isComponentInstance && <Component className="inline-block size-3 ml-1 opacity-60" />}
        </span>
      )}
    </div>
  );
}

interface FolderRowProps {
  folder: SceneFolder;
  hasObjects: boolean;
  isEditing: boolean;
  folderEditName: string;
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
  onFolderEditNameChange: (value: string) => void;
  onSaveFolderRename: () => void;
  onCancelFolderRename: () => void;
}

function FolderRow({
  folder,
  hasObjects,
  isEditing,
  folderEditName,
  folderInputRef,
  onToggle,
  onStartEdit,
  onDelete,
  onFolderEditNameChange,
  onSaveFolderRename,
  onCancelFolderRename,
}: FolderRowProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: getFolderDropId(folder.id),
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-1 px-2 py-1 border-b transition-colors ${
        isOver ? 'bg-primary/15' : hasObjects ? 'bg-muted/40' : 'bg-muted/20'
      }`}
      onClick={onToggle}
    >
      {hasObjects ? (
        <button
          className="h-5 w-5 flex items-center justify-center hover:bg-accent rounded"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {folder.collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      ) : (
        <div className="h-5 w-5" />
      )}
      {isEditing ? (
        <Input
          ref={folderInputRef}
          value={folderEditName}
          onChange={e => onFolderEditNameChange(e.target.value)}
          onBlur={onSaveFolderRename}
          onKeyDown={e => {
            if (e.key === 'Enter') onSaveFolderRename();
            if (e.key === 'Escape') onCancelFolderRename();
          }}
          className="h-6 text-xs flex-1"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        />
      ) : (
        <button
          className="flex items-center gap-1.5 flex-1 text-left text-xs font-medium"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartEdit();
          }}
        >
          {folder.collapsed ? <Folder className="size-3.5" /> : <FolderOpen className="size-3.5" />}
          <span className="truncate">{folder.name}</span>
        </button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="h-6 w-6"
        title="Rename folder"
        onClick={(e) => {
          e.stopPropagation();
          onStartEdit();
        }}
      >
        <Pencil className="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="h-6 w-6 text-destructive hover:text-destructive"
        title="Delete folder"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}

export function SpriteShelf() {
  const { project, addObject, removeObject, duplicateObject, updateObject, updateScene, addScene, makeComponent, detachFromComponent } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectedObjectIds, selectObject, selectObjects, selectScene } = useEditorStore();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; object: GameObject } | null>(null);
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [folderEditName, setFolderEditName] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sceneInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const selectionAnchorRef = useRef<string | null>(null);

  const generateUploadUrl = useMutation(api.objectLibrary.generateUploadUrl);
  const createLibraryItem = useMutation(api.objectLibrary.create);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);
  const folders = selectedScene?.objectFolders ?? [];

  if (!selectedScene) return null;

  const handleAddObject = () => {
    if (!selectedSceneId) return;
    const newName = `Object ${selectedScene.objects.length + 1}`;
    const newObject = addObject(selectedSceneId, newName);
    selectObject(newObject.id);
  };

  const handleAddFolder = (assignObjectId?: string) => {
    if (!selectedScene || !selectedSceneId) return;
    const newFolder: SceneFolder = {
      id: crypto.randomUUID(),
      name: `Folder ${folders.length + 1}`,
      collapsed: false,
    };
    updateScene(selectedSceneId, { objectFolders: [...folders, newFolder] });
    if (assignObjectId) {
      updateObject(selectedSceneId, assignObjectId, { folderId: newFolder.id });
    }
  };

  const handleAddScene = () => {
    if (!project) return;
    const newName = `Scene ${project.scenes.length + 1}`;
    addScene(newName);
    // Select the newly added scene (it's the last one)
    setTimeout(() => {
      const newScene = useProjectStore.getState().project?.scenes.at(-1);
      if (newScene) {
        selectScene(newScene.id);
      }
    }, 0);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !selectedSceneId) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const objectIds = selectedScene.objects.map(obj => obj.id);
    if (!objectIds.includes(activeId)) return;

    const selectedIdsInScene = selectedObjectIds.filter(id => objectIds.includes(id));
    const selectedSet = new Set(selectedIdsInScene);
    const draggedIds = selectedSet.has(activeId) && selectedSet.size > 1
      ? objectIds.filter(id => selectedSet.has(id))
      : [activeId];
    const draggedSet = new Set(draggedIds);

    const folderDropId = parseFolderDropId(overId);
    if (folderDropId) {
      const nextObjects = selectedScene.objects.map(obj =>
        draggedSet.has(obj.id) ? { ...obj, folderId: folderDropId } : obj
      );
      updateScene(selectedSceneId, { objects: nextObjects });
      return;
    }

    if (!objectIds.includes(overId)) return;
    if (draggedSet.has(overId)) return;

    const activeIndex = objectIds.indexOf(activeId);
    const overIndex = objectIds.indexOf(overId);
    const movingDown = overIndex > activeIndex;

    const remaining = objectIds.filter(id => !draggedSet.has(id));
    const overIndexInRemaining = remaining.indexOf(overId);
    if (overIndexInRemaining < 0) return;

    const insertIndex = movingDown ? overIndexInRemaining + 1 : overIndexInRemaining;
    const reorderedIds = [...remaining];
    reorderedIds.splice(insertIndex, 0, ...draggedIds);

    const objectMap = new Map(selectedScene.objects.map(obj => [obj.id, obj]));
    const reorderedObjects = reorderedIds
      .map(id => objectMap.get(id))
      .filter((obj): obj is GameObject => !!obj);

    updateScene(selectedSceneId, { objects: reorderedObjects });
  };

  const handleContextMenu = (e: React.MouseEvent, object: GameObject) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, object });
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
  };

  const handleMoveObjectToFolder = (folderId: string | null) => {
    if (!contextMenu || !selectedSceneId) return;
    updateObject(selectedSceneId, contextMenu.object.id, { folderId });
    handleCloseContextMenu();
  };

  const handleDuplicate = () => {
    if (!contextMenu || !selectedSceneId) return;
    const duplicated = duplicateObject(selectedSceneId, contextMenu.object.id);
    if (duplicated) {
      selectObject(duplicated.id);
    }
    handleCloseContextMenu();
  };

  const handleCopy = () => {
    if (!contextMenu || !project) return;
    const object = contextMenu.object;
    const effectiveProps = getEffectiveObjectProps(object, project.components || []);

    // Copy effective properties to clipboard (deep clone)
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
    if (!objectClipboard || !selectedSceneId) return;

    // Create new object with copied data
    const newObject = addObject(selectedSceneId, `${objectClipboard.name} (copy)`);

    // Generate new IDs for costumes and sounds
    const newCostumes = objectClipboard.costumes.map(c => ({
      ...c,
      id: crypto.randomUUID(),
    }));
    const newSounds = objectClipboard.sounds.map(s => ({
      ...s,
      id: crypto.randomUUID(),
    }));
    const newLocalVariables = (objectClipboard.localVariables || []).map(v => ({
      ...v,
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
    if (!contextMenu || !selectedSceneId) return;

    const sceneObjectIds = new Set(selectedScene.objects.map(obj => obj.id));
    const selectedIdsInScene = selectedObjectIds.filter(id => sceneObjectIds.has(id));
    const deleteIds = selectedIdsInScene.length > 1 && selectedIdsInScene.includes(contextMenu.object.id)
      ? selectedIdsInScene
      : [contextMenu.object.id];

    const deleteSet = new Set(deleteIds);
    deleteIds.forEach((id) => removeObject(selectedSceneId, id));

    const deletedSelectedIds = selectedIdsInScene.filter(id => deleteSet.has(id));
    if (deletedSelectedIds.length > 0) {
      const remainingSelectedIds = selectedIdsInScene.filter(id => !deleteSet.has(id));
      if (remainingSelectedIds.length > 0) {
        const nextPrimary = (selectedObjectId && remainingSelectedIds.includes(selectedObjectId))
          ? selectedObjectId
          : remainingSelectedIds[0];
        selectObjects(remainingSelectedIds, nextPrimary);
      } else {
        const remainingSceneIds = selectedScene.objects
          .map(obj => obj.id)
          .filter(id => !deleteSet.has(id));
        selectObject(remainingSceneIds[0] ?? null);
      }
    }
    handleCloseContextMenu();
  };

  const handleToggleFolderCollapsed = (folderId: string) => {
    if (!selectedSceneId) return;
    const nextFolders = folders.map(folder =>
      folder.id === folderId ? { ...folder, collapsed: !folder.collapsed } : folder
    );
    updateScene(selectedSceneId, { objectFolders: nextFolders });
  };

  const handleStartFolderEdit = (folder: SceneFolder) => {
    setEditingFolderId(folder.id);
    setFolderEditName(folder.name);
    setTimeout(() => folderInputRef.current?.focus(), 0);
  };

  const handleSaveFolderRename = () => {
    if (!selectedSceneId || !editingFolderId || !folderEditName.trim()) {
      setEditingFolderId(null);
      setFolderEditName('');
      return;
    }
    const nextFolders = folders.map(folder =>
      folder.id === editingFolderId ? { ...folder, name: folderEditName.trim() } : folder
    );
    updateScene(selectedSceneId, { objectFolders: nextFolders });
    setEditingFolderId(null);
    setFolderEditName('');
  };

  const handleDeleteFolder = (folderId: string) => {
    if (!selectedSceneId || !selectedScene) return;
    const nextFolders = folders.filter(folder => folder.id !== folderId);
    const nextObjects = selectedScene.objects.map(obj =>
      obj.folderId === folderId ? { ...obj, folderId: null } : obj
    );
    updateScene(selectedSceneId, {
      objectFolders: nextFolders,
      objects: nextObjects,
    });
    if (editingFolderId === folderId) {
      setEditingFolderId(null);
      setFolderEditName('');
    }
  };

  // Object name editing
  const handleStartObjectEdit = (objectId: string, currentName: string) => {
    setEditingObjectId(objectId);
    setEditName(currentName);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSaveObjectRename = () => {
    if (editingObjectId && editName.trim() && selectedSceneId) {
      updateObject(selectedSceneId, editingObjectId, { name: editName.trim() });
    }
    setEditingObjectId(null);
    setEditName('');
  };

  // Scene name editing
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
    if (!contextMenu || !project) return;

    const object = contextMenu.object;
    const effectiveProps = getEffectiveObjectProps(object, project.components || []);

    handleCloseContextMenu();
    setSavingToLibrary(true);

    try {
      // Upload each costume to Convex storage
      const costumes: Array<{
        id: string;
        name: string;
        storageId: Id<"_storage">;
        bounds?: { x: number; y: number; width: number; height: number };
      }> = [];

      for (const costume of effectiveProps.costumes) {
        const { storageId } = await uploadDataUrlToStorage(
          costume.assetId,
          generateUploadUrl
        );
        costumes.push({
          id: costume.id,
          name: costume.name,
          storageId: storageId as Id<"_storage">,
          bounds: costume.bounds,
        });
      }

      // Upload each sound to Convex storage
      const sounds: Array<{
        id: string;
        name: string;
        storageId: Id<"_storage">;
      }> = [];

      for (const sound of effectiveProps.sounds) {
        const { storageId } = await uploadDataUrlToStorage(
          sound.assetId,
          generateUploadUrl
        );
        sounds.push({
          id: sound.id,
          name: sound.name,
          storageId: storageId as Id<"_storage">,
        });
      }

      // Generate thumbnail from first costume
      let thumbnail = '';
      if (effectiveProps.costumes.length > 0) {
        thumbnail = await generateThumbnail(effectiveProps.costumes[0].assetId, 128);
      }

      // Create the library entry
      await createLibraryItem({
        name: object.name,
        thumbnail,
        costumes,
        sounds,
        blocklyXml: effectiveProps.blocklyXml,
        physics: effectiveProps.physics ?? undefined,
        collider: effectiveProps.collider ?? undefined,
      });

    } catch (e) {
      console.error('Failed to save object to library:', e);
      alert('Failed to save object to library');
    } finally {
      setSavingToLibrary(false);
    }
  };

  const handleMakeComponent = () => {
    if (!contextMenu || !selectedSceneId) return;
    const component = makeComponent(selectedSceneId, contextMenu.object.id);
    if (component) {
      // Component created successfully
    }
    handleCloseContextMenu();
  };

  const handleDetachFromComponent = () => {
    if (!contextMenu || !selectedSceneId) return;
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
    if (!selectedSceneId) return;

    // Create a new object with all the library data
    const newObject = addObject(selectedSceneId, data.name);

    // Update with library data (costumes, sounds, etc. are already embedded as data URLs)
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

  const folderById = new Map(folders.map(folder => [folder.id, folder]));
  const folderFirstObjectIndex = new Map<string, number>();
  for (let i = 0; i < selectedScene.objects.length; i++) {
    const folderId = selectedScene.objects[i].folderId;
    if (folderId && folderById.has(folderId) && !folderFirstObjectIndex.has(folderId)) {
      folderFirstObjectIndex.set(folderId, i);
    }
  }
  const collapsedFolderIds = new Set(
    folders.filter(folder => folder.collapsed).map(folder => folder.id)
  );
  const sceneObjectIdSet = new Set(selectedScene.objects.map(obj => obj.id));
  const selectedIdsInScene = selectedObjectIds.filter(id => sceneObjectIdSet.has(id));
  const willDeleteSelection = !!contextMenu &&
    selectedIdsInScene.length > 1 &&
    selectedIdsInScene.includes(contextMenu.object.id);
  const deleteLabel = willDeleteSelection
    ? `Delete Selected (${selectedIdsInScene.length})`
    : 'Delete';
  const visibleObjectIds = selectedScene.objects
    .filter(obj => !obj.folderId || !collapsedFolderIds.has(obj.folderId))
    .map(obj => obj.id);
  const foldersWithoutObjects = folders.filter(folder => !folderFirstObjectIndex.has(folder.id));

  const handleObjectSelect = (e: React.MouseEvent, objectId: string) => {
    const orderedIds = selectedScene.objects.map(obj => obj.id);
    const isToggleSelection = e.metaKey || e.ctrlKey;
    const isRangeSelection = e.shiftKey;
    const anchorId = selectionAnchorRef.current ?? selectedObjectId;

    // Shift+click: contiguous range selection
    if (isRangeSelection && anchorId) {
      const anchorIndex = orderedIds.indexOf(anchorId);
      const targetIndex = orderedIds.indexOf(objectId);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        const rangeIds = orderedIds.slice(start, end + 1);
        const nextIds = isToggleSelection
          ? Array.from(new Set([...selectedObjectIds, ...rangeIds]))
          : rangeIds;
        selectObjects(nextIds, objectId);
        return;
      }
    }

    // Cmd/Ctrl+click: toggle individual selection
    if (isToggleSelection) {
      const alreadySelected = selectedObjectIds.includes(objectId);
      const nextIds = alreadySelected
        ? selectedObjectIds.filter(id => id !== objectId)
        : [...selectedObjectIds, objectId];
      selectionAnchorRef.current = objectId;
      selectObjects(nextIds, alreadySelected ? (nextIds[0] ?? null) : objectId);
      return;
    }

    // Plain click on an already-selected item in a multi-selection should not
    // collapse the selection unexpectedly.
    if (selectedObjectIds.length > 1 && selectedObjectIds.includes(objectId)) {
      selectionAnchorRef.current = objectId;
      return;
    }

    // Plain click: single selection
    selectionAnchorRef.current = objectId;
    selectObject(objectId);
  };

  return (
    <div className="h-full flex flex-col bg-card border-r">
      {/* Header */}
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
                  onMouseDown={e => e.stopPropagation()}
                >
                  <Input
                    ref={sceneInputRef}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={handleSaveSceneRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveSceneRename();
                      if (e.key === 'Escape') handleSaveSceneRename();
                    }}
                    onClick={e => e.stopPropagation()}
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
          <Button size="icon-sm" variant="ghost" onClick={() => handleAddFolder()} title="Add Folder">
            <FolderPlus className="size-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setShowLibrary(true)} title="Object Library" disabled={savingToLibrary}>
            {savingToLibrary ? <Loader2 className="size-4 animate-spin" /> : <Library className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Object List */}
      <div className="flex-1 overflow-y-auto">
        {selectedScene.objects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
            <span className="text-2xl mb-2">📦</span>
            <span className="text-xs text-center">No objects yet</span>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visibleObjectIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col">
                {selectedScene.objects.map((object, index) => {
                  const folder = object.folderId ? folderById.get(object.folderId) : null;
                  const shouldShowFolderRow = folder && folderFirstObjectIndex.get(folder.id) === index;
                  const isHiddenByCollapsedFolder = !!(object.folderId && collapsedFolderIds.has(object.folderId));
                  const isComponentInstance = !!object.componentId;
                  const effectiveProps = getEffectiveObjectProps(object, project?.components || []);

                  return (
                    <div key={object.id}>
                      {shouldShowFolderRow && folder && (
                        <FolderRow
                          folder={folder}
                          hasObjects
                          isEditing={editingFolderId === folder.id}
                          folderEditName={folderEditName}
                          folderInputRef={folderInputRef}
                          onToggle={() => handleToggleFolderCollapsed(folder.id)}
                          onStartEdit={() => handleStartFolderEdit(folder)}
                          onDelete={() => handleDeleteFolder(folder.id)}
                          onFolderEditNameChange={setFolderEditName}
                          onSaveFolderRename={handleSaveFolderRename}
                          onCancelFolderRename={() => {
                            setEditingFolderId(null);
                            setFolderEditName('');
                          }}
                        />
                      )}
                      {!isHiddenByCollapsedFolder && (
                        <SortableObjectItem
                          object={object}
                          isSelected={selectedObjectIds.includes(object.id)}
                          isEditing={editingObjectId === object.id}
                          isComponentInstance={isComponentInstance}
                          effectiveCostumes={effectiveProps.costumes}
                          effectiveCostumeIndex={effectiveProps.currentCostumeIndex}
                          editName={editName}
                          inputRef={inputRef}
                          onSelect={(e) => handleObjectSelect(e, object.id)}
                          onStartEdit={() => handleStartObjectEdit(object.id, object.name)}
                          onContextMenu={(e) => handleContextMenu(e, object)}
                          onEditNameChange={setEditName}
                          onSaveRename={handleSaveObjectRename}
                        />
                      )}
                    </div>
                  );
                })}
                {foldersWithoutObjects.map(folder => (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    hasObjects={false}
                    isEditing={editingFolderId === folder.id}
                    folderEditName={folderEditName}
                    folderInputRef={folderInputRef}
                    onToggle={() => handleToggleFolderCollapsed(folder.id)}
                    onStartEdit={() => handleStartFolderEdit(folder)}
                    onDelete={() => handleDeleteFolder(folder.id)}
                    onFolderEditNameChange={setFolderEditName}
                    onSaveFolderRename={handleSaveFolderRename}
                    onCancelFolderRename={() => {
                      setEditingFolderId(null);
                      setFolderEditName('');
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={handleCloseContextMenu}
          />
          <Card
            className="fixed z-50 py-1 min-w-36 gap-0"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="w-full justify-start rounded-none h-8"
            >
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
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDuplicate}
              className="w-full justify-start rounded-none h-8"
            >
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
              Remove from Folder
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!contextMenu) return;
                handleAddFolder(contextMenu.object.id);
                handleCloseContextMenu();
              }}
              className="w-full justify-start rounded-none h-8"
            >
              <FolderPlus className="size-4" />
              New Folder with Object
            </Button>
            {folders.map(folder => (
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
          </Card>
        </>
      )}

      {/* Object Library Dialog */}
      <ObjectLibraryBrowser
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelect={handleLibrarySelect}
      />
    </div>
  );
}
