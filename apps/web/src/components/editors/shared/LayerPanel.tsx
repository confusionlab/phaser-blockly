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
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { MenuItemButton, MenuSeparator } from '@/components/ui/menu-item-button';
import { ThumbnailVisibilityIndicator } from '@/components/ui/thumbnail-visibility-indicator';
import { Copy, Eye, EyeOff, Image, Layers3, Lock, LockOpen, Plus, Shapes, Trash2 } from '@/components/ui/icons';
import { selectionSurfaceClassNames } from '@/lib/ui/selectionSurfaceTokens';
import { cn } from '@/lib/utils';
import { EDITOR_CHROME_Z_INDEX, EDITOR_POPOVER_Z_INDEX } from './editorChromeZIndices';

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

function clampOpacityPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
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
  isActive,
  thumbnailDataUrl,
  thumbnailTestId,
  hiddenIndicatorTestId,
}: {
  layer: LayerPanelLayerShape;
  isActive: boolean;
  thumbnailDataUrl: string | null;
  thumbnailTestId: string;
  hiddenIndicatorTestId: string;
}) {
  return (
    <div
      data-testid={thumbnailTestId}
      draggable={false}
      className={cn(
        'relative z-10 flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[14px] transition-[background-color,box-shadow] duration-150 ease-out',
        isActive
          ? 'bg-transparent shadow-none'
          : 'bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] group-hover/layer-row:bg-transparent group-hover/layer-row:shadow-none dark:bg-background dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:group-hover/layer-row:bg-transparent dark:group-hover/layer-row:shadow-none',
        !layer.visible && 'opacity-70',
      )}
    >
      {thumbnailDataUrl ? (
        <img
          src={thumbnailDataUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none size-full object-contain p-1"
          style={{ opacity: layer.opacity }}
        />
      ) : (
        <div className="pointer-events-none flex size-full items-center justify-center text-muted-foreground/70">
          <LayerKindIcon layer={layer} />
        </div>
      )}
      <ThumbnailVisibilityIndicator visible={layer.visible} testId={hiddenIndicatorTestId} />
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
  mergeActionLabel = 'Merge Down',
  showMergeAction = false,
  showRasterizeAction = false,
  thumbnailTestId = 'layer-thumbnail',
}: SharedLayerPanelProps<LayerPanelLayerShape>) => {
  const displayedLayers = useMemo(() => [...document.layers].reverse(), [document.layers]);
  const activeLayerId = activeLayer?.id ?? document.activeLayerId;
  const canAddLayer = document.layers.length < maxLayers;
  const [isPanelHovered, setIsPanelHovered] = useState(false);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ layerId: string; x: number; y: number } | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [contextMenuOpacityDraft, setContextMenuOpacityDraft] = useState(100);
  const [layerThumbnails, setLayerThumbnails] = useState<Record<string, LayerThumbnailEntry>>({});
  const isPanelExpanded = isPanelHovered || editingLayerId !== null || contextMenu !== null;
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
    const currentEntries = layerThumbnailsRef.current;
    const retainedEntries = Object.fromEntries(
      layerThumbnailRequests.flatMap(({ layer }) => {
        const cachedEntry = currentEntries[layer.id];
        return cachedEntry ? [[layer.id, cachedEntry]] : [];
      }),
    ) as Record<string, LayerThumbnailEntry>;

    if (!areLayerThumbnailEntriesEqual(currentEntries, retainedEntries)) {
      startTransition(() => {
        setLayerThumbnails((current) => (
          areLayerThumbnailEntriesEqual(current, retainedEntries) ? current : retainedEntries
        ));
      });
    }

    const needsRender = layerThumbnailRequests.some(({ layer, signature }) => {
      const cachedEntry = retainedEntries[layer.id];
      return !cachedEntry || cachedEntry.signature !== signature;
    });

    if (!needsRender) {
      return;
    }

    void Promise.all(layerThumbnailRequests.map(async ({ layer, signature }) => {
      const cachedEntry = retainedEntries[layer.id];
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
    setContextMenuOpacityDraft(clampOpacityPercent(contextMenuLayer.opacity * 100));
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

  const commitContextMenuOpacity = (nextDraft = contextMenuOpacityDraft) => {
    if (!contextMenuLayer) {
      return;
    }

    const clampedDraft = clampOpacityPercent(nextDraft);
    if (clampedDraft !== contextMenuOpacityDraft) {
      setContextMenuOpacityDraft(clampedDraft);
    }

    if (clampOpacityPercent(contextMenuLayer.opacity * 100) === clampedDraft) {
      return;
    }

    onOpacityChange(contextMenuLayer.id, clampedDraft / 100);
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
      <div
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
        style={{ zIndex: EDITOR_CHROME_Z_INDEX }}
      >
        <div
          data-testid="layer-panel"
          onPointerEnter={() => setIsPanelHovered(true)}
          onPointerLeave={() => setIsPanelHovered(false)}
          className={cn(
            'pointer-events-auto rounded-[24px] px-3 py-4 transition-[width,background-color,box-shadow] duration-200 ease-out',
            isPanelExpanded
              ? 'w-64 bg-surface-floating shadow-[0_18px_42px_-26px_rgba(15,23,42,0.55)]'
              : 'w-20 bg-transparent shadow-none',
          )}
        >
          <div className="flex flex-col items-start gap-1">
            <div className="relative flex w-11 justify-center group/layer-add">
              {canAddLayer ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      data-testid="layer-add-button"
                      className="rounded-[12px] border border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-surface-interactive hover:text-foreground"
                      label="Add layer"
                      size="sm"
                    >
                      <Plus className="size-3.5" />
                    </IconButton>
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
                  <IconButton
                    data-testid="layer-add-button"
                    disabled
                    className="rounded-[12px] border border-transparent bg-transparent text-muted-foreground shadow-none disabled:opacity-50 group-hover/layer-add:bg-surface-interactive"
                    label="Add layer"
                    size="sm"
                    title={maxLayerTooltip}
                  >
                    <Plus className="size-3.5" />
                  </IconButton>
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute left-[calc(100%+0.75rem)] top-1/2 min-w-max -translate-y-1/2 rounded-xl border border-border/70 bg-surface-floating px-3 py-2 text-xs text-foreground opacity-0 shadow-[0_18px_42px_-26px_rgba(15,23,42,0.55)] transition-opacity group-hover/layer-add:opacity-100"
                  >
                    {maxLayerTooltip}
                  </div>
                </>
              )}
            </div>

            <div className="sr-only">Layers</div>

            <div className="flex w-full flex-col gap-1.5">
              {displayedLayers.map((layer, displayIndex) => {
                const isActive = layer.id === activeLayerId;
                const isEditing = editingLayerId === layer.id;
                const isDragged = draggedLayerId === layer.id;
                const ariaLabel = getLayerButtonLabel(layer);
                const activeHighlightWidth = isPanelExpanded ? '100%' : '2.75rem';

                return (
                  <div
                    key={layer.id}
                    className="relative w-full"
                  >
                    {dropIndicatorIndex === displayIndex ? (
                      <div className="pointer-events-none absolute inset-x-0 -top-1 z-20 h-0 border-t-2 border-primary" />
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
                        'group/layer-row relative flex w-full items-center gap-3 text-left outline-none',
                        isDragged && 'opacity-45',
                      )}
                    >
                      {!isActive ? (
                        <div
                          aria-hidden="true"
                          className={cn(
                            'pointer-events-none absolute inset-0 rounded-[14px] opacity-0 transition-opacity group-hover/layer-row:opacity-100',
                            selectionSurfaceClassNames.hover,
                          )}
                        />
                      ) : null}

                      <div
                        aria-hidden="true"
                        className={cn(
                          'pointer-events-none absolute inset-y-0 left-0 rounded-[14px] transition-[width,opacity] duration-200 ease-out',
                          selectionSurfaceClassNames.selected,
                          isActive ? 'opacity-100' : 'opacity-0',
                        )}
                        style={{ width: activeHighlightWidth }}
                      />

                      <LayerThumbnailPreview
                        layer={layer}
                        isActive={isActive}
                        thumbnailDataUrl={layerThumbnails[layer.id]?.dataUrl ?? null}
                        thumbnailTestId={thumbnailTestId}
                        hiddenIndicatorTestId={`${thumbnailTestId}-hidden-indicator`}
                      />

                      <div
                        className={cn(
                          'relative z-10 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden max-w-0 opacity-0 pointer-events-none transition-[max-width,opacity] duration-150 ease-out',
                          isPanelExpanded && 'max-w-44 pointer-events-auto opacity-100',
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="inline-flex shrink-0 text-muted-foreground">
                            <LayerKindIcon layer={layer} />
                          </span>

                          <InlineRenameField
                            editing={isEditing}
                            value={isEditing ? renameDraft : layer.name}
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
                            autoFocus={isEditing}
                            className="min-w-0 flex-1"
                            textClassName="min-w-0 truncate text-sm font-medium leading-5"
                            displayProps={{
                              onDoubleClick: (event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                startInlineRename(layer);
                              },
                            }}
                          />
                        </div>

                        <IconButton
                          label={layer.visible ? 'Hide layer' : 'Show layer'}
                          shape="pill"
                          size="sm"
                          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleVisibility(layer.id);
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                        </IconButton>
                      </div>
                    </div>
                    {dropIndicatorIndex === displayedLayers.length && displayIndex === displayedLayers.length - 1 ? (
                      <div className="pointer-events-none absolute inset-x-0 -bottom-1 z-20 h-0 border-t-2 border-primary" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {contextMenuLayer ? (
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: EDITOR_POPOVER_Z_INDEX - 1 }}
            onClick={closeContextMenu}
          />
          <Card
            ref={contextMenuRef}
            className="fixed min-w-56 gap-0 rounded-2xl border-border/80 bg-surface-floating px-0 py-1.5 shadow-[0_28px_80px_-34px_rgba(2,6,23,0.78)]"
            style={{
              left: contextMenuPosition?.left ?? contextMenu?.x ?? 0,
              top: contextMenuPosition?.top ?? contextMenu?.y ?? 0,
              zIndex: EDITOR_POPOVER_Z_INDEX,
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
                onChange={(event) => setContextMenuOpacityDraft(clampOpacityPercent(Number(event.target.value)))}
                onPointerUp={(event) => commitContextMenuOpacity(Number(event.currentTarget.value))}
                onKeyUp={(event) => commitContextMenuOpacity(Number(event.currentTarget.value))}
                onBlur={(event) => commitContextMenuOpacity(Number(event.currentTarget.value))}
                className="w-full accent-primary"
              />
            </div>

            <MenuSeparator />

            <MenuItemButton
              icon={<Copy className="size-4" />}
              onClick={() => {
                onDuplicateLayer(contextMenuLayer.id);
                closeContextMenu();
              }}
            >
              Duplicate
            </MenuItemButton>

            <MenuItemButton
              icon={contextMenuLayer.locked ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
              onClick={() => {
                onToggleLocked(contextMenuLayer.id);
                closeContextMenu();
              }}
            >
              {contextMenuLayer.locked ? 'Unlock' : 'Lock'}
            </MenuItemButton>

            {showMergeAction ? (
              <MenuItemButton
                icon={<Layers3 className="size-4" />}
                onClick={() => {
                  onMergeDown?.(contextMenuLayer.id);
                  closeContextMenu();
                }}
                disabled={contextMenuLayerIndex <= 0 || !onMergeDown}
              >
                {mergeActionLabel}
              </MenuItemButton>
            ) : null}

            {showRasterizeAction && contextMenuLayer.kind === 'vector' ? (
              <MenuItemButton
                icon={<Image className="size-4" />}
                onClick={() => {
                  onRasterizeLayer?.(contextMenuLayer.id);
                  closeContextMenu();
                }}
                disabled={!onRasterizeLayer}
              >
                Rasterize
              </MenuItemButton>
            ) : null}

            <MenuItemButton
              icon={<Trash2 className="size-4" />}
              intent="destructive"
              onClick={() => {
                onDeleteLayer(contextMenuLayer.id);
                closeContextMenu();
              }}
              disabled={document.layers.length <= 1}
            >
              Delete
            </MenuItemButton>
          </Card>
        </>
      ) : null}
    </>
  );
});

LayerPanel.displayName = 'LayerPanel';
