import { Component } from '@/components/ui/icons';
import { useProjectStore } from '@/store/projectStore';
import { Button } from '@/components/ui/button';
import { LibraryBrowserDialog } from '@/components/dialogs/LibraryBrowserDialog';

interface ComponentLibraryBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (componentId: string) => void;
  onEditCode?: (componentId: string) => void;
  onDelete?: (componentId: string) => void;
}

export function ComponentLibraryBrowser({
  open,
  onOpenChange,
  onSelect,
  onEditCode,
  onDelete,
}: ComponentLibraryBrowserProps) {
  const project = useProjectStore((state) => state.project);
  const components = project?.components || [];

  return (
    <LibraryBrowserDialog
      emptyDescription='Right-click an object and select "Make Component" to add one here.'
      emptyTitle="No components yet"
      getItemId={(item) => item.id}
      getItemName={(item) => item.name}
      itemLabelPlural="components"
      itemLabelSingular="component"
      items={components}
      onDeleteSelected={onDelete ? async (selectedItems) => {
        selectedItems.forEach((item) => onDelete(item.id));
      } : undefined}
      onItemOpen={async (item) => {
        onSelect?.(item.id);
      }}
      onOpenChange={onOpenChange}
      open={open}
      renderCard={(item) => {
        const thumbnail = item.costumes[0]?.assetId || null;
        return (
          <>
            <div className="checkerboard-bg checkerboard-bg-sm flex aspect-square w-full items-center justify-center border-b border-border/60 bg-muted">
              {thumbnail ? (
                <img
                  src={thumbnail}
                  alt={item.name}
                  className="h-full w-full object-contain p-4"
                />
              ) : (
                <Component className="size-12 text-muted-foreground" />
              )}
            </div>

            <div className="flex flex-1 flex-col justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-foreground">
                  {item.name}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Shared component definition
                </p>
              </div>
            </div>
          </>
        );
      }}
      renderRow={(item) => {
        const thumbnail = item.costumes[0]?.assetId || null;
        return (
          <>
            <div className="checkerboard-bg checkerboard-bg-sm flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-muted">
              {thumbnail ? (
                <img
                  src={thumbnail}
                  alt={item.name}
                  className="h-full w-full object-contain p-2"
                />
              ) : (
                <Component className="size-7 text-muted-foreground" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">
                {item.name}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Click to add this component to the scene
              </div>
            </div>
          </>
        );
      }}
      title="Component Library"
      toolbarActions={onEditCode ? ({ selectedItems }) => {
        if (selectedItems.length !== 1) {
          return null;
        }

        return (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onEditCode(selectedItems[0]!.id);
              onOpenChange(false);
            }}
          >
            Edit Code
          </Button>
        );
      } : undefined}
    />
  );
}
