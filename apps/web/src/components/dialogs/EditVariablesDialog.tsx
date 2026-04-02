import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
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
type VariableListTab = 'global' | 'local';

type LocalSelectionTarget =
  | { kind: 'component'; componentId: string }
  | { kind: 'object'; sceneId: string; objectId: string; backingComponentId?: string };

type VariableEntry = {
  key: string;
  variable: Variable;
  target: VariableTarget;
  note?: string;
};

type LocalVariableGroup = {
  key: string;
  title: string;
  subtitle?: string | null;
  entries: VariableEntry[];
};

const VARIABLE_SCOPE_OPTIONS: { value: AddVariableScope; label: string }[] = [
  { value: 'global', label: 'Global' },
  { value: 'local', label: 'Local' },
];

const VARIABLE_LIST_TABS: { value: VariableListTab; label: string }[] = [
  { value: 'global', label: 'Global' },
  { value: 'local', label: 'Local' },
];

const VARIABLE_TYPES: { value: VariableType; label: string }[] = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
];
const VARIABLE_CARDINALITIES: { value: VariableCardinality; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'array', label: 'Multiple' },
];

const VARIABLE_FIELD_HELP = {
  scope: 'Global variables are available everywhere. Local variables belong to the current object or reusable component selection.',
  type: 'Choose what kind of data the variable stores: text, number, or true/false.',
  values: 'Single stores one value. Multiple stores a list of values in order.',
} as const;

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

function VariableOptionRow({
  label,
  helpText,
  children,
}: {
  label: string;
  helpText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        {children}
        <IconButton
          className="text-muted-foreground"
          label={`${label} help`}
          shape="pill"
          size="xs"
          title={helpText}
          variant="ghost"
        >
          <span className="text-[11px] font-semibold">?</span>
        </IconButton>
      </div>
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<VariableListTab>('global');
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
    setActiveTab(preferredScope);
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

  const localGroups = useMemo<LocalVariableGroup[]>(() => {
    const groups: LocalVariableGroup[] = [];

    for (const scene of scenes) {
      for (const object of scene.objects) {
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
          continue;
        }

        groups.push({
          key: `scene:${scene.id}:object:${object.id}`,
          title: object.name,
          subtitle: usesComponentVariables && component
            ? `${scene.name} · Uses component ${component.name}`
            : scene.name,
          entries,
        });
      }
    }

    for (const component of components) {
      if (referencedComponentIds.has(component.id)) {
        continue;
      }

      const entries: VariableEntry[] = (component.localVariables || []).map((variable) => ({
        key: `component:${component.id}:${variable.id}`,
        variable,
        target: { kind: 'component', componentId: component.id },
      }));

      if (entries.length === 0) {
        continue;
      }

      groups.push({
        key: `component:${component.id}`,
        title: component.name,
        subtitle: 'Reusable component',
        entries,
      });
    }

    return groups;
  }, [componentById, components, referencedComponentIds, scenes]);

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
    resetAddDialog(activeTab === 'local' && localSelectionTarget ? 'local' : 'global');
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
        title="Variables"
        addButtonLabel="Add variable"
        onAdd={() => {
          resetAddDialog(activeTab === 'local' && localSelectionTarget ? 'local' : 'global');
          setIsAdding(true);
        }}
        toolbar={(
          <SegmentedControl
            ariaLabel="Variable manager tabs"
            className="max-w-full"
            layout="content"
            options={VARIABLE_LIST_TABS}
            value={activeTab}
            onValueChange={setActiveTab}
          />
        )}
      >
        {activeTab === 'global' ? (
          <section className="space-y-2">
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
        ) : (
          <section className="space-y-3">
            {localGroups.length > 0 ? (
              localGroups.map((group) => (
                <div key={group.key} className="space-y-1 rounded-lg border p-3">
                  <div className="px-1 pb-1">
                    <div className="text-sm font-semibold">{group.title}</div>
                    {group.subtitle ? (
                      <div className="text-xs text-muted-foreground">{group.subtitle}</div>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    {group.entries.map((entry) => (
                      <VariableRow key={entry.key} entry={entry} />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                No local variables yet.
              </div>
            )}
          </section>
        )}
      </ProjectPropertyManagerDialog>
      <Modal
        open={isAdding}
        onOpenChange={(nextOpen) => {
          setIsAdding(nextOpen);
          if (!nextOpen) {
            setError(null);
          }
        }}
        title="Create Variable"
        contentClassName="sm:max-w-lg"
        footer={(
          <Button onClick={handleAdd}>Create Variable</Button>
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

          <VariableOptionRow label="Scope" helpText={VARIABLE_FIELD_HELP.scope}>
            <SegmentedControl
              ariaLabel="Variable scope"
              className="w-[240px]"
              layout="fill"
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
          </VariableOptionRow>

          <VariableOptionRow label="Type" helpText={VARIABLE_FIELD_HELP.type}>
            <SegmentedControl
              ariaLabel="Variable type"
              className="w-[280px]"
              layout="fill"
              options={VARIABLE_TYPES}
              value={type}
              onValueChange={(nextValue) => {
                setType(nextValue as VariableType);
                setError(null);
              }}
            />
          </VariableOptionRow>

          <VariableOptionRow label="Values" helpText={VARIABLE_FIELD_HELP.values}>
            <SegmentedControl
              ariaLabel="Variable values"
              className="w-[240px]"
              layout="fill"
              options={VARIABLE_CARDINALITIES}
              value={cardinality}
              onValueChange={(nextValue) => {
                setCardinality(nextValue as VariableCardinality);
                setError(null);
              }}
            />
          </VariableOptionRow>

          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}
