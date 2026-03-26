import { ChevronDown, Redo2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface CanvasViewportOverlayProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomToActualSize: () => void;
  onZoomToFit: () => void;
  onZoomToSelection?: () => void;
  canZoomToSelection?: boolean;
  className?: string;
}

export function CanvasViewportOverlay({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  minZoom,
  maxZoom,
  onZoomOut,
  onZoomIn,
  onZoomToActualSize,
  onZoomToFit,
  onZoomToSelection,
  canZoomToSelection = false,
  className,
}: CanvasViewportOverlayProps) {
  const overlayButtonClassName = 'text-foreground/78 hover:!bg-transparent hover:text-foreground';
  const showSelectionZoomAction = typeof onZoomToSelection === 'function';

  return (
    <div className={cn('pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between px-3 py-3', className)}>
      <div className="pointer-events-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-xs"
          className={overlayButtonClassName}
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo"
          aria-label="Undo"
        >
          <Undo2 className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={overlayButtonClassName}
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo"
          aria-label="Redo"
        >
          <Redo2 className="size-3.5" />
        </Button>
      </div>

      <div className="pointer-events-auto ml-auto flex items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className={cn(overlayButtonClassName, 'gap-1 px-2 text-[11px] font-medium')}
              title="Zoom options"
              aria-label="Zoom options"
            >
              {Math.round(zoom * 100)}%
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="min-w-[220px]">
            <DropdownMenuItem onClick={onZoomIn} disabled={zoom >= maxZoom} className="justify-between">
              <span>Zoom In</span>
              <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onZoomOut} disabled={zoom <= minZoom} className="justify-between">
              <span>Zoom Out</span>
              <DropdownMenuShortcut>⌘-</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onZoomToActualSize} className="justify-between">
              <span>Zoom to 100%</span>
              <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onZoomToFit} className="justify-between">
              <span>Zoom to Fit</span>
              <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
            </DropdownMenuItem>
            {showSelectionZoomAction ? (
              <DropdownMenuItem onClick={onZoomToSelection} disabled={!canZoomToSelection} className="justify-between">
                <span>Zoom to Selection</span>
                <DropdownMenuShortcut>⌘2</DropdownMenuShortcut>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
