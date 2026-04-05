import { Card } from '@/components/ui/card';
import { Clipboard, Copy, CopyPlus, Layers3, Scissors, Trash2, Unlink } from '@/components/ui/icons';
import { MenuItemButton, MenuSeparator } from '@/components/ui/menu-item-button';

type SelectionActionContextMenuProps = {
  canCopy: boolean;
  canDelete?: boolean;
  canGroup?: boolean;
  canPaste: boolean;
  canUngroup?: boolean;
  dataTestId?: string;
  deleteLabel?: string;
  onClose: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onGroup?: () => void;
  onPaste?: () => void;
  onUngroup?: () => void;
  position: { x: number; y: number };
};

export function SelectionActionContextMenu({
  canCopy,
  canDelete = canCopy,
  canGroup = false,
  canPaste,
  canUngroup = false,
  dataTestId = 'selection-action-context-menu',
  deleteLabel = 'Delete',
  onClose,
  onCopy,
  onCut,
  onDelete,
  onDuplicate,
  onGroup,
  onPaste,
  onUngroup,
  position,
}: SelectionActionContextMenuProps) {
  const hasClipboardAction = !!(onCopy || onCut || onPaste || onDuplicate);
  const hasGroupingAction = !!(onGroup || onUngroup);
  const showGroupingSeparator = hasGroupingAction && hasClipboardAction;
  const showDeleteSeparator = !!(onDelete && (hasClipboardAction || hasGroupingAction));

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      <Card
        data-testid={dataTestId}
        role="menu"
        className="fixed z-50 min-w-36 gap-0 py-1"
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        {onCopy ? (
          <MenuItemButton icon={<Copy className="size-4" />} onClick={onCopy} disabled={!canCopy}>
            Copy
          </MenuItemButton>
        ) : null}
        {onCut ? (
          <MenuItemButton icon={<Scissors className="size-4" />} onClick={onCut} disabled={!canCopy}>
            Cut
          </MenuItemButton>
        ) : null}
        {onPaste ? (
          <MenuItemButton icon={<Clipboard className="size-4" />} onClick={onPaste} disabled={!canPaste}>
            Paste
          </MenuItemButton>
        ) : null}
        {onDuplicate ? (
          <MenuItemButton icon={<CopyPlus className="size-4" />} onClick={onDuplicate} disabled={!canCopy}>
            Duplicate
          </MenuItemButton>
        ) : null}
        {showGroupingSeparator ? <MenuSeparator /> : null}
        {onGroup ? (
          <MenuItemButton icon={<Layers3 className="size-4" />} onClick={onGroup} disabled={!canGroup}>
            Group
          </MenuItemButton>
        ) : null}
        {onUngroup ? (
          <MenuItemButton icon={<Unlink className="size-4" />} onClick={onUngroup} disabled={!canUngroup}>
            Ungroup
          </MenuItemButton>
        ) : null}
        {showDeleteSeparator ? <MenuSeparator /> : null}
        {onDelete ? (
          <MenuItemButton
            icon={<Trash2 className="size-4" />}
            intent="destructive"
            onClick={onDelete}
            disabled={!canDelete}
          >
            {deleteLabel}
          </MenuItemButton>
        ) : null}
      </Card>
    </>
  );
}
