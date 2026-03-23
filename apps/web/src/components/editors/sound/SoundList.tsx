import { type ChangeEvent, memo, useRef, useState } from 'react';
import { useConvexAuth, useMutation } from 'convex/react';
import { api } from '@convex-generated/api';
import type { Id } from '@convex-generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SoundLibraryBrowser } from '@/components/dialogs/SoundLibraryBrowser';
import { uploadDataUrlToStorage } from '@/utils/convexHelpers';
import { compressAudio, getAudioDuration } from '@/utils/audioProcessor';
import { formatAudioTime } from '@/lib/audioWaveform';
import type { Sound } from '@/types';
import { cn } from '@/lib/utils';
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
  const { isAuthenticated } = useConvexAuth();

  const generateUploadUrl = useMutation(api.soundLibrary.generateUploadUrl);
  const createLibraryItem = useMutation(api.soundLibrary.create);

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

  return (
    <aside className="flex h-full min-h-0 w-[320px] shrink-0 flex-col border-r border-border/70 bg-[linear-gradient(180deg,rgba(249,251,249,0.98),rgba(243,246,244,0.96))]">
      <div className="border-b border-border/70 px-4 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b8b77]">Sound Workspace</div>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Sounds</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Import, record, preview, and keep trims close to the object they belong to.
            </p>
          </div>
          <div className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-border/70">
            {sounds.length} clip{sounds.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="justify-center rounded-full"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
          >
            {isProcessing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="justify-center rounded-full"
            onClick={() => setShowLibrary(true)}
            disabled={isProcessing}
          >
            <Library className="size-4" />
            Library
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="justify-center rounded-full"
            onClick={onOpenRecorder}
            disabled={isProcessing}
          >
            <Mic className="size-4" />
            Record
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {sounds.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-[28px] border border-dashed border-border bg-white/55 px-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-[#edf5ef] text-[#5e7f6c]">
              <Volume2 className="size-7" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-foreground">No sounds yet</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Bring in a file, pick one from the library, or record straight into the project.
            </p>
            <Button className="mt-5 rounded-full px-5" onClick={onOpenRecorder}>
              <Mic className="size-4" />
              Record a Clip
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {sounds.map((sound, index) => {
              const activeDuration = getActiveDuration(sound);
              const trimmed = isTrimmed(sound);
              const isSelected = index === selectedIndex;
              const isPlaying = playingId === sound.id;

              return (
                <div
                  key={sound.id}
                  onClick={() => onSelectSound(index)}
                  className={cn(
                    'group cursor-pointer rounded-[24px] border p-3 shadow-sm transition-all',
                    isSelected
                      ? 'border-[#8aa693] bg-[linear-gradient(180deg,rgba(241,248,243,0.98),rgba(236,244,238,0.95))] shadow-[0_10px_28px_rgba(94,127,108,0.12)]'
                      : 'border-border/70 bg-white/75 hover:border-border hover:bg-white',
                  )}
                >
                  <div className="flex items-start gap-3">
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
                        'flex size-12 shrink-0 items-center justify-center rounded-2xl border transition-colors',
                        isSelected
                          ? 'border-[#87a291]/60 bg-[#dfeee4] text-[#5e7f6c]'
                          : 'border-border/70 bg-muted/60 text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {isPlaying ? <Square className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <Input
                        value={sound.name}
                        onChange={(event) => onRenameSound(index, event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        className="h-7 border-none bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:ring-0"
                      />

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded-full bg-background/90 px-2.5 py-1 text-muted-foreground ring-1 ring-border/70">
                          {activeDuration !== undefined ? formatAudioTime(activeDuration) : '--:--'}
                        </span>
                        {trimmed ? (
                          <span className="rounded-full bg-[#edf5ef] px-2.5 py-1 font-medium text-[#5e7f6c]">
                            Trimmed
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
                            Full clip
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="rounded-full"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleSaveToLibrary(index);
                        }}
                        disabled={!isAuthenticated || savingToLibrary === index}
                      >
                        {savingToLibrary === index ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="rounded-full text-destructive hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteSound(index);
                        }}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <SoundLibraryBrowser
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelect={handleLibrarySelect}
      />
    </aside>
  );
});

SoundList.displayName = 'SoundList';
