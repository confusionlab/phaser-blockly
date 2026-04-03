import { useCallback, useState } from 'react';
import { PhaserCanvas } from './PhaserCanvas';
import { HierarchyPanel } from './HierarchyPanel';
import { ObjectInspector } from './ObjectInspector';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { useEditorStore, type HierarchyTab } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { OverlayActionButton } from '@/components/ui/overlay-action-button';
import { OverlayPill } from '@/components/ui/overlay-pill';
import { getSceneBackgroundBaseColor } from '@/lib/background/compositor';
import { Square, Camera, Maximize2, Minimize2, Play, RotateCcw, Earth, Shapes, Component } from '@/components/ui/icons';
import { tryStartPlaying } from '@/lib/playStartGuard';
import { panelHeaderClassNames } from '@/lib/ui/panelHeaderTokens';
import { cn } from '@/lib/utils';

interface StagePanelProps {
  fullscreen?: boolean;
  isCanvasFullscreen: boolean;
  onCanvasFullscreenChange: (isFullscreen: boolean) => void;
}

const hierarchyTabs: SegmentedControlOption<HierarchyTab>[] = [
  { value: 'scene', label: 'Scenes', icon: <Earth className="size-3.5" /> },
  { value: 'object', label: 'Objects', icon: <Shapes className="size-3.5" /> },
  { value: 'component', label: 'Components', icon: <Component className="size-3.5" /> },
];

export function StagePanel({
  fullscreen = false,
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
  const [isBottomPanelSplitDragging, setIsBottomPanelSplitDragging] = useState(false);

  const toggleCanvasFullscreen = useCallback(() => {
    onCanvasFullscreenChange(!isCanvasFullscreen);
  }, [isCanvasFullscreen, onCanvasFullscreenChange]);

  const handleVerticalDividerDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    if (!container) return;

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
      setIsBottomPanelSplitDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    setIsBottomPanelSplitDragging(true);
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
  const stageShellStyle = viewMode === 'editor'
    ? { backgroundColor: editorStageSurfaceColor }
    : { backgroundColor: '#000000' };
  const playModeControls = (
    <OverlayPill tone={stageOverlayTone} size="compact">
      <OverlayActionButton
        label="Restart"
        onClick={handleRestartPlaying}
        selected
        size="compact"
        tone={stageOverlayTone}
      >
        <RotateCcw className="size-3.5" />
      </OverlayActionButton>
      <OverlayActionButton
        emphasis="danger"
        label="Stop"
        onClick={stopPlaying}
        size="compact"
        tone={stageOverlayTone}
      >
        <Square className="size-3.5 fill-current" />
      </OverlayActionButton>
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
      <OverlayActionButton
        onClick={cycleViewMode}
        label={isCameraView ? 'Camera View' : 'World View'}
        pressed={isCameraView}
        selected={isCameraView}
        size="compact"
        title={isCameraView ? 'Camera View (C to toggle)' : 'World View (C to toggle)'}
        tone={stageOverlayTone}
      >
        <Camera className="size-3.5" />
      </OverlayActionButton>
      <OverlayActionButton
        onClick={toggleCanvasFullscreen}
        label={isCanvasFullscreen ? 'Exit fullscreen' : 'Fullscreen stage'}
        pressed={isCanvasFullscreen}
        selected={isCanvasFullscreen}
        size="compact"
        title={isCanvasFullscreen ? 'Exit fullscreen' : 'Fullscreen stage'}
        tone={stageOverlayTone}
      >
        {isCanvasFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </OverlayActionButton>
      <OverlayActionButton
        emphasis="positive"
        label="Play"
        onClick={() => {
          void tryStartPlaying();
        }}
        size="compact"
        tone={stageOverlayTone}
      >
        <Play className="size-3.5 fill-current" />
      </OverlayActionButton>
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
          <PhaserCanvas
            isPlaying={false}
            layoutMode={isCanvasFullscreen ? 'fullscreen' : 'panel'}
          />
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
            data-dragging={isBottomPanelSplitDragging ? 'true' : 'false'}
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
