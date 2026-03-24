import { Undo2, Redo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CostumeCanvasHeaderProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomReset: () => void;
}

export function CostumeCanvasHeader({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  minZoom,
  maxZoom,
  onZoomOut,
  onZoomIn,
  onZoomReset,
}: CostumeCanvasHeaderProps) {
  return (
    <div className="flex items-center py-2 px-3 border-b bg-background/50">
      <div className="flex-1 flex items-center gap-1">
        <Button variant="ghost" size="icon" className="size-8" onClick={onUndo} disabled={!canUndo} title="Undo">
          <Undo2 className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={onRedo} disabled={!canRedo} title="Redo">
          <Redo2 className="size-4" />
        </Button>
      </div>

      <div className="flex items-center justify-center gap-2">
        <button
          onClick={onZoomOut}
          className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded"
          disabled={zoom <= minZoom}
        >
          -
        </button>
        <span className="text-xs text-muted-foreground w-16 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={onZoomIn}
          className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded"
          disabled={zoom >= maxZoom}
        >
          +
        </button>
        <button
          onClick={onZoomReset}
          className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded ml-2"
        >
          Reset
        </button>
      </div>

      <div className="flex-1" />
    </div>
  );
}
