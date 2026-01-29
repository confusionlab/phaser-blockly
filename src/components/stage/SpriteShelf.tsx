import { useState, useRef } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { saveReusable } from '@/db/database';
import { ReusableLibrary } from '../dialogs/ReusableLibrary';
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
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Star, Pencil, Copy, Trash2, ChevronRight, Component, Unlink } from 'lucide-react';
import type { GameObject, ReusableObject } from '@/types';
import { COMPONENT_COLOR, getEffectiveObjectProps } from '@/types';

interface SortableObjectItemProps {
  object: GameObject;
  isSelected: boolean;
  isEditing: boolean;
  isComponentInstance: boolean;
  effectiveCostumes: { assetId: string }[];
  effectiveCostumeIndex: number;
  editName: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSelect: () => void;
  onStartEdit: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onEditNameChange: (value: string) => void;
  onSaveRename: () => void;
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

  const handleClick = () => {
    if (isSelected && !isEditing) {
      // Already selected, start editing on second click
      onStartEdit();
    } else {
      onSelect();
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
      className={`flex items-center gap-2 px-2 py-1.5 cursor-grab active:cursor-grabbing border-b transition-colors ${
        isSelected
          ? 'bg-primary/10 border-l-2 border-l-primary'
          : 'hover:bg-accent border-l-2 border-l-transparent'
      }`}
    >
      {/* Thumbnail */}
      <div
        className="w-8 h-8 rounded flex items-center justify-center overflow-hidden shrink-0"
        style={{
          backgroundColor: isComponentInstance ? COMPONENT_COLOR : undefined,
          border: isComponentInstance ? '2px solid #7c3aed' : undefined,
        }}
      >
        {effectiveCostumes && effectiveCostumes.length > 0 ? (
          <img
            src={effectiveCostumes[effectiveCostumeIndex]?.assetId}
            alt={object.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <span className="text-sm">{isComponentInstance ? '⬡' : '📦'}</span>
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
          className="flex-1 h-6 px-1 text-xs"
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

export function SpriteShelf() {
  const { project, addObject, removeObject, duplicateObject, updateObject, updateScene, reorderObject, addScene, makeComponent, detachFromComponent, addComponentInstance } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectObject, selectScene } = useEditorStore();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; object: GameObject } | null>(null);
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sceneInputRef = useRef<HTMLInputElement>(null);

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

  if (!selectedScene) return null;

  const handleAddObject = () => {
    if (!selectedSceneId) return;
    const newName = `Object ${selectedScene.objects.length + 1}`;
    const newObject = addObject(selectedSceneId, newName);
    selectObject(newObject.id);
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

    if (over && active.id !== over.id && selectedSceneId) {
      const oldIndex = selectedScene.objects.findIndex(obj => obj.id === active.id);
      const newIndex = selectedScene.objects.findIndex(obj => obj.id === over.id);
      reorderObject(selectedSceneId, oldIndex, newIndex);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, object: GameObject) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, object });
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
  };

  const handleDuplicate = () => {
    if (!contextMenu || !selectedSceneId) return;
    const duplicated = duplicateObject(selectedSceneId, contextMenu.object.id);
    if (duplicated) {
      selectObject(duplicated.id);
    }
    handleCloseContextMenu();
  };

  const handleDelete = () => {
    if (!contextMenu || !selectedSceneId) return;
    removeObject(selectedSceneId, contextMenu.object.id);
    if (selectedObjectId === contextMenu.object.id) {
      selectObject(null);
    }
    handleCloseContextMenu();
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

  const handleMakeReusable = async () => {
    if (!contextMenu) return;

    const object = contextMenu.object;
    const reusable: ReusableObject = {
      id: crypto.randomUUID(),
      name: object.name,
      thumbnail: getObjectColor(object.id),
      spriteAssetId: object.spriteAssetId,
      defaultPhysics: object.physics,
      blocklyXml: object.blocklyXml,
      createdAt: new Date(),
      tags: [],
    };

    try {
      await saveReusable(reusable);
      alert(`"${object.name}" saved to library!`);
    } catch (e) {
      console.error('Failed to save reusable:', e);
      alert('Failed to save object to library');
    }

    handleCloseContextMenu();
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

  const getObjectColor = (id: string): string => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash = hash & hash;
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 60%, 70%)`;
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
          <Button size="icon-sm" variant="ghost" onClick={() => setShowLibrary(true)} title="Library">
            <Star className="size-4" />
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
              items={selectedScene.objects.map(obj => obj.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col">
                {selectedScene.objects.map((object) => {
                  const isComponentInstance = !!object.componentId;
                  const effectiveProps = getEffectiveObjectProps(object, project?.components || []);
                  return (
                    <SortableObjectItem
                      key={object.id}
                      object={object}
                      isSelected={selectedObjectId === object.id}
                      isEditing={editingObjectId === object.id}
                      isComponentInstance={isComponentInstance}
                      effectiveCostumes={effectiveProps.costumes}
                      effectiveCostumeIndex={effectiveProps.currentCostumeIndex}
                      editName={editName}
                      inputRef={inputRef}
                      onSelect={() => selectObject(object.id)}
                      onStartEdit={() => handleStartObjectEdit(object.id, object.name)}
                      onContextMenu={(e) => handleContextMenu(e, object)}
                      onEditNameChange={setEditName}
                      onSaveRename={handleSaveObjectRename}
                    />
                  );
                })}
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
              onClick={handleDuplicate}
              className="w-full justify-start rounded-none h-8"
            >
              <Copy className="size-4" />
              Duplicate
            </Button>
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
              onClick={handleMakeReusable}
              className="w-full justify-start rounded-none h-8"
            >
              <Star className="size-4" />
              Save to Library
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="w-full justify-start rounded-none h-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </Card>
        </>
      )}

      {/* Reusable Library Dialog */}
      {showLibrary && (
        <ReusableLibrary onClose={() => setShowLibrary(false)} />
      )}
    </div>
  );
}
