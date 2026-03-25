import { memo, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CostumeDocument, CostumeLayer } from '@/types';
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Image, Lock, LockOpen, Shapes, Trash2, Layers3 } from 'lucide-react';
import { MAX_COSTUME_LAYERS, getCostumeLayerIndex } from '@/lib/costume/costumeDocument';
import { cn } from '@/lib/utils';

interface CostumeLayerPanelProps {
  document: CostumeDocument;
  activeLayer: CostumeLayer | null;
  onSelectLayer: (layerId: string) => void;
  onAddBitmapLayer: () => void;
  onAddVectorLayer: () => void;
  onDuplicateLayer: (layerId: string) => void;
  onDeleteLayer: (layerId: string) => void;
  onMoveLayer: (layerId: string, direction: 'up' | 'down') => void;
  onToggleVisibility: (layerId: string) => void;
  onToggleLocked: (layerId: string) => void;
  onRenameLayer: (layerId: string, name: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
  onMergeDown: (layerId: string) => void;
  onRasterizeLayer: (layerId: string) => void;
}

function LayerKindIcon({ layer }: { layer: CostumeLayer }) {
  return layer.kind === 'bitmap'
    ? <Image className="size-3.5" />
    : <Shapes className="size-3.5" />;
}

export const CostumeLayerPanel = memo(({
  document,
  activeLayer,
  onSelectLayer,
  onAddBitmapLayer,
  onAddVectorLayer,
  onDuplicateLayer,
  onDeleteLayer,
  onMoveLayer,
  onToggleVisibility,
  onToggleLocked,
  onRenameLayer,
  onOpacityChange,
  onMergeDown,
  onRasterizeLayer,
}: CostumeLayerPanelProps) => {
  const displayedLayers = [...document.layers].reverse();
  const activeLayerIndex = activeLayer ? getCostumeLayerIndex(document, activeLayer.id) : -1;
  const canAddLayer = document.layers.length < MAX_COSTUME_LAYERS;
  const [nameDraft, setNameDraft] = useState(activeLayer?.name ?? '');
  const [opacityDraft, setOpacityDraft] = useState(Math.round((activeLayer?.opacity ?? 1) * 100));

  useEffect(() => {
    setNameDraft(activeLayer?.name ?? '');
    setOpacityDraft(Math.round((activeLayer?.opacity ?? 1) * 100));
  }, [activeLayer?.id, activeLayer?.name, activeLayer?.opacity]);

  const commitNameDraft = () => {
    if (!activeLayer) {
      return;
    }

    if (nameDraft === activeLayer.name) {
      return;
    }

    onRenameLayer(activeLayer.id, nameDraft);
  };

  const commitOpacityDraft = () => {
    if (!activeLayer) {
      return;
    }

    const nextOpacity = opacityDraft / 100;
    if (Math.round(activeLayer.opacity * 100) === opacityDraft) {
      return;
    }

    onOpacityChange(activeLayer.id, nextOpacity);
  };

  return (
    <div className="flex w-[260px] shrink-0 flex-col border-l bg-background/80">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Layers3 className="size-4" />
          <span>Layers</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {document.layers.length}/{MAX_COSTUME_LAYERS}
        </span>
      </div>

      <div className="flex gap-2 border-b px-3 py-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={onAddVectorLayer} disabled={!canAddLayer}>
          <Shapes className="size-3.5" />
          Vector
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={onAddBitmapLayer} disabled={!canAddLayer}>
          <Image className="size-3.5" />
          Bitmap
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-2">
          {displayedLayers.map((layer) => {
            const isActive = layer.id === document.activeLayerId;
            return (
              <button
                key={layer.id}
                type="button"
                onClick={() => onSelectLayer(layer.id)}
                aria-pressed={isActive}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors',
                  isActive ? 'border-primary bg-primary/8' : 'border-border hover:bg-accent/50',
                )}
              >
                <span className="text-muted-foreground">
                  <LayerKindIcon layer={layer} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{layer.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{layer.kind}</span>
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleVisibility(layer.id);
                  }}
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                >
                  {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                </span>
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleLocked(layer.id);
                  }}
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                >
                  {layer.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {activeLayer ? (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitNameDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  setNameDraft(activeLayer.name);
                  event.currentTarget.blur();
                }
              }}
              className="h-8"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Opacity</span>
              <span>{opacityDraft}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={opacityDraft}
              onChange={(event) => setOpacityDraft(Number(event.target.value))}
              onPointerUp={commitOpacityDraft}
              onKeyUp={commitOpacityDraft}
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onMoveLayer(activeLayer.id, 'up')}
              disabled={activeLayerIndex >= document.layers.length - 1}
            >
              <ChevronUp className="size-3.5" />
              Up
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onMoveLayer(activeLayer.id, 'down')}
              disabled={activeLayerIndex <= 0}
            >
              <ChevronDown className="size-3.5" />
              Down
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDuplicateLayer(activeLayer.id)}>
              <Copy className="size-3.5" />
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDeleteLayer(activeLayer.id)}
              disabled={document.layers.length <= 1}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onMergeDown(activeLayer.id)}
              disabled={activeLayerIndex <= 0}
            >
              <ChevronDown className="size-3.5" />
              Merge
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRasterizeLayer(activeLayer.id)}
              disabled={activeLayer.kind !== 'vector'}
            >
              <Image className="size-3.5" />
              Rasterize
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
});

CostumeLayerPanel.displayName = 'CostumeLayerPanel';
