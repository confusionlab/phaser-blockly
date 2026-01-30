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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Image, Music, Upload, Trash2, Play, Pause } from "lucide-react";

interface MediaLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (url: string, type: "image" | "sound") => void;
}

export function MediaLibrary({ open, onOpenChange, onSelect }: MediaLibraryProps) {
  const [tab, setTab] = useState<"image" | "sound">("image");
  const [uploading, setUploading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const items = useQuery(api.library.list, { type: tab });
  const generateUploadUrl = useMutation(api.library.generateUploadUrl);
  const createItem = useMutation(api.library.create);
  const removeItem = useMutation(api.library.remove);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        const { storageId } = await result.json();

        let thumbnail: string | undefined;
        if (tab === "image") {
          thumbnail = await createThumbnail(file);
        }

        await createItem({
          name: file.name.replace(/\.[^/.]+$/, ""),
          type: tab,
          storageId,
          thumbnail,
          mimeType: file.type,
          size: file.size,
        });
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: Id<"library">) => {
    await removeItem({ id });
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

  const handleSelect = (url: string) => {
    onSelect?.(url, tab);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[600px] flex flex-col">
        <DialogHeader>
          <DialogTitle>Media Library</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "image" | "sound")} className="flex-1 flex flex-col">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="image">
                <Image className="size-4 mr-1" /> Images
              </TabsTrigger>
              <TabsTrigger value="sound">
                <Music className="size-4 mr-1" /> Sounds
              </TabsTrigger>
            </TabsList>

            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="size-4" />
              {uploading ? "Uploading..." : "Upload"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={tab === "image" ? "image/*" : "audio/*"}
              multiple
              className="hidden"
              onChange={handleUpload}
            />
          </div>

          <TabsContent value="image" className="flex-1 mt-4">
            <ScrollArea className="h-[420px]">
              {!items?.length ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No images yet
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-3 pr-4">
                  {items.map((item) => (
                    <div
                      key={item._id}
                      className="group relative aspect-square rounded-lg border bg-muted/50 overflow-hidden cursor-pointer hover:ring-2 ring-primary"
                      onClick={() => item.url && handleSelect(item.url)}
                    >
                      <img
                        src={item.thumbnail || item.url || ""}
                        alt={item.name}
                        className="w-full h-full object-contain"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-xs text-white truncate">
                        {item.name}
                      </div>
                      <Button
                        variant="destructive"
                        size="icon-xs"
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item._id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="sound" className="flex-1 mt-4">
            <ScrollArea className="h-[420px]">
              {!items?.length ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No sounds yet
                </div>
              ) : (
                <div className="flex flex-col gap-2 pr-4">
                  {items.map((item) => (
                    <div
                      key={item._id}
                      className="group flex items-center gap-3 p-3 rounded-lg border bg-muted/50 hover:bg-muted cursor-pointer"
                      onClick={() => item.url && handleSelect(item.url)}
                    >
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          item.url && handlePlay(item.url, item._id);
                        }}
                      >
                        {playingId === item._id ? <Pause className="size-4" /> : <Play className="size-4" />}
                      </Button>
                      <span className="flex-1 truncate">{item.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatSize(item.size)}
                      </span>
                      <Button
                        variant="destructive"
                        size="icon-xs"
                        className="opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item._id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

async function createThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = document.createElement("img");
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 128;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;

      const scale = Math.min(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

      resolve(canvas.toDataURL("image/webp", 0.7));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
