import type { MouseEventHandler, ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { selectionSurfaceClassNames } from '@/lib/ui/selectionSurfaceTokens';
import { cn } from '@/lib/utils';

interface AssetSidebarTileProps {
  index: number;
  name: string;
  selected: boolean;
  media: ReactNode;
  mediaTestId?: string;
  onClick: () => void;
  onNameChange: (name: string) => void;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  cardClassName?: string;
  mediaClassName?: string;
  testId?: string;
  inputClassName?: string;
}

export function AssetSidebarTile({
  index,
  name,
  selected,
  media,
  mediaTestId,
  onClick,
  onNameChange,
  onContextMenu,
  cardClassName,
  mediaClassName,
  testId,
  inputClassName,
}: AssetSidebarTileProps) {
  return (
    <Card
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-selected={selected ? 'true' : 'false'}
      data-testid={testId}
      className={cn(
        'group relative cursor-pointer border-transparent p-1.5 shadow-none transition-colors',
        selected ? selectionSurfaceClassNames.selected : selectionSurfaceClassNames.interactiveHover,
        cardClassName,
      )}
    >
      <div
        className={cn('relative aspect-square overflow-hidden rounded', mediaClassName)}
        data-testid={mediaTestId}
      >
        {media}
      </div>

      <InlineRenameField
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="mt-1 w-full"
        textClassName={cn('px-1 text-center text-[10px] leading-none', inputClassName)}
        outlineClassName="inset-x-0 inset-y-[-2px] rounded-sm bg-background/90"
      />

      <div className="absolute left-1 top-1 text-[10px] font-medium text-foreground/80">
        {index + 1}
      </div>
    </Card>
  );
}
