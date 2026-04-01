import { useRef, useState } from 'react';
import Color from 'color';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { Button } from '@/components/ui/button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import {
  CompactColorPicker,
} from '@/components/ui/color-picker';
import { ColorSwatchButton } from '@/components/ui/color-swatch-button';
import { Paintbrush, Plus, X } from '@/components/ui/icons';
import { runInHistoryTransaction } from '@/store/universalHistory';

export function SceneTabs() {
  const { project, addScene, removeScene, updateScene } = useProjectStore();
  const { selectedSceneId, selectScene, clearSceneUiState, openBackgroundEditor } = useEditorStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editWidth, setEditWidth] = useState<number | null>(null);
  const [showBgColorPicker, setShowBgColorPicker] = useState(false);
  const cancelEditOnBlurRef = useRef(false);

  const selectedScene = project?.scenes.find(s => s.id === selectedSceneId);
  const currentBgColor = !selectedScene?.background || selectedScene.background.type === 'image'
    ? '#87CEEB'
    : selectedScene.background.value;

  const handleBgColorChange = (color: string) => {
    if (selectedSceneId && selectedScene) {
      updateScene(selectedSceneId, {
        background: selectedScene.background?.type === 'tiled'
          ? { ...selectedScene.background, value: color }
          : { type: 'color', value: color }
      });
    }
  };

  const handleBgPickerChange = (value: Parameters<typeof Color>[0]) => {
    try {
      const hex = Color(value).hex();
      handleBgColorChange(hex);
    } catch {
      // Ignore invalid color values from picker
    }
  };

  if (!project) return null;

  const handleAddScene = () => {
    const newName = `Scene ${project.scenes.length + 1}`;
    addScene(newName);
  };

  const handleDoubleClick = (scene: typeof project.scenes[0], event: React.MouseEvent<HTMLDivElement>) => {
    setEditingId(scene.id);
    setEditName(scene.name);
    setEditError(null);
    setEditWidth(event.currentTarget.getBoundingClientRect().width);
  };

  const handleSaveEdit = () => {
    if (cancelEditOnBlurRef.current) {
      cancelEditOnBlurRef.current = false;
      return;
    }

    if (!editingId) return;

    const nextName = editName.trim();
    if (!nextName) {
      setEditError('Scene name is required.');
      return;
    }

    const normalizedNextName = nextName.toLowerCase();
    const duplicateExists = project.scenes.some(
      (scene) => scene.id !== editingId && scene.name.trim().toLowerCase() === normalizedNextName,
    );
    if (duplicateExists) {
      setEditError('Scene name must be unique.');
      return;
    }

    updateScene(editingId, { name: nextName });
    setEditingId(null);
    setEditName('');
    setEditError(null);
    setEditWidth(null);
  };

  const handleDeleteScene = (sceneId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (project.scenes.length > 1) {
      runInHistoryTransaction('scene-tabs:delete-scene', () => {
        removeScene(sceneId);
        clearSceneUiState(sceneId);
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
          onDoubleClick={(event) => handleDoubleClick(scene, event)}
          className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
            selectedSceneId === scene.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
          }`}
          style={editingId === scene.id && editWidth ? { width: `${editWidth}px` } : undefined}
        >
          <InlineRenameField
            editing={editingId === scene.id}
            value={editingId === scene.id ? editName : scene.name}
            onChange={e => {
              setEditName(e.target.value);
              setEditError(null);
            }}
            onBlur={handleSaveEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleSaveEdit();
              }
              if (e.key === 'Escape') {
                cancelEditOnBlurRef.current = true;
                setEditingId(null);
                setEditName('');
                setEditError(null);
                setEditWidth(null);
              }
            }}
            className="flex-1 min-w-0"
            textClassName="truncate text-sm font-medium leading-5 text-current"
            invalid={!!editError}
            autoFocus={editingId === scene.id}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
          />
          {editingId !== scene.id && project.scenes.length > 1 && (
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
      <div className="relative flex items-center gap-2">
        <span className="text-xs text-muted-foreground">BG:</span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => selectedSceneId && openBackgroundEditor(selectedSceneId)}
          disabled={!selectedSceneId}
          title="Draw background"
        >
          <Paintbrush className="size-3.5" />
          Draw
        </Button>
        <ColorSwatchButton
          value={currentBgColor}
          onClick={() => setShowBgColorPicker(!showBgColorPicker)}
          className="h-7 w-7 cursor-pointer rounded transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          swatchClassName="size-full rounded-[inherit]"
          title="Change background color"
        />
        {showBgColorPicker && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowBgColorPicker(false)}
            />
            <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-lg p-3 shadow-lg">
              <CompactColorPicker value={currentBgColor} onChange={handleBgPickerChange} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
