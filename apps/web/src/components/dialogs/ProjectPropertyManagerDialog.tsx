import type { ReactNode } from 'react';
import { WindowDialogChrome } from '@/components/shared/WindowDialogChrome';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { Check, Pencil, Plus, Trash2, X } from '@/components/ui/icons';

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
  primaryActionLabel,
  onPrimaryAction,
}: ProjectPropertyManagerRowProps) {
  return (
    <div className="group flex items-center justify-between rounded-lg px-3 py-2 select-none hover:bg-accent">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon}
        {isEditing ? (
          <div className="flex flex-1 items-center gap-2">
            <InlineRenameField
              value={editValue}
              onChange={(event) => onEditValueChange?.(event.target.value)}
              autoFocus
              className="flex-1"
              textClassName="text-sm leading-5"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onEditSave?.();
                }
                if (event.key === 'Escape') {
                  onEditCancel?.();
                }
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={onEditSave}
              className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-500/15 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onEditCancel}
              className="h-7 w-7 p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
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
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
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
          {onEdit ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              className="h-7 w-7 p-0 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="h-7 w-7 p-0 text-red-500 hover:bg-red-500/15 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
