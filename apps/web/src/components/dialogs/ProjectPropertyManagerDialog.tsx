import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { Modal } from '@/components/ui/modal';
import { Check, Pencil, Trash2, X } from '@/components/ui/icons';

interface ProjectPropertyManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  addButtonLabel: string;
  closeAddButtonLabel?: string;
  isAdding: boolean;
  onToggleAdd: () => void;
  addForm?: ReactNode;
  children: ReactNode;
}

interface ProjectPropertyManagerRowProps {
  icon?: ReactNode;
  name: string;
  subtitle?: string;
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
  closeAddButtonLabel,
  isAdding,
  onToggleAdd,
  addForm,
  children,
}: ProjectPropertyManagerDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      contentClassName="sm:max-w-[760px]"
    >
      <div className="flex items-center justify-between gap-3">
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : (
          <div />
        )}
        <Button onClick={onToggleAdd}>
          {isAdding ? (closeAddButtonLabel ?? 'Close Add Form') : addButtonLabel}
        </Button>
      </div>

      {isAdding ? addForm : null}

      <div className="max-h-[460px] space-y-5 overflow-y-auto pr-1">
        {children}
      </div>
    </Modal>
  );
}

export function ProjectPropertyManagerRow({
  icon,
  name,
  subtitle,
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
    <div className="group flex items-center justify-between rounded-lg px-3 py-2 hover:bg-accent">
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
            <div className="truncate font-medium">{name}</div>
            {subtitle ? (
              <div className="text-xs text-muted-foreground">{subtitle}</div>
            ) : null}
          </div>
        )}
      </div>
      {!isEditing ? (
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
      ) : null}
    </div>
  );
}
