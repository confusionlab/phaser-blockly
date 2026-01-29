import { useEffect, useState, useCallback } from 'react';
import { Toolbar } from './Toolbar';
import { ObjectEditor } from '../editors/ObjectEditor';
import { StagePanel } from '../stage/StagePanel';
import { ProjectDialog } from '../dialogs/ProjectDialog';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';

export function EditorLayout() {
  const { project, saveCurrentProject } = useProjectStore();
  const { isPlaying, showProjectDialog, setShowProjectDialog, selectScene, startPlaying, stopPlaying } = useEditorStore();
  const [dividerPosition, setDividerPosition] = useState(40); // percentage

  // Auto-select first scene when project loads (only when project ID changes)
  useEffect(() => {
    if (project && project.scenes.length > 0) {
      selectScene(project.scenes[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Show project dialog on first load if no project
  useEffect(() => {
    if (!project) {
      setShowProjectDialog(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Check if user is typing in an input field
    const target = e.target as HTMLElement;
    const isTyping = target.tagName === 'INPUT' ||
                     target.tagName === 'TEXTAREA' ||
                     target.isContentEditable;

    // Cmd+S / Ctrl+S to save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (project) {
        saveCurrentProject();
      }
      return;
    }

    // Escape always stops the game
    if (e.key === 'Escape' && isPlaying) {
      e.preventDefault();
      stopPlaying();
      return;
    }

    // Enter starts the game (but not while typing)
    if (e.key === 'Enter' && !isTyping && !isPlaying && project) {
      e.preventDefault();
      startPlaying();
      return;
    }
  }, [isPlaying, project, saveCurrentProject, startPlaying, stopPlaying]);

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
      setDividerPosition(Math.max(20, Math.min(60, newPos)));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Fullscreen play mode
  if (isPlaying) {
    return <StagePanel fullscreen />;
  }

  return (
    <div className="flex flex-col h-screen">
      <Toolbar />

      <div className="flex flex-1 overflow-hidden">
        {project ? (
          <>
            {/* Object Editor - Left Panel */}
            <div
              className="h-full border-r border-[var(--color-border)]"
              style={{ width: `${dividerPosition}%` }}
            >
              <ObjectEditor />
            </div>

            {/* Resizable Divider */}
            <div
              className="w-1 bg-[var(--color-border)] hover:bg-[var(--color-primary)] cursor-col-resize transition-colors"
              onMouseDown={handleDividerDrag}
            />

            {/* Stage Panel - Right Panel */}
            <div
              className="h-full overflow-hidden"
              style={{ width: `${100 - dividerPosition}%` }}
            >
              <StagePanel />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[var(--color-bg-main)]">
            <div className="text-center">
              <div className="w-24 h-24 bg-[var(--color-primary)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="text-white font-bold text-3xl">PB</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-800 mb-2">Welcome to PhaserBlockly</h1>
              <p className="text-gray-600 mb-6">Create amazing games with visual programming!</p>
              <button
                onClick={() => setShowProjectDialog(true)}
                className="px-6 py-3 bg-[var(--color-primary)] text-white rounded-lg font-medium hover:bg-[var(--color-primary-dark)] transition-colors"
              >
                Get Started
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Project Dialog */}
      {showProjectDialog && (
        <ProjectDialog onClose={() => setShowProjectDialog(false)} />
      )}
    </div>
  );
}
