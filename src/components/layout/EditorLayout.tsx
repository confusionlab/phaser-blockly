import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Toolbar } from './Toolbar';
import { ObjectEditor } from '../editors/ObjectEditor';
import { StagePanel } from '../stage/StagePanel';
import { PhaserCanvas } from '../stage/PhaserCanvas';
import { ObjectPicker } from '../stage/ObjectPicker';
import { ProjectDialog } from '../dialogs/ProjectDialog';
import { PlayValidationDialog } from '../dialogs/PlayValidationDialog';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { CURRENT_SCHEMA_VERSION, loadProject, migrateAllLocalProjects } from '@/db/database';
import { useCloudSync } from '@/hooks/useCloudSync';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { tryStartPlaying } from '@/lib/playStartGuard';

type HoveredPanel = 'code' | 'stage' | null;
type FullscreenPanel = 'code' | 'stage' | null;

export function EditorLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { project, isDirty, openProject, saveCurrentProject, duplicateObject } = useProjectStore();
  const {
    isPlaying,
    selectedSceneId,
    selectedObjectId,
    showProjectDialog,
    setShowProjectDialog,
    selectScene,
    selectObject,
    stopPlaying,
    undo,
    redo,
    showPlayValidationDialog,
    playValidationIssues,
    setShowPlayValidationDialog,
    focusPlayValidationIssue,
  } = useEditorStore();
  const [dividerPosition, setDividerPosition] = useState(70);
  const [hoveredPanel, setHoveredPanel] = useState<HoveredPanel>(null);
  const [fullscreenPanel, setFullscreenPanel] = useState<FullscreenPanel>(null);
  const [isLoading, setIsLoading] = useState(false);
  const hoveredPanelRef = useRef<HoveredPanel>(null);

  // Cloud sync is exit-oriented to reduce bandwidth (unmount / unload).
  useCloudSync({
    currentProjectId: project?.id ?? null,
    currentProject: project,
  });


  useEffect(() => {
    if (!project || !isDirty) return;

    const timeout = window.setTimeout(() => {
      void saveCurrentProject();
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [project, isDirty, saveCurrentProject]);

  // Keep ref in sync for use in event handler
  useEffect(() => {
    hoveredPanelRef.current = hoveredPanel;
  }, [hoveredPanel]);

  // Run local project migrations proactively so every project stays schema-compatible.
  useEffect(() => {
    void (async () => {
      const result = await migrateAllLocalProjects();
      if (result.migrated > 0) {
        console.log(`[Migration] Migrated ${result.migrated} local projects to schema v${CURRENT_SCHEMA_VERSION}`);
      }
      if (result.failed > 0) {
        console.error(`[Migration] Failed to migrate ${result.failed} local projects`);
      }
    })();
  }, []);

  // Load project from URL
  useEffect(() => {
    const loadFromUrl = async () => {
      if (projectId && (!project || project.id !== projectId)) {
        setIsLoading(true);
        try {
          const loadedProject = await loadProject(projectId);
          if (loadedProject) {
            openProject(loadedProject);
          } else {
            // Project not found, redirect to home
            navigate('/', { replace: true });
          }
        } catch (e) {
          console.error('Failed to load project:', e);
          navigate('/', { replace: true });
        } finally {
          setIsLoading(false);
        }
      } else if (!projectId && project) {
        // URL is home but we have a project open - navigate to project URL
        navigate(`/project/${project.id}`, { replace: true });
      } else if (!projectId && !project) {
        // No project in URL and no project open - show project list page
        setShowProjectDialog(false);
      }
    };

    loadFromUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Select first scene when project changes
  useEffect(() => {
    if (project && project.scenes.length > 0) {
      selectScene(project.scenes[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Navigate to project URL when project is opened
  const handleProjectOpen = useCallback((openedProject: { id: string }) => {
    navigate(`/project/${openedProject.id}`);
    setShowProjectDialog(false);
  }, [navigate, setShowProjectDialog]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isTyping = target.tagName === 'INPUT' ||
                     target.tagName === 'TEXTAREA' ||
                     target.isContentEditable;
    const isInBlocklyArea = !!target.closest('[data-blockly-editor], .blocklyWidgetDiv, .blocklyDropDownDiv');

    // Backtick for fullscreen toggle
    if (e.key === '`' && !isTyping) {
      e.preventDefault();
      if (fullscreenPanel) {
        // Exit fullscreen
        setFullscreenPanel(null);
      } else if (hoveredPanelRef.current) {
        // Enter fullscreen for hovered panel
        setFullscreenPanel(hoveredPanelRef.current);
      }
      return;
    }

    // Escape to exit fullscreen or stop playing
    if (e.key === 'Escape') {
      e.preventDefault();
      if (fullscreenPanel) {
        setFullscreenPanel(null);
        return;
      }
      if (isPlaying) {
        stopPlaying();
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (project) {
        saveCurrentProject();
      }
      return;
    }

    // Undo: Cmd+Z or Ctrl+Z
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }

    // Redo: Cmd+Shift+Z or Ctrl+Shift+Z
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      redo();
      return;
    }

    // Duplicate selected object: Cmd/Ctrl + D (disabled in Blockly area)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      if (isInBlocklyArea || !selectedSceneId || !selectedObjectId) {
        return;
      }

      const duplicated = duplicateObject(selectedSceneId, selectedObjectId);
      if (duplicated) {
        e.preventDefault();
        selectObject(duplicated.id);
      }
      return;
    }

    if (
      e.key === 'Enter' &&
      !isTyping &&
      !isPlaying &&
      project &&
      (fullscreenPanel === null || fullscreenPanel === 'code')
    ) {
      e.preventDefault();
      tryStartPlaying();
      return;
    }
  }, [
    isPlaying,
    project,
    saveCurrentProject,
    stopPlaying,
    fullscreenPanel,
    undo,
    redo,
    selectedSceneId,
    selectedObjectId,
    duplicateObject,
    selectObject,
  ]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleDividerDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startPos = dividerPosition;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const containerWidth = window.innerWidth;
      const newPos = startPos + (deltaX / containerWidth) * 100;
      setDividerPosition(Math.max(20, Math.min(70, newPos)));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  if (isPlaying) {
    return <StagePanel fullscreen />;
  }

  // Fullscreen code editor
  if (fullscreenPanel === 'code') {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
          <span className="text-sm font-medium">Code Editor (Press ` or Esc to exit)</span>
          <Button variant="ghost" size="icon-sm" onClick={() => setFullscreenPanel(null)}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-hidden">
          <ObjectEditor />
        </div>
      </div>
    );
  }

  // Fullscreen stage (canvas only, no properties)
  if (fullscreenPanel === 'stage') {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
          <span className="text-sm font-medium">Stage (Press ` or Esc to exit)</span>
          <Button variant="ghost" size="icon-sm" onClick={() => setFullscreenPanel(null)}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-hidden p-1">
          <div className="relative w-full h-full bg-card rounded-lg overflow-hidden">
            <PhaserCanvas isPlaying={false} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <Toolbar />

      <div className="flex flex-1 overflow-hidden">
        {project ? (
          <>
            {/* Object Editor - Left Panel */}
            <div
              className="h-full border-r"
              style={{ width: `${dividerPosition}%` }}
              onMouseEnter={() => setHoveredPanel('code')}
              onMouseLeave={() => setHoveredPanel(null)}
            >
              <ObjectEditor />
            </div>

            {/* Resizable Divider */}
            <div
              className="w-1 bg-border hover:bg-primary cursor-col-resize transition-colors"
              onMouseDown={handleDividerDrag}
            />

            {/* Stage Panel - Right Panel */}
            <div
              className="h-full overflow-hidden"
              style={{ width: `${100 - dividerPosition}%` }}
              onMouseEnter={() => setHoveredPanel('stage')}
              onMouseLeave={() => setHoveredPanel(null)}
            >
              <StagePanel />
            </div>
          </>
        ) : (
          <ProjectDialog onProjectOpen={handleProjectOpen} mode="page" />
        )}
      </div>

      {project && showProjectDialog && (
        <ProjectDialog
          onClose={() => setShowProjectDialog(false)}
          onProjectOpen={handleProjectOpen}
        />
      )}

      <PlayValidationDialog
        open={showPlayValidationDialog}
        issues={playValidationIssues}
        onOpenChange={setShowPlayValidationDialog}
        onIssueClick={focusPlayValidationIssue}
      />

      {/* Object picker overlay */}
      <ObjectPicker />
    </div>
  );
}
