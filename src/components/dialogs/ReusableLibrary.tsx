import { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { listReusables, loadReusable, deleteReusable } from '@/db/database';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { X } from 'lucide-react';
import type { ReusableObject } from '@/types';
import { runInHistoryTransaction } from '@/store/universalHistory';

interface ReusableLibraryProps {
  onClose: () => void;
}

export function ReusableLibrary({ onClose }: ReusableLibraryProps) {
  const [reusables, setReusables] = useState<ReusableObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { addObject } = useProjectStore();
  const { selectedSceneId, selectObject } = useEditorStore();

  const fetchReusables = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listReusables();
      setReusables(items);
    } catch (e) {
      console.error('Failed to load reusables:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchReusables();
  }, [fetchReusables]);

  const handleInsert = async () => {
    if (!selectedId || !selectedSceneId) return;

    try {
      const reusable = await loadReusable(selectedId);
      if (!reusable) return;

      // Create a new GameObject from the reusable
      runInHistoryTransaction('reusable-library:insert-object', () => {
        const newObject = addObject(selectedSceneId, reusable.name);

        // Update with reusable data
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
      onClose();
    } catch (e) {
      console.error('Failed to insert reusable:', e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this reusable object?')) return;

    try {
      await deleteReusable(id);
      setReusables(prev => prev.filter(r => r.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (e) {
      console.error('Failed to delete reusable:', e);
    }
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Reusable Objects Library</DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="text-center text-muted-foreground py-8">Loading...</div>
          ) : reusables.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <p className="mb-2">No reusable objects yet</p>
              <p className="text-sm">Right-click an object and select "Make Reusable" to save it here</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {reusables.map(reusable => (
                <Card
                  key={reusable.id}
                  onClick={() => setSelectedId(reusable.id)}
                  className={`relative group p-3 cursor-pointer transition-all ${
                    selectedId === reusable.id
                      ? 'ring-2 ring-primary bg-primary/5'
                      : 'hover:bg-accent'
                  }`}
                >
                  {/* Thumbnail */}
                  <div
                    className="w-full aspect-square rounded-lg flex items-center justify-center text-3xl mb-2"
                    style={{ backgroundColor: reusable.thumbnail || getObjectColor(reusable.id) }}
                  >
                    {reusable.spriteAssetId ? '🖼️' : '📦'}
                  </div>

                  {/* Name */}
                  <p className="text-sm text-center truncate">
                    {reusable.name}
                  </p>

                  {/* Tags */}
                  {reusable.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 justify-center">
                      {reusable.tags.slice(0, 2).map(tag => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(reusable.id);
                    }}
                    className="absolute top-2 right-2 w-6 h-6 bg-destructive/10 text-destructive rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    <X className="size-3" />
                  </button>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleInsert} disabled={!selectedId}>
            Insert Object
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
