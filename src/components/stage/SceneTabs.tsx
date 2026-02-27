import { useState, useRef } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X } from 'lucide-react';
import { runInHistoryTransaction } from '@/store/universalHistory';

export function SceneTabs() {
  const { project, addScene, removeScene, updateScene } = useProjectStore();
  const { selectedSceneId, selectScene } = useEditorStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const colorInputRef = useRef<HTMLInputElement>(null);

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);
  const currentBgColor = selectedScene?.background?.type === 'color'
    ? selectedScene.background.value
    : '#87CEEB';

  const handleBgColorChange = (color: string) => {
    if (selectedSceneId) {
      updateScene(selectedSceneId, {
        background: { type: 'color', value: color }
      });
    }
  };

  if (!project) return null;

  const handleAddScene = () => {
    const newName = `Scene ${project.scenes.length + 1}`;
    addScene(newName);
  };

  const handleDoubleClick = (scene: typeof project.scenes[0]) => {
    setEditingId(scene.id);
    setEditName(scene.name);
  };

  const handleSaveEdit = () => {
    if (editingId && editName.trim()) {
      updateScene(editingId, { name: editName.trim() });
    }
    setEditingId(null);
    setEditName('');
  };

  const handleDeleteScene = (sceneId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (project.scenes.length > 1) {
      runInHistoryTransaction('scene-tabs:delete-scene', () => {
        removeScene(sceneId);
        if (selectedSceneId === sceneId) {
          const remaining = project.scenes.filter(s => s.id !== sceneId);
          selectScene(remaining[0]?.id || null);
        }
      });
    }
  };

  return (
    <div className="flex items-center gap-1 px-4 py-2 bg-card border-b overflow-x-auto">
      {project.scenes.map(scene => (
        <div
          key={scene.id}
          onClick={() => selectScene(scene.id)}
          onDoubleClick={() => handleDoubleClick(scene)}
          className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
            selectedSceneId === scene.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
          }`}
        >
          {editingId === scene.id ? (
            <Input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={handleSaveEdit}
              onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
              className="w-24 h-6 px-1 py-0.5 text-sm"
              autoFocus
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="text-sm font-medium">{scene.name}</span>
              {project.scenes.length > 1 && (
                <button
                  onClick={(e) => handleDeleteScene(scene.id, e)}
                  className={`opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 rounded-full flex items-center justify-center ${
                    selectedSceneId === scene.id
                      ? 'hover:bg-primary-foreground/20'
                      : 'hover:bg-secondary-foreground/20'
                  }`}
                >
                  <X className="size-3" />
                </button>
              )}
            </>
          )}
        </div>
      ))}

      <Button
        variant="secondary"
        size="icon-sm"
        onClick={handleAddScene}
        title="Add Scene"
      >
        <Plus className="size-4" />
      </Button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Background color picker */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">BG:</span>
        <button
          onClick={() => colorInputRef.current?.click()}
          className="w-7 h-7 rounded border-2 border-border hover:border-primary transition-colors cursor-pointer"
          style={{ backgroundColor: currentBgColor }}
          title="Change background color"
        />
        <input
          ref={colorInputRef}
          type="color"
          value={currentBgColor}
          onChange={(e) => handleBgColorChange(e.target.value)}
          className="sr-only"
        />
      </div>
    </div>
  );
}
