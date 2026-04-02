import { useCallback, useState } from 'react';
import { PhaserCanvas } from './PhaserCanvas';
import { HierarchyPanel } from './HierarchyPanel';
import { ObjectInspector } from './ObjectInspector';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { useEditorStore, type HierarchyTab } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { OverlayPill } from '@/components/ui/overlay-pill';
import { getSceneBackgroundBaseColor } from '@/lib/background/compositor';
import { Square, Camera, Maximize2, Minimize2, Play, RotateCcw, Earth, Shapes, Component } from '@/components/ui/icons';
import { tryStartPlaying } from '@/lib/playStartGuard';
import { panelHeaderClassNames } from '@/lib/ui/panelHeaderTokens';
import { cn } from '@/lib/utils';

interface StagePanelProps {
  fullscreen?: boolean;
  deferEditorResize?: boolean;
  isCanvasFullscreen: boolean;
  onCanvasFullscreenChange: (isFullscreen: boolean) => void;
}

const hierarchyTabs: SegmentedControlOption<HierarchyTab>[] = [
  { value: 'scene', label: 'Scene', icon: <Earth className="size-3.5" /> },
  { value: 'object', label: 'Object', icon: <Shapes className="size-3.5" /> },
  { value: 'component', label: 'Component', icon: <Component className="size-3.5" /> },
];

function dispatchEditorResizeFreeze(active: boolean): void {
  window.dispatchEvent(new CustomEvent('pocha-editor-resize-freeze', { detail: { active } }));
}

const stageOverlayToneClasses = {
  dark: {
    button:
      'inline-flex h-6 w-6 items-center justify-center rounded-full text-white/78 transition-[background-color,color,transform] duration-150 hover:bg-white/14 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55',
    active:
      'bg-white/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
    play:
      'text-emerald-300 hover:bg-emerald-400/14 hover:text-emerald-200',
    stop:
      'inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white transition-colors duration-150 hover:bg-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55',
  },
  light: {
    button:
      'inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-700/88 transition-[background-color,color,transform] duration-150 hover:bg-white/22 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950/18',
    active:
      'bg-white/42 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_8px_18px_-14px_rgba(15,23,42,0.22)]',
    play:
      'text-emerald-700 hover:bg-emerald-500/12 hover:text-emerald-800',
    stop:
      'inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white transition-colors duration-150 hover:bg-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950/18',
  },
} as const;

export function StagePanel({
  fullscreen = false,
  deferEditorResize = false,
  isCanvasFullscreen,
  onCanvasFullscreenChange,
}: StagePanelProps) {
  const stopPlaying = useEditorStore((state) => state.stopPlaying);
  const isDarkMode = useEditorStore((state) => state.isDarkMode);
  const viewMode = useEditorStore((state) => state.viewMode);
  const cycleViewMode = useEditorStore((state) => state.cycleViewMode);
  const activeHierarchyTab = useEditorStore((state) => state.activeHierarchyTab);
  const setActiveHierarchyTab = useEditorStore((state) => state.setActiveHierarchyTab);
  const selectedSceneId = useEditorStore((state) => state.selectedSceneId);
  const project = useProjectStore((state) => state.project);
  const [bottomHeightPercent, setBottomHeightPercent] = useState(60); // percentage
  const [objectsWidth, setObjectsWidth] = useState(40); // percentage
  const [isPanelResizeDragging, setIsPanelResizeDragging] = useState(false);

  const toggleCanvasFullscreen = useCallback(() => {
    onCanvasFullscreenChange(!isCanvasFullscreen);
  }, [isCanvasFullscreen, onCanvasFullscreenChange]);

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
      void tryStartPlaying();
    });
  };

  const selectedScene = project?.scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const editorStageSurfaceColor = getSceneBackgroundBaseColor(selectedScene?.background);
  const stageOverlayTone = isDarkMode ? 'dark' : 'light';
  const stageOverlayClasses = stageOverlayToneClasses[stageOverlayTone];
  const stageShellStyle = viewMode === 'editor'
    ? { backgroundColor: editorStageSurfaceColor }
    : { backgroundColor: '#000000' };
  const playModeControls = (
    <OverlayPill tone={stageOverlayTone} size="compact">
      <button
        type="button"
        onClick={handleRestartPlaying}
        title="Restart"
        aria-label="Restart"
        className={cn(stageOverlayClasses.button, stageOverlayClasses.active)}
      >
        <RotateCcw className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={stopPlaying}
        title="Stop"
        aria-label="Stop"
        className={stageOverlayClasses.stop}
      >
        <Square className="size-3.5 fill-current" />
      </button>
    </OverlayPill>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[100001] overflow-hidden bg-black">
        <div className="absolute right-2 top-2 z-10">
          {playModeControls}
        </div>
        <div className="h-full w-full">
          <PhaserCanvas isPlaying={true} />
        </div>
      </div>
    );
  }

  const isCameraView = viewMode !== 'editor';

  const stageOverlayControls = (
    <OverlayPill tone={stageOverlayTone} size="compact">
      <button
        type="button"
        className={cn(
          stageOverlayClasses.button,
          isCameraView && stageOverlayClasses.active,
          isCameraView && 'hover:bg-inherit hover:text-inherit',
        )}
        onClick={cycleViewMode}
        title={isCameraView ? 'Camera View (C to toggle)' : 'World View (C to toggle)'}
        aria-label={isCameraView ? 'Camera View' : 'World View'}
        aria-pressed={isCameraView}
      >
        <Camera className="size-3.5" />
      </button>
      <button
        type="button"
        className={cn(
          stageOverlayClasses.button,
          isCanvasFullscreen && stageOverlayClasses.active,
          isCanvasFullscreen && 'hover:bg-inherit hover:text-inherit',
        )}
        onClick={toggleCanvasFullscreen}
        title={isCanvasFullscreen ? 'Exit fullscreen' : 'Fullscreen stage'}
        aria-label={isCanvasFullscreen ? 'Exit fullscreen' : 'Fullscreen stage'}
        aria-pressed={isCanvasFullscreen}
      >
        {isCanvasFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>
      <button
        type="button"
        className={cn(stageOverlayClasses.button, stageOverlayClasses.play)}
        onClick={() => {
          void tryStartPlaying();
        }}
        title="Play"
        aria-label="Play"
      >
        <Play className="size-3.5 fill-current" />
      </button>
    </OverlayPill>
  );

  return (
    <div
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background',
        isCanvasFullscreen && 'fixed inset-0 z-[100001]',
      )}
    >
      {/* Phaser canvas */}
      <div
        className={cn(
          'min-h-0 overflow-hidden',
          isCanvasFullscreen ? 'flex-1' : 'shrink-0',
        )}
        style={isCanvasFullscreen ? undefined : { height: `${100 - bottomHeightPercent}%` }}
      >
        <div
          className="relative h-full w-full overflow-hidden"
          style={stageShellStyle}
        >
          <div className={cn('absolute right-2 top-2', isCanvasFullscreen ? 'z-10' : 'z-20')}>
            {stageOverlayControls}
          </div>
          <PhaserCanvas isPlaying={false} deferEditorResize={deferEditorResize || isPanelResizeDragging} />
        </div>
      </div>

      {/* Resizable vertical divider */}
      <div
        data-testid="stage-panel-vertical-divider"
        className={cn(
          'app-resize-divider-y hover:text-primary cursor-row-resize transition-colors',
          isCanvasFullscreen && 'hidden',
        )}
        onMouseDown={handleVerticalDividerDrag}
      />

      {/* Bottom panel: Objects list (left) + Properties (right) */}
      <div
        aria-hidden={isCanvasFullscreen}
        className={cn(
          'flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden',
          isCanvasFullscreen && 'hidden',
        )}
        style={isCanvasFullscreen ? undefined : { height: `${bottomHeightPercent}%` }}
      >
        <div
          className={cn(
            panelHeaderClassNames.chrome,
            panelHeaderClassNames.row,
            'shrink-0 justify-center border-b border-border bg-card',
          )}
        >
          <SegmentedControl
            ariaLabel="Hierarchy sections"
            className="max-w-full"
            layout="content"
            options={hierarchyTabs}
            value={activeHierarchyTab}
            onValueChange={(value) => setActiveHierarchyTab(value)}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {/* Objects list */}
          <div className="min-h-0 overflow-hidden" style={{ width: `${objectsWidth}%` }}>
            <HierarchyPanel />
          </div>

          {/* Resizable horizontal divider */}
          <div
            data-testid="stage-panel-horizontal-divider"
            className="app-resize-divider-x hover:text-primary cursor-col-resize transition-colors"
            onMouseDown={handleHorizontalDividerDrag}
          />

          {/* Properties panel */}
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            <ObjectInspector />
          </div>
        </div>
      </div>
    </div>
  );
}
