import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { normalizeVariableName } from '@/lib/variableUtils';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import type { Variable, VariableType } from '@/types';

interface AddVariableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (variable: Variable) => void;
  objectName?: string; // If provided, shows "for this object" option
}

const VARIABLE_TYPES: { value: VariableType; label: string; description: string }[] = [
  { value: 'string', label: 'Text', description: 'Letters and words' },
  { value: 'integer', label: 'Integer', description: 'Whole numbers (1, 2, 3...)' },
  { value: 'float', label: 'Decimal', description: 'Numbers with decimals (1.5, 3.14...)' },
  { value: 'boolean', label: 'Boolean', description: 'True or False' },
];

function getDefaultValue(type: VariableType): number | string | boolean {
  switch (type) {
    case 'string': return '';
    case 'integer': return 0;
    case 'float': return 0.0;
    case 'boolean': return false;
  }
}

export function AddVariableDialog({ open, onOpenChange, onAdd, objectName }: AddVariableDialogProps) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'global' | 'local'>('global');
  const [type, setType] = useState<VariableType>('integer');
  const [error, setError] = useState<string | null>(null);
  const project = useProjectStore((state) => state.project);
  const { selectedSceneId, selectedObjectId, selectedComponentId } = useEditorStore();

  const hasDuplicateName = (candidateName: string): boolean => {
    if (!project) return false;
    const normalizedCandidate = normalizeVariableName(candidateName).toLowerCase();

    if (scope === 'global') {
      return (project.globalVariables || []).some(
        (variable) => normalizeVariableName(variable.name).toLowerCase() === normalizedCandidate,
      );
    }

    if (selectedSceneId && selectedObjectId) {
      const scene = project.scenes.find((sceneItem) => sceneItem.id === selectedSceneId);
      const object = scene?.objects.find((objectItem) => objectItem.id === selectedObjectId);
      if (!object) return false;
      const component = object.componentId
        ? (project.components || []).find((componentItem) => componentItem.id === object.componentId)
        : null;
      const componentLocalVariables = component?.localVariables || [];
      const localVariables = componentLocalVariables.length > 0
        ? componentLocalVariables
        : (object.localVariables || []);
      return localVariables.some(
        (variable) => normalizeVariableName(variable.name).toLowerCase() === normalizedCandidate,
      );
    }

    if (selectedComponentId) {
      const component = (project.components || []).find((componentItem) => componentItem.id === selectedComponentId);
      return (component?.localVariables || []).some(
        (variable) => normalizeVariableName(variable.name).toLowerCase() === normalizedCandidate,
      );
    }

    return false;
  };

  const handleAdd = () => {
    const trimmedName = normalizeVariableName(name);
    if (!trimmedName) {
      setError('Please enter a variable name');
      return;
    }

    if (hasDuplicateName(trimmedName)) {
      setError(scope === 'global' ? 'A global variable with this name already exists' : 'A local variable with this name already exists');
      return;
    }

    const variable: Variable = {
      id: crypto.randomUUID(),
      name: trimmedName,
      type,
      defaultValue: getDefaultValue(type),
      scope,
    };

    onAdd(variable);

    // Reset form
    setName('');
    setScope('global');
    setType('integer');
    setError(null);
    onOpenChange(false);
  };

  const handleClose = () => {
    setName('');
    setScope('global');
    setType('integer');
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Add Variable</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Variable Name */}
          <div className="space-y-2">
            <Label htmlFor="var-name">Variable Name</Label>
            <Input
              id="var-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="Player score"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          {/* Scope Toggle */}
          <div className="space-y-2">
            <Label>Scope</Label>
            <div className="flex gap-2">
              <Button
                variant={scope === 'global' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setScope('global')}
              >
                Global
              </Button>
              <Button
                variant={scope === 'local' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setScope('local')}
                disabled={!objectName}
              >
                Local {objectName ? `(${objectName})` : ''}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {scope === 'global'
                ? 'Available to all objects in the project'
                : 'Only available to this object (each instance has its own value)'}
            </p>
          </div>

          {/* Type Selection */}
          <div className="space-y-2">
            <Label>Type</Label>
            <div className="flex flex-col gap-2">
              {VARIABLE_TYPES.map((t) => (
                <Button
                  key={t.value}
                  variant={type === t.value ? 'default' : 'outline'}
                  className="h-auto w-full py-2 flex flex-col items-start"
                  onClick={() => setType(t.value)}
                >
                  <span className="font-medium">{t.label}</span>
                  <span className="text-xs opacity-70">{t.description}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd}>
            Add Variable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
