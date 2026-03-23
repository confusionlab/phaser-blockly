import type { MouseEventHandler, ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
        'group relative cursor-pointer p-1.5 transition-colors',
        selected ? 'bg-primary/5 ring-2 ring-primary' : 'hover:bg-accent',
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
          'mt-0.5 h-4 w-full border-none bg-transparent px-1 text-center text-[10px] leading-none shadow-none focus:bg-background',
          inputClassName,
        )}
      />

      <div className="absolute left-1 top-1 text-[10px] font-medium text-foreground/80">
        {index + 1}
      </div>
    </Card>
  );
}
