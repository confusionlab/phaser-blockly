import type { DragEventHandler, MouseEventHandler, ReactNode } from 'react';
import { ChevronDown, ChevronRight } from '@/components/ui/icons';
import { selectionSurfaceClassNames } from '@/lib/ui/selectionSurfaceTokens';

interface ShelfTreeRowProps {
  rowKey: string;
  name: string;
  level: number;
  leadingIcon: ReactNode;
  content: ReactNode;
  trailingActions?: ReactNode;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected?: boolean;
  isDropOn?: boolean;
  isDropBefore?: boolean;
  isDropAfter?: boolean;
  connectsToPrevious?: boolean;
  connectsToNext?: boolean;
  isEditing?: boolean;
  showControls?: boolean;
  draggable?: boolean;
  onToggleChildren?: MouseEventHandler<HTMLButtonElement>;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  onDragStart?: DragEventHandler<HTMLDivElement>;
  onDragEnd?: DragEventHandler<HTMLDivElement>;
}

export function ShelfTreeRow({
  rowKey,
  name,
  level,
  leadingIcon,
  content,
  trailingActions,
  hasChildren,
  isExpanded,
  isSelected = false,
  isDropOn = false,
  isDropBefore = false,
  isDropAfter = false,
  connectsToPrevious = false,
  connectsToNext = false,
  isEditing = false,
  showControls = false,
  draggable = false,
  onToggleChildren,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
}: ShelfTreeRowProps) {
  const rowHighlightClass = isSelected
    ? selectionSurfaceClassNames.selected
    : isDropOn
      ? selectionSurfaceClassNames.dropTarget
      : '';
  const rowShapeClass = isSelected || isDropOn
    ? connectsToPrevious
      ? connectsToNext
        ? 'rounded-none'
        : 'rounded-t-none rounded-b-lg'
      : connectsToNext
        ? 'rounded-t-lg rounded-b-none'
        : 'rounded-lg'
    : 'rounded-lg';
  const rowOverflowClass = (isEditing || (isSelected && connectsToNext))
    ? 'overflow-visible'
    : 'overflow-hidden';
  const indentDepth = Math.max(0, level - 1);

  return (
    <div
      key={rowKey}
      className={`relative w-full min-w-0 max-w-full ${rowOverflowClass}`}
    >
      {isDropBefore ? (
        <div className="pointer-events-none absolute inset-x-2 top-0 z-10 h-0 border-t-2 border-primary" />
      ) : null}
      <div
        data-sprite-shelf-row="true"
        className={`group/shelf-row w-full min-w-0 max-w-full ${rowOverflowClass} px-1 pt-1 select-none ${
          isEditing ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
        }`}
        draggable={draggable}
        onDoubleClick={onDoubleClick}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className={`relative w-full min-w-0 max-w-full ${rowOverflowClass}`}>
          {!isSelected && !isDropOn ? (
            <div
              className={`pointer-events-none absolute inset-0 z-0 rounded-lg opacity-0 transition-opacity group-hover/shelf-row:opacity-100 ${selectionSurfaceClassNames.hover}`}
            />
          ) : null}
          {(isSelected || isDropOn) ? (
            <div className={`pointer-events-none absolute inset-0 z-0 ${rowShapeClass} ${rowHighlightClass}`} />
          ) : null}
          {isSelected && connectsToNext ? (
            <div className={`pointer-events-none absolute inset-x-0 top-full z-0 h-2 ${rowHighlightClass}`} />
          ) : null}
          <div className="relative z-10 flex w-full min-w-0 max-w-full items-stretch rounded-lg py-1 transition-colors">
            {indentDepth > 0 ? (
              <div aria-hidden="true" className="flex self-center shrink-0">
                {Array.from({ length: indentDepth }).map((_, index) => (
                  <span key={`${rowKey}-indent-${index}`} className="block w-4 shrink-0" />
                ))}
              </div>
            ) : null}
            <button
              type="button"
              disabled={!hasChildren}
              aria-label={hasChildren ? `Toggle ${name}` : undefined}
              className={`-mx-1 flex self-stretch shrink-0 items-center justify-center rounded px-1 transition-opacity disabled:pointer-events-none ${
                showControls ? 'opacity-100' : 'opacity-0'
              }`}
              onClick={onToggleChildren}
            >
              {hasChildren ? (
                isExpanded ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />
              ) : (
                <span className="block h-2.5 w-2.5" />
              )}
            </button>

            <div className="relative flex h-6 w-6 self-center shrink-0 items-center justify-center overflow-hidden rounded-md">
              {leadingIcon}
            </div>

            <div className={`ml-1.5 flex flex-1 min-w-0 max-w-full items-center pr-[3px] ${isEditing ? 'overflow-visible' : 'overflow-hidden'}`}>
              {content}
            </div>

            {trailingActions ? (
              <div className="flex shrink-0 items-center">
                {trailingActions}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {isDropAfter ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-0 z-10 h-0 border-t-2 border-primary" />
      ) : null}
    </div>
  );
}
