import {
  useRef,
  useState,
  memo,
  useEffect,
  useMemo,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useConvex, useConvexAuth, useMutation } from 'convex/react';
import { api } from '@convex-generated/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Plus, Upload, Loader2, Library, Copy, CopyPlus, Trash2, Clipboard, Scissors } from '@/components/ui/icons';
import { processImage } from '@/utils/imageProcessor';
import { calculateVisibleBounds } from '@/utils/imageBounds';
import { CostumeLibraryBrowser } from '@/components/dialogs/CostumeLibraryBrowser';
import { AssetSidebar } from '@/components/editors/shared/AssetSidebar';
import { AssetSidebarTile } from '@/components/editors/shared/AssetSidebarTile';
import { useAssetSidebarDrag } from '@/components/editors/shared/useAssetSidebarDrag';
import type { Costume, CostumeAssetFrame, CostumeBounds, CostumeDocument } from '@/types';
import { shouldIgnoreGlobalKeyboardEvent } from '@/utils/keyboard';
import { getCostumeBoundsInAssetSpace } from '@/lib/costume/costumeAssetFrame';
import {
  cloneCostume,
  cloneCostumeDocument,
  createBlankCostumeDocument,
  createBitmapCostumeDocument,
} from '@/lib/costume/costumeDocument';
import {
  getCachedCostumeDocumentPreview,
  getCostumeDocumentPreviewSignature,
  renderCostumeDocumentPreview,
} from '@/lib/costume/costumeDocumentRender';
import { prepareCostumeLibraryCreatePayload } from '@/lib/costumeLibrary/costumeLibraryAssets';
import { ensureLibraryAssetRefsInCloud } from '@/lib/templateLibrary/libraryAssetRefs';
import { useModal } from '@/components/ui/modal-provider';
import {
  getAssetCardActionIds,
  getAssetCardClipboard,
  hasAssetCardClipboardContents,
  insertAssetItemsAtIndex,
  setAssetCardClipboard,
  type AssetCardClipboardMode,
} from '@/lib/editor/assetCardClipboard';

interface CostumeListProps {
  costumes: Costume[];
  activeCostumeId: string | null;
  selectedCostumeIds: string[];
  onSelectCostume: (
    costumeId: string,
    event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  ) => void;
  onAddCostume: (costume: Costume) => void;
  onDeleteCostumes: (costumeIds: string[]) => void;
  onRenameCostume: (costumeId: string, name: string) => void;
  onReplaceCostumes: (nextCostumes: Costume[], nextActiveCostumeId: string | null, nextSelectedCostumeIds: string[]) => void;
  onPrepareCostumeDrag: (costumeId: string) => string[];
  onReorderCostumes: (costumeIds: string[], targetIndex: number) => void;
}

const CostumeListPreview = memo(function CostumeListPreview({ costume }: { costume: Costume }) {
  const previewSignature = useMemo(
    () => getCostumeDocumentPreviewSignature(costume.document),
    [costume.document],
  );
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewContainerSize, setPreviewContainerSize] = useState(0);
  const [preview, setPreview] = useState<{ assetFrame?: CostumeAssetFrame | null; assetId: string; bounds?: CostumeBounds }>(() => {
    const cachedPreview = getCachedCostumeDocumentPreview(costume.document);
    if (cachedPreview) {
      return {
        assetFrame: cachedPreview.assetFrame,
        assetId: cachedPreview.dataUrl,
        bounds: cachedPreview.bounds ?? undefined,
      };
    }

    return {
      assetFrame: costume.assetFrame,
      assetId: costume.assetId,
      bounds: costume.bounds,
    };
  });

  useEffect(() => {
    let cancelled = false;
    const cachedPreview = getCachedCostumeDocumentPreview(costume.document);
    if (cachedPreview) {
      setPreview({
        assetFrame: cachedPreview.assetFrame,
        assetId: cachedPreview.dataUrl,
        bounds: cachedPreview.bounds ?? undefined,
      });
      return () => {
        cancelled = true;
      };
    }

    void renderCostumeDocumentPreview(costume.document).then((rendered) => {
      if (cancelled) {
        return;
      }

      setPreview({
        assetFrame: rendered.assetFrame,
        assetId: rendered.dataUrl,
        bounds: rendered.bounds ?? undefined,
      });
    }).catch((error) => {
      if (!cancelled) {
        console.warn('Failed to render costume list preview from document.', error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [previewSignature]);

  useEffect(() => {
    const element = previewContainerRef.current;
    if (!element) {
      return;
    }

    const updateSize = (width: number, height: number) => {
      setPreviewContainerSize(Math.max(0, Math.min(width, height)));
    };

    updateSize(element.clientWidth, element.clientHeight);

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (preview.bounds && preview.bounds.width > 0 && preview.bounds.height > 0) {
    const fitSize = previewContainerSize > 0 ? previewContainerSize * 0.85 : 140;
    const scale = Math.min(1, fitSize / Math.max(preview.bounds.width, preview.bounds.height));
    const localBounds = getCostumeBoundsInAssetSpace(preview.bounds, preview.assetFrame);
    return (
      <div ref={previewContainerRef} className="relative h-full w-full">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${preview.assetId})`,
            backgroundPosition: localBounds ? `${-localBounds.x}px ${-localBounds.y}px` : '0 0',
            backgroundSize: preview.assetFrame
              ? `${preview.assetFrame.width}px ${preview.assetFrame.height}px`
              : '1024px 1024px',
            backgroundRepeat: 'no-repeat',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            width: preview.bounds.width,
            height: preview.bounds.height,
            imageRendering: 'pixelated',
            left: '50%',
            top: '50%',
            marginLeft: -(preview.bounds.width * scale) / 2,
            marginTop: -(preview.bounds.height * scale) / 2,
          }}
        />
      </div>
    );
  }

  return (
    <div ref={previewContainerRef} className="h-full w-full">
      <img
        src={preview.assetId}
        alt={costume.name}
        className="h-full w-full object-contain"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
});

export const CostumeList = memo(({
  costumes,
  activeCostumeId,
  selectedCostumeIds,
  onSelectCostume,
  onAddCostume,
  onDeleteCostumes,
  onRenameCostume,
  onReplaceCostumes,
  onPrepareCostumeDrag,
  onReorderCostumes,
}: CostumeListProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState<number | null>(null);
  const { showAlert } = useModal();
  const [contextMenu, setContextMenu] = useState<{ costumeId: string; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const selectedCostumeIdSet = new Set(selectedCostumeIds);

  const handleCloseContextMenu = () => setContextMenu(null);

  useEffect(() => {
    const closeOnEscape = (e: KeyboardEvent) => {
      if (shouldIgnoreGlobalKeyboardEvent(e)) {
        return;
      }

      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    if (!contextMenu || typeof document === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      handleCloseContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [contextMenu]);

  const generateUploadUrl = useMutation(api.projectAssets.generateUploadUrl);
  const upsertProjectAsset = useMutation(api.projectAssets.upsert);
  const createLibraryItem = useMutation(api.costumeLibrary.create);
  const contextMenuCostume = contextMenu
    ? costumes.find((costume) => costume.id === contextMenu.costumeId) ?? null
    : null;
  const contextMenuCostumeIndex = contextMenuCostume
    ? costumes.findIndex((costume) => costume.id === contextMenuCostume.id)
    : -1;
  const contextMenuDeleteIds = contextMenuCostume
    ? (selectedCostumeIds.length > 1 && selectedCostumeIdSet.has(contextMenuCostume.id)
        ? selectedCostumeIds
        : [contextMenuCostume.id])
    : [];
  const canDeleteContextMenuCostumes = contextMenuDeleteIds.length > 0
    && costumes.length - contextMenuDeleteIds.length >= 1;
  const contextMenuDeleteLabel = contextMenuDeleteIds.length > 1
    ? `Delete Selected (${contextMenuDeleteIds.length})`
    : 'Delete';
  const {
    dropBoundaryRef,
    draggedItemIds: draggedCostumeIds,
    dropTarget,
    clearDragState,
    handleDragStart: handleCostumeDragStart,
    handleDragOver: handleCostumeDragOver,
    handleTailDragOver: handleTailCostumeDragOver,
    handleDrop: handleCostumeDrop,
    handleTailDrop: handleTailCostumeDrop,
  } = useAssetSidebarDrag({
    itemIds: costumes.map((costume) => costume.id),
    dataTransferType: 'application/x-pocha-costume-ids',
    onPrepareDrag: onPrepareCostumeDrag,
    onReorder: onReorderCostumes,
  });

  const handleAddBlank = () => {
    // Create a blank 1024x1024 transparent canvas as initial costume
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    // Canvas is transparent by default, no need to fill

    const newCostume: Costume = {
      id: crypto.randomUUID(),
      name: `costume${costumes.length + 1}`,
      assetId: canvas.toDataURL('image/png'),
      document: createBlankCostumeDocument(),
    };
    onAddCostume(newCostume);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);

    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;

        try {
          const processedDataUrl = await processImage(file);
          // Calculate bounds for the uploaded image
          const bounds = await calculateVisibleBounds(processedDataUrl);
          const newCostume: Costume = {
            id: crypto.randomUUID(),
            name: file.name.replace(/\.[^/.]+$/, ''),
            assetId: processedDataUrl,
            bounds: bounds || undefined,
            document: createBitmapCostumeDocument(
              processedDataUrl,
              file.name.replace(/\.[^/.]+$/, '') || 'Layer 1',
            ),
          };
          onAddCostume(newCostume);
        } catch (error) {
          console.error('Failed to process image:', file.name, error);
        }
      }
    } finally {
      setIsProcessing(false);
      e.target.value = '';
    }
  };

  const handleLibrarySelect = (data: {
    name: string;
    dataUrl: string;
    bounds?: CostumeBounds;
    document: CostumeDocument;
  }) => {
    try {
      const newCostume: Costume = {
        id: crypto.randomUUID(),
        name: data.name,
        assetId: data.dataUrl,
        bounds: data.bounds,
        document: cloneCostumeDocument(data.document),
      };
      onAddCostume(newCostume);
    } catch (error) {
      console.error('Failed to add costume from library:', error);
      void showAlert({
        title: 'Add Failed',
        description: 'Failed to add costume from library',
        tone: 'destructive',
      });
    }
  };

  const handleSaveToLibrary = async (index: number) => {
    const costume = costumes[index];
    if (!costume) return;
    if (!isAuthenticated) {
      await showAlert({
        title: 'Sign In Required',
        description: 'Sign in to save costumes to the cloud library.',
      });
      return;
    }

    setSavingToLibrary(index);
    try {
      const prepared = await prepareCostumeLibraryCreatePayload(costume);
      await ensureLibraryAssetRefsInCloud(prepared.assetRefs, {
        listMissingAssetIds: async (assetIds) => {
          return await convex.query(api.projectAssets.listMissing, { assetIds }) as string[];
        },
        generateUploadUrl,
        upsertAsset: async (args) => {
          return await upsertProjectAsset({
            assetId: args.assetId,
            kind: args.kind,
            mimeType: args.mimeType,
            size: args.size,
            storageId: args.storageId,
          });
        },
      });

      await createLibraryItem(prepared.payload);
    } catch (error) {
      console.error('Failed to save costume to library:', error);
      await showAlert({
        title: 'Save Failed',
        description: 'Failed to save costume to library',
        tone: 'destructive',
      });
    } finally {
      setSavingToLibrary(null);
    }
  };

  const handleDuplicateCostume = (index: number) => {
    const costume = costumes[index];
    if (!costume) return;

    onAddCostume(cloneCostume({
      ...costume,
      id: crypto.randomUUID(),
      name: `${costume.name} copy`,
    }));
  };

  const getContextMenuActionIds = useCallback(() => {
    return getAssetCardActionIds(
      costumes.map((costume) => costume.id),
      selectedCostumeIds,
      contextMenuCostume?.id ?? null,
    );
  }, [contextMenuCostume?.id, costumes, selectedCostumeIds]);

  const cloneCostumeForPaste = useCallback((costume: Costume, mode: AssetCardClipboardMode): Costume => cloneCostume({
    ...costume,
    id: crypto.randomUUID(),
    name: mode === 'cut' ? costume.name : `${costume.name} Copy`,
  }), []);

  const handleCopyCostumes = useCallback((mode: AssetCardClipboardMode = 'copy') => {
    const actionIds = getContextMenuActionIds();
    if (actionIds.length === 0) {
      return false;
    }

    const costumeById = new Map(costumes.map((costume) => [costume.id, costume]));
    const entries = actionIds
      .map((id) => costumeById.get(id))
      .filter((costume): costume is Costume => !!costume)
      .map((costume) => ({ item: cloneCostume(costume) }));

    if (entries.length === 0) {
      return false;
    }

    setAssetCardClipboard({
      kind: 'costume',
      mode,
      entries,
    });
    return true;
  }, [costumes, getContextMenuActionIds]);

  const handleCutCostumes = useCallback(() => {
    if (!canDeleteContextMenuCostumes) {
      return;
    }
    if (!handleCopyCostumes('cut')) {
      return;
    }
    onDeleteCostumes(contextMenuDeleteIds);
    handleCloseContextMenu();
  }, [canDeleteContextMenuCostumes, contextMenuDeleteIds, handleCopyCostumes, onDeleteCostumes]);

  const handlePasteCostumes = useCallback((modeOverride?: AssetCardClipboardMode) => {
    const clipboard = getAssetCardClipboard<Costume>('costume');
    if (!clipboard) {
      return;
    }

    const nextMode = modeOverride ?? clipboard.mode;
    const insertedCostumes = clipboard.entries.map((entry) => cloneCostumeForPaste(entry.item, nextMode));
    if (insertedCostumes.length === 0) {
      return;
    }

    const targetIndex = contextMenuCostumeIndex >= 0 ? contextMenuCostumeIndex + 1 : costumes.length;
    const nextCostumes = insertAssetItemsAtIndex(costumes, insertedCostumes, targetIndex);
    const nextSelectedIds = insertedCostumes.map((costume) => costume.id);
    onReplaceCostumes(nextCostumes, nextSelectedIds[0] ?? null, nextSelectedIds);

    if (clipboard.mode === 'cut' && !modeOverride) {
      setAssetCardClipboard({
        kind: 'costume',
        mode: 'copy',
        entries: insertedCostumes.map((costume) => ({ item: cloneCostume(costume) })),
      });
    }

    handleCloseContextMenu();
  }, [cloneCostumeForPaste, contextMenuCostumeIndex, costumes, onReplaceCostumes]);

  const handleDuplicateCostumes = useCallback(() => {
    if (!handleCopyCostumes('copy')) {
      return;
    }
    handlePasteCostumes('copy');
  }, [handleCopyCostumes, handlePasteCostumes]);

  return (
    <>
      <AssetSidebar
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleAddBlank}
              title="New blank costume"
              disabled={isProcessing}
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleUploadClick}
              title="Import image"
              disabled={isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setShowLibrary(true)}
              title="Browse library"
              disabled={isProcessing}
            >
              <Library className="size-3.5" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
          </>
        }
      >
        <div ref={dropBoundaryRef}>
          {costumes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-2 text-center text-muted-foreground">
              <p className="text-xs">No costumes</p>
              <p className="mt-1 text-xs">Click + to add</p>
            </div>
          ) : (
            <>
              {costumes.map((costume, index) => (
                <div
                  key={costume.id}
                  className="relative py-1 first:pt-0"
                  onDragOver={(event) => handleCostumeDragOver(event, index)}
                  onDrop={(event) => handleCostumeDrop(event, index)}
                >
                  {dropTarget?.key === costume.id && dropTarget.dropPosition === 'before' ? (
                    <div className="pointer-events-none absolute inset-x-1 top-0 z-10 h-0 border-t-2 border-primary" />
                  ) : null}
                  <AssetSidebarTile
                    itemId={costume.id}
                    index={index}
                    name={costume.name}
                    selected={selectedCostumeIdSet.has(costume.id)}
                    active={costume.id === activeCostumeId}
                    testId="costume-list-tile"
                    dragging={draggedCostumeIds.includes(costume.id)}
                    draggable
                    onClick={(event) => onSelectCostume(costume.id, event)}
                    onActivate={() => onSelectCostume(costume.id, { metaKey: false, ctrlKey: false, shiftKey: false })}
                    onNameCommit={(name) => onRenameCostume(costume.id, name)}
                    onContextMenu={(e: ReactMouseEvent<HTMLDivElement>) => {
                      e.preventDefault();
                      setContextMenu({
                        costumeId: costume.id,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    onDragStart={(event) => handleCostumeDragStart(event, costume.id)}
                    onDragEnd={clearDragState}
                    media={
                      <CostumeListPreview costume={costume} />
                    }
                  />
                  {dropTarget?.key === costume.id && dropTarget.dropPosition === 'after' ? (
                    <div className="pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0 border-t-2 border-primary" />
                  ) : null}
                </div>
              ))}
              <div
                className="relative h-3"
                onDragOver={handleTailCostumeDragOver}
                onDrop={handleTailCostumeDrop}
              >
                {dropTarget?.key === null && dropTarget.dropPosition === null ? (
                  <div className="pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0 border-t-2 border-primary" />
                ) : null}
              </div>
            </>
          )}
        </div>
      </AssetSidebar>

      {contextMenu && (
        <>
          <Card
            ref={contextMenuRef}
            className="fixed z-50 py-1 min-w-44 gap-0"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                handleCopyCostumes('copy');
                handleCloseContextMenu();
              }}
              className="w-full justify-start rounded-none h-8"
            >
              <Copy className="size-4" />
              Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCutCostumes}
              disabled={!canDeleteContextMenuCostumes}
              className="w-full justify-start rounded-none h-8"
            >
              <Scissors className="size-4" />
              Cut
            </Button>
            {hasAssetCardClipboardContents('costume') ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handlePasteCostumes()}
                className="w-full justify-start rounded-none h-8"
              >
                <Clipboard className="size-4" />
                Paste
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDuplicateCostumes}
              className="w-full justify-start rounded-none h-8"
            >
              <CopyPlus className="size-4" />
              Duplicate
            </Button>
            <DropdownMenuSeparator />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (contextMenuCostume) {
                  void handleSaveToLibrary(contextMenuCostumeIndex);
                }
                handleCloseContextMenu();
              }}
              disabled={!contextMenuCostume || contextMenuCostumeIndex < 0 || savingToLibrary === contextMenuCostumeIndex}
              className="w-full justify-start rounded-none h-8"
            >
              {contextMenuCostume && savingToLibrary === contextMenuCostumeIndex ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Library className="size-4" />
              )}
              Add to Library
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (canDeleteContextMenuCostumes) {
                  onDeleteCostumes(contextMenuDeleteIds);
                }
                handleCloseContextMenu();
              }}
              disabled={!canDeleteContextMenuCostumes}
              className="w-full justify-start rounded-none h-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
              {contextMenuDeleteLabel}
            </Button>
          </Card>
        </>
      )}

      {/* Costume Library Browser Dialog */}
      <CostumeLibraryBrowser
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelect={handleLibrarySelect}
      />
    </>
  );
});

CostumeList.displayName = 'CostumeList';
