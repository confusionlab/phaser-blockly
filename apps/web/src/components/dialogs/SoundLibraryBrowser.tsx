import { useRef, useState } from 'react';
import { useConvex, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { api } from '@convex-generated/api';
import type { Id } from '@convex-generated/dataModel';
import { Button } from '@/components/ui/button';
import { LibraryBrowserDialog } from '@/components/dialogs/LibraryBrowserDialog';
import {
  Loader2,
  Play,
  Square,
  Upload,
  Volume2,
} from '@/components/ui/icons';
import { blobToDataUrl } from '@/utils/convexHelpers';
import { compressAudio, getAudioDuration } from '@/utils/audioProcessor';
import {
  hydrateSoundLibraryItemForInsertion,
  prepareSoundLibraryCreatePayload,
  type SoundLibraryListItemData,
} from '@/lib/soundLibrary/soundLibraryAssets';
import { ensureLibraryAssetRefsInCloud } from '@/lib/templateLibrary/libraryAssetRefs';
import { useModal } from '@/components/ui/modal-provider';

interface SoundLibraryBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (data: { name: string; dataUrl: string }) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

type SoundLibraryItem = SoundLibraryListItemData & {
  _id: Id<'soundLibrary'>;
  createdAt: number;
};

export function SoundLibraryBrowser({
  open,
  onOpenChange,
  onSelect,
}: SoundLibraryBrowserProps) {
  const convex = useConvex();
  const [uploading, setUploading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { isAuthenticated } = useConvexAuth();
  const { showAlert, showConfirm } = useModal();

  const items = useQuery(api.soundLibrary.list, open ? {} : 'skip') as SoundLibraryItem[] | undefined;
  const generateUploadUrl = useMutation(api.projectAssets.generateUploadUrl);
  const upsertProjectAsset = useMutation(api.projectAssets.upsert);
  const createItem = useMutation(api.soundLibrary.create);
  const removeItem = useMutation(api.soundLibrary.remove);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) {
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('audio/')) {
          continue;
        }

        const originalDataUrl = await blobToDataUrl(file);
        const dataUrl = await compressAudio(originalDataUrl);
        const duration = await getAudioDuration(dataUrl);

        const prepared = await prepareSoundLibraryCreatePayload({
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^/.]+$/, ''),
          assetId: dataUrl,
          duration,
        });

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
      console.error('Failed to upload sound:', error);
      await showAlert({
        title: 'Upload Failed',
        description: 'Failed to upload sound',
        tone: 'destructive',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteSelected = async (selectedItems: SoundLibraryItem[]) => {
    const confirmed = await showConfirm({
      title: selectedItems.length === 1 ? 'Delete Sound' : 'Delete Sounds',
      description: selectedItems.length === 1
        ? 'Delete this sound from library?'
        : `Delete ${selectedItems.length} sounds from library?`,
      confirmLabel: selectedItems.length === 1 ? 'Delete Sound' : `Delete ${selectedItems.length} Sounds`,
      tone: 'destructive',
    });
    if (!confirmed) {
      return;
    }

    if (playingId && selectedItems.some((item) => item._id === playingId)) {
      audioRef.current?.pause();
      setPlayingId(null);
    }

    try {
      await Promise.all(selectedItems.map((item) => removeItem({ id: item._id })));
    } catch (error) {
      console.error('Failed to delete sounds:', error);
      await showAlert({
        title: 'Delete Failed',
        description: 'Failed to delete sound',
        tone: 'destructive',
      });
    }
  };

  const handlePlay = (url: string, id: string) => {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    audioRef.current = new Audio(url);
    audioRef.current.onended = () => setPlayingId(null);
    void audioRef.current.play().catch((error) => {
      console.error('Failed to play sound preview:', error);
      setPlayingId(null);
    });
    setPlayingId(id);
  };

  const handleOpenItem = async (item: SoundLibraryItem) => {
    try {
      const sound = await hydrateSoundLibraryItemForInsertion(item);
      onSelect?.({
        name: sound.name,
        dataUrl: sound.dataUrl,
      });
    } catch (error) {
      console.error('Failed to load sound:', error);
      await showAlert({
        title: 'Load Failed',
        description: 'Failed to load sound',
        tone: 'destructive',
      });
      throw error;
    }
  };

  return (
    <LibraryBrowserDialog
      canDeleteItem={(item) => item.scope === 'user'}
      emptyDescription={isAuthenticated ? 'Upload sounds to build your collection.' : 'Sign in to add your own sounds.'}
      emptyIcon={<Volume2 className="size-8" />}
      emptyTitle="No sounds in library"
      getItemId={(item) => item._id}
      getItemName={(item) => item.name}
      initialViewMode="row"
      itemLabelPlural="sounds"
      itemLabelSingular="sound"
      items={items}
      onDeleteSelected={handleDeleteSelected}
      onItemOpen={handleOpenItem}
      onOpenChange={onOpenChange}
      open={open}
      renderCard={(item) => (
        <>
          <div className="flex aspect-[16/10] items-center justify-center border-b border-border/60 bg-gradient-to-br from-muted via-muted/80 to-background">
            <Button
              variant={playingId === item._id ? 'default' : 'outline'}
              size="icon"
              className="rounded-full shadow-sm"
              onClick={(event) => {
                event.stopPropagation();
                if (item.url) {
                  handlePlay(item.url, item._id);
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {playingId === item._id ? <Square className="size-4" /> : <Play className="size-4" />}
            </Button>
          </div>

          <div className="flex flex-1 flex-col justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">
                {item.name}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Click to add to the current object
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {item.duration ? <span>{formatDuration(item.duration)}</span> : null}
              <span>{formatSize(item.size ?? 0)}</span>
            </div>
          </div>
        </>
      )}
      renderRow={(item) => (
        <>
          <Button
            variant={playingId === item._id ? 'default' : 'outline'}
            size="icon-sm"
            className="rounded-full"
            onClick={(event) => {
              event.stopPropagation();
              if (item.url) {
                handlePlay(item.url, item._id);
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {playingId === item._id ? <Square className="size-4" /> : <Play className="size-4" />}
          </Button>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {item.name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {item.duration ? <span>{formatDuration(item.duration)}</span> : null}
              <span>{formatSize(item.size ?? 0)}</span>
            </div>
          </div>
        </>
      )}
      title="Sound Library"
      toolbarActions={(
        <>
          <Button
            size="sm"
            disabled={uploading || !isAuthenticated}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
        </>
      )}
    />
  );
}
