import { useState, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Upload, Loader2, Play, Square } from "lucide-react";
import { uploadDataUrlToStorage, urlToDataUrl, blobToDataUrl } from "@/utils/convexHelpers";

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
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function SoundLibraryBrowser({
  open,
  onOpenChange,
  onSelect,
}: SoundLibraryBrowserProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingSelect, setLoadingSelect] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const items = useQuery(api.soundLibrary.list);
  const generateUploadUrl = useMutation(api.soundLibrary.generateUploadUrl);
  const createItem = useMutation(api.soundLibrary.create);
  const removeItem = useMutation(api.soundLibrary.remove);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("audio/")) continue;

        // Get audio duration
        const duration = await getAudioDuration(file);

        // Convert file to data URL for upload
        const dataUrl = await blobToDataUrl(file);

        // Upload to Convex storage
        const { storageId, size, mimeType } = await uploadDataUrlToStorage(
          dataUrl,
          generateUploadUrl
        );

        // Create the library entry
        await createItem({
          name: file.name.replace(/\.[^/.]+$/, ""),
          storageId: storageId as Id<"_storage">,
          mimeType,
          size,
          duration,
        });
      }
    } catch (error) {
      console.error("Failed to upload sound:", error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: Id<"soundLibrary">) => {
    // Stop if this sound is playing
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
    }
    await removeItem({ id });
    if (selectedId === id) setSelectedId(null);
  };

  const handlePlay = (url: string, id: string) => {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) audioRef.current.pause();
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlayingId(null);
      audioRef.current.play();
      setPlayingId(id);
    }
  };

  const handleSelect = async () => {
    if (!selectedId || !items) return;

    const item = items.find((i) => i._id === selectedId);
    if (!item || !item.url) return;

    setLoadingSelect(true);
    try {
      // Download the audio and convert to data URL
      const dataUrl = await urlToDataUrl(item.url);

      onSelect?.({
        name: item.name,
        dataUrl,
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to load sound:", error);
    } finally {
      setLoadingSelect(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl h-[500px] flex flex-col">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <DialogTitle>Sound Library</DialogTitle>
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {uploading ? "Uploading..." : "Upload"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
        </DialogHeader>

        <ScrollArea className="flex-1 mt-4">
          {!items ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <p className="mb-2">No sounds in library</p>
              <p className="text-sm">Upload audio files to build your collection</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 pr-4">
              {items.map((item) => (
                <div
                  key={item._id}
                  onClick={() => setSelectedId(item._id)}
                  className={`group flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedId === item._id
                      ? "ring-2 ring-primary bg-primary/5"
                      : "hover:bg-muted"
                  }`}
                >
                  <Button
                    variant={playingId === item._id ? "default" : "outline"}
                    size="icon"
                    className="shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.url) {
                        handlePlay(item.url, item._id);
                      }
                    }}
                  >
                    {playingId === item._id ? (
                      <Square className="size-4" />
                    ) : (
                      <Play className="size-4" />
                    )}
                  </Button>
                  <span className="flex-1 truncate">{item.name}</span>
                  {item.duration && (
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(item.duration)}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatSize(item.size)}
                  </span>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="size-7 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(item._id);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSelect}
            disabled={!selectedId || loadingSelect}
          >
            {loadingSelect && <Loader2 className="size-4 animate-spin mr-2" />}
            Insert Sound
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function getAudioDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.onloadedmetadata = () => {
      resolve(audio.duration);
      URL.revokeObjectURL(audio.src);
    };
    audio.onerror = () => {
      resolve(undefined);
      URL.revokeObjectURL(audio.src);
    };
    audio.src = URL.createObjectURL(file);
  });
}
