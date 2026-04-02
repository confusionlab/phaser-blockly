import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AppIcon, type AppIconName } from '@/components/ui/icons';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { hasVariableNameConflict, normalizeVariableName } from '@/lib/variableUtils';
import type { Variable, VariableType } from '@/types';
import { useModal } from '@/components/ui/modal-provider';
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

type AddTargetOption = {
  value: string;
  label: string;
  target: VariableTarget;
  group: 'project' | 'components' | 'scenes';
};

type VariableEntry = {
  key: string;
  variable: Variable;
  target: VariableTarget;
  note?: string;
};

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
    case 'float': return 0;
    case 'boolean': return false;
  }
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
  const [type, setType] = useState<VariableType>('integer');
  const [targetValue, setTargetValue] = useState('global');
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

  const addTargetOptions = useMemo<AddTargetOption[]>(() => {
    const options: AddTargetOption[] = [
      {
        value: 'global',
        label: 'Project / Global variables',
        target: { kind: 'global' },
        group: 'project',
      },
    ];

    for (const component of components) {
      options.push({
        value: `component:${component.id}`,
        label: `Component / ${component.name}`,
        target: { kind: 'component', componentId: component.id },
        group: 'components',
      });
    }

    for (const scene of scenes) {
      for (const object of scene.objects) {
        const component = object.componentId ? componentById.get(object.componentId) : null;
        options.push({
          value: `scene:${scene.id}:object:${object.id}`,
          label: component
            ? `Scene / ${scene.name} / ${object.name} (via ${component.name})`
            : `Scene / ${scene.name} / ${object.name}`,
          target: component
            ? { kind: 'component', componentId: component.id }
            : { kind: 'object', sceneId: scene.id, objectId: object.id },
          group: 'scenes',
        });
      }
    }

    return options;
  }, [componentById, components, scenes]);

  const addTargetByValue = useMemo(
    () => new Map(addTargetOptions.map((option) => [option.value, option])),
    [addTargetOptions],
  );

  const preferredTargetValue = useMemo(() => {
    if (selectedSceneId && selectedObjectId) {
      const scene = scenes.find((sceneItem) => sceneItem.id === selectedSceneId);
      const object = scene?.objects.find((objectItem) => objectItem.id === selectedObjectId);
      if (object) {
        return `scene:${selectedSceneId}:object:${selectedObjectId}`;
      }
    }
    if (selectedComponentId) {
      return `component:${selectedComponentId}`;
    }
    return 'global';
  }, [scenes, selectedComponentId, selectedObjectId, selectedSceneId]);

  useEffect(() => {
    if (!open) return;
    setIsAdding(false);
    setName('');
    setType('integer');
    setError(null);
    setEditingKey(null);
    setEditName('');
    setTargetValue(addTargetByValue.has(preferredTargetValue) ? preferredTargetValue : 'global');
  }, [addTargetByValue, open, preferredTargetValue]);

  useEffect(() => {
    if (!addTargetByValue.has(targetValue)) {
      setTargetValue(addTargetByValue.has(preferredTargetValue) ? preferredTargetValue : 'global');
    }
  }, [addTargetByValue, preferredTargetValue, targetValue]);

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
              note: usesComponentVariables && component ? `Via component ${component.name}` : undefined,
            }));

            if (entries.length === 0) {
              return null;
            }

            return {
              key: `scene:${scene.id}:object:${object.id}`,
              title: object.name,
              subtitle: usesComponentVariables && component ? `Using ${component.name} component variables` : null,
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
    const option = addTargetByValue.get(targetValue);
    const trimmedName = normalizeVariableName(name);

    if (!option) {
      setError('Please choose where to add the variable');
      return;
    }
    if (!trimmedName) {
      setError('Please enter a variable name');
      return;
    }
    if (hasVariableNameConflict(getVariablesForTarget(option.target), trimmedName)) {
      setError('A variable with this name already exists in that location');
      return;
    }

    const variable: Variable = {
      id: crypto.randomUUID(),
      name: trimmedName,
      type,
      defaultValue: getDefaultValue(type),
      scope: option.target.kind === 'global' ? 'global' : 'local',
    };

    switch (option.target.kind) {
      case 'global':
        addGlobalVariable(variable);
        break;
      case 'component': {
        const component = componentById.get(option.target.componentId);
        if (!component) {
          setError('Could not find that component');
          return;
        }
        updateComponent(option.target.componentId, {
          localVariables: [...(component.localVariables || []), { ...variable, scope: 'local' }],
        });
        break;
      }
      case 'object':
        addLocalVariable(option.target.sceneId, option.target.objectId, variable);
        break;
    }

    setName('');
    setType('integer');
    setError(null);
    setIsAdding(false);
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
        subtitle={`${getTypeLabel(entry.variable.type)}${entry.note ? ` · ${entry.note}` : ''}`}
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
    <ProjectPropertyManagerDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Variables"
      description="Manage variables across the whole project."
      addButtonLabel="+ Add Variable"
      isAdding={isAdding}
      onToggleAdd={() => {
        setIsAdding((current) => !current);
        setError(null);
      }}
      addForm={(
        <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
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
              />
            </div>

            <div className="space-y-2">
              <Label>Where</Label>
              <Select value={targetValue} onValueChange={setTargetValue}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose where this variable belongs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Project</SelectLabel>
                    {addTargetOptions
                      .filter((option) => option.group === 'project')
                      .map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Components</SelectLabel>
                    {addTargetOptions
                      .filter((option) => option.group === 'components')
                      .map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Scene Objects</SelectLabel>
                    {addTargetOptions
                      .filter((option) => option.group === 'scenes')
                      .map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <div className="flex flex-col gap-2">
                {VARIABLE_TYPES.map((option) => (
                  <Button
                    key={option.value}
                    variant={type === option.value ? 'default' : 'outline'}
                    className="h-auto w-full flex-col items-start py-2"
                    onClick={() => setType(option.value)}
                  >
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs opacity-70">{option.description}</span>
                  </Button>
                ))}
              </div>
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
              <Button onClick={handleAdd}>Add Variable</Button>
            </div>
          </div>
      )}
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
            <div className="text-sm font-semibold text-muted-foreground">Scenes</div>
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
                No scene-level or object-level variables yet.
              </div>
            )}
          </section>

      <section className="space-y-3">
            <div className="text-sm font-semibold text-muted-foreground">Standalone Components</div>
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
                No standalone component variables yet.
              </div>
            )}
      </section>
    </ProjectPropertyManagerDialog>
  );
}
