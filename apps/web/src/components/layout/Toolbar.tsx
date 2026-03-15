import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from 'convex/react';
import { api } from '@convex-generated/api';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { downloadProject } from '@/db/database';
import { useCloudSync } from '@/hooks/useCloudSync';
import { ProjectHistoryDialog } from '@/components/dialogs/ProjectHistoryDialog';
import { Button } from '@/components/ui/button';
import { Upload, History, Sun, Moon } from 'lucide-react';

export function Toolbar() {
  const navigate = useNavigate();
  const { project, isDirty, saveCurrentProject, closeProject, updateProjectName, openProject } = useProjectStore();
  const { isDarkMode, toggleDarkMode, selectScene } = useEditorStore();
  const updateMySettings = useMutation(api.userSettings.updateMySettings);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const cancelProjectRenameOnBlurRef = useRef(false);
  const { syncProjectToCloud } = useCloudSync({
    currentProjectId: project?.id ?? null,
    currentProject: project,
    isDirty,
    syncOnUnmount: false,
    checkpointIntervalMs: 0,
  });
  const syncCurrentProjectToCloud = async (): Promise<boolean> => {
    if (!project) return true;

    setIsSyncingCloud(true);
    try {
      await saveCurrentProject();
      const synced = await syncProjectToCloud(project.id);
      if (!synced) {
        alert('Cloud sync failed. Please try Upload/Update to Cloud again.');
        return false;
      }
      return true;
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const handleGoHome = async () => {
    if (project) {
      const synced = await syncCurrentProjectToCloud();
      if (!synced) return;
    }

    closeProject();
    navigate('/');
  };

  const handleToggleDarkMode = async () => {
    const nextIsDarkMode = !isDarkMode;
    toggleDarkMode();
    try {
      await updateMySettings({ isDarkMode: nextIsDarkMode });
    } catch (error) {
      console.error('[UserSettings] Failed to persist dark mode setting:', error);
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
    if (cancelProjectRenameOnBlurRef.current) {
      cancelProjectRenameOnBlurRef.current = false;
      return;
    }

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
    <>
      <div className="flex items-center justify-between h-12 px-4 bg-card border-b">
        <div className="flex items-center gap-4">
          <button
            onClick={() => void handleGoHome()}
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
                      cancelProjectRenameOnBlurRef.current = true;
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

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void handleToggleDarkMode()}
            title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>

          {project && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void downloadProject(project)}
              title="Export project bundle"
              disabled={isSyncingCloud}
            >
              <Upload className="size-4" />
              Export
            </Button>
          )}

          {project && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen(true)}
              disabled={isSyncingCloud}
              title="Open version history"
            >
              <History className="size-4" />
              History
            </Button>
          )}

        </div>
      </div>

      <ProjectHistoryDialog
        project={project}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestoredProject={(restoredProject) => {
          openProject(restoredProject);
          if (restoredProject.scenes.length > 0) {
            selectScene(restoredProject.scenes[0].id, { recordHistory: false });
          }
          navigate(`/project/${restoredProject.id}`);
        }}
      />

      {isSyncingCloud && (
        <div className="fixed inset-0 z-[9999] bg-black/45 flex items-center justify-center">
          <div className="rounded-lg border bg-background px-5 py-4 text-sm shadow-xl">
            Please wait, Uploading/Syncing to Cloud.
          </div>
        </div>
      )}
    </>
  );
}
