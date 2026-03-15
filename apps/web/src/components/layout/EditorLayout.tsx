import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Toolbar } from './Toolbar';
import { ObjectEditor } from '../editors/ObjectEditor';
import { StagePanel } from '../stage/StagePanel';
import { PhaserCanvas } from '../stage/PhaserCanvas';
import { ObjectPicker } from '../stage/ObjectPicker';
import { BackgroundCanvasEditor } from '../stage/BackgroundCanvasEditor';
import { ProjectDialog } from '../dialogs/ProjectDialog';
import { PlayValidationDialog } from '../dialogs/PlayValidationDialog';
import { AiAssistantPanel } from '../assistant/AiAssistantPanel';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { CURRENT_SCHEMA_VERSION, createAutoCheckpoint, loadProject, migrateAllLocalProjects } from '@/db/database';
import { useCloudSync } from '@/hooks/useCloudSync';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { tryStartPlaying } from '@/lib/playStartGuard';
import { getSceneObjectsInLayerOrder } from '@/utils/layerTree';
import { isBlocklyShortcutTarget, isTextEntryTarget } from '@/utils/keyboard';
import { deleteSceneObjectsWithHistory, duplicateSceneObjectsWithHistory } from '@/lib/editor/objectCommands';

type HoveredPanel = 'code' | 'stage' | null;
type FullscreenPanel = 'code' | 'stage' | null;

export function EditorLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { project, isDirty, openProject, saveCurrentProject, duplicateObject, removeObject } = useProjectStore();
  const {
    isPlaying,
    selectedSceneId,
    selectedObjectId,
    selectedObjectIds,
    showProjectDialog,
    setShowProjectDialog,
    selectScene,
    selectObjects,
    stopPlaying,
    undo,
    redo,
    showPlayValidationDialog,
    playValidationIssues,
    setShowPlayValidationDialog,
    focusPlayValidationIssue,
    activeObjectTab,
    costumeUndoHandler,
    backgroundEditorOpen,
    backgroundShortcutHandler,
    assistantLockRunId,
    assistantLockMessage,
  } = useEditorStore();
  const [dividerPosition, setDividerPosition] = useState(60);
  const [hoveredPanel, setHoveredPanel] = useState<HoveredPanel>(null);
  const [fullscreenPanel, setFullscreenPanel] = useState<FullscreenPanel>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBlockingCloudSync, setIsBlockingCloudSync] = useState(false);
  const hoveredPanelRef = useRef<HoveredPanel>(null);
  const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const isBlockingCloudSyncRef = useRef(false);
  const activeProjectId = project?.id ?? null;

  // Cloud sync is exit-oriented to reduce bandwidth (unmount / unload).
  const { syncProjectToCloud } = useCloudSync({
    currentProjectId: project?.id ?? null,
    currentProject: project,
    isDirty,
    syncOnUnmount: false,
    checkpointIntervalMs: 10 * 60 * 1000,
  });


  useEffect(() => {
    if (!project || !isDirty) return;

    const timeout = window.setTimeout(() => {
      void saveCurrentProject();
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [project, isDirty, saveCurrentProject]);

  useEffect(() => {
    isBlockingCloudSyncRef.current = isBlockingCloudSync;
  }, [isBlockingCloudSync]);

  useEffect(() => {
    if (!activeProjectId) return;

    const intervalId = window.setInterval(() => {
      const latestProject = useProjectStore.getState().project;
      if (!latestProject) return;
      void createAutoCheckpoint(latestProject);
    }, 2 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [activeProjectId]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!project || isBlockingCloudSyncRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = 'Please wait, Uploading/Syncing to Cloud.';

      setIsBlockingCloudSync(true);
      void (async () => {
        try {
          await saveCurrentProject();
          await syncProjectToCloud(project.id);
        } catch (error) {
          console.error('[CloudSync] Failed to sync before unload:', error);
        } finally {
          setIsBlockingCloudSync(false);
        }
      })();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [project, saveCurrentProject, syncProjectToCloud]);

  // Keep ref in sync for use in event handler
  useEffect(() => {
    hoveredPanelRef.current = hoveredPanel;
  }, [hoveredPanel]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      lastPointerPositionRef.current = { x: event.clientX, y: event.clientY };
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, []);

  const getPanelFromElement = useCallback((element: Element | null): HoveredPanel => {
    const panelElement = element?.closest('[data-editor-panel]');
    if (!panelElement) return null;
    const panel = panelElement.getAttribute('data-editor-panel');
    return panel === 'code' || panel === 'stage' ? panel : null;
  }, []);

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
      selectScene(project.scenes[0].id, { recordHistory: false });
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
    const isTyping = isTextEntryTarget(e.target);
    const isInBlocklyArea = isBlocklyShortcutTarget(e.target);

    if (e.defaultPrevented || e.isComposing) {
      return;
    }

    if (assistantLockRunId) {
      e.preventDefault();
      return;
    }

    if (backgroundEditorOpen) {
      if (isTyping) {
        return;
      }

      const handled = backgroundShortcutHandler?.(e) ?? false;
      if (handled) {
        return;
      }

      if (
        e.key === '`' ||
        e.key === 'Escape' ||
        e.key === 'Enter' ||
        e.key === 'Delete' ||
        e.key === 'Backspace' ||
        e.metaKey ||
        e.ctrlKey
      ) {
        e.preventDefault();
      }
      return;
    }

    // Backtick for fullscreen toggle
    if (e.key === '`' && !isTyping) {
      e.preventDefault();
      if (fullscreenPanel) {
        // Exit fullscreen
        setFullscreenPanel(null);
      } else {
        const panelFromTarget = getPanelFromElement(target);
        const pointerPosition = lastPointerPositionRef.current;
        const elementUnderPointer = pointerPosition
          ? document.elementFromPoint(pointerPosition.x, pointerPosition.y)
          : null;
        const panelFromPointer = getPanelFromElement(elementUnderPointer);
        const panelToFullscreen = panelFromPointer ?? panelFromTarget ?? hoveredPanelRef.current;

        if (panelToFullscreen) {
          setFullscreenPanel(panelToFullscreen);
        }
      }
      return;
    }

    // Escape to exit fullscreen or stop playing
    if (e.key === 'Escape' && !isTyping) {
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

    // Undo: Cmd+Z or Ctrl+Z
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      if (isTyping && !isInBlocklyArea) {
        return;
      }
      e.preventDefault();
      undo();
      return;
    }

    // Redo: Cmd+Shift+Z / Ctrl+Shift+Z / Ctrl+Y
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
      if (isTyping && !isInBlocklyArea) {
        return;
      }
      e.preventDefault();
      redo();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      if (isTyping && !isInBlocklyArea) {
        return;
      }
      e.preventDefault();
      redo();
      return;
    }

    // Duplicate selected object(s): Cmd/Ctrl + D (disabled in Blockly area)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      if (isTyping) {
        return;
      }

      if (activeObjectTab === 'costumes') {
        e.preventDefault();
        void Promise.resolve(costumeUndoHandler?.duplicateSelection?.()).catch((error) => {
          console.error('Failed to duplicate costume selection:', error);
        });
        return;
      }

      if (isInBlocklyArea || !selectedSceneId) {
        return;
      }

      const idsToDuplicate = selectedObjectIds.length > 0
        ? selectedObjectIds
        : (selectedObjectId ? [selectedObjectId] : []);

      if (idsToDuplicate.length === 0) {
        return;
      }

      e.preventDefault();

      duplicateSceneObjectsWithHistory({
        source: 'shortcut:duplicate',
        sceneId: selectedSceneId,
        objectIds: idsToDuplicate,
        duplicateObject,
        selectObjects,
      });
      return;
    }

    // Delete selected object(s): Delete/Backspace (disabled in Blockly area)
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping && !isInBlocklyArea) {
      if (activeObjectTab === 'costumes') {
        e.preventDefault();
        costumeUndoHandler?.deleteSelection?.();
        return;
      }

      if (!selectedSceneId) {
        return;
      }

      const idsToDelete = selectedObjectIds.length > 0
        ? selectedObjectIds
        : (selectedObjectId ? [selectedObjectId] : []);

      if (idsToDelete.length === 0) {
        return;
      }

      e.preventDefault();
      const selectedScene = project?.scenes.find((scene) => scene.id === selectedSceneId);
      const orderedSceneObjectIds = selectedScene
        ? getSceneObjectsInLayerOrder(selectedScene).map((object) => object.id)
        : [];

      deleteSceneObjectsWithHistory({
        source: 'shortcut:delete',
        sceneId: selectedSceneId,
        deleteIds: idsToDelete,
        orderedSceneObjectIds,
        selectedObjectId,
        selectedObjectIds: idsToDelete.length > 0 ? idsToDelete : [],
        removeObject,
        selectObject: (objectId) => selectObjects(objectId ? [objectId] : [], objectId),
        selectObjects,
      });
      return;
    }

    if (e.key === 'Enter' && activeObjectTab === 'costumes' && costumeUndoHandler?.isTextEditing?.()) {
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
    stopPlaying,
    fullscreenPanel,
    undo,
    redo,
    selectedSceneId,
    selectedObjectId,
    selectedObjectIds,
    duplicateObject,
    removeObject,
    selectObjects,
    getPanelFromElement,
    activeObjectTab,
    costumeUndoHandler,
    backgroundEditorOpen,
    backgroundShortcutHandler,
    assistantLockRunId,
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

  if (backgroundEditorOpen) {
    return <BackgroundCanvasEditor />;
  }

  // Fullscreen code editor
  if (fullscreenPanel === 'code') {
    return (
      <div className="fixed inset-0 z-[100001] bg-background flex flex-col">
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
      <div className="fixed inset-0 z-[100001] bg-background flex flex-col">
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
    <div className="relative flex flex-col h-screen bg-background">
      <Toolbar />

      <div className="flex flex-1 overflow-hidden">
        {project ? (
          <>
            {/* Object Editor - Left Panel */}
            <div
              className="h-full border-r"
              data-editor-panel="code"
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
              data-editor-panel="stage"
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

      {isBlockingCloudSync && (
        <div className="fixed inset-0 z-[100002] bg-black/45 flex items-center justify-center">
          <div className="rounded-lg border bg-background px-5 py-4 text-sm shadow-xl">
            Please wait, Uploading/Syncing to Cloud.
          </div>
        </div>
      )}

      {assistantLockRunId && !isBlockingCloudSync ? (
        <div className="fixed inset-0 z-[100250] bg-background/70 backdrop-blur-[1px] flex items-center justify-center">
          <div className="rounded-lg border bg-background px-5 py-4 text-sm shadow-xl">
            {assistantLockMessage ?? 'Assistant is working. The editor is temporarily locked.'}
          </div>
        </div>
      ) : null}

      <AiAssistantPanel />
    </div>
  );
}
