import { type ChangeEvent, memo, useEffect, useRef, useState } from 'react';
import { useConvex, useConvexAuth, useMutation } from 'convex/react';
import { api } from '@convex-generated/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SoundLibraryBrowser } from '@/components/dialogs/SoundLibraryBrowser';
import { AssetSidebar } from '@/components/editors/shared/AssetSidebar';
import { AssetSidebarTile } from '@/components/editors/shared/AssetSidebarTile';
import { compressAudio, getAudioDuration } from '@/utils/audioProcessor';
import type { Sound } from '@/types';
import { shouldIgnoreGlobalKeyboardEvent } from '@/utils/keyboard';
import { Library, Loader2, Mic, Save, Trash2, Upload, Volume2 } from '@/components/ui/icons';
import { prepareSoundLibraryCreatePayload } from '@/lib/soundLibrary/soundLibraryAssets';
import { ensureLibraryAssetRefsInCloud } from '@/lib/templateLibrary/libraryAssetRefs';

interface SoundListProps {
  sounds: Sound[];
  selectedIndex: number;
  onOpenRecorder: () => void;
  onSelectSound: (index: number) => void;
  onAddSound: (sound: Sound) => void;
  onDeleteSound: (index: number) => void;
  onRenameSound: (index: number, name: string) => void;
}

export const SoundList = memo(({
  sounds,
  selectedIndex,
  onOpenRecorder,
  onSelectSound,
  onAddSound,
  onDeleteSound,
  onRenameSound,
}: SoundListProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  const generateUploadUrl = useMutation(api.projectAssets.generateUploadUrl);
  const upsertProjectAsset = useMutation(api.projectAssets.upsert);
  const createLibraryItem = useMutation(api.soundLibrary.create);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalKeyboardEvent(event)) {
        return;
      }

      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    setIsProcessing(true);

    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('audio/')) {
          continue;
        }

        try {
          const originalDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const compressedDataUrl = await compressAudio(originalDataUrl);
          const duration = await getAudioDuration(compressedDataUrl);

          onAddSound({
            id: crypto.randomUUID(),
            name: file.name.replace(/\.[^/.]+$/, ''),
            assetId: compressedDataUrl,
            duration,
          });
        } catch (error) {
          console.error('Failed to process audio:', file.name, error);
        }
      }
    } finally {
      setIsProcessing(false);
      event.target.value = '';
    }
  };

  const handleLibrarySelect = async (data: { name: string; dataUrl: string }) => {
    try {
      const duration = await getAudioDuration(data.dataUrl);
      onAddSound({
        id: crypto.randomUUID(),
        name: data.name,
        assetId: data.dataUrl,
        duration,
      });
    } catch (error) {
      console.error('Failed to add sound from library:', error);
      alert('Failed to add sound from library');
    }
  };

  const handleSaveToLibrary = async (index: number) => {
    if (!isAuthenticated) {
      alert('Sign in to save sounds to the cloud library.');
      return;
    }

    const sound = sounds[index];
    if (!sound) {
      return;
    }

    setSavingToLibrary(index);
    try {
      const prepared = await prepareSoundLibraryCreatePayload(sound);
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
      console.error('Failed to save sound to library:', error);
      alert('Failed to save sound to library');
    } finally {
      setSavingToLibrary(null);
    }
  };

  const handleCloseContextMenu = () => setContextMenu(null);

  return (
    <>
      <AssetSidebar
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onOpenRecorder}
              title="Record sound"
              disabled={isProcessing}
            >
              <Mic className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => fileInputRef.current?.click()}
              title="Import sound"
              disabled={isProcessing}
            >
              {isProcessing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
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
              accept="audio/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </>
        }
        contentClassName="space-y-2"
      >
        {sounds.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-2 text-center text-muted-foreground">
            <Volume2 className="size-8" />
            <p className="mt-2 text-xs">No sounds</p>
            <p className="mt-1 text-xs">Use the toolbar to add one</p>
          </div>
        ) : (
          <>
            {sounds.map((sound, index) => {
              const isSelected = index === selectedIndex;

              return (
                <AssetSidebarTile
                  key={sound.id}
                  index={index}
                  name={sound.name}
                  selected={isSelected}
                  onClick={() => onSelectSound(index)}
                  onNameCommit={(name) => onRenameSound(index, name)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({
                      index,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  media={
                    <div className="flex h-full items-center justify-center">
                      <Volume2 className="size-8 text-muted-foreground" />
                    </div>
                  }
                />
              );
            })}
          </>
        )}
      </AssetSidebar>

      {contextMenu ? (
        <>
          <div className="fixed inset-0 z-40" onClick={handleCloseContextMenu} />
          <Card
            className="fixed z-50 min-w-44 gap-0 py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleSaveToLibrary(contextMenu.index);
                handleCloseContextMenu();
              }}
              disabled={!isAuthenticated || savingToLibrary === contextMenu.index}
              className="h-8 w-full justify-start rounded-none"
            >
              {savingToLibrary === contextMenu.index ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Add to Library
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onDeleteSound(contextMenu.index);
                handleCloseContextMenu();
              }}
              className="h-8 w-full justify-start rounded-none text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </Card>
        </>
      ) : null}

      <SoundLibraryBrowser
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelect={handleLibrarySelect}
      />
    </>
  );
});

SoundList.displayName = 'SoundList';
