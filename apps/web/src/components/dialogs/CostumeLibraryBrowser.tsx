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
import { Trash2, Upload, Loader2 } from "@/components/ui/icons";
import type { CostumeBounds, CostumeDocument } from "@/types";
import { processImage } from "@/utils/imageProcessor";
import { createBitmapCostumeDocument } from "@/lib/costume/costumeDocument";
import {
  hydrateCostumeLibraryItemForInsertion,
  prepareCostumeLibraryCreatePayload,
  type CostumeLibraryListItemData,
} from "@/lib/costumeLibrary/costumeLibraryAssets";
import { ensureLibraryAssetRefsInCloud } from "@/lib/templateLibrary/libraryAssetRefs";

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
  _id: Id<"costumeLibrary">;
  createdAt: number;
}

export function CostumeLibraryBrowser({
  open,
  onOpenChange,
  onSelect,
}: CostumeLibraryBrowserProps) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingSelect, setLoadingSelect] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const items = useQuery(api.costumeLibrary.list, open ? {} : "skip") as CostumeLibraryItem[] | undefined;
  const generateUploadUrl = useMutation(api.projectAssets.generateUploadUrl);
  const upsertProjectAsset = useMutation(api.projectAssets.upsert);
  const createItem = useMutation(api.costumeLibrary.create);
  const removeItem = useMutation(api.costumeLibrary.remove);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;

        const processedDataUrl = await processImage(file);
        const prepared = await prepareCostumeLibraryCreatePayload({
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^/.]+$/, ""),
          assetId: processedDataUrl,
          document: createBitmapCostumeDocument(
            processedDataUrl,
            file.name.replace(/\.[^/.]+$/, "") || "Layer 1",
          ),
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
      console.error("Failed to upload costume:", error);
      alert("Failed to upload costume");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: Id<"costumeLibrary">) => {
    if (!confirm("Delete this costume from library?")) return;
    try {
      await removeItem({ id });
      if (selectedId === id) setSelectedId(null);
    } catch (error) {
      console.error("Failed to delete costume:", error);
      alert("Failed to delete costume");
    }
  };

  const handleSelect = async () => {
    if (!selectedId || !items) return;

    const item = items.find((i) => i._id === selectedId);
    if (!item) return;

    setLoadingSelect(true);
    try {
      onSelect?.(await hydrateCostumeLibraryItemForInsertion(item));
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to load costume:", error);
      alert("Failed to load costume");
    } finally {
      setLoadingSelect(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[500px] flex flex-col">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <DialogTitle>Costume Library</DialogTitle>
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isAuthenticated || uploading}
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
            accept="image/*"
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
              <p className="mb-2">No costumes in library</p>
              <p className="text-sm">
                {isAuthenticated ? "Upload images to build your collection" : "Sign in to add your own costumes"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3 pr-4">
              {items.map((item) => (
                <div
                  key={item._id}
                  onClick={() => setSelectedId(item._id)}
                  className={`group relative aspect-square rounded-lg border overflow-hidden cursor-pointer transition-all ${
                    selectedId === item._id
                      ? "ring-2 ring-primary bg-primary/5"
                      : "hover:ring-2 ring-muted-foreground/30"
                  } checkerboard-bg checkerboard-bg-sm`}
                >
                  <img
                    src={item.thumbnail}
                    alt={item.name}
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-xs text-white truncate">
                    {item.name}
                  </div>
                  {item.scope === 'user' ? (
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 size-6 opacity-0 group-hover:opacity-100"
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
            Insert Costume
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
