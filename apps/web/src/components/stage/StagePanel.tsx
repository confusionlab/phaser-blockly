import { useCallback, useState } from 'react';
import { PhaserCanvas } from './PhaserCanvas';
import { SpriteShelf } from './SpriteShelf';
import { ObjectInspector } from './ObjectInspector';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { Button } from '@/components/ui/button';
import { getSceneBackgroundBaseColor } from '@/lib/background/compositor';
import { Square, Camera, Maximize2, Minimize2, Play, RotateCcw } from 'lucide-react';
import { tryStartPlaying } from '@/lib/playStartGuard';

interface StagePanelProps {
  fullscreen?: boolean;
  deferEditorResize?: boolean;
}

function dispatchEditorResizeFreeze(active: boolean): void {
  window.dispatchEvent(new CustomEvent('pocha-editor-resize-freeze', { detail: { active } }));
}

export function StagePanel({ fullscreen = false, deferEditorResize = false }: StagePanelProps) {
  const stopPlaying = useEditorStore((state) => state.stopPlaying);
  const viewMode = useEditorStore((state) => state.viewMode);
  const cycleViewMode = useEditorStore((state) => state.cycleViewMode);
  const selectedSceneId = useEditorStore((state) => state.selectedSceneId);
  const project = useProjectStore((state) => state.project);
  const [bottomHeightPercent, setBottomHeightPercent] = useState(60); // percentage
  const [objectsWidth, setObjectsWidth] = useState(40); // percentage
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);
  const [isPanelResizeDragging, setIsPanelResizeDragging] = useState(false);

  const toggleCanvasFullscreen = useCallback(() => {
    setIsCanvasFullscreen((current) => !current);
  }, []);

  const handleVerticalDividerDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    if (!container) return;

    dispatchEditorResizeFreeze(true);
    setIsPanelResizeDragging(true);
    const startY = e.clientY;
    const startHeight = bottomHeightPercent;
    const containerHeight = container.clientHeight;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startY - e.clientY;
      const deltaPercent = (deltaY / containerHeight) * 100;
      const newHeight = startHeight + deltaPercent;
      setBottomHeightPercent(Math.max(20, Math.min(80, newHeight)));
    };

    const handleMouseUp = () => {
      dispatchEditorResizeFreeze(false);
      setIsPanelResizeDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleHorizontalDividerDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    if (!container) return;

    dispatchEditorResizeFreeze(true);
    setIsPanelResizeDragging(true);
    const startX = e.clientX;
    const startWidth = objectsWidth;
    const containerWidth = container.clientWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newWidth = startWidth + deltaPercent;
      setObjectsWidth(Math.max(30, Math.min(70, newWidth)));
    };

    const handleMouseUp = () => {
      dispatchEditorResizeFreeze(false);
      setIsPanelResizeDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleRestartPlaying = () => {
    stopPlaying();
    requestAnimationFrame(() => {
      tryStartPlaying();
    });
  };

  const selectedScene = project?.scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const editorStageSurfaceColor = getSceneBackgroundBaseColor(selectedScene?.background);
  const stageShellStyle = viewMode === 'editor'
    ? { backgroundColor: editorStageSurfaceColor }
    : { backgroundColor: '#000000' };

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[100001] overflow-hidden bg-black">
        <div className="absolute top-4 right-4 z-10">
          <div className="inline-flex items-center gap-1 rounded-full bg-black/60 border border-white/15 p-1">
            <button
              type="button"
              onClick={handleRestartPlaying}
              title="Restart"
              aria-label="Restart"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors"
            >
              <RotateCcw className="size-4" />
            </button>
            <button
              type="button"
              onClick={stopPlaying}
              title="Stop"
              aria-label="Stop"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              <Square className="size-4 fill-current" />
            </button>
          </div>
        </div>
        <div className="h-full w-full">
          <PhaserCanvas isPlaying={true} />
        </div>
      </div>
    );
  }

  const isCameraView = viewMode !== 'editor';
  const canvasToolbar = (
    <div className="flex items-center justify-between px-2 py-1 border-b border-border">
      <div className="flex items-center gap-1">
        <Button
          variant={isCameraView ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 w-7 p-0"
          onClick={cycleViewMode}
          title={isCameraView ? 'Camera View (C to toggle)' : 'World View (C to toggle)'}
        >
          <Camera className="size-4" />
        </Button>
        <Button
          variant={isCanvasFullscreen ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 w-7 p-0"
          onClick={toggleCanvasFullscreen}
          title={isCanvasFullscreen ? 'Exit fullscreen' : 'Fullscreen stage'}
        >
          {isCanvasFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
      </div>
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center text-green-500 hover:text-green-400 transition-colors"
        onClick={tryStartPlaying}
        title="Play"
        aria-label="Play"
      >
        <Play className="size-5 fill-current" />
      </button>
    </div>
  );

  const fullscreenCanvasControls = (
    <div className="absolute top-4 right-4 z-10">
      <div className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/60 p-1">
        <Button
          variant={isCameraView ? 'secondary' : 'ghost'}
          size="sm"
          className="h-9 w-9 rounded-full p-0 text-white hover:bg-white/15 hover:text-white"
          onClick={cycleViewMode}
          title={isCameraView ? 'Camera View (C to toggle)' : 'World View (C to toggle)'}
        >
          <Camera className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 rounded-full p-0 text-white hover:bg-white/15 hover:text-white"
          onClick={toggleCanvasFullscreen}
          title="Exit fullscreen stage"
        >
          <Minimize2 className="size-4" />
        </Button>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-green-400 transition-colors hover:bg-white/15 hover:text-green-300"
          onClick={tryStartPlaying}
          title="Play"
          aria-label="Play"
        >
          <Play className="size-5 fill-current" />
        </button>
      </div>
    </div>
  );

  if (isCanvasFullscreen) {
    return (
      <div className="fixed inset-0 z-[100001] overflow-hidden bg-background">
        {fullscreenCanvasControls}
        <div
          className="relative h-full w-full overflow-hidden"
          style={stageShellStyle}
        >
          <PhaserCanvas isPlaying={false} deferEditorResize={deferEditorResize || isPanelResizeDragging} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Phaser canvas */}
      <div className="min-h-0 flex flex-col" style={{ height: `${100 - bottomHeightPercent}%` }}>
        {/* Toolbar above stage */}
        {canvasToolbar}
        {/* Canvas container */}
        <div className="flex-1 min-h-0">
          <div
            className="relative h-full w-full overflow-hidden"
            style={stageShellStyle}
          >
            <PhaserCanvas isPlaying={false} deferEditorResize={deferEditorResize || isPanelResizeDragging} />
          </div>
        </div>
      </div>

      {/* Resizable vertical divider */}
      <div
        data-testid="stage-panel-vertical-divider"
        className="app-resize-divider-y hover:text-primary cursor-row-resize transition-colors"
        onMouseDown={handleVerticalDividerDrag}
      />

      {/* Bottom panel: Objects list (left) + Properties (right) */}
      <div className="flex" style={{ height: `${bottomHeightPercent}%` }}>
        {/* Objects list */}
        <div className="overflow-hidden" style={{ width: `${objectsWidth}%` }}>
          <SpriteShelf />
        </div>

        {/* Resizable horizontal divider */}
        <div
          data-testid="stage-panel-horizontal-divider"
          className="app-resize-divider-x hover:text-primary cursor-col-resize transition-colors"
          onMouseDown={handleHorizontalDividerDrag}
        />

        {/* Properties panel */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ObjectInspector />
        </div>
      </div>
    </div>
  );
}
