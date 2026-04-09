import { useRef, useState } from 'react';
import { useConvex, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '@convex-generated/api';
import type { Id } from '@convex-generated/dataModel';
import { Button } from '@/components/ui/button';
import { LibraryBrowserDialog } from '@/components/dialogs/LibraryBrowserDialog';
import { Loader2, Upload } from '@/components/ui/icons';
import type { CostumeBounds, CostumeDocument } from '@/types';
import { processImage } from '@/utils/imageProcessor';
import { createBitmapCostumeDocument, createStaticCostumeFromDocument } from '@/lib/costume/costumeDocument';
import {
  hydrateCostumeLibraryItemForInsertion,
  prepareCostumeLibraryCreatePayload,
  type CostumeLibraryListItemData,
} from '@/lib/costumeLibrary/costumeLibraryAssets';
import { ensureLibraryAssetRefsInCloud } from '@/lib/templateLibrary/libraryAssetRefs';
import { useModal } from '@/components/ui/modal-provider';

interface CostumeLibraryBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (data: {
    name: string;
    dataUrl: string;
    bounds?: CostumeBounds;
    document: CostumeDocument;
  }) => void;
}

interface CostumeLibraryItem extends CostumeLibraryListItemData {
  _id: Id<'costumeLibrary'>;
  createdAt: number;
}

export function CostumeLibraryBrowser({
  open,
  onOpenChange,
  onSelect,
}: CostumeLibraryBrowserProps) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showAlert, showConfirm } = useModal();

  const items = useQuery(api.costumeLibrary.list, open ? {} : 'skip') as CostumeLibraryItem[] | undefined;
  const generateUploadUrl = useMutation(api.projectAssets.generateUploadUrl);
  const upsertProjectAsset = useMutation(api.projectAssets.upsert);
  const createItem = useMutation(api.costumeLibrary.create);
  const removeItem = useMutation(api.costumeLibrary.remove);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) {
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          continue;
        }

        const processedDataUrl = await processImage(file);
        const prepared = await prepareCostumeLibraryCreatePayload(createStaticCostumeFromDocument({
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^/.]+$/, ''),
          assetId: processedDataUrl,
          document: createBitmapCostumeDocument(
            processedDataUrl,
            file.name.replace(/\.[^/.]+$/, '') || 'Layer 1',
          ),
        }));

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

        await createItem(prepared.payload);
      }
    } catch (error) {
      console.error('Failed to upload costume:', error);
      await showAlert({
        title: 'Upload Failed',
        description: 'Failed to upload costume',
        tone: 'destructive',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteSelected = async (selectedItems: CostumeLibraryItem[]) => {
    const confirmed = await showConfirm({
      title: selectedItems.length === 1 ? 'Delete Costume' : 'Delete Costumes',
      description: selectedItems.length === 1
        ? 'Delete this costume from library?'
        : `Delete ${selectedItems.length} costumes from library?`,
      confirmLabel: selectedItems.length === 1 ? 'Delete Costume' : `Delete ${selectedItems.length} Costumes`,
      tone: 'destructive',
    });
    if (!confirmed) {
      return;
    }

    try {
      await Promise.all(selectedItems.map((item) => removeItem({ id: item._id })));
    } catch (error) {
      console.error('Failed to delete costumes:', error);
      await showAlert({
        title: 'Delete Failed',
        description: 'Failed to delete costume',
        tone: 'destructive',
      });
    }
  };

  const handleOpenItem = async (item: CostumeLibraryItem) => {
    try {
      onSelect?.(await hydrateCostumeLibraryItemForInsertion(item));
    } catch (error) {
      console.error('Failed to load costume:', error);
      await showAlert({
        title: 'Load Failed',
        description: 'Failed to load costume',
        tone: 'destructive',
      });
      throw error;
    }
  };

  return (
    <LibraryBrowserDialog
      canDeleteItem={(item) => item.scope === 'user'}
      emptyDescription={isAuthenticated ? 'Upload images to build your collection.' : 'Sign in to add your own costumes.'}
      emptyTitle="No costumes in library"
      getItemId={(item) => item._id}
      getItemName={(item) => item.name}
      itemLabelPlural="costumes"
      itemLabelSingular="costume"
      items={items}
      onDeleteSelected={handleDeleteSelected}
      onItemOpen={handleOpenItem}
      onOpenChange={onOpenChange}
      open={open}
      renderCard={(item) => (
        <>
          <div className="checkerboard-bg checkerboard-bg-sm aspect-square w-full overflow-hidden border-b border-border/60 bg-muted">
            <img
              src={item.thumbnail}
              alt={item.name}
              className="h-full w-full object-contain p-4"
            />
          </div>

          <div className="flex flex-1 flex-col justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">
                {item.name}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Transparent-ready preview
              </p>
            </div>
          </div>
        </>
      )}
      renderRow={(item) => (
        <>
          <div className="checkerboard-bg checkerboard-bg-sm h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-border/70 bg-muted">
            <img
              src={item.thumbnail}
              alt={item.name}
              className="h-full w-full object-contain p-2"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {item.name}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Click to add this costume to the current object
            </div>
          </div>
        </>
      )}
      title="Costume Library"
      toolbarActions={(
        <>
          <Button
            size="sm"
            disabled={!isAuthenticated || uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
        </>
      )}
    />
  );
}
