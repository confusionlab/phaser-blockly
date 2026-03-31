import { useCallback, useEffect, useState, type MouseEventHandler, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { selectionSurfaceClassNames } from '@/lib/ui/selectionSurfaceTokens';
import { cn } from '@/lib/utils';

interface AssetSidebarTileProps {
  index: number;
  name: string;
  selected: boolean;
  media: ReactNode;
  onClick: () => void;
  onNameCommit: (name: string) => void;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  cardClassName?: string;
  mediaClassName?: string;
  inputClassName?: string;
}

export function AssetSidebarTile({
  index,
  name,
  selected,
  media,
  onClick,
  onNameCommit,
  onContextMenu,
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
      className={cn(
        'group relative h-fit cursor-pointer gap-0 border-transparent p-1.5 shadow-none transition-colors',
        selected ? selectionSurfaceClassNames.selected : selectionSurfaceClassNames.interactiveHover,
        cardClassName,
      )}
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
            selected ? 'opacity-100' : 'opacity-80',
          ),
          onDoubleClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            beginRename();
          },
          title: name,
        }}
        outlineClassName={cn(
          'inset-x-0 inset-y-[-2px] rounded-sm border-input bg-background/90 shadow-xs',
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
