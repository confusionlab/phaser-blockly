import {
  useCallback,
  useEffect,
  useState,
  type DragEventHandler,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import { Card } from '@/components/ui/card';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { selectionSurfaceClassNames } from '@/lib/ui/selectionSurfaceTokens';
import { cn } from '@/lib/utils';

interface AssetSidebarTileProps {
  index: number;
  name: string;
  selected: boolean;
  active?: boolean;
  media: ReactNode;
  itemId?: string;
  testId?: string;
  dragging?: boolean;
  draggable?: boolean;
  onClick: MouseEventHandler<HTMLDivElement>;
  onActivate?: () => void;
  onNameCommit: (name: string) => void;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  onDragStart?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  onDragEnd?: DragEventHandler<HTMLDivElement>;
  cardClassName?: string;
  mediaClassName?: string;
  inputClassName?: string;
}

export function AssetSidebarTile({
  index,
  name,
  selected,
  active = false,
  media,
  itemId,
  testId,
  dragging = false,
  draggable = false,
  onClick,
  onActivate,
  onNameCommit,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  cardClassName,
  mediaClassName,
  inputClassName,
}: AssetSidebarTileProps) {
  const [draftName, setDraftName] = useState(name);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraftName(name);
    }
  }, [isEditing, name]);

  const beginRename = useCallback(() => {
    setDraftName(name);
    setIsEditing(true);
  }, [name]);

  const commitRename = useCallback(() => {
    if (draftName !== name) {
      onNameCommit(draftName);
    }
    setIsEditing(false);
  }, [draftName, name, onNameCommit]);

  const cancelRename = useCallback(() => {
    setDraftName(name);
    setIsEditing(false);
  }, [name]);

  return (
    <Card
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      draggable={draggable && !isEditing}
      role="button"
      tabIndex={0}
      aria-label={name}
      aria-pressed={active}
      data-testid={testId}
      data-sidebar-tile-id={itemId}
      data-selected={selected ? 'true' : 'false'}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'group relative h-fit gap-0 border-transparent p-1.5 shadow-none transition-[background-color,box-shadow,opacity] focus-visible:outline-none',
        draggable && !isEditing ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        selected ? selectionSurfaceClassNames.selected : selectionSurfaceClassNames.interactiveHover,
        active && 'ring-1 ring-inset ring-primary/35 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)]',
        dragging && 'opacity-60',
        cardClassName,
      )}
      onKeyDown={((event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (onActivate) {
            onActivate();
            return;
          }
          onClick(event as unknown as Parameters<typeof onClick>[0]);
        }
      }) as KeyboardEventHandler<HTMLDivElement>}
    >
      <div className={cn('relative aspect-square overflow-hidden rounded', mediaClassName)}>
        {media}
      </div>

      <InlineRenameField
        editing={isEditing}
        value={isEditing ? draftName : name}
        aria-label={`Rename ${name}`}
        spellCheck={false}
        autoFocus={isEditing}
        onChange={(event) => setDraftName(event.target.value)}
        onBlur={commitRename}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="mt-1 w-full"
        displayAs="div"
        textClassName="min-h-4 px-1 text-center text-[10px] leading-none"
        inputClassName={cn('h-4 text-center text-foreground', inputClassName)}
        displayProps={{
          className: cn(
            'flex min-h-4 items-center justify-center truncate text-foreground',
            active || selected ? 'opacity-100' : 'opacity-80',
          ),
          onDoubleClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onActivate?.();
            beginRename();
          },
          title: name,
        }}
        outlineClassName={cn(
          'inset-x-0 inset-y-[-2px] rounded-sm border-input bg-surface-floating shadow-xs',
          'group-focus-within/rename:border-ring group-focus-within/rename:ring-[3px] group-focus-within/rename:ring-ring/40',
        )}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            commitRename();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelRename();
          }
        }}
      />

      <div className="absolute left-1 top-1 text-[10px] font-medium text-foreground/80">
        {index + 1}
      </div>
    </Card>
  );
}
