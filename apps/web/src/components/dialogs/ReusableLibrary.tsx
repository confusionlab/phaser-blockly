import { useEffect, useCallback, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { deleteReusable, listReusables, loadReusable } from '@/db/database';
import { LibraryBrowserDialog } from '@/components/dialogs/LibraryBrowserDialog';
import type { ReusableObject } from '@/types';
import { runInHistoryTransaction } from '@/store/universalHistory';
import { useModal } from '@/components/ui/modal-provider';

interface ReusableLibraryProps {
  onClose: () => void;
}

export function ReusableLibrary({ onClose }: ReusableLibraryProps) {
  const [reusables, setReusables] = useState<ReusableObject[]>([]);
  const [loading, setLoading] = useState(true);
  const { addObject } = useProjectStore();
  const { selectedSceneId, selectObject } = useEditorStore();
  const { showAlert, showConfirm } = useModal();

  const fetchReusables = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listReusables();
      setReusables(items);
    } catch (error) {
      console.error('Failed to load reusables:', error);
      await showAlert({
        title: 'Load Failed',
        description: 'Failed to load reusable objects',
        tone: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    void fetchReusables();
  }, [fetchReusables]);

  const handleOpenItem = async (item: ReusableObject) => {
    if (!selectedSceneId) {
      throw new Error('No selected scene');
    }

    try {
      const reusable = await loadReusable(item.id);
      if (!reusable) {
        throw new Error('Reusable not found');
      }

      runInHistoryTransaction('reusable-library:insert-object', () => {
        const newObject = addObject(selectedSceneId, reusable.name);

        const { project, updateObject } = useProjectStore.getState();
        if (project) {
          updateObject(selectedSceneId, newObject.id, {
            spriteAssetId: reusable.spriteAssetId,
            physics: reusable.defaultPhysics,
            blocklyXml: reusable.blocklyXml,
          });
        }

        selectObject(newObject.id);
      });
    } catch (error) {
      console.error('Failed to insert reusable:', error);
      await showAlert({
        title: 'Insert Failed',
        description: 'Failed to insert reusable object',
        tone: 'destructive',
      });
      throw error;
    }
  };

  const handleDeleteSelected = async (selectedItems: ReusableObject[]) => {
    const confirmed = await showConfirm({
      title: selectedItems.length === 1 ? 'Delete Reusable Object' : 'Delete Reusable Objects',
      description: selectedItems.length === 1
        ? 'Delete this reusable object?'
        : `Delete ${selectedItems.length} reusable objects?`,
      confirmLabel: selectedItems.length === 1 ? 'Delete Object' : `Delete ${selectedItems.length} Objects`,
      tone: 'destructive',
    });
    if (!confirmed) {
      return;
    }

    try {
      await Promise.all(selectedItems.map((item) => deleteReusable(item.id)));
      setReusables((current) => current.filter((reusable) => !selectedItems.some((item) => item.id === reusable.id)));
    } catch (error) {
      console.error('Failed to delete reusable objects:', error);
      await showAlert({
        title: 'Delete Failed',
        description: 'Failed to delete reusable object',
        tone: 'destructive',
      });
    }
  };

  const getObjectColor = (id: string): string => {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
      hash = ((hash << 5) - hash) + id.charCodeAt(index);
      hash &= hash;
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 60%, 70%)`;
  };

  return (
    <LibraryBrowserDialog
      emptyDescription='Right-click an object and select "Make Reusable" to save it here.'
      emptyTitle="No reusable objects yet"
      getItemId={(item) => item.id}
      getItemName={(item) => item.name}
      itemLabelPlural="reusable objects"
      itemLabelSingular="reusable object"
      items={reusables}
      loading={loading}
      onDeleteSelected={handleDeleteSelected}
      onItemOpen={handleOpenItem}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      renderCard={(item) => (
        <>
          <div
            className="flex aspect-square w-full items-center justify-center border-b border-border/60 text-5xl"
            style={{ backgroundColor: item.thumbnail || getObjectColor(item.id) }}
          >
            {item.spriteAssetId ? '[]' : '{}'}
          </div>

          <div className="flex flex-1 flex-col justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">
                {item.name}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ready to reuse in the current scene
              </p>
            </div>

            {item.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {item.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </>
      )}
      renderRow={(item) => (
        <>
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-border/70 text-2xl"
            style={{ backgroundColor: item.thumbnail || getObjectColor(item.id) }}
          >
            {item.spriteAssetId ? '[]' : '{}'}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {item.name}
            </div>
            {item.tags.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {item.tags.slice(0, 3).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">
                Click to insert this reusable object
              </div>
            )}
          </div>
        </>
      )}
      title="Reusable Objects Library"
    />
  );
}
