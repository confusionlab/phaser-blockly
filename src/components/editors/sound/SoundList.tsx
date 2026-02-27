import { useRef, useState, memo } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { X, Upload, Loader2, Library, Save, Volume2, Play, Square } from 'lucide-react';
import { uploadDataUrlToStorage } from '@/utils/convexHelpers';
import { SoundLibraryBrowser } from '@/components/dialogs/SoundLibraryBrowser';
import { compressAudio, getAudioDuration } from '@/utils/audioProcessor';
import type { Sound } from '@/types';
import { cn } from '@/lib/utils';

interface SoundListProps {
  sounds: Sound[];
  selectedIndex: number;
  playingId: string | null;
  onSelectSound: (index: number) => void;
  onAddSound: (sound: Sound) => void;
  onDeleteSound: (index: number) => void;
  onRenameSound: (index: number, name: string) => void;
  onPlaySound: (sound: Sound) => void;
  onStopSound: () => void;
}

export const SoundList = memo(({
  sounds,
  selectedIndex,
  playingId,
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

  const generateUploadUrl = useMutation(api.soundLibrary.generateUploadUrl);
  const createLibraryItem = useMutation(api.soundLibrary.create);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);

    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('audio/')) continue;

        try {
          // Read file as data URL
          const originalDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          // Compress the audio for efficient storage
          console.log(`[Audio] Compressing ${file.name}...`);
          const compressedDataUrl = await compressAudio(originalDataUrl);
          console.log(`[Audio] Compressed: ${(originalDataUrl.length / 1024).toFixed(1)}KB -> ${(compressedDataUrl.length / 1024).toFixed(1)}KB`);

          const duration = await getAudioDuration(compressedDataUrl);

          const newSound: Sound = {
            id: crypto.randomUUID(),
            name: file.name.replace(/\.[^/.]+$/, ''),
            assetId: compressedDataUrl,
            duration,
          };
          onAddSound(newSound);
        } catch (error) {
          console.error('Failed to process audio:', file.name, error);
        }
      }
    } finally {
      setIsProcessing(false);
      e.target.value = '';
    }
  };

  const handleLibrarySelect = async (data: { name: string; dataUrl: string }) => {
    try {
      const duration = await getAudioDuration(data.dataUrl);
      const newSound: Sound = {
        id: crypto.randomUUID(),
        name: data.name,
        assetId: data.dataUrl,
        duration,
      };
      onAddSound(newSound);
    } catch (error) {
      console.error('Failed to add sound from library:', error);
      alert('Failed to add sound from library');
    }
  };

  const handleSaveToLibrary = async (index: number) => {
    const sound = sounds[index];
    if (!sound) return;

    setSavingToLibrary(index);
    try {
      const { storageId, size, mimeType } = await uploadDataUrlToStorage(
        sound.assetId,
        generateUploadUrl
      );

      await createLibraryItem({
        name: sound.name,
        storageId: storageId as Id<"_storage">,
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

  const formatDuration = (seconds: number | undefined) => {
    if (seconds === undefined) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-48 border-r bg-muted/30 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b">
        <span className="text-xs font-medium">Sounds</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={handleUploadClick}
            title="Import sound"
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Upload className="size-3" />
            )}
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
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Sound List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {sounds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center px-2">
            <p className="text-xs">No sounds</p>
            <p className="text-xs mt-1">Click upload to add</p>
          </div>
        ) : (
          sounds.map((sound, index) => (
            <Card
              key={sound.id}
              onClick={() => onSelectSound(index)}
              className={cn(
                'relative group cursor-pointer p-1.5 transition-colors',
                index === selectedIndex
                  ? 'ring-2 ring-primary bg-primary/5'
                  : 'hover:bg-accent'
              )}
            >
              {/* Sound icon with play button */}
              <div className="aspect-square rounded mb-1.5 overflow-hidden border bg-muted flex items-center justify-center relative">
                <Volume2 className="size-8 text-muted-foreground" />

                {/* Play/Stop overlay button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (playingId === sound.id) {
                      onStopSound();
                    } else {
                      onPlaySound(sound);
                    }
                  }}
                  className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity"
                >
                  {playingId === sound.id ? (
                    <Square className="size-6 text-white fill-white" />
                  ) : (
                    <Play className="size-6 text-white fill-white" />
                  )}
                </button>
              </div>

              {/* Sound name */}
              <Input
                value={sound.name}
                onChange={(e) => onRenameSound(index, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full h-5 px-1 text-[10px] text-center bg-transparent border-none focus:bg-background"
              />

              {/* Duration badge */}
              <div className="text-[9px] text-muted-foreground text-center mt-0.5">
                {formatDuration(sound.duration)}
              </div>

              {/* Delete button */}
              {sounds.length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSound(index);
                  }}
                  className="absolute top-0 right-0 w-4 h-4 bg-destructive text-destructive-foreground rounded-bl rounded-tr opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  title="Delete sound"
                >
                  <X className="size-2.5" />
                </button>
              )}

              {/* Save to library button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSaveToLibrary(index);
                }}
                disabled={savingToLibrary === index}
                className="absolute bottom-8 right-0 w-4 h-4 bg-primary text-primary-foreground rounded-l opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center disabled:opacity-50"
                title="Save to library"
              >
                {savingToLibrary === index ? (
                  <Loader2 className="size-2.5 animate-spin" />
                ) : (
                  <Save className="size-2.5" />
                )}
              </button>

              {/* Index badge */}
              <div className="absolute top-0 left-0 w-4 h-4 bg-foreground text-background rounded-tl rounded-br flex items-center justify-center text-[9px] font-medium">
                {index + 1}
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Sound Library Browser Dialog */}
      <SoundLibraryBrowser
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelect={handleLibrarySelect}
      />
    </div>
  );
});

SoundList.displayName = 'SoundList';
