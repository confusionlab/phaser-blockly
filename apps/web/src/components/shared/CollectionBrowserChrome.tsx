import { IconButton } from '@/components/ui/icon-button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  Check,
  LayoutGrid,
  Rows3,
  SquareCheck,
  Trash2,
} from '@/components/ui/icons';
import { cn } from '@/lib/utils';

export type CollectionViewMode = 'row' | 'card';

interface CollectionSelectionCheckboxProps {
  checked: boolean;
  className?: string;
}

export function CollectionSelectionCheckbox({
  checked,
  className,
}: CollectionSelectionCheckboxProps) {
  return (
    <div
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
        className,
      )}
    >
      {checked ? <Check className="size-3" /> : null}
    </div>
  );
}

export function collectionRowClassName(options: {
  className?: string;
  dragging?: boolean;
  selected?: boolean;
  dropTarget?: boolean;
}) {
  return cn(
    'group relative flex w-full items-center gap-4 border-b border-border/70 bg-background/95 px-4 py-3 text-left transition outline-none',
    options.selected && 'bg-primary/6',
    options.dropTarget && 'bg-primary/10 ring-1 ring-inset ring-primary/30',
    options.dragging && 'opacity-45',
    'hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-primary/35',
    options.className,
  );
}

export function collectionCardClassName(options: {
  className?: string;
  dragging?: boolean;
  selected?: boolean;
  dropTarget?: boolean;
}) {
  return cn(
    'group relative flex h-full min-h-[240px] flex-col overflow-hidden rounded-[24px] border border-border/70 bg-background/88 text-left transition-[border-color,background-color,box-shadow,opacity] outline-none',
    options.selected && 'border-primary/45 bg-primary/5 shadow-[0_16px_40px_-28px_rgba(37,99,235,0.55)]',
    options.dropTarget && 'border-primary bg-primary/10 ring-2 ring-primary/18',
    options.dragging && 'opacity-45',
    'hover:border-foreground/10 hover:shadow-[0_22px_50px_-36px_rgba(15,23,42,0.48)] focus-visible:ring-2 focus-visible:ring-primary/35',
    options.className,
  );
}

interface CollectionViewControlsProps {
  ariaLabel: string;
  className?: string;
  deleteDisabled?: boolean;
  deleteLabel?: string;
  disabled?: boolean;
  onDeleteSelected?: () => void;
  onToggleSelectionMode: () => void;
  onViewModeChange: (nextValue: CollectionViewMode) => void;
  selectionCount: number;
  selectionMode: boolean;
  viewMode: CollectionViewMode;
}

export function CollectionViewControls({
  ariaLabel,
  className,
  deleteDisabled = false,
  deleteLabel,
  disabled = false,
  onDeleteSelected,
  onToggleSelectionMode,
  onViewModeChange,
  selectionCount,
  selectionMode,
  viewMode,
}: CollectionViewControlsProps) {
  const resolvedDeleteLabel = deleteLabel ?? (
    selectionCount === 1 ? 'Delete selected item' : `Delete ${selectionCount} selected items`
  );

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {selectionMode && selectionCount > 0 && onDeleteSelected ? (
        <IconButton
          disabled={disabled || deleteDisabled}
          label={resolvedDeleteLabel}
          onClick={onDeleteSelected}
          shape="pill"
          size="sm"
        >
          <Trash2 className="size-4" />
        </IconButton>
      ) : null}

      <IconButton
        variant={selectionMode ? 'default' : 'ghost'}
        disabled={disabled}
        label={selectionMode ? 'Done selecting' : 'Multi-select'}
        onClick={onToggleSelectionMode}
        shape="pill"
        size="sm"
      >
        <SquareCheck className="size-4" />
      </IconButton>

      <SegmentedControl
        ariaLabel={ariaLabel}
        className="bg-muted/80"
        layout="content"
        optionClassName="min-w-9 px-2"
        options={[
          { value: 'row', label: 'Rows', icon: <Rows3 className="size-3.5" />, iconOnly: true },
          { value: 'card', label: 'Grid', icon: <LayoutGrid className="size-3.5" />, iconOnly: true },
        ] as const}
        value={viewMode}
        onValueChange={onViewModeChange}
      />
    </div>
  );
}
