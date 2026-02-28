import { useRef, useState, memo, useEffect } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Plus, Upload, Loader2, Library, Copy, Trash2 } from 'lucide-react';
import { processImage } from '@/utils/imageProcessor';
import { calculateVisibleBounds } from '@/utils/imageBounds';
import { uploadDataUrlToStorage, generateThumbnail } from '@/utils/convexHelpers';
import { CostumeLibraryBrowser } from '@/components/dialogs/CostumeLibraryBrowser';
import type { Costume } from '@/types';
import { cn } from '@/lib/utils';

interface CostumeListProps {
  costumes: Costume[];
  selectedIndex: number;
  onSelectCostume: (index: number) => void;
  onAddCostume: (costume: Costume) => void;
  onDeleteCostume: (index: number) => void;
  onRenameCostume: (index: number, name: string) => void;
}

export const CostumeList = memo(({
  costumes,
  selectedIndex,
  onSelectCostume,
  onAddCostume,
  onDeleteCostume,
  onRenameCostume,
}: CostumeListProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ index: number; x: number; y: number } | null>(null);

  const handleCloseContextMenu = () => setContextMenu(null);

  useEffect(() => {
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const generateUploadUrl = useMutation(api.costumeLibrary.generateUploadUrl);
  const createLibraryItem = useMutation(api.costumeLibrary.create);

  const handleAddBlank = () => {
    // Create a blank 1024x1024 transparent canvas as initial costume
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    // Canvas is transparent by default, no need to fill

    const newCostume: Costume = {
      id: crypto.randomUUID(),
      name: `costume${costumes.length + 1}`,
      assetId: canvas.toDataURL('image/png'),
    };
    onAddCostume(newCostume);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);

    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;

        try {
          const processedDataUrl = await processImage(file);
          // Calculate bounds for the uploaded image
          const bounds = await calculateVisibleBounds(processedDataUrl);
          const newCostume: Costume = {
            id: crypto.randomUUID(),
            name: file.name.replace(/\.[^/.]+$/, ''),
            assetId: processedDataUrl,
            bounds: bounds || undefined,
          };
          onAddCostume(newCostume);
        } catch (error) {
          console.error('Failed to process image:', file.name, error);
        }
      }
    } finally {
      setIsProcessing(false);
      e.target.value = '';
    }
  };

  const handleLibrarySelect = (data: { name: string; dataUrl: string; bounds?: { x: number; y: number; width: number; height: number } }) => {
    try {
      const newCostume: Costume = {
        id: crypto.randomUUID(),
        name: data.name,
        assetId: data.dataUrl,
        bounds: data.bounds,
      };
      onAddCostume(newCostume);
    } catch (error) {
      console.error('Failed to add costume from library:', error);
      alert('Failed to add costume from library');
    }
  };

  const handleSaveToLibrary = async (index: number) => {
    const costume = costumes[index];
    if (!costume) return;

    setSavingToLibrary(index);
    try {
      // Generate thumbnail
      const thumbnail = await generateThumbnail(costume.assetId, 128);

      // Upload to Convex storage
      const { storageId, size, mimeType } = await uploadDataUrlToStorage(
        costume.assetId,
        generateUploadUrl
      );

      // Create the library entry
      await createLibraryItem({
        name: costume.name,
        storageId: storageId as Id<"_storage">,
        thumbnail,
        bounds: costume.bounds,
        mimeType,
        size,
      });
    } catch (error) {
      console.error('Failed to save costume to library:', error);
      alert('Failed to save costume to library');
    } finally {
      setSavingToLibrary(null);
    }
  };

  const handleDuplicateCostume = (index: number) => {
    const costume = costumes[index];
    if (!costume) return;

    onAddCostume({
      ...costume,
      id: crypto.randomUUID(),
      name: `${costume.name} copy`,
      bounds: costume.bounds ? { ...costume.bounds } : undefined,
    });
  };

  return (
    <div className="flex flex-col h-full w-48 border-r bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b">
        <span className="text-xs font-medium">Costumes</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={handleAddBlank}
            title="New blank costume"
            disabled={isProcessing}
          >
            <Plus className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={handleUploadClick}
            title="Import image"
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
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Costume List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {costumes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center px-2">
            <p className="text-xs">No costumes</p>
            <p className="text-xs mt-1">Click + to add</p>
          </div>
        ) : (
          costumes.map((costume, index) => (
            <Card
              key={costume.id}
              onClick={() => onSelectCostume(index)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({
                  index,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              className={cn(
                'relative group cursor-pointer p-1.5 transition-colors',
                index === selectedIndex
                  ? 'ring-2 ring-primary bg-primary/5'
                  : 'hover:bg-accent'
              )}
            >
              {/* Thumbnail with checkerboard for transparency - zoomed to bounds */}
              <div
                className="aspect-square rounded mb-1.5 overflow-hidden border relative checkerboard-bg checkerboard-bg-sm"
              >
                {costume.bounds && costume.bounds.width > 0 && costume.bounds.height > 0 ? (
                  // Zoomed thumbnail using bounds
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `url(${costume.assetId})`,
                      backgroundPosition: `${-costume.bounds.x}px ${-costume.bounds.y}px`,
                      backgroundSize: '1024px 1024px',
                      backgroundRepeat: 'no-repeat',
                      transform: `scale(${Math.min(
                        1,
                        140 / Math.max(costume.bounds.width, costume.bounds.height)
                      )})`,
                      transformOrigin: 'top left',
                      width: costume.bounds.width,
                      height: costume.bounds.height,
                      imageRendering: 'pixelated',
                      left: '50%',
                      top: '50%',
                      marginLeft: -costume.bounds.width * Math.min(1, 140 / Math.max(costume.bounds.width, costume.bounds.height)) / 2,
                      marginTop: -costume.bounds.height * Math.min(1, 140 / Math.max(costume.bounds.width, costume.bounds.height)) / 2,
                    }}
                  />
                ) : (
                  // Fallback: show full image
                  <img
                    src={costume.assetId}
                    alt={costume.name}
                    className="w-full h-full object-contain"
                    style={{ imageRendering: 'pixelated' }}
                  />
                )}
              </div>

              {/* Costume name */}
              <Input
                value={costume.name}
                onChange={(e) => onRenameCostume(index, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full h-5 px-1 text-[10px] text-center bg-transparent border-none focus:bg-background"
              />

              {/* Index badge */}
              <div className="absolute top-0 left-0 w-4 h-4 bg-foreground text-background rounded-tl rounded-br flex items-center justify-center text-[9px] font-medium">
                {index + 1}
              </div>
            </Card>
          ))
        )}
      </div>

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={handleCloseContextMenu} />
          <Card
            className="fixed z-50 py-1 min-w-44 gap-0"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                handleSaveToLibrary(contextMenu.index);
                handleCloseContextMenu();
              }}
              disabled={savingToLibrary === contextMenu.index}
              className="w-full justify-start rounded-none h-8"
            >
              {savingToLibrary === contextMenu.index ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Library className="size-4" />
              )}
              Add to Library
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                handleDuplicateCostume(contextMenu.index);
                handleCloseContextMenu();
              }}
              className="w-full justify-start rounded-none h-8"
            >
              <Copy className="size-4" />
              Duplicate
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (costumes.length > 1) {
                  onDeleteCostume(contextMenu.index);
                }
                handleCloseContextMenu();
              }}
              disabled={costumes.length <= 1}
              className="w-full justify-start rounded-none h-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </Card>
        </>
      )}

      {/* Costume Library Browser Dialog */}
      <CostumeLibraryBrowser
        open={showLibrary}
        onOpenChange={setShowLibrary}
        onSelect={handleLibrarySelect}
      />
    </div>
  );
});

CostumeList.displayName = 'CostumeList';
