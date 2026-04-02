import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppIcon, type AppIconName } from '@/components/ui/icons';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import {
  getDefaultVariableValue,
  hasVariableNameConflict,
  normalizeVariableCardinality,
  normalizeVariableName,
} from '@/lib/variableUtils';
import type { Variable, VariableCardinality, VariableType } from '@/types';
import { useModal } from '@/components/ui/modal-provider';
import { Modal } from '@/components/ui/modal';
import {
  ProjectPropertyManagerDialog,
  ProjectPropertyManagerRow,
} from '@/components/dialogs/ProjectPropertyManagerDialog';

interface EditVariablesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVariablesChanged?: () => void;
}

type VariableTarget =
  | { kind: 'global' }
  | { kind: 'component'; componentId: string }
  | { kind: 'object'; sceneId: string; objectId: string };

type AddVariableScope = 'global' | 'local';

type LocalSelectionTarget =
  | { kind: 'component'; componentId: string }
  | { kind: 'object'; sceneId: string; objectId: string; backingComponentId?: string };

type VariableEntry = {
  key: string;
  variable: Variable;
  target: VariableTarget;
  note?: string;
};

const VARIABLE_SCOPE_OPTIONS: { value: AddVariableScope; label: string; description: string }[] = [
  { value: 'global', label: 'Global', description: 'Available everywhere in the project.' },
  { value: 'local', label: 'Local', description: 'Uses the currently selected object or reusable component.' },
];

const VARIABLE_TYPES: { value: VariableType; label: string; description: string }[] = [
  { value: 'string', label: 'Text', description: 'Letters and words' },
  { value: 'number', label: 'Number', description: 'Whole numbers or decimals' },
  { value: 'boolean', label: 'Boolean', description: 'True or False' },
];
const VARIABLE_CARDINALITIES: { value: VariableCardinality; label: string; description: string }[] = [
  { value: 'single', label: 'Single', description: 'One value' },
  { value: 'array', label: 'Multiple', description: 'An ordered list of values' },
];

function getTypeIconName(type: VariableType): AppIconName {
  switch (type) {
    case 'string': return 'variableString';
    case 'number': return 'variableNumber';
    case 'boolean': return 'variableBoolean';
  }
}

function getTypeLabel(type: VariableType): string {
  switch (type) {
    case 'string': return 'Text';
    case 'number': return 'Number';
    case 'boolean': return 'Boolean';
  }
}

function getVariableKindLabel(variable: Variable): string {
  const cardinality = normalizeVariableCardinality(variable.cardinality);
  return cardinality === 'array' ? `${getTypeLabel(variable.type)} Array` : getTypeLabel(variable.type);
}

export function EditVariablesDialog({ open, onOpenChange, onVariablesChanged }: EditVariablesDialogProps) {
  const {
    project,
    addGlobalVariable,
    removeGlobalVariable,
    updateGlobalVariable,
    addLocalVariable,
    removeLocalVariable,
    updateLocalVariable,
    updateComponent,
  } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectedComponentId } = useEditorStore();
  const { showAlert, showConfirm } = useModal();

  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<VariableType>('number');
  const [cardinality, setCardinality] = useState<VariableCardinality>('single');
  const [scope, setScope] = useState<AddVariableScope>('global');
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const components = useMemo(() => project?.components || [], [project?.components]);
  const scenes = useMemo(() => project?.scenes || [], [project?.scenes]);

  const componentById = useMemo(
    () => new Map(components.map((component) => [component.id, component])),
    [components],
  );

  const referencedComponentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const scene of scenes) {
      for (const object of scene.objects) {
        if (object.componentId) {
          ids.add(object.componentId);
        }
      }
    }
    return ids;
  }, [scenes]);

  const localSelectionTarget = useMemo<LocalSelectionTarget | null>(() => {
    if (selectedSceneId && selectedObjectId) {
      const scene = scenes.find((sceneItem) => sceneItem.id === selectedSceneId);
      const object = scene?.objects.find((objectItem) => objectItem.id === selectedObjectId);
      if (object) {
        const component = object.componentId ? componentById.get(object.componentId) : null;
        return {
          kind: 'object',
          sceneId: selectedSceneId,
          objectId: selectedObjectId,
          backingComponentId: component?.id,
        };
      }
    }
    if (selectedComponentId) {
      const component = componentById.get(selectedComponentId);
      if (component) {
        return {
          kind: 'component',
          componentId: selectedComponentId,
        };
      }
    }
    return null;
  }, [componentById, scenes, selectedComponentId, selectedObjectId, selectedSceneId]);

  const preferredScope = localSelectionTarget ? 'local' : 'global';

  const resetAddDialog = (nextScope: AddVariableScope) => {
    setName('');
    setType('number');
    setCardinality('single');
    setError(null);
    setScope(nextScope);
  };

  useEffect(() => {
    if (!open) return;
    setIsAdding(false);
    setEditingKey(null);
    setEditName('');
    resetAddDialog(preferredScope);
  }, [open, preferredScope]);

  useEffect(() => {
    if (scope === 'local' && !localSelectionTarget) {
      setScope('global');
    }
  }, [localSelectionTarget, scope]);

  const getVariablesForTarget = (target: VariableTarget): Variable[] => {
    switch (target.kind) {
      case 'global':
        return project?.globalVariables || [];
      case 'component':
        return componentById.get(target.componentId)?.localVariables || [];
      case 'object': {
        const scene = scenes.find((sceneItem) => sceneItem.id === target.sceneId);
        const object = scene?.objects.find((objectItem) => objectItem.id === target.objectId);
        return object?.localVariables || [];
      }
    }
  };

  const getVariablesForLocalSelectionTarget = (target: LocalSelectionTarget): Variable[] => {
    if (target.kind === 'component') {
      return componentById.get(target.componentId)?.localVariables || [];
    }

    if (target.backingComponentId) {
      return componentById.get(target.backingComponentId)?.localVariables || [];
    }

    const scene = scenes.find((sceneItem) => sceneItem.id === target.sceneId);
    const object = scene?.objects.find((objectItem) => objectItem.id === target.objectId);
    return object?.localVariables || [];
  };

  const emitVariablesChanged = () => {
    onVariablesChanged?.();
  };

  const sceneGroups = useMemo(() => {
    return scenes
      .map((scene) => {
        const objectGroups = scene.objects
          .map((object) => {
            const component = object.componentId ? componentById.get(object.componentId) : null;
            const componentLocalVariables = component?.localVariables || [];
            const usesComponentVariables = componentLocalVariables.length > 0;
            const variables = usesComponentVariables ? componentLocalVariables : (object.localVariables || []);

            const entries: VariableEntry[] = variables.map((variable) => ({
              key: `scene:${scene.id}:object:${object.id}:${usesComponentVariables ? 'component' : 'object'}:${variable.id}`,
              variable,
              target: usesComponentVariables && component
                ? { kind: 'component', componentId: component.id }
                : { kind: 'object', sceneId: scene.id, objectId: object.id },
              note: usesComponentVariables && component ? `Stored on component ${component.name}` : undefined,
            }));

            if (entries.length === 0) {
              return null;
            }

            return {
              key: `scene:${scene.id}:object:${object.id}`,
              title: object.name,
              subtitle: usesComponentVariables && component ? `Uses variables from component ${component.name}` : null,
              entries,
            };
          })
          .filter((group): group is NonNullable<typeof group> => group !== null);

        return objectGroups.length > 0
          ? {
              key: scene.id,
              title: scene.name,
              objects: objectGroups,
            }
          : null;
      })
      .filter((group): group is NonNullable<typeof group> => group !== null);
  }, [componentById, scenes]);

  const standaloneComponentGroups = useMemo(() => {
    return components
      .filter((component) => !referencedComponentIds.has(component.id))
      .map((component) => {
        const entries: VariableEntry[] = (component.localVariables || []).map((variable) => ({
          key: `component:${component.id}:${variable.id}`,
          variable,
          target: { kind: 'component', componentId: component.id },
        }));

        if (entries.length === 0) {
          return null;
        }

        return {
          key: component.id,
          title: component.name,
          entries,
        };
      })
      .filter((group): group is NonNullable<typeof group> => group !== null);
  }, [components, referencedComponentIds]);

  const globalEntries = useMemo<VariableEntry[]>(
    () => (project?.globalVariables || []).map((variable) => ({
      key: `global:${variable.id}`,
      variable,
      target: { kind: 'global' },
    })),
    [project],
  );

  const handleDelete = async (entry: VariableEntry) => {
    const confirmed = await showConfirm({
      title: 'Delete Variable',
      description: 'Delete this variable? Any blocks using it will stop working.',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!confirmed) return;

    switch (entry.target.kind) {
      case 'global':
        removeGlobalVariable(entry.variable.id);
        break;
      case 'component': {
        const component = componentById.get(entry.target.componentId);
        if (!component) return;
        updateComponent(entry.target.componentId, {
          localVariables: (component.localVariables || []).filter((variable) => variable.id !== entry.variable.id),
        });
        break;
      }
      case 'object':
        removeLocalVariable(entry.target.sceneId, entry.target.objectId, entry.variable.id);
        break;
    }

    if (editingKey === entry.key) {
      setEditingKey(null);
      setEditName('');
    }
    emitVariablesChanged();
  };

  const saveRename = (entry: VariableEntry) => {
    const trimmed = normalizeVariableName(editName);
    if (!trimmed) {
      void showAlert({
        title: 'Missing Variable Name',
        description: 'Please enter a variable name.',
      });
      return;
    }

    if (hasVariableNameConflict(getVariablesForTarget(entry.target), trimmed, entry.variable.id)) {
      void showAlert({
        title: 'Duplicate Variable Name',
        description: 'A variable with this name already exists in that location.',
      });
      return;
    }

    switch (entry.target.kind) {
      case 'global':
        updateGlobalVariable(entry.variable.id, { name: trimmed });
        break;
      case 'component': {
        const component = componentById.get(entry.target.componentId);
        if (!component) return;
        updateComponent(entry.target.componentId, {
          localVariables: (component.localVariables || []).map((variable) =>
            variable.id === entry.variable.id ? { ...variable, name: trimmed } : variable,
          ),
        });
        break;
      }
      case 'object':
        updateLocalVariable(entry.target.sceneId, entry.target.objectId, entry.variable.id, { name: trimmed });
        break;
    }

    setEditingKey(null);
    setEditName('');
    emitVariablesChanged();
  };

  const handleAdd = () => {
    const trimmedName = normalizeVariableName(name);
    const target: VariableTarget | null = scope === 'global'
      ? { kind: 'global' }
      : localSelectionTarget
        ? (
            localSelectionTarget.kind === 'component'
              ? { kind: 'component', componentId: localSelectionTarget.componentId }
              : { kind: 'object', sceneId: localSelectionTarget.sceneId, objectId: localSelectionTarget.objectId }
          )
        : null;

    if (!target) {
      setError('Select an object or reusable component to add a local variable');
      return;
    }
    if (!trimmedName) {
      setError('Please enter a variable name');
      return;
    }
    if (scope === 'global') {
      if (hasVariableNameConflict(getVariablesForTarget(target), trimmedName)) {
        setError('A global variable with this name already exists');
        return;
      }
    } else if (localSelectionTarget && hasVariableNameConflict(getVariablesForLocalSelectionTarget(localSelectionTarget), trimmedName)) {
      setError('A local variable with this name already exists for the current selection');
      return;
    }

    const variable: Variable = {
      id: crypto.randomUUID(),
      name: trimmedName,
      type,
      cardinality,
      defaultValue: getDefaultVariableValue(type, cardinality),
      scope: target.kind === 'global' ? 'global' : 'local',
    };

    switch (target.kind) {
      case 'global':
        addGlobalVariable(variable);
        break;
      case 'component': {
        const component = componentById.get(target.componentId);
        if (!component) {
          setError('Could not find that component');
          return;
        }
        updateComponent(target.componentId, {
          localVariables: [...(component.localVariables || []), { ...variable, scope: 'local' }],
        });
        break;
      }
      case 'object':
        addLocalVariable(target.sceneId, target.objectId, variable);
        break;
    }

    setIsAdding(false);
    resetAddDialog(preferredScope);
    emitVariablesChanged();
  };

  const VariableRow = ({ entry }: { entry: VariableEntry }) => {
    const isEditing = editingKey === entry.key;

    return (
      <ProjectPropertyManagerRow
        icon={(
          <AppIcon
            className="size-4 flex-shrink-0 text-muted-foreground"
            decorative={false}
            name={getTypeIconName(entry.variable.type)}
            title={getTypeLabel(entry.variable.type)}
          />
        )}
        name={entry.variable.name}
        subtitle={`${getVariableKindLabel(entry.variable)}${entry.note ? ` · ${entry.note}` : ''}`}
        isEditing={isEditing}
        editValue={editName}
        onEditValueChange={setEditName}
        onEditSave={() => saveRename(entry)}
        onEditCancel={() => {
          setEditingKey(null);
          setEditName('');
        }}
        onEdit={() => {
          setEditingKey(entry.key);
          setEditName(entry.variable.name);
        }}
        onDelete={() => void handleDelete(entry)}
      />
    );
  };

  return (
    <>
      <ProjectPropertyManagerDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Edit Variables"
        addButtonLabel="+ Add Variable"
        closeAddButtonLabel="Close Add Dialog"
        isAdding={isAdding}
        onToggleAdd={() => {
          if (isAdding) {
            setIsAdding(false);
            setError(null);
            return;
          }

          resetAddDialog(preferredScope);
          setIsAdding(true);
        }}
      >
          <section className="space-y-2">
            <div className="text-sm font-semibold text-muted-foreground">Global Variables</div>
            {globalEntries.length > 0 ? (
              <div className="space-y-1">
                {globalEntries.map((entry) => (
                  <VariableRow key={entry.key} entry={entry} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                No global variables yet.
              </div>
            )}
          </section>

      <section className="space-y-3">
            <div className="text-sm font-semibold text-muted-foreground">Scene Objects</div>
            {sceneGroups.length > 0 ? (
              sceneGroups.map((scene) => (
                <div key={scene.key} className="space-y-3 rounded-lg border p-3">
                  <div className="text-sm font-semibold">{scene.title}</div>
                  <div className="space-y-3">
                    {scene.objects.map((objectGroup) => (
                      <div key={objectGroup.key} className="space-y-1 rounded-lg bg-muted/20 p-2">
                        <div className="px-1">
                          <div className="text-sm font-medium">{objectGroup.title}</div>
                          {objectGroup.subtitle ? (
                            <div className="text-xs text-muted-foreground">{objectGroup.subtitle}</div>
                          ) : null}
                        </div>
                        <div className="space-y-1">
                          {objectGroup.entries.map((entry) => (
                            <VariableRow key={entry.key} entry={entry} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                No scene-grouped object variables yet.
              </div>
            )}
          </section>

      <section className="space-y-3">
            <div className="text-sm font-semibold text-muted-foreground">Reusable Components</div>
            {standaloneComponentGroups.length > 0 ? (
              standaloneComponentGroups.map((component) => (
                <div key={component.key} className="space-y-1 rounded-lg border p-3">
                  <div className="text-sm font-semibold">{component.title}</div>
                  <div className="space-y-1">
                    {component.entries.map((entry) => (
                      <VariableRow key={entry.key} entry={entry} />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                No reusable component variables outside scene objects yet.
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
        title="Add Variable"
        contentClassName="sm:max-w-lg"
        footer={(
          <>
            <Button
              variant="outline"
              onClick={() => {
                setIsAdding(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAdd}>Add Variable</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="variable-name">Variable Name</Label>
            <Input
              id="variable-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              placeholder="Player score"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleAdd();
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Scope</Label>
            <SegmentedControl
              ariaLabel="Variable scope"
              className="w-full"
              layout="fill"
              size="expanded"
              options={VARIABLE_SCOPE_OPTIONS.map((option) => ({
                ...option,
                disabled: option.value === 'local' && !localSelectionTarget,
              }))}
              value={scope}
              onValueChange={(nextValue) => {
                setScope(nextValue as AddVariableScope);
                setError(null);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <SegmentedControl
              ariaLabel="Variable type"
              className="w-full"
              layout="fill"
              size="expanded"
              options={VARIABLE_TYPES}
              value={type}
              onValueChange={(nextValue) => {
                setType(nextValue as VariableType);
                setError(null);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Values</Label>
            <SegmentedControl
              ariaLabel="Variable values"
              className="w-full"
              layout="fill"
              size="expanded"
              options={VARIABLE_CARDINALITIES}
              value={cardinality}
              onValueChange={(nextValue) => {
                setCardinality(nextValue as VariableCardinality);
                setError(null);
              }}
            />
          </div>

          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}
