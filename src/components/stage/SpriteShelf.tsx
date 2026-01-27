import { useState, useRef } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import type { GameObject } from '../../types';

export function SpriteShelf() {
  const { project, addObject, removeObject, duplicateObject, updateObject } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectObject } = useEditorStore();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; object: GameObject } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);

  if (!selectedScene) return null;

  const handleAddObject = () => {
    if (!selectedSceneId) return;
    const newName = `Object ${selectedScene.objects.length + 1}`;
    const newObject = addObject(selectedSceneId, newName);
    selectObject(newObject.id);
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

  const handleRename = () => {
    if (!contextMenu) return;
    setEditingId(contextMenu.object.id);
    setEditName(contextMenu.object.name);
    handleCloseContextMenu();
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSaveRename = () => {
    if (editingId && editName.trim() && selectedSceneId) {
      updateObject(selectedSceneId, editingId, { name: editName.trim() });
    }
    setEditingId(null);
    setEditName('');
  };

  const handleMakeReusable = () => {
    // TODO: Implement reusable objects
    console.log('Make reusable:', contextMenu?.object);
    handleCloseContextMenu();
  };

  // Get color for object thumbnail
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
    <div className="h-32 bg-white border-t border-[var(--color-border)] p-3">
      <div className="flex items-center gap-2 h-full overflow-x-auto">
        {/* Existing objects */}
        {selectedScene.objects.map(object => (
          <div
            key={object.id}
            onClick={() => selectObject(object.id)}
            onContextMenu={(e) => handleContextMenu(e, object)}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg cursor-pointer transition-all shrink-0 ${
              selectedObjectId === object.id
                ? 'bg-[var(--color-primary)]/10 ring-2 ring-[var(--color-primary)]'
                : 'hover:bg-gray-100'
            }`}
          >
            {/* Thumbnail */}
            <div
              className="w-16 h-16 rounded-lg flex items-center justify-center text-2xl"
              style={{ backgroundColor: getObjectColor(object.id) }}
            >
              {object.spriteAssetId ? '🖼️' : '📦'}
            </div>

            {/* Name */}
            {editingId === object.id ? (
              <input
                ref={inputRef}
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={handleSaveRename}
                onKeyDown={e => e.key === 'Enter' && handleSaveRename()}
                className="w-16 px-1 text-xs text-center bg-white border border-[var(--color-primary)] rounded outline-none"
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className="text-xs text-gray-600 truncate max-w-16 text-center">
                {object.name}
              </span>
            )}
          </div>
        ))}

        {/* Add button */}
        <button
          onClick={handleAddObject}
          className="flex flex-col items-center justify-center gap-1 w-20 h-full border-2 border-dashed border-gray-300 rounded-lg hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-colors shrink-0"
        >
          <span className="text-2xl text-gray-400">+</span>
          <span className="text-xs text-gray-400">Add Object</span>
        </button>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={handleCloseContextMenu}
          />
          <div
            className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-40"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={handleRename}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
            >
              ✏️ Rename
            </button>
            <button
              onClick={handleDuplicate}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
            >
              📋 Duplicate
            </button>
            <div className="border-t border-gray-200 my-1" />
            <button
              onClick={handleMakeReusable}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
            >
              ⭐ Make Reusable
            </button>
            <div className="border-t border-gray-200 my-1" />
            <button
              onClick={handleDelete}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              🗑️ Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
