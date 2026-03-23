import { type ChangeEvent, memo, useEffect, useRef, useState } from 'react';
import { useConvexAuth, useMutation } from 'convex/react';
import { api } from '@convex-generated/api';
import type { Id } from '@convex-generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { SoundLibraryBrowser } from '@/components/dialogs/SoundLibraryBrowser';
import { AssetSidebar } from '@/components/editors/shared/AssetSidebar';
import { uploadDataUrlToStorage } from '@/utils/convexHelpers';
import { compressAudio, getAudioDuration } from '@/utils/audioProcessor';
import { formatAudioTime } from '@/lib/audioWaveform';
import type { Sound } from '@/types';
import { cn } from '@/lib/utils';
import { shouldIgnoreGlobalKeyboardEvent } from '@/utils/keyboard';
import { Library, Loader2, Mic, Play, Save, Square, Trash2, Upload, Volume2 } from 'lucide-react';

interface SoundListProps {
  sounds: Sound[];
  selectedIndex: number;
  playingId: string | null;
  onOpenRecorder: () => void;
  onSelectSound: (index: number) => void;
  onAddSound: (sound: Sound) => void;
  onDeleteSound: (index: number) => void;
  onRenameSound: (index: number, name: string) => void;
  onPlaySound: (sound: Sound) => void;
  onStopSound: () => void;
}

function getActiveDuration(sound: Sound): number | undefined {
  if (typeof sound.duration !== 'number') {
    return undefined;
  }

  const start = sound.trimStart ?? 0;
  const end = sound.trimEnd ?? sound.duration;
  return Math.max(0, end - start);
}

function isTrimmed(sound: Sound): boolean {
  if (typeof sound.duration !== 'number') {
    return false;
  }

  const start = sound.trimStart ?? 0;
  const end = sound.trimEnd ?? sound.duration;
  return start > 0.001 || end < sound.duration - 0.001;
}

export const SoundList = memo(({
  sounds,
  selectedIndex,
  playingId,
  onOpenRecorder,
  onSelectSound,
  onAddSound,
  onDeleteSound,
  onRenameSound,
  onPlaySound,
  onStopSound,
}: SoundListProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const { isAuthenticated } = useConvexAuth();

  const generateUploadUrl = useMutation(api.soundLibrary.generateUploadUrl);
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
      const { storageId, size, mimeType } = await uploadDataUrlToStorage(
        sound.assetId,
        generateUploadUrl,
      );

      await createLibraryItem({
        name: sound.name,
        storageId: storageId as Id<'_storage'>,
        mimeType,
        size,
        duration: sound.duration,
      });
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
        title="Sounds"
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={onOpenRecorder}
              title="Record sound"
              disabled={isProcessing}
            >
              <Mic className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => fileInputRef.current?.click()}
              title="Import sound"
              disabled={isProcessing}
            >
              {isProcessing ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setShowLibrary(true)}
              title="Browse library"
              disabled={isProcessing}
            >
              <Library className="size-3" />
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
              const activeDuration = getActiveDuration(sound);
              const trimmed = isTrimmed(sound);
              const isSelected = index === selectedIndex;
              const isPlaying = playingId === sound.id;

              return (
                <Card
                  key={sound.id}
                  onClick={() => onSelectSound(index)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({
                      index,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  className={cn(
                    'relative group cursor-pointer p-1.5 transition-colors',
                    isSelected
                      ? 'ring-2 ring-primary bg-primary/5'
                      : 'hover:bg-accent',
                  )}
                >
                  <div className="relative mb-1.5 aspect-square overflow-hidden rounded border bg-muted">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isPlaying) {
                          onStopSound();
                        } else {
                          onPlaySound(sound);
                        }
                      }}
                      className={cn(
                        'absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity hover:opacity-100',
                      )}
                    >
                      {isPlaying ? (
                        <Square className="size-6 fill-white text-white" />
                      ) : (
                        <Play className="size-6 fill-white text-white" />
                      )}
                    </button>
                    <div className="flex h-full items-center justify-center">
                      <Volume2 className="size-8 text-muted-foreground" />
                    </div>
                  </div>

                  <Input
                    value={sound.name}
                    onChange={(event) => onRenameSound(index, event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    className="mt-0.5 h-4 w-full border-none bg-transparent px-1 text-center text-[10px] leading-none shadow-none focus:bg-background"
                  />

                  <div className="mt-0.5 text-center text-[9px] text-muted-foreground">
                    {activeDuration !== undefined ? formatAudioTime(activeDuration) : '--:--'}
                  </div>

                  <div className="absolute left-1 top-1 text-[10px] font-medium text-foreground/80">
                    {index + 1}
                  </div>

                  {trimmed ? (
                    <div className="absolute bottom-1 right-1 rounded bg-[#edf5ef] px-1 py-0.5 text-[8px] font-medium text-[#5e7f6c]">
                      Trim
                    </div>
                  ) : null}
                </Card>
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
