import * as Select from '@radix-ui/react-select';
import { Undo2, Redo2, Move, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ColliderConfig } from '@/types';
import type { DrawingTool } from './CostumeToolbar';

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
  colliderType: ColliderConfig['type'];
  onColliderTypeChange: (type: ColliderConfig['type']) => void;
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
}

const colliderTypes: { value: ColliderConfig['type']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'box', label: 'Box' },
  { value: 'circle', label: 'Circle' },
  { value: 'capsule', label: 'Capsule' },
];

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
  colliderType,
  onColliderTypeChange,
  activeTool,
  onToolChange,
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

      <div className="flex-1 flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">Collider:</span>
        <Select.Root value={colliderType} onValueChange={(value) => onColliderTypeChange(value as ColliderConfig['type'])}>
          <Select.Trigger className="inline-flex items-center justify-between gap-1 h-8 px-2 text-xs bg-background border rounded hover:bg-accent min-w-[90px]">
            <Select.Value />
            <Select.Icon>
              <ChevronDown className="size-3" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="bg-popover border rounded-md shadow-md z-50">
              <Select.Viewport className="p-1">
                {colliderTypes.map(({ value, label }) => (
                  <Select.Item
                    key={value}
                    value={value}
                    className="flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer outline-none hover:bg-accent data-[highlighted]:bg-accent"
                  >
                    <Select.ItemIndicator>
                      <Check className="size-3" />
                    </Select.ItemIndicator>
                    <Select.ItemText>{label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>

        {colliderType !== 'none' && (
          <Button
            variant={activeTool === 'collider' ? 'default' : 'outline'}
            size="sm"
            className="h-8 px-2 gap-1"
            onClick={() => onToolChange('collider')}
            title="Edit Collider"
            style={activeTool === 'collider' ? { backgroundColor: '#22c55e', borderColor: '#22c55e' } : { borderColor: '#22c55e', color: '#22c55e' }}
          >
            <Move className="size-3" />
            <span className="text-xs">Edit</span>
          </Button>
        )}
      </div>
    </div>
  );
}
