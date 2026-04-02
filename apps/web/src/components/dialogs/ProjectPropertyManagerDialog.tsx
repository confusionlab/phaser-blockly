import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { WindowDialogChrome } from '@/components/shared/WindowDialogChrome';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { MenuItemButton } from '@/components/ui/menu-item-button';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Pencil, Plus, Trash2 } from '@/components/ui/icons';

interface ProjectPropertyManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  addButtonLabel: string;
  onAdd: () => void;
  toolbar?: ReactNode;
  children: ReactNode;
}

interface ProjectPropertyManagerRowProps {
  icon?: ReactNode;
  name: string;
  subtitle?: string;
  nameMeta?: ReactNode;
  trailingMeta?: ReactNode;
  isEditing?: boolean;
  editValue?: string;
  onEditValueChange?: (value: string) => void;
  onEditSave?: () => void;
  onEditCancel?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  renameLabel?: string;
  deleteLabel?: string;
  renameFieldLabel?: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
}

export function ProjectPropertyManagerDialog({
  open,
  onOpenChange,
  title,
  description,
  addButtonLabel,
  onAdd,
  toolbar,
  children,
}: ProjectPropertyManagerDialogProps) {
  return (
    <WindowDialogChrome
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      contentClassName="left-1/2 right-auto w-[760px] max-w-[calc(100vw-4rem)] translate-x-[-50%]"
      bodyClassName="flex min-h-0 flex-1 flex-col px-6 py-5"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 select-none">
        <div className="flex items-center justify-between gap-3">
          <IconButton
            className="shrink-0"
            label={addButtonLabel}
            onClick={onAdd}
            shape="pill"
            size="sm"
          >
            <Plus className="size-4" />
          </IconButton>

          {toolbar ? (
            <div className="ml-auto flex min-w-0 items-center justify-end">
              {toolbar}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="space-y-5">
            {children}
          </div>
        </div>
      </div>
    </WindowDialogChrome>
  );
}

export function ProjectPropertyManagerRow({
  icon,
  name,
  subtitle,
  nameMeta,
  trailingMeta,
  isEditing = false,
  editValue = '',
  onEditValueChange,
  onEditSave,
  onEditCancel,
  onEdit,
  onDelete,
  renameLabel = 'Rename',
  deleteLabel = 'Delete',
  renameFieldLabel,
  primaryActionLabel,
  onPrimaryAction,
}: ProjectPropertyManagerRowProps) {
  const [contextMenuPosition, setContextMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const cancelRenameOnBlurRef = useRef(false);
  const hasContextMenuActions = Boolean(onEdit || onDelete);

  useLayoutEffect(() => {
    if (!contextMenuPosition || !contextMenuRef.current) {
      return;
    }

    const margin = 8;
    const menuRect = contextMenuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let nextLeft = contextMenuPosition.left;
    let nextTop = contextMenuPosition.top;

    if (nextLeft + menuRect.width + margin > viewportWidth) {
      nextLeft = Math.max(margin, viewportWidth - menuRect.width - margin);
    }
    if (nextTop + menuRect.height + margin > viewportHeight) {
      nextTop = Math.max(margin, viewportHeight - menuRect.height - margin);
    }

    if (nextLeft !== contextMenuPosition.left || nextTop !== contextMenuPosition.top) {
      setContextMenuPosition({ left: nextLeft, top: nextTop });
    }
  }, [contextMenuPosition]);

  useEffect(() => {
    if (!contextMenuPosition || typeof document === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setContextMenuPosition(null);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [contextMenuPosition]);

  const closeContextMenu = () => {
    setContextMenuPosition(null);
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (isEditing || !hasContextMenuActions) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setContextMenuPosition({ left: event.clientX, top: event.clientY });
  };

  const beginRename = () => {
    closeContextMenu();
    onEdit?.();
  };

  const cancelRename = () => {
    cancelRenameOnBlurRef.current = true;
    onEditCancel?.();
  };

  const handleRenameBlur = () => {
    if (cancelRenameOnBlurRef.current) {
      cancelRenameOnBlurRef.current = false;
      return;
    }
    onEditSave?.();
  };

  return (
    <>
      <div
        className="group flex items-center justify-between rounded-lg px-3 py-2 select-none hover:bg-accent"
        onContextMenu={handleContextMenu}
        onDoubleClick={(event) => {
          if (isEditing || !onEdit) {
            return;
          }
          const target = event.target as HTMLElement | null;
          if (target?.closest('button, input, textarea, a')) {
            return;
          }
          event.preventDefault();
          beginRename();
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {icon}
          {isEditing ? (
            <div className="flex flex-1 items-center">
              <InlineRenameField
                aria-label={renameFieldLabel ?? `Rename ${name}`}
                value={editValue}
                onBlur={handleRenameBlur}
                onChange={(event) => onEditValueChange?.(event.target.value)}
                autoFocus
                className="flex-1"
                textClassName="text-sm leading-5"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onEditSave?.();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelRename();
                  }
                }}
              />
            </div>
          ) : (
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate font-medium">{name}</div>
                {nameMeta ? (
                  <div className="shrink-0 text-xs text-muted-foreground/80">
                    {nameMeta}
                  </div>
                ) : null}
              </div>
              {subtitle ? (
                <div className="text-xs text-muted-foreground">{subtitle}</div>
              ) : null}
            </div>
          )}
        </div>
        {!isEditing ? (
          <div className="flex items-center gap-2">
            {trailingMeta ? (
              <div className="shrink-0 text-xs text-muted-foreground/80">
                {trailingMeta}
              </div>
            ) : null}
            {primaryActionLabel && onPrimaryAction ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onPrimaryAction}
                className="h-7 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {primaryActionLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {contextMenuPosition && hasContextMenuActions ? (
        <Card
          ref={contextMenuRef}
          className="fixed z-50 min-w-40 gap-0 py-1"
          style={{
            left: contextMenuPosition.left,
            top: contextMenuPosition.top,
          }}
        >
          {onEdit ? (
            <MenuItemButton
              icon={<Pencil className="size-4" />}
              onClick={beginRename}
            >
              {renameLabel}
            </MenuItemButton>
          ) : null}
          {onEdit && onDelete ? <DropdownMenuSeparator /> : null}
          {onDelete ? (
            <MenuItemButton
              icon={<Trash2 className="size-4" />}
              intent="destructive"
              onClick={() => {
                closeContextMenu();
                onDelete();
              }}
            >
              {deleteLabel}
            </MenuItemButton>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
