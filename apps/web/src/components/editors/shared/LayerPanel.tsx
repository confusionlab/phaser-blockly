import {
  memo,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Copy, Eye, EyeOff, Image, Layers3, Lock, LockOpen, Plus, Shapes, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_LAYER_THUMBNAIL_SIZE = 44;
const MAX_CONTEXT_MENU_MARGIN = 12;

interface LayerThumbnailEntry {
  dataUrl: string | null;
  signature: string;
}

function areLayerThumbnailEntriesEqual(
  left: Record<string, LayerThumbnailEntry>,
  right: Record<string, LayerThumbnailEntry>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    const leftEntry = left[key];
    const rightEntry = right[key];
    if (!rightEntry || leftEntry.signature !== rightEntry.signature || leftEntry.dataUrl !== rightEntry.dataUrl) {
      return false;
    }
  }

  return true;
}

let transparentDragImage: HTMLCanvasElement | null = null;

function getTransparentDragImage(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  if (transparentDragImage) {
    return transparentDragImage;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  transparentDragImage = canvas;
  return transparentDragImage;
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
  onReorderLayer: (layerId: string, targetIndex: number) => void;
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
        'relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-border/60 bg-muted/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
        !layer.visible && 'opacity-70',
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

function getLayerButtonLabel(layer: LayerPanelLayerShape): string {
  return `${layer.name} ${layer.kind}`;
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
  onReorderLayer,
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
  const displayedLayers = useMemo(() => [...document.layers].reverse(), [document.layers]);
  const activeLayerId = activeLayer?.id ?? document.activeLayerId;
  const canAddLayer = document.layers.length < maxLayers;
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ layerId: string; x: number; y: number } | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [contextMenuOpacityDraft, setContextMenuOpacityDraft] = useState(100);
  const [layerThumbnails, setLayerThumbnails] = useState<Record<string, LayerThumbnailEntry>>({});
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
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
  const contextMenuLayer = useMemo(() => (
    contextMenu ? document.layers.find((layer) => layer.id === contextMenu.layerId) ?? null : null
  ), [contextMenu, document.layers]);
  const contextMenuLayerIndex = contextMenuLayer ? getLayerIndex(contextMenuLayer.id) : -1;

  useEffect(() => {
    if (editingLayerId && !document.layers.some((layer) => layer.id === editingLayerId)) {
      setEditingLayerId(null);
      setRenameDraft('');
    }
  }, [document.layers, editingLayerId]);

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

    if (!areLayerThumbnailEntriesEqual(cachedEntries, nextCachedEntries)) {
      startTransition(() => {
        setLayerThumbnails((current) => (
          areLayerThumbnailEntriesEqual(current, nextCachedEntries) ? current : nextCachedEntries
        ));
      });
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

      const nextEntries = Object.fromEntries(entries);
      startTransition(() => {
        setLayerThumbnails((current) => (
          areLayerThumbnailEntriesEqual(current, nextEntries) ? current : nextEntries
        ));
      });
    });

    return () => {
      cancelled = true;
    };
  }, [layerThumbnailRequestKey, layerThumbnailRequests]);

  useEffect(() => {
    if (!contextMenuLayer || !contextMenu) {
      setContextMenuPosition(null);
      return;
    }

    setContextMenuPosition({ left: contextMenu.x, top: contextMenu.y });
    setContextMenuOpacityDraft(Math.round(contextMenuLayer.opacity * 100));
  }, [contextMenu, contextMenuLayer]);

  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current || !contextMenuPosition) {
      return;
    }

    const menuRect = contextMenuRef.current.getBoundingClientRect();
    let nextLeft = contextMenuPosition.left;
    let nextTop = contextMenuPosition.top;

    if (nextLeft + menuRect.width > window.innerWidth - MAX_CONTEXT_MENU_MARGIN) {
      nextLeft = Math.max(MAX_CONTEXT_MENU_MARGIN, window.innerWidth - menuRect.width - MAX_CONTEXT_MENU_MARGIN);
    }
    if (nextTop + menuRect.height > window.innerHeight - MAX_CONTEXT_MENU_MARGIN) {
      nextTop = Math.max(MAX_CONTEXT_MENU_MARGIN, window.innerHeight - menuRect.height - MAX_CONTEXT_MENU_MARGIN);
    }
    if (nextLeft < MAX_CONTEXT_MENU_MARGIN) {
      nextLeft = MAX_CONTEXT_MENU_MARGIN;
    }
    if (nextTop < MAX_CONTEXT_MENU_MARGIN) {
      nextTop = MAX_CONTEXT_MENU_MARGIN;
    }

    if (nextLeft !== contextMenuPosition.left || nextTop !== contextMenuPosition.top) {
      setContextMenuPosition({ left: nextLeft, top: nextTop });
    }
  }, [contextMenu, contextMenuPosition]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const startInlineRename = (layer: LayerPanelLayerShape) => {
    onSelectLayer(layer.id);
    setEditingLayerId(layer.id);
    setRenameDraft(layer.name);
  };

  const commitInlineRename = (layerId: string) => {
    const layer = document.layers.find((candidate) => candidate.id === layerId);
    if (!layer) {
      setEditingLayerId(null);
      setRenameDraft('');
      return;
    }

    if (renameDraft !== layer.name) {
      onRenameLayer(layerId, renameDraft);
    }

    setEditingLayerId(null);
    setRenameDraft('');
  };

  const cancelInlineRename = () => {
    setEditingLayerId(null);
    setRenameDraft('');
  };

  const commitContextMenuOpacity = () => {
    if (!contextMenuLayer) {
      return;
    }

    if (Math.round(contextMenuLayer.opacity * 100) === contextMenuOpacityDraft) {
      return;
    }

    onOpacityChange(contextMenuLayer.id, contextMenuOpacityDraft / 100);
  };

  const clearLayerDragState = () => {
    setDraggedLayerId(null);
    setDropIndicatorIndex(null);
  };

  const handleLayerDragStart = (event: ReactDragEvent<HTMLDivElement>, layerId: string) => {
    setDraggedLayerId(layerId);
    setDropIndicatorIndex(null);
    onSelectLayer(layerId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', layerId);
    const emptyDragImage = getTransparentDragImage();
    if (emptyDragImage) {
      event.dataTransfer.setDragImage(emptyDragImage, 0, 0);
    }
  };

  const handleLayerDragOver = (event: ReactDragEvent<HTMLDivElement>, displayIndex: number) => {
    if (!draggedLayerId) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    setDropIndicatorIndex(before ? displayIndex : displayIndex + 1);
    event.dataTransfer.dropEffect = 'move';
  };

  const handleLayerDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sourceLayerId = draggedLayerId ?? event.dataTransfer.getData('text/plain');
    if (!sourceLayerId || dropIndicatorIndex === null) {
      clearLayerDragState();
      return;
    }

    const sourceDisplayIndex = displayedLayers.findIndex((layer) => layer.id === sourceLayerId);
    const sourceLayerIndex = getLayerIndex(sourceLayerId);
    if (sourceDisplayIndex < 0 || sourceLayerIndex < 0) {
      clearLayerDragState();
      return;
    }

    const finalDisplayedIndex = dropIndicatorIndex > sourceDisplayIndex
      ? dropIndicatorIndex - 1
      : dropIndicatorIndex;
    const clampedDisplayedIndex = Math.max(0, Math.min(finalDisplayedIndex, document.layers.length - 1));
    const targetIndex = document.layers.length - 1 - clampedDisplayedIndex;

    if (targetIndex !== sourceLayerIndex) {
      onReorderLayer(sourceLayerId, targetIndex);
    }

    clearLayerDragState();
  };

  const handleLayerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, layerId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectLayer(layerId);
    }
  };

  const handleLayerContextMenu = (event: ReactMouseEvent<HTMLDivElement>, layerId: string) => {
    event.preventDefault();
    onSelectLayer(layerId);
    setContextMenu({
      layerId,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const maxLayerTooltip = `Max layer, max ${maxLayers} layers`;

  return (
    <>
      <div className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2">
        <div className="flex flex-col items-start gap-3">
          <div className="pointer-events-auto relative group/layer-add">
            {canAddLayer ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    data-testid="layer-add-button"
                    size="icon-sm"
                    variant="outline"
                    className="h-12 w-12 rounded-[18px] border-border/70 bg-background/82 shadow-[0_18px_42px_-26px_rgba(15,23,42,0.55)] backdrop-blur-xl transition-transform hover:-translate-y-0.5 hover:border-primary/40 hover:bg-background/92"
                    aria-label="Add layer"
                  >
                    <Plus className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start" sideOffset={10} className="min-w-36 rounded-xl">
                  <DropdownMenuItem onClick={onAddVectorLayer}>
                    <Shapes className="size-4" />
                    Vector
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onAddBitmapLayer}>
                    <Image className="size-4" />
                    Pixel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Button
                  data-testid="layer-add-button"
                  size="icon-sm"
                  variant="outline"
                  disabled
                  aria-label="Add layer"
                  title={maxLayerTooltip}
                  className="h-12 w-12 rounded-[18px] border-border/70 bg-background/82 shadow-[0_18px_42px_-26px_rgba(15,23,42,0.55)] backdrop-blur-xl"
                >
                  <Plus className="size-4" />
                </Button>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute left-[calc(100%+0.75rem)] top-1/2 min-w-max -translate-y-1/2 rounded-xl border border-border/70 bg-background/96 px-3 py-2 text-xs text-foreground opacity-0 shadow-[0_18px_42px_-26px_rgba(15,23,42,0.55)] transition-opacity group-hover/layer-add:opacity-100"
                >
                  {maxLayerTooltip}
                </div>
              </>
            )}
          </div>

          <div className="sr-only">Layers</div>

          {displayedLayers.map((layer, displayIndex) => {
            const isActive = layer.id === activeLayerId;
            const isEditing = editingLayerId === layer.id;
            const isPinnedOpen = isEditing || contextMenu?.layerId === layer.id;
            const isDragged = draggedLayerId === layer.id;
            const ariaLabel = getLayerButtonLabel(layer);

            return (
              <div
                key={layer.id}
                className="pointer-events-auto relative"
              >
                {dropIndicatorIndex === displayIndex ? (
                  <div className="pointer-events-none absolute inset-x-3 -top-1 z-20 h-0 border-t-2 border-primary" />
                ) : null}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={ariaLabel}
                  aria-pressed={isActive}
                  data-testid="layer-row"
                  data-layer-id={layer.id}
                  data-layer-kind={layer.kind}
                  data-layer-name={layer.name}
                  draggable={!isEditing}
                  onClick={() => onSelectLayer(layer.id)}
                  onKeyDown={(event) => handleLayerKeyDown(event, layer.id)}
                  onContextMenu={(event) => handleLayerContextMenu(event, layer.id)}
                  onDragStart={(event) => handleLayerDragStart(event, layer.id)}
                  onDragOver={(event) => handleLayerDragOver(event, displayIndex)}
                  onDrop={handleLayerDrop}
                  onDragEnd={clearLayerDragState}
                  className={cn(
                    'group/layer relative flex items-center gap-2 overflow-hidden rounded-[20px] border border-border/70 bg-background/82 px-2 py-2 text-left shadow-[0_18px_42px_-26px_rgba(15,23,42,0.55)] backdrop-blur-xl transition-[width,transform,border-color,background-color,box-shadow,opacity] duration-200 ease-out hover:w-60 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-background/92 focus-visible:w-60 focus-visible:-translate-y-0.5 focus-visible:border-primary/50 focus-visible:bg-background/92 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-0 focus-within:w-60 focus-within:border-primary/50 focus-within:bg-background/92',
                    isPinnedOpen ? 'w-60 border-primary/50 bg-background/94' : 'w-14',
                    isActive && 'border-primary/60 bg-background/94 shadow-[0_22px_50px_-28px_rgba(14,165,233,0.5)]',
                    isDragged && 'opacity-45',
                  )}
                >
                  <LayerThumbnailPreview
                    layer={layer}
                    thumbnailDataUrl={layerThumbnails[layer.id]?.dataUrl ?? null}
                    thumbnailTestId={thumbnailTestId}
                  />

                  <div
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 overflow-hidden max-w-0 opacity-0 translate-x-2 pointer-events-none transition-[max-width,opacity,transform] duration-150 ease-out group-hover/layer:max-w-44 group-hover/layer:translate-x-0 group-hover/layer:opacity-100 group-focus-within/layer:max-w-44 group-focus-within/layer:translate-x-0 group-focus-within/layer:opacity-100',
                      isPinnedOpen && 'max-w-44 pointer-events-auto translate-x-0 opacity-100',
                    )}
                  >
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/65 text-muted-foreground">
                      <LayerKindIcon layer={layer} />
                    </span>

                    {isEditing ? (
                      <Input
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={() => commitInlineRename(layer.id)}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitInlineRename(layer.id);
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelInlineRename();
                          }
                        }}
                        autoFocus
                        className="h-8 min-w-0 flex-1 border-transparent bg-muted/45 text-sm shadow-none focus-visible:border-primary/40 focus-visible:bg-background"
                      />
                    ) : (
                      <span
                        className="min-w-0 flex-1 truncate text-sm font-medium"
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          startInlineRename(layer);
                        }}
                      >
                        {layer.name}
                      </span>
                    )}

                    <button
                      type="button"
                      aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleVisibility(layer.id);
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    </button>
                  </div>
                </div>
                {dropIndicatorIndex === displayedLayers.length && displayIndex === displayedLayers.length - 1 ? (
                  <div className="pointer-events-none absolute inset-x-3 -bottom-1 z-20 h-0 border-t-2 border-primary" />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {contextMenuLayer ? (
        <>
          <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
          <Card
            ref={contextMenuRef}
            className="fixed z-50 min-w-56 gap-0 rounded-2xl border-border/80 bg-background/95 px-0 py-1.5 shadow-[0_28px_80px_-34px_rgba(2,6,23,0.78)] backdrop-blur-xl"
            style={{
              left: contextMenuPosition?.left ?? contextMenu?.x ?? 0,
              top: contextMenuPosition?.top ?? contextMenu?.y ?? 0,
            }}
          >
            <div className="px-3 py-2">
              <div className="mb-2 flex items-center justify-between text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                <span>Opacity</span>
                <span>{contextMenuOpacityDraft}%</span>
              </div>
              <input
                aria-label="Layer opacity"
                type="range"
                min={0}
                max={100}
                step={1}
                value={contextMenuOpacityDraft}
                onChange={(event) => setContextMenuOpacityDraft(Number(event.target.value))}
                onPointerUp={commitContextMenuOpacity}
                onKeyUp={commitContextMenuOpacity}
                onBlur={commitContextMenuOpacity}
                className="w-full accent-primary"
              />
            </div>

            <DropdownMenuSeparator />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onDuplicateLayer(contextMenuLayer.id);
                closeContextMenu();
              }}
              className="h-9 w-full justify-start rounded-none px-3"
            >
              <Copy className="size-4" />
              Duplicate
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onToggleLocked(contextMenuLayer.id);
                closeContextMenu();
              }}
              className="h-9 w-full justify-start rounded-none px-3"
            >
              {contextMenuLayer.locked ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
              {contextMenuLayer.locked ? 'Unlock' : 'Lock'}
            </Button>

            {showMergeAction ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onMergeDown?.(contextMenuLayer.id);
                  closeContextMenu();
                }}
                disabled={contextMenuLayerIndex <= 0 || !onMergeDown}
                className="h-9 w-full justify-start rounded-none px-3"
              >
                <Layers3 className="size-4" />
                {mergeActionLabel}
              </Button>
            ) : null}

            {showRasterizeAction && contextMenuLayer.kind === 'vector' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onRasterizeLayer?.(contextMenuLayer.id);
                  closeContextMenu();
                }}
                disabled={!onRasterizeLayer}
                className="h-9 w-full justify-start rounded-none px-3"
              >
                <Image className="size-4" />
                Rasterize
              </Button>
            ) : null}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onDeleteLayer(contextMenuLayer.id);
                closeContextMenu();
              }}
              disabled={document.layers.length <= 1}
              className="h-9 w-full justify-start rounded-none px-3 text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </Card>
        </>
      ) : null}
    </>
  );
});

LayerPanel.displayName = 'LayerPanel';
