import { SelectionActionContextMenu } from '@/components/editors/shared/SelectionActionContextMenu';

type VectorSelectionContextMenuProps = {
  canCopy: boolean;
  canDelete?: boolean;
  canGroup?: boolean;
  canPaste: boolean;
  canUngroup?: boolean;
  dataTestId?: string;
  deleteLabel?: string;
  onClose: () => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete?: () => void;
  onDuplicate: () => void;
  onGroup?: () => void;
  onPaste: () => void;
  onUngroup?: () => void;
  position: { x: number; y: number };
};

export function VectorSelectionContextMenu({
  canCopy,
  canDelete,
  canGroup,
  canPaste,
  canUngroup,
  dataTestId,
  deleteLabel,
  onClose,
  onCopy,
  onCut,
  onDelete,
  onDuplicate,
  onGroup,
  onPaste,
  onUngroup,
  position,
}: VectorSelectionContextMenuProps) {
  return (
    <SelectionActionContextMenu
      canCopy={canCopy}
      canDelete={canDelete}
      canGroup={canGroup}
      canPaste={canPaste}
      canUngroup={canUngroup}
      dataTestId={dataTestId ?? 'vector-selection-context-menu'}
      deleteLabel={deleteLabel}
      onClose={onClose}
      onCopy={onCopy}
      onCut={onCut}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onGroup={onGroup}
      onPaste={onPaste}
      onUngroup={onUngroup}
      position={position}
    />
  );
}
