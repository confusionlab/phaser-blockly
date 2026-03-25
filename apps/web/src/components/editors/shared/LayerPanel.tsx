import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Image, Layers3, Lock, LockOpen, Shapes, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_LAYER_THUMBNAIL_SIZE = 44;

interface LayerThumbnailEntry {
  dataUrl: string | null;
  signature: string;
}

export interface LayerPanelLayerShape {
  id: string;
  name: string;
  kind: 'bitmap' | 'vector';
  visible: boolean;
  locked: boolean;
  opacity: number;
}

interface SharedLayerPanelProps<TLayer extends LayerPanelLayerShape> {
  document: {
    activeLayerId: string;
    layers: TLayer[];
  };
  activeLayer: TLayer | null;
  maxLayers: number;
  getLayerIndex: (layerId: string) => number;
  getLayerThumbnailSignature: (layer: TLayer, size: number) => string;
  renderLayerThumbnailToDataUrl: (layer: TLayer, size: number) => Promise<string | null>;
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
  onMergeDown?: (layerId: string) => void;
  onRasterizeLayer?: (layerId: string) => void;
  mergeActionLabel?: string;
  showMergeAction?: boolean;
  showRasterizeAction?: boolean;
  thumbnailTestId?: string;
}

function LayerKindIcon({ layer }: { layer: LayerPanelLayerShape }) {
  return layer.kind === 'bitmap'
    ? <Image className="size-3.5" />
    : <Shapes className="size-3.5" />;
}

function LayerThumbnailPreview({
  layer,
  thumbnailDataUrl,
  thumbnailTestId,
}: {
  layer: LayerPanelLayerShape;
  thumbnailDataUrl: string | null;
  thumbnailTestId: string;
}) {
  return (
    <div
      data-testid={thumbnailTestId}
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

export const LayerPanel = memo(({
  document,
  activeLayer,
  maxLayers,
  getLayerIndex,
  getLayerThumbnailSignature,
  renderLayerThumbnailToDataUrl,
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
  mergeActionLabel = 'Merge',
  showMergeAction = false,
  showRasterizeAction = false,
  thumbnailTestId = 'layer-thumbnail',
}: SharedLayerPanelProps<LayerPanelLayerShape>) => {
  const displayedLayers = [...document.layers].reverse();
  const activeLayerIndex = activeLayer ? getLayerIndex(activeLayer.id) : -1;
  const canAddLayer = document.layers.length < maxLayers;
  const [nameDraft, setNameDraft] = useState(activeLayer?.name ?? '');
  const [opacityDraft, setOpacityDraft] = useState(Math.round((activeLayer?.opacity ?? 1) * 100));
  const [layerThumbnails, setLayerThumbnails] = useState<Record<string, LayerThumbnailEntry>>({});
  const layerThumbnailsRef = useRef(layerThumbnails);
  const renderLayerThumbnailToDataUrlRef = useRef(renderLayerThumbnailToDataUrl);

  const layerThumbnailRequests = useMemo(() => (
    document.layers.map((layer) => ({
      layer,
      signature: getLayerThumbnailSignature(layer, DEFAULT_LAYER_THUMBNAIL_SIZE),
    }))
  ), [document.layers, getLayerThumbnailSignature]);
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
    renderLayerThumbnailToDataUrlRef.current = renderLayerThumbnailToDataUrl;
  }, [renderLayerThumbnailToDataUrl]);

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
        const dataUrl = await renderLayerThumbnailToDataUrlRef.current(layer, DEFAULT_LAYER_THUMBNAIL_SIZE);
        return [layer.id, { signature, dataUrl }] as const;
      } catch (error) {
        console.warn('Failed to render layer thumbnail.', error);
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
  }, [layerThumbnailRequestKey, layerThumbnailRequests]);

  const commitNameDraft = () => {
    if (!activeLayer || nameDraft === activeLayer.name) {
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
          {document.layers.length}/{maxLayers}
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
                data-testid="layer-row"
                data-layer-id={layer.id}
                data-layer-kind={layer.kind}
                data-layer-name={layer.name}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-2 py-2 text-left transition-colors',
                  isActive ? 'border-primary bg-primary/8' : 'border-border hover:bg-accent/50',
                )}
              >
                <LayerThumbnailPreview
                  layer={layer}
                  thumbnailDataUrl={layerThumbnails[layer.id]?.dataUrl ?? null}
                  thumbnailTestId={thumbnailTestId}
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
            {showMergeAction ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onMergeDown?.(activeLayer.id)}
                disabled={activeLayerIndex <= 0 || !onMergeDown}
              >
                <ChevronDown className="size-3.5" />
                {mergeActionLabel}
              </Button>
            ) : null}
            {showRasterizeAction ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRasterizeLayer?.(activeLayer.id)}
                disabled={activeLayer.kind !== 'vector' || !onRasterizeLayer}
              >
                <Image className="size-3.5" />
                Rasterize
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});

LayerPanel.displayName = 'LayerPanel';
