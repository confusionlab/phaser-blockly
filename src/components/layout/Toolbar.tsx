import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { downloadProject } from '@/db/database';
import { Button } from '@/components/ui/button';
import { Play, Square, Upload, Save } from 'lucide-react';

export function Toolbar() {
  const navigate = useNavigate();
  const { project, isDirty, saveCurrentProject, closeProject } = useProjectStore();
  const { isPlaying, startPlaying, stopPlaying } = useEditorStore();

  const handleGoHome = () => {
    closeProject();
    navigate('/');
  };

  const handleSave = async () => {
    await saveCurrentProject();
  };

  const handlePlay = () => {
    if (isPlaying) {
      stopPlaying();
    } else {
      startPlaying();
    }
  };

  return (
    <div className="flex items-center justify-between h-12 px-4 bg-card border-b">
      {/* Left section - Logo and project name */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleGoHome}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">PC</span>
          </div>
          <span className="font-semibold text-primary">PochaCoding</span>
        </button>

        {project && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">|</span>
            <span className="font-medium">{project.name}</span>
            {isDirty && <span className="text-muted-foreground">*</span>}
          </div>
        )}
      </div>

      {/* Center section - Play controls */}
      <div className="flex items-center gap-2">
        {project && (
          <Button
            onClick={handlePlay}
            variant={isPlaying ? 'destructive' : 'default'}
            className={!isPlaying ? 'bg-green-600 hover:bg-green-700' : ''}
          >
            {isPlaying ? (
              <>
                <Square className="size-4" />
                Stop
              </>
            ) : (
              <>
                <Play className="size-4" />
                Play
              </>
            )}
          </Button>
        )}
      </div>

      {/* Right section - Actions */}
      <div className="flex items-center gap-2">
        {project && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadProject(project)}
            title="Export project as JSON file"
          >
            <Upload className="size-4" />
            Export
          </Button>
        )}

        {project && (
          <Button
            variant={isDirty ? 'default' : 'secondary'}
            size="sm"
            onClick={handleSave}
            disabled={!isDirty}
          >
            <Save className="size-4" />
            Save
          </Button>
        )}
      </div>
    </div>
  );
}
