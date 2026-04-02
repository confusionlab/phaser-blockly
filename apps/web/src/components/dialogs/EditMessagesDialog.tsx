import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Type } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { ReferenceUsageDialog } from '@/components/dialogs/ReferenceUsageDialog';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { useModal } from '@/components/ui/modal-provider';
import {
  ProjectPropertyManagerDialog,
  ProjectPropertyManagerRow,
} from '@/components/dialogs/ProjectPropertyManagerDialog';
import type { ProjectReferenceImpact, ProjectReferenceOwnerTarget } from '@/lib/projectReferenceUsage';

interface EditMessagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMessagesChanged?: () => void;
}

export function EditMessagesDialog({
  open,
  onOpenChange,
  onMessagesChanged,
}: EditMessagesDialogProps) {
  const { project, addMessage, getMessageDeletionImpact, removeMessage, updateMessage } = useProjectStore();
  const focusCodeOwner = useEditorStore((state) => state.focusCodeOwner);
  const { showAlert, showConfirm } = useModal();
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [blockedDelete, setBlockedDelete] = useState<{ entityLabel: string; impact: ProjectReferenceImpact } | null>(null);

  const messages = useMemo(() => project?.messages || [], [project?.messages]);

  const resetAddDialog = () => {
    setName('');
    setError(null);
  };

  useEffect(() => {
    if (!open) return;
    setIsAdding(false);
    resetAddDialog();
    setEditingId(null);
    setEditName('');
    setBlockedDelete(null);
  }, [open]);

  const emitMessagesChanged = () => {
    onMessagesChanged?.();
  };

  const canCreateMessage = name.trim().length > 0;

  const handleAdd = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    const created = addMessage(trimmedName);
    if (!created) {
      setError('Failed to create message');
      return;
    }

    setIsAdding(false);
    resetAddDialog();
    emitMessagesChanged();
  };

  const saveRename = (messageId: string) => {
    const trimmedName = editName.trim();
    if (!trimmedName) {
      void showAlert({
        title: 'Missing Name',
        description: 'Please enter a name.',
      });
      return;
    }

    updateMessage(messageId, { name: trimmedName });
    setEditingId(null);
    setEditName('');
    emitMessagesChanged();
  };

  const handleDelete = async (messageId: string) => {
    const message = messages.find((entry) => entry.id === messageId);
    const impact = getMessageDeletionImpact(messageId);
    if (message && impact && impact.referenceCount > 0) {
      setBlockedDelete({ entityLabel: message.name, impact });
      return;
    }

    const confirmed = await showConfirm({
      title: 'Delete Message',
      description: 'Delete this message?',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!confirmed) return;

    const result = removeMessage(messageId);
    if (!result.deleted) {
      if (message && result.impact?.referenceCount) {
        setBlockedDelete({ entityLabel: message.name, impact: result.impact });
      }
      return;
    }

    if (editingId === messageId) {
      setEditingId(null);
      setEditName('');
    }
    emitMessagesChanged();
  };

  const handleNavigateToUsage = (owner: ProjectReferenceOwnerTarget) => {
    focusCodeOwner(owner);
    setBlockedDelete(null);
    onOpenChange(false);
  };

  return (
    <>
      <ProjectPropertyManagerDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Messages"
        addButtonLabel="Create"
        onAdd={() => {
          resetAddDialog();
          setIsAdding(true);
        }}
      >
        <section className="space-y-2">
          {messages.length > 0 ? (
            <div className="space-y-1">
              {messages.map((message) => {
                const isEditing = editingId === message.id;
                return (
                  <ProjectPropertyManagerRow
                    key={message.id}
                    icon={<Type className="size-4 flex-shrink-0 text-muted-foreground" />}
                    name={message.name}
                    isEditing={isEditing}
                    editValue={editName}
                    onEditValueChange={setEditName}
                    onEditSave={() => saveRename(message.id)}
                    onEditCancel={() => {
                      setEditingId(null);
                      setEditName('');
                    }}
                    onEdit={() => {
                      setEditingId(message.id);
                      setEditName(message.name);
                    }}
                    onDelete={() => void handleDelete(message.id)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
              No broadcast messages yet.
            </div>
          )}
        </section>
      </ProjectPropertyManagerDialog>
      <Modal
        open={isAdding}
        onOpenChange={(nextOpen) => {
          setIsAdding(nextOpen);
          if (!nextOpen) {
            setError(null);
          }
        }}
        title="Create Message"
        contentClassName="sm:max-w-lg"
        footer={(
          <Button disabled={!canCreateMessage} onClick={handleAdd}>Create</Button>
        )}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="message-name">Name</Label>
            <Input
              id="message-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              placeholder="game over"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleAdd();
                }
              }}
            />
          </div>

          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>
      </Modal>
      <ReferenceUsageDialog
        open={!!blockedDelete}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setBlockedDelete(null);
          }
        }}
        entityLabel={blockedDelete?.entityLabel ?? ''}
        impact={blockedDelete?.impact ?? null}
        onNavigate={handleNavigateToUsage}
      />
    </>
  );
}
