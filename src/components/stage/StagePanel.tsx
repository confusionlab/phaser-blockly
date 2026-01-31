import { useState } from 'react';
import { PhaserCanvas } from './PhaserCanvas';
import { SpriteShelf } from './SpriteShelf';
import { ObjectInspector } from './ObjectInspector';
import { useEditorStore } from '@/store/editorStore';
import { Button } from '@/components/ui/button';
import { Square, Camera } from 'lucide-react';

interface StagePanelProps {
  fullscreen?: boolean;
}

export function StagePanel({ fullscreen = false }: StagePanelProps) {
  const { stopPlaying, viewMode, cycleViewMode } = useEditorStore();
  const [bottomHeightPercent, setBottomHeightPercent] = useState(70); // percentage
  const [objectsWidth, setObjectsWidth] = useState(40); // percentage

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
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
        <div className="absolute top-4 right-4 z-10">
          <Button variant="destructive" onClick={stopPlaying}>
            <Square className="size-4" />
            Stop
          </Button>
        </div>
        <div className="w-full h-full flex items-center justify-center">
          <PhaserCanvas isPlaying={true} />
        </div>
      </div>
    );
  }

  const isCameraView = viewMode !== 'editor';

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Phaser canvas */}
      <div className="min-h-0 flex flex-col" style={{ height: `${100 - bottomHeightPercent}%` }}>
        {/* Toolbar above stage */}
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
          <Button
            variant={isCameraView ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={cycleViewMode}
            title={isCameraView ? 'Camera View (C to toggle)' : 'World View (C to toggle)'}
          >
            <Camera className="size-4" />
          </Button>
        </div>
        {/* Canvas container */}
        <div className="flex-1 min-h-0 p-1">
          <div className="relative w-full h-full bg-black rounded-lg shadow-sm overflow-hidden">
            <PhaserCanvas isPlaying={false} />
          </div>
        </div>
      </div>

      {/* Resizable vertical divider */}
      <div
        className="h-1 bg-border hover:bg-primary cursor-row-resize transition-colors"
        onMouseDown={handleVerticalDividerDrag}
      />

      {/* Bottom panel: Objects list (left) + Properties (right) */}
      <div className="flex" style={{ height: `${bottomHeightPercent}%` }}>
        {/* Objects list */}
        <div className="overflow-auto" style={{ width: `${objectsWidth}%` }}>
          <SpriteShelf />
        </div>

        {/* Resizable horizontal divider */}
        <div
          className="w-1 bg-border hover:bg-primary cursor-col-resize transition-colors"
          onMouseDown={handleHorizontalDividerDrag}
        />

        {/* Properties panel */}
        <div className="flex-1 overflow-auto">
          <ObjectInspector />
        </div>
      </div>
    </div>
  );
}
