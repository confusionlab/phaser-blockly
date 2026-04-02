import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '@convex-generated/api';
import type { Id } from '@convex-generated/dataModel';
import { LibraryBrowserDialog } from '@/components/dialogs/LibraryBrowserDialog';
import type {
  ColliderConfig,
  Costume,
  PhysicsConfig,
  Sound,
  Variable,
} from '@/types';
import {
  hydrateObjectLibraryItemForInsertion,
  type ObjectLibraryListItemData,
} from '@/lib/objectLibrary/objectLibraryAssets';
import { useModal } from '@/components/ui/modal-provider';

interface ObjectLibraryItem extends ObjectLibraryListItemData {
  _id: Id<'objectLibrary'>;
  createdAt: number;
}

interface ObjectLibraryBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (data: {
    name: string;
    costumes: Costume[];
    sounds: Sound[];
    blocklyXml: string;
    currentCostumeIndex: number;
    physics: PhysicsConfig | null;
    collider: ColliderConfig | null;
    localVariables: Variable[];
  }) => void;
}

export function ObjectLibraryBrowser({
  open,
  onOpenChange,
  onSelect,
}: ObjectLibraryBrowserProps) {
  const { isAuthenticated } = useConvexAuth();
  const { showAlert, showConfirm } = useModal();
  const items = useQuery(api.objectLibrary.list, open ? {} : 'skip') as ObjectLibraryItem[] | undefined;
  const removeItem = useMutation(api.objectLibrary.remove);

  const handleDeleteSelected = async (selectedItems: ObjectLibraryItem[]) => {
    const confirmed = await showConfirm({
      title: selectedItems.length === 1 ? 'Delete Object' : 'Delete Objects',
      description: selectedItems.length === 1
        ? 'Delete this object from library?'
        : `Delete ${selectedItems.length} objects from library?`,
      confirmLabel: selectedItems.length === 1 ? 'Delete Object' : `Delete ${selectedItems.length} Objects`,
      tone: 'destructive',
    });
    if (!confirmed) {
      return;
    }

    try {
      await Promise.all(selectedItems.map((item) => removeItem({ id: item._id })));
    } catch (error) {
      console.error('Failed to delete objects:', error);
      await showAlert({
        title: 'Delete Failed',
        description: 'Failed to delete object',
        tone: 'destructive',
      });
    }
  };

  const handleOpenItem = async (item: ObjectLibraryItem) => {
    try {
      const runtimeObject = await hydrateObjectLibraryItemForInsertion(item);
      onSelect?.(runtimeObject);
    } catch (error) {
      console.error('Failed to load object:', error);
      await showAlert({
        title: 'Load Failed',
        description: 'Failed to load object from library',
        tone: 'destructive',
      });
      throw error;
    }
  };

  return (
    <LibraryBrowserDialog
      canDeleteItem={(item) => item.scope === 'user'}
      emptyDescription={isAuthenticated ? 'Save objects to build your collection.' : 'Sign in to add your own objects.'}
      emptyTitle="No objects in library"
      getItemId={(item) => item._id}
      getItemName={(item) => item.name}
      itemLabelPlural="objects"
      itemLabelSingular="object"
      items={items}
      onDeleteSelected={handleDeleteSelected}
      onItemOpen={handleOpenItem}
      onOpenChange={onOpenChange}
      open={open}
      renderCard={(item) => (
        <>
          <div className="checkerboard-bg checkerboard-bg-sm aspect-square w-full overflow-hidden border-b border-border/60 bg-muted">
            <img
              src={item.thumbnail}
              alt={item.name}
              className="h-full w-full object-contain p-4"
            />
          </div>

          <div className="flex flex-1 flex-col justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">
                {item.name}
              </p>
            </div>
          </div>
        </>
      )}
      renderRow={(item) => (
        <>
          <div className="checkerboard-bg checkerboard-bg-sm h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-border/70 bg-muted">
            <img
              src={item.thumbnail}
              alt={item.name}
              className="h-full w-full object-contain p-2"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {item.name}
            </div>
          </div>
        </>
      )}
      title="Object Library"
    />
  );
}
