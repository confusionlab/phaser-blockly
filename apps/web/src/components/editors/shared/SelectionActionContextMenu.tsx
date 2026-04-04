import { Card } from '@/components/ui/card';
import { Clipboard, Copy, CopyPlus, Scissors, Trash2 } from '@/components/ui/icons';
import { MenuItemButton, MenuSeparator } from '@/components/ui/menu-item-button';

type SelectionActionContextMenuProps = {
  canCopy: boolean;
  canDelete?: boolean;
  canPaste: boolean;
  dataTestId?: string;
  deleteLabel?: string;
  onClose: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onPaste?: () => void;
  position: { x: number; y: number };
};

export function SelectionActionContextMenu({
  canCopy,
  canDelete = canCopy,
  canPaste,
  dataTestId = 'selection-action-context-menu',
  deleteLabel = 'Delete',
  onClose,
  onCopy,
  onCut,
  onDelete,
  onDuplicate,
  onPaste,
  position,
}: SelectionActionContextMenuProps) {
  const hasClipboardAction = !!(onCopy || onCut || onPaste || onDuplicate);
  const showDeleteSeparator = !!(onDelete && hasClipboardAction);

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
