import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { downloadProject } from '@/db/database';
import { useCloudSync } from '@/hooks/useCloudSync';
import { Button } from '@/components/ui/button';
import { Upload, Save, Sun, Moon } from 'lucide-react';

export function Toolbar() {
  const navigate = useNavigate();
  const { project, isDirty, saveCurrentProject, closeProject, updateProjectName } = useProjectStore();
  const { isDarkMode, toggleDarkMode } = useEditorStore();
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const { syncProjectToCloud } = useCloudSync({
    currentProjectId: project?.id ?? null,
    currentProject: project,
    syncOnUnmount: false,
  });

  const handleGoHome = async () => {
    if (project) {
      setIsSyncingCloud(true);
      try {
        await saveCurrentProject();
        const synced = await syncProjectToCloud(project.id);
        if (!synced) {
          alert('Cloud sync failed. Please try Save again before leaving this project.');
          return;
        }
      } finally {
        setIsSyncingCloud(false);
      }
    }

    closeProject();
    navigate('/');
  };

  const handleSave = async () => {
    if (!project) return;
    setIsSyncingCloud(true);
    try {
      await saveCurrentProject();
      const synced = await syncProjectToCloud(project.id);
      if (!synced) {
        alert('Cloud sync failed. Please try saving again.');
      }
    } finally {
      setIsSyncingCloud(false);
    }
  };

  useEffect(() => {
    if (isEditingProjectName) {
      projectNameInputRef.current?.focus();
      projectNameInputRef.current?.select();
    }
  }, [isEditingProjectName]);

  const handleStartProjectRename = () => {
    if (!project) return;
    setProjectNameDraft(project.name);
    setIsEditingProjectName(true);
  };

  const handleSaveProjectRename = () => {
    if (!project) return;

    const nextName = projectNameDraft.trim();
    if (nextName && nextName !== project.name) {
      updateProjectName(nextName);
    }
    setIsEditingProjectName(false);
  };

  const handleCancelProjectRename = () => {
    setProjectNameDraft(project?.name ?? '');
    setIsEditingProjectName(false);
  };

  return (
    <div className="flex items-center justify-between h-12 px-4 bg-card border-b">
      {/* Left section - Logo and project name */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleGoHome}
          disabled={isSyncingCloud}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <img src="/logo.png" alt="PochaCoding logo" className="w-8 h-8 object-contain dark:invert" />
          <span className="font-semibold text-primary">PochaCoding</span>
        </button>

        {project && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">|</span>
            {isEditingProjectName ? (
              <input
                ref={projectNameInputRef}
                value={projectNameDraft}
                onChange={(e) => setProjectNameDraft(e.target.value)}
                onBlur={handleSaveProjectRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveProjectRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    handleCancelProjectRename();
                  }
                }}
                className="h-7 w-52 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Project name"
              />
            ) : (
              <button
                onClick={handleStartProjectRename}
                className="font-medium rounded px-1 -mx-1 hover:bg-accent transition-colors"
                title="Click to rename project"
              >
                {project.name}
              </button>
            )}
            {isDirty && <span className="text-muted-foreground">*</span>}
          </div>
        )}
      </div>

      <div />

      {/* Right section - Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleDarkMode}
          title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDarkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

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
            disabled={isSyncingCloud}
          >
            <Save className="size-4" />
            {isSyncingCloud ? 'Syncing...' : 'Save'}
          </Button>
        )}
      </div>
    </div>
  );
}
