import { useState } from 'react';
import { Component } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ComponentLibraryBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (componentId: string) => void;
}

export function ComponentLibraryBrowser({
  open,
  onOpenChange,
  onSelect,
}: ComponentLibraryBrowserProps) {
  const project = useProjectStore((state) => state.project);
  const components = project?.components || [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedComponent = components.find((component) => component.id === selectedId) || null;

  const handleInsert = () => {
    if (!selectedComponent) return;
    onSelect?.(selectedComponent.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[550px] flex flex-col">
        <DialogHeader>
          <DialogTitle>Component Library</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 mt-4">
          {components.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <p className="mb-2">No components yet</p>
              <p className="text-sm">Right-click an object and select "Make Component" to add one</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 pr-4">
              {components.map((component) => {
                const thumbnail = component.costumes[0]?.assetId || null;
                return (
                  <Card
                    key={component.id}
                    onClick={() => setSelectedId(component.id)}
                    className={`relative group p-3 cursor-pointer transition-all ${
                      selectedId === component.id
                        ? 'ring-2 ring-primary bg-primary/5'
                        : 'hover:bg-accent'
                    }`}
                  >
                    <div className="w-full aspect-square rounded-lg overflow-hidden mb-2 checkerboard-bg checkerboard-bg-sm flex items-center justify-center bg-muted/30">
                      {thumbnail ? (
                        <img
                          src={thumbnail}
                          alt={component.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <Component className="size-10 text-muted-foreground" />
                      )}
                    </div>

                    <p className="text-sm text-center truncate font-medium">
                      {component.name}
                    </p>
                  </Card>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleInsert} disabled={!selectedComponent}>
            Add to Scene
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
