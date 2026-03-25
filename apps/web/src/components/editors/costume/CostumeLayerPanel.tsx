import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CostumeDocument, CostumeLayer } from '@/types';
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Image, Lock, LockOpen, Shapes, Trash2, Layers3 } from 'lucide-react';
import { MAX_COSTUME_LAYERS, getCostumeLayerIndex } from '@/lib/costume/costumeDocument';
import {
  getCostumeLayerThumbnailSignature,
  renderCostumeLayerThumbnailToDataUrl,
} from '@/lib/costume/costumeDocumentRender';
import { cn } from '@/lib/utils';

const LAYER_THUMBNAIL_SIZE = 44;

interface LayerThumbnailEntry {
  dataUrl: string | null;
  signature: string;
}

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

function LayerThumbnailPreview({
  layer,
  thumbnailDataUrl,
}: {
  layer: CostumeLayer;
  thumbnailDataUrl: string | null;
}) {
  return (
    <div
      data-testid="costume-layer-thumbnail"
      className={cn(
        'relative size-11 shrink-0 overflow-hidden rounded-md border bg-muted/35',
        !layer.visible && 'opacity-60',
      )}
    >
      {thumbnailDataUrl ? (
        <img
          src={thumbnailDataUrl}
          alt=""
          aria-hidden="true"
          className="size-full object-contain p-1"
          style={{ opacity: layer.opacity }}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground/70">
          <LayerKindIcon layer={layer} />
        </div>
      )}
    </div>
  );
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
  const [layerThumbnails, setLayerThumbnails] = useState<Record<string, LayerThumbnailEntry>>({});
  const layerThumbnailsRef = useRef(layerThumbnails);

  const layerThumbnailRequests = useMemo(() => (
    document.layers.map((layer) => ({
      layer,
      signature: getCostumeLayerThumbnailSignature(layer, LAYER_THUMBNAIL_SIZE),
    }))
  ), [document.layers]);
  const layerThumbnailRequestKey = useMemo(() => (
    layerThumbnailRequests
      .map(({ layer, signature }) => `${layer.id}:${signature}`)
      .join('|')
  ), [layerThumbnailRequests]);

  useEffect(() => {
    setNameDraft(activeLayer?.name ?? '');
    setOpacityDraft(Math.round((activeLayer?.opacity ?? 1) * 100));
  }, [activeLayer?.id, activeLayer?.name, activeLayer?.opacity]);

  useEffect(() => {
    layerThumbnailsRef.current = layerThumbnails;
  }, [layerThumbnails]);

  useEffect(() => {
    let cancelled = false;
    const cachedEntries = layerThumbnailsRef.current;
    const nextCachedEntries = Object.fromEntries(
      layerThumbnailRequests.flatMap(({ layer, signature }) => {
        const cachedEntry = cachedEntries[layer.id];
        return cachedEntry && cachedEntry.signature === signature
          ? [[layer.id, cachedEntry]]
          : [];
      }),
    ) as Record<string, LayerThumbnailEntry>;

    if (
      Object.keys(nextCachedEntries).length === layerThumbnailRequests.length &&
      Object.keys(cachedEntries).length === layerThumbnailRequests.length
    ) {
      return;
    }

    void Promise.all(layerThumbnailRequests.map(async ({ layer, signature }) => {
      const cachedEntry = cachedEntries[layer.id];
      if (cachedEntry && cachedEntry.signature === signature) {
        return [layer.id, cachedEntry] as const;
      }

      try {
        const dataUrl = await renderCostumeLayerThumbnailToDataUrl(layer, LAYER_THUMBNAIL_SIZE);
        return [layer.id, { signature, dataUrl }] as const;
      } catch (error) {
        console.warn('Failed to render costume layer thumbnail.', error);
        return [layer.id, { signature, dataUrl: null }] as const;
      }
    })).then((entries) => {
      if (cancelled) {
        return;
      }

      setLayerThumbnails(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [layerThumbnailRequestKey]);

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
                  'flex w-full items-center gap-3 rounded-lg border px-2 py-2 text-left transition-colors',
                  isActive ? 'border-primary bg-primary/8' : 'border-border hover:bg-accent/50',
                )}
              >
                <LayerThumbnailPreview
                  layer={layer}
                  thumbnailDataUrl={layerThumbnails[layer.id]?.dataUrl ?? null}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      <LayerKindIcon layer={layer} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{layer.name}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span>{layer.kind}</span>
                    {layer.opacity < 1 ? <span>{Math.round(layer.opacity * 100)}%</span> : null}
                  </div>
                </div>
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
