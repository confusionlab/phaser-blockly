import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '@convex-generated/api';
import type { Id } from '@convex-generated/dataModel';
import { Component, Layers3 } from '@/components/ui/icons';
import { LibraryBrowserDialog } from '@/components/dialogs/LibraryBrowserDialog';
import {
  hydrateSceneLibraryItemForInsertion,
  type SceneLibraryListItemData,
} from '@/lib/sceneLibrary/sceneLibraryAssets';
import type { ComponentDefinition, ComponentFolder, Scene } from '@/types';
import { useModal } from '@/components/ui/modal-provider';

interface SceneLibraryItem extends SceneLibraryListItemData {
  _id: Id<'sceneLibrary'>;
  createdAt: number;
}

interface SceneLibraryBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (data: {
    name: string;
    scene: Scene;
    components: ComponentDefinition[];
    componentFolders: ComponentFolder[];
  }) => void;
}

export function SceneLibraryBrowser({
  open,
  onOpenChange,
  onSelect,
}: SceneLibraryBrowserProps) {
  const { isAuthenticated } = useConvexAuth();
  const { showAlert, showConfirm } = useModal();
  const items = useQuery(api.sceneLibrary.list, open ? {} : 'skip') as SceneLibraryItem[] | undefined;
  const removeItem = useMutation(api.sceneLibrary.remove);

  const handleDeleteSelected = async (selectedItems: SceneLibraryItem[]) => {
    const confirmed = await showConfirm({
      title: selectedItems.length === 1 ? 'Delete Scene' : 'Delete Scenes',
      description: selectedItems.length === 1
        ? 'Delete this scene from library?'
        : `Delete ${selectedItems.length} scenes from library?`,
      confirmLabel: selectedItems.length === 1 ? 'Delete Scene' : `Delete ${selectedItems.length} Scenes`,
      tone: 'destructive',
    });
    if (!confirmed) {
      return;
    }

    try {
      await Promise.all(selectedItems.map((item) => removeItem({ id: item._id })));
    } catch (error) {
      console.error('Failed to delete scenes:', error);
      await showAlert({
        title: 'Delete Failed',
        description: 'Failed to delete scene',
        tone: 'destructive',
      });
    }
  };

  const handleOpenItem = async (item: SceneLibraryItem) => {
    try {
      const runtimeScene = await hydrateSceneLibraryItemForInsertion(item);
      onSelect?.(runtimeScene);
    } catch (error) {
      console.error('Failed to load scene:', error);
      await showAlert({
        title: 'Load Failed',
        description: 'Failed to load scene from library',
        tone: 'destructive',
      });
      throw error;
    }
  };

  return (
    <LibraryBrowserDialog
      canDeleteItem={(item) => item.scope === 'user'}
      emptyDescription={isAuthenticated ? 'Save scenes to build your collection.' : 'Sign in to add your own scenes.'}
      emptyTitle="No scenes in library"
      getItemId={(item) => item._id}
      getItemName={(item) => item.name}
      itemLabelPlural="scenes"
      itemLabelSingular="scene"
      items={items}
      onDeleteSelected={handleDeleteSelected}
      onItemOpen={handleOpenItem}
      onOpenChange={onOpenChange}
      open={open}
      renderCard={(item) => (
        <>
          <div className="checkerboard-bg checkerboard-bg-sm aspect-[16/10] w-full overflow-hidden border-b border-border/60 bg-muted">
            {item.thumbnail ? (
              <img
                src={item.thumbnail}
                alt={item.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <Layers3 className="size-10" />
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">
                {item.name}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Scene template with components included
              </p>
            </div>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Layers3 className="size-4" />
                {item.template.scene.objects.length}
              </span>
              <span className="flex items-center gap-2">
                <Component className="size-4" />
                {item.template.components.length}
              </span>
            </div>
          </div>
        </>
      )}
      renderRow={(item) => (
        <>
          <div className="checkerboard-bg checkerboard-bg-sm flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-muted">
            {item.thumbnail ? (
              <img
                src={item.thumbnail}
                alt={item.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <Layers3 className="size-7 text-muted-foreground" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {item.name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Layers3 className="size-3.5" />
                {item.template.scene.objects.length} objects
              </span>
              <span className="flex items-center gap-1.5">
                <Component className="size-3.5" />
                {item.template.components.length} components
              </span>
            </div>
          </div>
        </>
      )}
      title="Scene Library"
    />
  );
}
