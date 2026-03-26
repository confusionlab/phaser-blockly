import type { MouseEventHandler, ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { selectionSurfaceClassNames } from '@/lib/ui/selectionSurfaceTokens';
import { cn } from '@/lib/utils';

interface AssetSidebarTileProps {
  index: number;
  name: string;
  selected: boolean;
  media: ReactNode;
  onClick: () => void;
  onNameChange: (name: string) => void;
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
  onNameChange,
  onContextMenu,
  cardClassName,
  mediaClassName,
  inputClassName,
}: AssetSidebarTileProps) {
  return (
    <Card
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        'group relative cursor-pointer border-transparent p-1.5 shadow-none transition-colors',
        selected ? selectionSurfaceClassNames.selected : selectionSurfaceClassNames.interactiveHover,
        cardClassName,
      )}
    >
      <div className={cn('relative aspect-square overflow-hidden rounded', mediaClassName)}>
        {media}
      </div>

      <Input
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'mt-0.5 h-4 w-full border-none bg-transparent px-1 text-center text-[10px] leading-none shadow-none focus:bg-transparent focus-visible:bg-transparent dark:bg-transparent dark:focus:bg-transparent dark:focus-visible:bg-transparent',
          inputClassName,
        )}
      />

      <div className="absolute left-1 top-1 text-[10px] font-medium text-foreground/80">
        {index + 1}
      </div>
    </Card>
  );
}
