import { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { listReusables, loadReusable, deleteReusable } from '../../db/database';
import type { ReusableObject } from '../../types';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-[500px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900">Reusable Objects Library</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-gray-500 py-8">Loading...</div>
          ) : reusables.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <p className="mb-2">No reusable objects yet</p>
              <p className="text-sm">Right-click an object and select "Make Reusable" to save it here</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {reusables.map(reusable => (
                <div
                  key={reusable.id}
                  onClick={() => setSelectedId(reusable.id)}
                  className={`relative group p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedId === reusable.id
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                      : 'border-gray-200 hover:border-gray-300'
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
                  <p className="text-sm text-center text-gray-700 truncate">
                    {reusable.name}
                  </p>

                  {/* Tags */}
                  {reusable.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 justify-center">
                      {reusable.tags.slice(0, 2).map(tag => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full"
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
                    className="absolute top-2 right-2 w-6 h-6 bg-red-100 text-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleInsert}
            disabled={!selectedId}
            className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Insert Object
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
