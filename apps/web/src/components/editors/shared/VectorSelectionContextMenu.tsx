import { Card } from '@/components/ui/card';
import { Clipboard, Copy, CopyPlus, Scissors } from '@/components/ui/icons';
import { MenuItemButton } from '@/components/ui/menu-item-button';

type VectorSelectionContextMenuProps = {
  canCopy: boolean;
  canPaste: boolean;
  onClose: () => void;
  onCopy: () => void;
  onCut: () => void;
  onDuplicate: () => void;
  onPaste: () => void;
  position: { x: number; y: number };
};

export function VectorSelectionContextMenu({
  canCopy,
  canPaste,
  onClose,
  onCopy,
  onCut,
  onDuplicate,
  onPaste,
  position,
}: VectorSelectionContextMenuProps) {
  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      <Card
        data-testid="vector-selection-context-menu"
        role="menu"
        className="fixed z-50 min-w-36 gap-0 py-1"
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        <MenuItemButton icon={<Copy className="size-4" />} onClick={onCopy} disabled={!canCopy}>
          Copy
        </MenuItemButton>
        <MenuItemButton icon={<Scissors className="size-4" />} onClick={onCut} disabled={!canCopy}>
          Cut
        </MenuItemButton>
        <MenuItemButton icon={<Clipboard className="size-4" />} onClick={onPaste} disabled={!canPaste}>
          Paste
        </MenuItemButton>
        <MenuItemButton icon={<CopyPlus className="size-4" />} onClick={onDuplicate} disabled={!canCopy}>
          Duplicate
        </MenuItemButton>
      </Card>
    </>
  );
}
