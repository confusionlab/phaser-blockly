import { useState } from "react";
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
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Loader2, Image, Music } from "lucide-react";
import type { Costume, Sound, PhysicsConfig, ColliderConfig, Variable } from "@/types";
import { urlToDataUrl } from "@/utils/convexHelpers";

interface ObjectLibraryItem {
  _id: Id<"objectLibrary">;
  name: string;
  thumbnail: string;
  costumes: Array<{
    id: string;
    name: string;
    storageId: Id<"_storage">;
    url: string | null;
    bounds?: { x: number; y: number; width: number; height: number };
  }>;
  sounds: Array<{
    id: string;
    name: string;
    storageId: Id<"_storage">;
    url: string | null;
    duration?: number;
    trimStart?: number;
    trimEnd?: number;
  }>;
  blocklyXml: string;
  currentCostumeIndex?: number;
  physics?: PhysicsConfig;
  collider?: ColliderConfig;
  localVariables?: Variable[];
  createdAt: number;
}

interface ObjectLibraryBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (data: {
    name: string;
    costumes: Costume[];
    sounds: Sound[];
    blocklyXml: string;
    currentCostumeIndex: number;
    physics: PhysicsConfig | null;
    collider: ColliderConfig | null;
    localVariables: Variable[];
  }) => void;
}

export function ObjectLibraryBrowser({
  open,
  onOpenChange,
  onSelect,
}: ObjectLibraryBrowserProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingSelect, setLoadingSelect] = useState(false);

  const items = useQuery(api.objectLibrary.list) as ObjectLibraryItem[] | undefined;
  const removeItem = useMutation(api.objectLibrary.remove);

  const handleDelete = async (id: Id<"objectLibrary">) => {
    if (!confirm("Delete this object from library? All associated costumes and sounds will be removed.")) return;
    try {
      await removeItem({ id });
      if (selectedId === id) setSelectedId(null);
    } catch (error) {
      console.error("Failed to delete object:", error);
      alert("Failed to delete object");
    }
  };

  const handleSelect = async () => {
    if (!selectedId || !items) return;

    const item = items.find((i) => i._id === selectedId);
    if (!item) return;

    setLoadingSelect(true);
    try {
      // Download all costumes and convert to embedded data URLs
      const costumes: Costume[] = await Promise.all(
        item.costumes.map(async (costume) => {
          if (!costume.url) {
            throw new Error(`Costume ${costume.name} has no URL`);
          }
          const dataUrl = await urlToDataUrl(costume.url);
          return {
            id: crypto.randomUUID(), // Generate new IDs for the imported object
            name: costume.name,
            assetId: dataUrl,
            bounds: costume.bounds,
          };
        })
      );

      // Download all sounds and convert to embedded data URLs
      const sounds: Sound[] = await Promise.all(
        item.sounds.map(async (sound) => {
          if (!sound.url) {
            throw new Error(`Sound ${sound.name} has no URL`);
          }
          const dataUrl = await urlToDataUrl(sound.url);
          return {
            id: crypto.randomUUID(),
            name: sound.name,
            assetId: dataUrl,
            duration: sound.duration,
            trimStart: sound.trimStart,
            trimEnd: sound.trimEnd,
          };
        })
      );

      onSelect?.({
        name: item.name,
        costumes,
        sounds,
        blocklyXml: item.blocklyXml,
        currentCostumeIndex: item.currentCostumeIndex ?? 0,
        physics: item.physics ?? null,
        collider: item.collider ?? null,
        localVariables: item.localVariables ?? [],
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to load object:", error);
      alert("Failed to load object from library");
    } finally {
      setLoadingSelect(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[550px] flex flex-col">
        <DialogHeader>
          <DialogTitle>Object Library</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 mt-4">
          {!items ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <p className="mb-2">No objects in library</p>
              <p className="text-sm">Right-click an object and select "Save to Library" to add it here</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 pr-4">
              {items.map((item) => (
                <Card
                  key={item._id}
                  onClick={() => setSelectedId(item._id)}
                  className={`relative group p-3 cursor-pointer transition-all ${
                    selectedId === item._id
                      ? "ring-2 ring-primary bg-primary/5"
                      : "hover:bg-accent"
                  }`}
                >
                  {/* Thumbnail */}
                  <div
                    className="w-full aspect-square rounded-lg overflow-hidden mb-2"
                    style={{
                      backgroundImage: `
                        linear-gradient(45deg, #d0d0d0 25%, transparent 25%),
                        linear-gradient(-45deg, #d0d0d0 25%, transparent 25%),
                        linear-gradient(45deg, transparent 75%, #d0d0d0 75%),
                        linear-gradient(-45deg, transparent 75%, #d0d0d0 75%)
                      `,
                      backgroundSize: "10px 10px",
                      backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0px",
                      backgroundColor: "#f0f0f0",
                    }}
                  >
                    <img
                      src={item.thumbnail}
                      alt={item.name}
                      className="w-full h-full object-contain"
                    />
                  </div>

                  {/* Name */}
                  <p className="text-sm text-center truncate font-medium">
                    {item.name}
                  </p>

                  {/* Asset counts */}
                  <div className="flex justify-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Image className="size-3" />
                      {item.costumes.length}
                    </span>
                    <span className="flex items-center gap-1">
                      <Music className="size-3" />
                      {item.sounds.length}
                    </span>
                  </div>

                  {/* Delete button */}
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 size-6 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(item._id);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </Card>
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
            Insert Object
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
