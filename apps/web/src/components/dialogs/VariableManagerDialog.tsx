import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InlineRenameField } from '@/components/ui/inline-rename-field';
import { AppIcon, type AppIconName } from '@/lib/icons/appIcons';
import { Trash2, Pencil, Check, X } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import type { Variable, VariableType } from '@/types';

interface VariableManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddNew: () => void;
}

function getTypeIconName(type: VariableType): AppIconName {
  switch (type) {
    case 'string': return 'variableString';
    case 'integer': return 'variableInteger';
    case 'float': return 'variableFloat';
    case 'boolean': return 'variableBoolean';
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
  const {
    project,
    removeGlobalVariable,
    removeLocalVariable,
    updateGlobalVariable,
    updateLocalVariable,
    updateComponent,
  } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectedComponentId } = useEditorStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Get all variables
  const globalVariables = project?.globalVariables || [];

  // Get local variables for current object
  const scene = project?.scenes.find(s => s.id === selectedSceneId);
  const currentObject = scene?.objects.find(o => o.id === selectedObjectId);
  const component = currentObject?.componentId
    ? (project?.components || []).find((componentItem) => componentItem.id === currentObject.componentId)
    : (selectedComponentId
      ? (project?.components || []).find((componentItem) => componentItem.id === selectedComponentId)
      : null);
  const editingComponentOnly = !currentObject && !!component;
  const componentIdForLocal = currentObject?.componentId || selectedComponentId || null;
  const componentNameForLocal = component?.name || null;
  const localOwnerLabel = currentObject
    ? currentObject.name
    : (componentNameForLocal ? `${componentNameForLocal} (component)` : '');
  const componentLocalVariables = component?.localVariables || [];
  const localVariables = componentLocalVariables.length > 0
    ? componentLocalVariables
    : (currentObject?.localVariables || []);

  const hasDuplicateGlobalName = (candidateName: string, excludeId?: string): boolean => {
    const normalized = candidateName.trim().toLowerCase();
    if (!normalized) return false;
    return globalVariables.some((variable) => {
      if (excludeId && variable.id === excludeId) return false;
      return variable.name.trim().toLowerCase() === normalized;
    });
  };

  const hasDuplicateLocalName = (candidateName: string, excludeId?: string): boolean => {
    const normalized = candidateName.trim().toLowerCase();
    if (!normalized) return false;
    return localVariables.some((variable) => {
      if (excludeId && variable.id === excludeId) return false;
      return variable.name.trim().toLowerCase() === normalized;
    });
  };

  const updateComponentLocalVariables = (nextLocalVariables: Variable[]) => {
    if (!componentIdForLocal) return;
    updateComponent(componentIdForLocal, { localVariables: nextLocalVariables });
  };

  const handleDeleteGlobal = (varId: string) => {
    if (confirm('Delete this variable? Any blocks using it will stop working.')) {
      removeGlobalVariable(varId);
    }
  };

  const handleDeleteLocal = (varId: string) => {
    if (editingComponentOnly) {
      if (confirm('Delete this variable? Any blocks using it will stop working.')) {
        updateComponentLocalVariables(localVariables.filter((v) => v.id !== varId));
      }
      return;
    }

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
      if (hasDuplicateGlobalName(trimmed, varId)) {
        alert('A global variable with this name already exists.');
        return;
      }
      updateGlobalVariable(varId, { name: trimmed });
    }
    setEditingId(null);
    setEditName('');
  };

  const saveRenameLocal = (varId: string) => {
    const trimmed = editName.trim();
    if (!trimmed || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
      setEditingId(null);
      setEditName('');
      return;
    }

    if (hasDuplicateLocalName(trimmed, varId)) {
      alert('A local variable with this name already exists.');
      return;
    }

    if (editingComponentOnly) {
      updateComponentLocalVariables(
        localVariables.map((variable) => (variable.id === varId ? { ...variable, name: trimmed } : variable))
      );
    } else if (selectedSceneId && selectedObjectId) {
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
          <AppIcon
            className="size-4 flex-shrink-0 text-muted-foreground"
            decorative={false}
            name={getTypeIconName(variable.type)}
            title={getTypeLabel(variable.type)}
          />
          {isEditing ? (
            <div className="flex items-center gap-2 flex-1">
              <InlineRenameField
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                className="flex-1"
                textClassName="text-sm leading-5"
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
          {(currentObject || editingComponentOnly) && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-2">
                Local Variables ({localOwnerLabel})
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
