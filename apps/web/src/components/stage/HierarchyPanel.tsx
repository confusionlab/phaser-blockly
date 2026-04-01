import { useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { SpriteShelf } from './SpriteShelf';
import {
  ChevronDown,
  ChevronRight,
  Component,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  Trash2,
} from '@/components/ui/icons';
import type { ComponentDefinition, ComponentFolder, HierarchyFolder, Scene, SceneFolder } from '@/types';
import {
  getFolderedHierarchyTree,
  getHierarchyFolderNodeKey,
  getHierarchyItemNodeKey,
  getNextFolderedSiblingOrder,
  moveFolderedHierarchyNodes,
  normalizeFolderedHierarchyDropTarget,
  type FolderedItemShape,
  type HierarchyDropTarget,
  type HierarchyTreeNode,
} from '@/utils/hierarchyTree';
import { panelHeaderClassNames } from '@/lib/ui/panelHeaderTokens';
import { cn } from '@/lib/utils';

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
  onSelectItem: (item: TItem) => void;
  onAddItem: () => void;
  onAddFolder: () => void;
  onRenameItem: (itemId: string, name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteItem: (itemId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onMove: (items: TItem[], folders: HierarchyFolder[]) => void;
  renderItemIcon?: (item: TItem) => React.ReactNode;
  renderHeaderActions?: React.ReactNode;
  onItemDragStart?: (event: React.DragEvent<HTMLDivElement>, item: TItem) => void;
}

function FolderedHierarchyPane<TItem extends FolderedItemShape>({
  title,
  itemLabel,
  emptyLabel,
  folders,
  items,
  itemKeyPrefix,
  selectedItemId,
  onSelectItem,
  onAddItem,
  onAddFolder,
  onRenameItem,
  onRenameFolder,
  onDeleteItem,
  onDeleteFolder,
  onMove,
  renderItemIcon,
  renderHeaderActions,
  onItemDragStart,
}: FolderedHierarchyPaneProps<TItem>) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draggedKeys, setDraggedKeys] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<HierarchyDropTarget>({ key: null, dropPosition: null });
  const inputRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(
    () => getFolderedHierarchyTree(folders, items, {
      itemKeyPrefix,
      setItemFolderId: (item, folderId) => ({ ...item, folderId }),
      setItemOrder: (item, order) => ({ ...item, order }),
    }),
    [folders, itemKeyPrefix, items],
  );

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
    setDropTarget({ key: null, dropPosition: null });
  };

  const renderNodes = (nodes: HierarchyTreeNode<TItem>[], level = 0): React.ReactNode => nodes.map((node) => {
    const isFolder = node.type === 'folder';
    const folder = node.folder;
    const item = node.item;
    const key = node.key;
    const isExpanded = isFolder && folder ? !collapsedFolders.has(folder.id) : false;
    const isEditing = (folder && editingFolderId === folder.id) || (item && editingItemId === item.id);
    const isSelected = item?.id === selectedItemId;

    return (
      <div key={key}>
        <div
          draggable
          onDragStart={(event) => {
            setDraggedKeys([key]);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', key);
            if (!isFolder && item && onItemDragStart) {
              onItemDragStart(event, item);
            }
          }}
          onDragEnd={() => {
            setDraggedKeys([]);
            setDropTarget({ key: null, dropPosition: null });
          }}
          onDragOver={(event) => {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const dropPosition: HierarchyDropTarget['dropPosition'] = isFolder && event.clientY > rect.top + rect.height * 0.28 && event.clientY < rect.bottom - rect.height * 0.28
              ? 'on'
              : event.clientY < midpoint
                ? 'before'
                : 'after';
            setDropTarget({ key, dropPosition });
          }}
          onDrop={(event) => {
            event.preventDefault();
            handleDrop(dropTarget.key === key ? dropTarget : { key, dropPosition: 'after' });
          }}
          className={cn(
            'group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
            isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
        >
          {dropTarget.key === key && dropTarget.dropPosition === 'before' ? (
            <div className="absolute inset-x-1 top-0 border-t-2 border-primary" />
          ) : null}
          {dropTarget.key === key && dropTarget.dropPosition === 'after' ? (
            <div className="absolute inset-x-1 bottom-0 border-t-2 border-primary" />
          ) : null}
          {isFolder && folder ? (
            <button
              type="button"
              className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => {
                setCollapsedFolders((current) => {
                  const next = new Set(current);
                  if (next.has(folder.id)) {
                    next.delete(folder.id);
                  } else {
                    next.add(folder.id);
                  }
                  return next;
                });
              }}
            >
              {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : (
            <div className="size-5" />
          )}

          {isFolder && folder ? (
            isEditing ? (
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
                className="min-w-0 flex-1"
                textClassName="truncate text-sm font-medium leading-5"
                autoFocus
              />
            ) : (
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onDoubleClick={() => {
                  setEditingFolderId(folder.id);
                  setEditingItemId(null);
                  setDraftName(folder.name);
                }}
              >
                {isExpanded ? <FolderOpen className="size-4 shrink-0 text-muted-foreground" /> : <Folder className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{folder.name}</span>
              </button>
            )
          ) : item ? (
            isEditing ? (
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
                className="min-w-0 flex-1"
                textClassName="truncate text-sm font-medium leading-5"
                autoFocus
              />
            ) : (
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => onSelectItem(item)}
                onDoubleClick={() => {
                  setEditingItemId(item.id);
                  setEditingFolderId(null);
                  setDraftName((item as { name?: string }).name ?? itemLabel);
                }}
              >
                {renderItemIcon ? renderItemIcon(item) : null}
                <span className="truncate">{(item as { name?: string }).name ?? itemLabel}</span>
              </button>
            )
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => {
              if (folder) {
                onDeleteFolder(folder.id);
              } else if (item) {
                onDeleteItem(item.id);
              }
            }}
            title={folder ? 'Delete folder' : `Delete ${itemLabel.toLowerCase()}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        {isFolder && folder && isExpanded ? renderNodes(node.children, level + 1) : null}
      </div>
    );
  });

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <div className={cn(panelHeaderClassNames.chrome, panelHeaderClassNames.splitRow)}>
        <div aria-hidden="true" />
        <div className="flex items-center gap-1">
          {renderHeaderActions}
          <Button type="button" size="icon-xs" variant="ghost" onClick={onAddItem} title={`Add ${itemLabel}`}>
            <Plus className="size-4" />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" onClick={onAddFolder} title="Add Folder">
            <FolderPlus className="size-4" />
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div
          className="min-h-full px-2 py-2"
          onDragOver={(event) => {
            event.preventDefault();
            setDropTarget({ key: null, dropPosition: null });
          }}
          onDrop={(event) => {
            event.preventDefault();
            handleDrop({ key: null, dropPosition: null });
          }}
        >
          {tree.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 py-10 text-sm text-muted-foreground">
              {emptyLabel}
            </div>
          ) : (
            <div role="tree" aria-label={title} className="space-y-0.5">
              {renderNodes(tree)}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function SceneHierarchyTab() {
  const { project, addScene, updateScene, removeScene, updateSceneOrganization } = useProjectStore();
  const { selectedSceneId, selectScene, setActiveHierarchyTab } = useEditorStore();
  const scenes = project?.scenes ?? [];
  const sceneFolders = project?.sceneFolders ?? [];

  return (
    <FolderedHierarchyPane<SceneItem>
      title="Scenes"
      itemLabel="Scene"
      emptyLabel="No scenes yet"
      folders={sceneFolders}
      items={scenes}
      itemKeyPrefix="scene"
      selectedItemId={selectedSceneId}
      onSelectItem={(scene) => {
        selectScene(scene.id);
        setActiveHierarchyTab('scene');
      }}
      onAddItem={() => addScene(`Scene ${scenes.length + 1}`)}
      onAddFolder={() => {
        const newFolder: SceneFolder = {
          id: crypto.randomUUID(),
          name: `Folder ${sceneFolders.length + 1}`,
          parentId: null,
          order: getNextFolderedSiblingOrder(sceneFolders, scenes, null, {
            itemKeyPrefix: 'scene',
            setItemFolderId: (scene, folderId) => ({ ...scene, folderId }),
            setItemOrder: (scene, order) => ({ ...scene, order }),
          }),
        };
        updateSceneOrganization(scenes, [...sceneFolders, newFolder]);
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
    />
  );
}

function ComponentHierarchyTab() {
  const {
    project,
    addComponentInstance,
    deleteComponent,
    updateComponent,
    updateComponentOrganization,
  } = useProjectStore();
  const {
    selectedSceneId,
    selectedComponentId,
    selectComponent,
    setActiveHierarchyTab,
  } = useEditorStore();
  const components = project?.components ?? [];
  const componentFolders = project?.componentFolders ?? [];

  const handleAddInstance = () => {
    if (!selectedSceneId || !selectedComponentId) return;
    addComponentInstance(selectedSceneId, selectedComponentId);
  };

  return (
    <FolderedHierarchyPane<ComponentItem>
      title="Components"
      itemLabel="Component"
      emptyLabel="No components yet"
      folders={componentFolders}
      items={components}
      itemKeyPrefix="component"
      selectedItemId={selectedComponentId}
      onSelectItem={(component) => {
        selectComponent(component.id);
        setActiveHierarchyTab('component');
      }}
      onAddItem={handleAddInstance}
      onAddFolder={() => {
        const newFolder: ComponentFolder = {
          id: crypto.randomUUID(),
          name: `Folder ${componentFolders.length + 1}`,
          parentId: null,
          order: getNextFolderedSiblingOrder(componentFolders, components, null, {
            itemKeyPrefix: 'component',
            setItemFolderId: (component, folderId) => ({ ...component, folderId }),
            setItemOrder: (component, order) => ({ ...component, order }),
          }),
        };
        updateComponentOrganization(components, [...componentFolders, newFolder]);
      }}
      onRenameItem={(componentId, name) => updateComponent(componentId, { name })}
      onRenameFolder={(folderId, name) => {
        updateComponentOrganization(
          components,
          componentFolders.map((folder) => (folder.id === folderId ? { ...folder, name } : folder)),
        );
      }}
      onDeleteItem={(componentId) => deleteComponent(componentId)}
      onDeleteFolder={(folderId) => {
        const descendants = collectFolderDescendants(folderId, componentFolders);
        updateComponentOrganization(
          components.map((component) => descendants.has(component.folderId ?? '') ? { ...component, folderId: null } : component),
          componentFolders.filter((folder) => !descendants.has(folder.id)),
        );
      }}
      onMove={(nextComponents, nextFolders) => updateComponentOrganization(nextComponents, nextFolders)}
      renderItemIcon={() => <Component className="size-4 shrink-0 text-muted-foreground" />}
      renderHeaderActions={selectedComponentId ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 rounded-full px-2 text-xs"
          onClick={handleAddInstance}
          disabled={!selectedSceneId}
        >
          Add to Scene
        </Button>
      ) : null}
      onItemDragStart={(event, component) => {
        event.dataTransfer.effectAllowed = 'copyMove';
        event.dataTransfer.setData('application/x-pocha-component-id', component.id);
      }}
    />
  );
}

export function HierarchyPanel() {
  const activeHierarchyTab = useEditorStore((state) => state.activeHierarchyTab);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <div className="min-h-0 flex-1">
        {activeHierarchyTab === 'scene' ? <SceneHierarchyTab /> : null}
        {activeHierarchyTab === 'object' ? (
          <SpriteShelf showQuickSceneSwitch={true} showComponentLibraryButton={false} />
        ) : null}
        {activeHierarchyTab === 'component' ? <ComponentHierarchyTab /> : null}
      </div>
    </div>
  );
}
