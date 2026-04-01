import { useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '@convex-generated/api';
import type { Id } from '@convex-generated/dataModel';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Component, Layers3, Loader2, Trash2 } from '@/components/ui/icons';
import {
  hydrateSceneLibraryItemForInsertion,
  type SceneLibraryListItemData,
} from '@/lib/sceneLibrary/sceneLibraryAssets';
import type { ComponentDefinition, ComponentFolder, Scene } from '@/types';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingSelect, setLoadingSelect] = useState(false);
  const { isAuthenticated } = useConvexAuth();

  const items = useQuery(api.sceneLibrary.list, open ? {} : 'skip') as SceneLibraryItem[] | undefined;
  const removeItem = useMutation(api.sceneLibrary.remove);

  const handleDelete = async (id: Id<'sceneLibrary'>) => {
    if (!confirm('Delete this scene from library?')) return;
    try {
      await removeItem({ id });
      if (selectedId === id) {
        setSelectedId(null);
      }
    } catch (error) {
      console.error('Failed to delete scene:', error);
      alert('Failed to delete scene');
    }
  };

  const handleSelect = async () => {
    if (!selectedId || !items) return;

    const item = items.find((entry) => entry._id === selectedId);
    if (!item) return;

    setLoadingSelect(true);
    try {
      const runtimeScene = await hydrateSceneLibraryItemForInsertion(item);
      onSelect?.(runtimeScene);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to load scene:', error);
      alert('Failed to load scene from library');
    } finally {
      setLoadingSelect(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[550px] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Scene Library</DialogTitle>
        </DialogHeader>

        <ScrollArea className="mt-4 flex-1">
          {!items ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <p>No scenes in library</p>
              <p className="text-sm">
                {isAuthenticated ? 'Save scenes to build your collection' : 'Sign in to add your own scenes'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 pr-4">
              {items.map((item) => (
                <Card
                  key={item._id}
                  onClick={() => setSelectedId(item._id)}
                  className={`relative cursor-pointer p-3 transition-all group ${
                    selectedId === item._id
                      ? 'bg-primary/5 ring-2 ring-primary'
                      : 'hover:bg-accent'
                  }`}
                >
                  <div className="checkerboard-bg checkerboard-bg-sm mb-2 aspect-video w-full overflow-hidden rounded-lg">
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <Layers3 className="size-8" />
                      </div>
                    )}
                  </div>

                  <p className="truncate text-center text-sm font-medium">
                    {item.name}
                  </p>

                  <div className="mt-2 flex justify-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Layers3 className="size-3" />
                      {item.template.scene.objects.length}
                    </span>
                    <span className="flex items-center gap-1">
                      <Component className="size-3" />
                      {item.template.components.length}
                    </span>
                  </div>

                  {item.scope === 'user' ? (
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute right-2 top-2 size-6 opacity-0 group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDelete(item._id);
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="flex justify-end gap-3 border-t pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSelect()}
            disabled={!selectedId || loadingSelect}
          >
            {loadingSelect ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Insert Scene
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
