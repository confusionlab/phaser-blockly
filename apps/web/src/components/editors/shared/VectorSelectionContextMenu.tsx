import { SelectionActionContextMenu } from '@/components/editors/shared/SelectionActionContextMenu';

type VectorSelectionContextMenuProps = {
  canCopy: boolean;
  canDelete?: boolean;
  canPaste: boolean;
  dataTestId?: string;
  deleteLabel?: string;
  onClose: () => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete?: () => void;
  onDuplicate: () => void;
  onPaste: () => void;
  position: { x: number; y: number };
};

export function VectorSelectionContextMenu({
  canCopy,
  canDelete,
  canPaste,
  dataTestId,
  deleteLabel,
  onClose,
  onCopy,
  onCut,
  onDelete,
  onDuplicate,
  onPaste,
  position,
}: VectorSelectionContextMenuProps) {
  return (
    <SelectionActionContextMenu
      canCopy={canCopy}
      canDelete={canDelete}
      canPaste={canPaste}
      dataTestId={dataTestId ?? 'vector-selection-context-menu'}
      deleteLabel={deleteLabel}
      onClose={onClose}
      onCopy={onCopy}
      onCut={onCut}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onPaste={onPaste}
      position={position}
    />
  );
}
