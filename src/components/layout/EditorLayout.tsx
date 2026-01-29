import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Toolbar } from './Toolbar';
import { ObjectEditor } from '../editors/ObjectEditor';
import { StagePanel } from '../stage/StagePanel';
import { PhaserCanvas } from '../stage/PhaserCanvas';
import { ProjectDialog } from '../dialogs/ProjectDialog';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { loadProject } from '@/db/database';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

type HoveredPanel = 'code' | 'stage' | null;
type FullscreenPanel = 'code' | 'stage' | null;

export function EditorLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { project, openProject, saveCurrentProject } = useProjectStore();
  const { isPlaying, showProjectDialog, setShowProjectDialog, selectScene, startPlaying, stopPlaying } = useEditorStore();
  const [dividerPosition, setDividerPosition] = useState(70);
  const [hoveredPanel, setHoveredPanel] = useState<HoveredPanel>(null);
  const [fullscreenPanel, setFullscreenPanel] = useState<FullscreenPanel>(null);
  const [isLoading, setIsLoading] = useState(false);
  const hoveredPanelRef = useRef<HoveredPanel>(null);

  // Keep ref in sync for use in event handler
  useEffect(() => {
    hoveredPanelRef.current = hoveredPanel;
  }, [hoveredPanel]);

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
        // No project in URL and no project open - show dialog
        setShowProjectDialog(true);
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

    if (e.key === 'Enter' && !isTyping && !isPlaying && project && !fullscreenPanel) {
      e.preventDefault();
      startPlaying();
      return;
    }
  }, [isPlaying, project, saveCurrentProject, startPlaying, stopPlaying, fullscreenPanel]);

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
          <div className="flex-1 flex items-center justify-center bg-background">
            <div className="text-center">
              <div className="w-24 h-24 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="text-primary-foreground font-bold text-3xl">PC</span>
              </div>
              <h1 className="text-2xl font-bold mb-2">Welcome to PochaCoding</h1>
              <p className="text-muted-foreground mb-6">Create amazing games with visual programming!</p>
              <Button
                onClick={() => setShowProjectDialog(true)}
                size="lg"
              >
                Get Started
              </Button>
            </div>
          </div>
        )}
      </div>

      {showProjectDialog && (
        <ProjectDialog
          onClose={() => setShowProjectDialog(false)}
          onProjectOpen={handleProjectOpen}
        />
      )}
    </div>
  );
}
