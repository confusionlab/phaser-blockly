import { useState, useRef } from "react";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated/api";
import type { Id } from "@convex-generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Upload, Loader2, Play, Square } from "@/components/ui/icons";
import { blobToDataUrl } from "@/utils/convexHelpers";
import { compressAudio, getAudioDuration } from "@/utils/audioProcessor";
import {
  hydrateSoundLibraryItemForInsertion,
  prepareSoundLibraryCreatePayload,
  type SoundLibraryListItemData,
} from "@/lib/soundLibrary/soundLibraryAssets";
import { ensureLibraryAssetRefsInCloud } from "@/lib/templateLibrary/libraryAssetRefs";
import { useModal } from "@/components/ui/modal-provider";

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
  const convex = useConvex();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingSelect, setLoadingSelect] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { isAuthenticated } = useConvexAuth();
  const { showAlert, showConfirm } = useModal();

  const items = useQuery(api.soundLibrary.list, open ? {} : "skip") as Array<SoundLibraryListItemData & {
    _id: Id<"soundLibrary">;
    createdAt: number;
  }> | undefined;
  const generateUploadUrl = useMutation(api.projectAssets.generateUploadUrl);
  const upsertProjectAsset = useMutation(api.projectAssets.upsert);
  const createItem = useMutation(api.soundLibrary.create);
  const removeItem = useMutation(api.soundLibrary.remove);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("audio/")) continue;

        // Convert and compress for consistent library storage
        const originalDataUrl = await blobToDataUrl(file);
        const dataUrl = await compressAudio(originalDataUrl);
        const duration = await getAudioDuration(dataUrl);

        const prepared = await prepareSoundLibraryCreatePayload({
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^/.]+$/, ""),
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
      console.error("Failed to upload sound:", error);
      await showAlert({
        title: "Upload Failed",
        description: "Failed to upload sound",
        tone: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: Id<"soundLibrary">) => {
    const confirmed = await showConfirm({
      title: "Delete Sound",
      description: "Delete this sound from library?",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!confirmed) return;

    // Stop if this sound is playing
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
    }

    try {
      await removeItem({ id });
      if (selectedId === id) setSelectedId(null);
    } catch (error) {
      console.error("Failed to delete sound:", error);
      await showAlert({
        title: "Delete Failed",
        description: "Failed to delete sound",
        tone: "destructive",
      });
    }
  };

  const handlePlay = (url: string, id: string) => {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) audioRef.current.pause();
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlayingId(null);
      void audioRef.current.play().catch((error) => {
        console.error("Failed to play sound preview:", error);
        setPlayingId(null);
      });
      setPlayingId(id);
    }
  };

  const handleSelect = async () => {
    if (!selectedId || !items) return;

    const item = items.find((i) => i._id === selectedId);
    if (!item) return;

    setLoadingSelect(true);
    try {
      const sound = await hydrateSoundLibraryItemForInsertion(item);
      onSelect?.({
        name: sound.name,
        dataUrl: sound.dataUrl,
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to load sound:", error);
      await showAlert({
        title: "Load Failed",
        description: "Failed to load sound",
        tone: "destructive",
      });
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
            disabled={uploading || !isAuthenticated}
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
              <p>No sounds in library</p>
              <p className="text-sm">{isAuthenticated ? 'Upload sounds to build your collection' : 'Sign in to add your own sounds'}</p>
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
                    {formatSize(item.size ?? 0)}
                  </span>
                  {item.scope === 'user' ? (
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
                  ) : null}
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
