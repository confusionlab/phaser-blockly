import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Pencil, Check, X } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import type { Variable, VariableType } from '@/types';

interface VariableManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddNew: () => void;
}

function getTypeIcon(type: VariableType): string {
  switch (type) {
    case 'string': return '📝';
    case 'integer': return '#';
    case 'float': return '#.#';
    case 'boolean': return '◇';
  }
}

function getTypeLabel(type: VariableType): string {
  switch (type) {
    case 'string': return 'Text';
    case 'integer': return 'Integer';
    case 'float': return 'Decimal';
    case 'boolean': return 'Boolean';
  }
}

export function VariableManagerDialog({ open, onOpenChange, onAddNew }: VariableManagerDialogProps) {
  const { project, removeGlobalVariable, removeLocalVariable, updateGlobalVariable, updateLocalVariable } = useProjectStore();
  const { selectedSceneId, selectedObjectId } = useEditorStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Get all variables
  const globalVariables = project?.globalVariables || [];

  // Get local variables for current object
  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const currentObject = scene?.objects.find(o => o.id === selectedObjectId);
  const localVariables = currentObject?.localVariables || [];

  const handleDeleteGlobal = (varId: string) => {
    if (confirm('Delete this variable? Any blocks using it will stop working.')) {
      removeGlobalVariable(varId);
    }
  };

  const handleDeleteLocal = (varId: string) => {
    if (selectedSceneId && selectedObjectId) {
      if (confirm('Delete this variable? Any blocks using it will stop working.')) {
        removeLocalVariable(selectedSceneId, selectedObjectId, varId);
      }
    }
  };

  const startEditing = (variable: Variable) => {
    setEditingId(variable.id);
    setEditName(variable.name);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveRenameGlobal = (varId: string) => {
    const trimmed = editName.trim();
    if (trimmed && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
      updateGlobalVariable(varId, { name: trimmed });
    }
    setEditingId(null);
    setEditName('');
  };

  const saveRenameLocal = (varId: string) => {
    const trimmed = editName.trim();
    if (trimmed && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed) && selectedSceneId && selectedObjectId) {
      updateLocalVariable(selectedSceneId, selectedObjectId, varId, { name: trimmed });
    }
    setEditingId(null);
    setEditName('');
  };

  const handleAddNew = () => {
    onOpenChange(false);
    onAddNew();
  };

  const VariableRow = ({
    variable,
    onDelete,
    onSaveRename,
  }: {
    variable: Variable;
    onDelete: () => void;
    onSaveRename: (id: string) => void;
  }) => {
    const isEditing = editingId === variable.id;

    return (
      <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-accent group">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-lg flex-shrink-0">{getTypeIcon(variable.type)}</span>
          {isEditing ? (
            <div className="flex items-center gap-2 flex-1">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-7 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSaveRename(variable.id);
                  if (e.key === 'Escape') cancelEditing();
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSaveRename(variable.id)}
                className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                <Check className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelEditing}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="font-medium truncate">{variable.name}</div>
              <div className="text-xs text-muted-foreground">{getTypeLabel(variable.type)}</div>
            </div>
          )}
        </div>
        {!isEditing && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startEditing(variable)}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="h-7 w-7 p-0 text-red-500 hover:text-red-500 hover:bg-red-500/15 dark:text-red-400 dark:hover:text-red-300"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Manage Variables</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[400px] overflow-y-auto">
          {/* Global Variables */}
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-2">Global Variables</div>
            {globalVariables.length === 0 ? (
              <div className="text-sm text-muted-foreground italic py-2">No global variables</div>
            ) : (
              <div className="space-y-1">
                {globalVariables.map(v => (
                  <VariableRow
                    key={v.id}
                    variable={v}
                    onDelete={() => handleDeleteGlobal(v.id)}
                    onSaveRename={saveRenameGlobal}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Local Variables */}
          {currentObject && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-2">
                Local Variables ({currentObject.name})
              </div>
              {localVariables.length === 0 ? (
                <div className="text-sm text-muted-foreground italic py-2">No local variables</div>
              ) : (
                <div className="space-y-1">
                  {localVariables.map(v => (
                    <VariableRow
                      key={v.id}
                      variable={v}
                      onDelete={() => handleDeleteLocal(v.id)}
                      onSaveRename={saveRenameLocal}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleAddNew}>
            + Add Variable
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
