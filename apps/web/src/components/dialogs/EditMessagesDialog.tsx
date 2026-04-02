import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Type } from '@/components/ui/icons';
import { useProjectStore } from '@/store/projectStore';
import { useModal } from '@/components/ui/modal-provider';
import {
  ProjectPropertyManagerDialog,
  ProjectPropertyManagerRow,
} from '@/components/dialogs/ProjectPropertyManagerDialog';

interface EditMessagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMessagesChanged?: () => void;
  onSelectMessage?: (messageId: string) => void;
  startInAddMode?: boolean;
}

export function EditMessagesDialog({
  open,
  onOpenChange,
  onMessagesChanged,
  onSelectMessage,
  startInAddMode = false,
}: EditMessagesDialogProps) {
  const { project, addMessage, removeMessage, updateMessage } = useProjectStore();
  const { showAlert, showConfirm } = useModal();
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const messages = useMemo(() => project?.messages || [], [project?.messages]);

  useEffect(() => {
    if (!open) return;
    setIsAdding(startInAddMode);
    setName('');
    setError(null);
    setEditingId(null);
    setEditName('');
  }, [open, startInAddMode]);

  const emitMessagesChanged = () => {
    onMessagesChanged?.();
  };

  const handleAdd = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter a message name');
      return;
    }

    const created = addMessage(trimmedName);
    if (!created) {
      setError('Failed to create message');
      return;
    }

    setName('');
    setError(null);
    setIsAdding(false);
    emitMessagesChanged();

    if (onSelectMessage) {
      onSelectMessage(created.id);
      onOpenChange(false);
    }
  };

  const saveRename = (messageId: string) => {
    const trimmedName = editName.trim();
    if (!trimmedName) {
      void showAlert({
        title: 'Missing Message Name',
        description: 'Please enter a message name.',
      });
      return;
    }

    updateMessage(messageId, { name: trimmedName });
    setEditingId(null);
    setEditName('');
    emitMessagesChanged();
  };

  const handleDelete = async (messageId: string) => {
    const confirmed = await showConfirm({
      title: 'Delete Message',
      description: 'Delete this message? Broadcast and receive blocks using it will stop working.',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!confirmed) return;

    removeMessage(messageId);
    if (editingId === messageId) {
      setEditingId(null);
      setEditName('');
    }
    emitMessagesChanged();
  };

  return (
    <ProjectPropertyManagerDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Messages"
      description="Manage broadcast messages across the whole project."
      addButtonLabel="+ Add Message"
      isAdding={isAdding}
      onToggleAdd={() => {
        setIsAdding((current) => !current);
        setError(null);
      }}
      addForm={(
        <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-2">
            <Label htmlFor="message-name">Message Name</Label>
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

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsAdding(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAdd}>Add Message</Button>
          </div>
        </div>
      )}
    >
      <section className="space-y-2">
        <div className="text-sm font-semibold text-muted-foreground">Broadcast Messages</div>
        {messages.length > 0 ? (
          <div className="space-y-1">
            {messages.map((message) => {
              const isEditing = editingId === message.id;
              return (
                <ProjectPropertyManagerRow
                  key={message.id}
                  icon={<Type className="size-4 flex-shrink-0 text-muted-foreground" />}
                  name={message.name}
                  subtitle={`Stable ID: ${message.id}`}
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
                  primaryActionLabel={onSelectMessage ? 'Use' : undefined}
                  onPrimaryAction={onSelectMessage
                    ? () => {
                        onSelectMessage(message.id);
                        onOpenChange(false);
                      }
                    : undefined}
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
  );
}
