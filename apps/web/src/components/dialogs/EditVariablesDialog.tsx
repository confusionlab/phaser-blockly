import { useEffect, useMemo, useState } from 'react';
import { DisclosureButton } from '@/components/ui/disclosure-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppIcon, ChevronDown, ChevronRight, Component as ComponentIcon, Earth, type AppIconName } from '@/components/ui/icons';
import { HoverHelp } from '@/components/ui/hover-help';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ShelfObjectThumbnail } from '@/components/stage/ShelfObjectThumbnail';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import {
  getDefaultVariableValue,
  hasVariableNameConflict,
  normalizeVariableCardinality,
  normalizeVariableName,
} from '@/lib/variableUtils';
import type { Costume, Variable, VariableCardinality, VariableType } from '@/types';
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

type LocalHierarchyObjectNode = {
  key: string;
  title: string;
  subtitle?: string | null;
  costumes: Costume[];
  currentCostumeIndex: number;
  entries: VariableEntry[];
};

type LocalHierarchyComponentNode = {
  key: string;
  title: string;
  subtitle?: string | null;
  entries: VariableEntry[];
  objects: LocalHierarchyObjectNode[];
};

type LocalHierarchySceneNode = {
  key: string;
  title: string;
  subtitle?: string | null;
  objects: LocalHierarchyObjectNode[];
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
  className,
}: {
  label: string;
  helpText: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3 px-3 py-2 ${className ?? ''}`}>
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {children}
        <HoverHelp
          label={`${label} help`}
          panelClassName="max-w-[18rem]"
          triggerClassName="h-7 w-7 p-0"
        >
          {helpText}
        </HoverHelp>
      </div>
    </div>
  );
}

function LocalHierarchyBranch({
  title,
  subtitle,
  icon,
  isExpanded,
  level = 0,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string | null;
  icon: React.ReactNode;
  isExpanded: boolean;
  level?: number;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/40"
        style={{ paddingLeft: level * 16 }}
      >
        <DisclosureButton
          aria-expanded={isExpanded}
          aria-label={`Toggle ${title}`}
          className="opacity-100"
          onClick={onToggle}
        >
          {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </DisclosureButton>
        <div className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40 text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{title}</div>
          {subtitle ? (
            <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
      </div>
      {isExpanded ? children : null}
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
  const [expandedLocalKeys, setExpandedLocalKeys] = useState<Set<string>>(new Set());

  const components = useMemo(() => project?.components || [], [project?.components]);
  const scenes = useMemo(() => project?.scenes || [], [project?.scenes]);

  const componentById = useMemo(
    () => new Map(components.map((component) => [component.id, component])),
    [components],
  );

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

  const componentHierarchy = useMemo<LocalHierarchyComponentNode[]>(() => {
    const groups: LocalHierarchyComponentNode[] = [];

    for (const component of components) {
      const componentVariables = component.localVariables || [];
      if (componentVariables.length === 0) {
        continue;
      }

      const instanceObjects: LocalHierarchyObjectNode[] = [];
      for (const scene of scenes) {
        for (const object of scene.objects) {
          if (object.componentId !== component.id) {
            continue;
          }

          instanceObjects.push({
            key: `component:${component.id}:object:${scene.id}:${object.id}`,
            title: object.name,
            subtitle: scene.name,
            entries: componentVariables.map((variable) => ({
              key: `component:${component.id}:object:${scene.id}:${object.id}:variable:${variable.id}`,
              variable,
              target: { kind: 'component', componentId: component.id },
            })),
            costumes: object.costumes || [],
            currentCostumeIndex: object.currentCostumeIndex ?? 0,
          });
        }
      }

      groups.push({
        key: `component:${component.id}`,
        title: component.name,
        subtitle: instanceObjects.length > 0
          ? `${instanceObjects.length} linked ${instanceObjects.length === 1 ? 'object' : 'objects'}`
          : 'Reusable component',
        entries: instanceObjects.length === 0
          ? componentVariables.map((variable) => ({
              key: `component:${component.id}:variable:${variable.id}`,
              variable,
              target: { kind: 'component', componentId: component.id },
            }))
          : [],
        objects: instanceObjects,
      });
    }

    return groups;
  }, [components, scenes]);

  const sceneHierarchy = useMemo<LocalHierarchySceneNode[]>(() => {
    const groups: LocalHierarchySceneNode[] = [];

    for (const scene of scenes) {
      const objects: LocalHierarchyObjectNode[] = [];

      for (const object of scene.objects) {
        if (object.componentId) {
          continue;
        }

        const objectVariables = object.localVariables || [];
        if (objectVariables.length === 0) {
          continue;
        }

        objects.push({
          key: `scene:${scene.id}:object:${object.id}`,
          title: object.name,
          costumes: object.costumes || [],
          currentCostumeIndex: object.currentCostumeIndex ?? 0,
          entries: objectVariables.map((variable) => ({
            key: `scene:${scene.id}:object:${object.id}:variable:${variable.id}`,
            variable,
            target: { kind: 'object', sceneId: scene.id, objectId: object.id },
          })),
        });
      }

      if (objects.length === 0) {
        continue;
      }

      groups.push({
        key: `scene:${scene.id}`,
        title: scene.name,
        objects,
      });
    }

    return groups;
  }, [scenes]);

  const defaultExpandedLocalKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const component of componentHierarchy) {
      keys.add(component.key);
      for (const object of component.objects) {
        keys.add(object.key);
      }
    }
    for (const scene of sceneHierarchy) {
      keys.add(scene.key);
      for (const object of scene.objects) {
        keys.add(object.key);
      }
    }
    return keys;
  }, [componentHierarchy, sceneHierarchy]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setExpandedLocalKeys(new Set(defaultExpandedLocalKeys));
  }, [defaultExpandedLocalKeys, open]);

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
        nameMeta={getVariableKindLabel(entry.variable)}
        subtitle={entry.note}
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

  const toggleExpandedLocalKey = (key: string) => {
    setExpandedLocalKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
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
            {componentHierarchy.length > 0 || sceneHierarchy.length > 0 ? (
              <div className="space-y-2">
                {componentHierarchy.map((component) => (
                  <LocalHierarchyBranch
                    key={component.key}
                    icon={<ComponentIcon className="size-3.5" />}
                    isExpanded={expandedLocalKeys.has(component.key)}
                    onToggle={() => toggleExpandedLocalKey(component.key)}
                    subtitle={component.subtitle}
                    title={component.title}
                  >
                    <div className="space-y-1">
                      {component.objects.map((object) => (
                        <LocalHierarchyBranch
                          key={object.key}
                          icon={(
                            <ShelfObjectThumbnail
                              currentCostumeIndex={object.currentCostumeIndex}
                              costumes={object.costumes}
                              name={object.title}
                            />
                          )}
                          isExpanded={expandedLocalKeys.has(object.key)}
                          level={1}
                          onToggle={() => toggleExpandedLocalKey(object.key)}
                          subtitle={object.subtitle}
                          title={object.title}
                        >
                          <div className="space-y-1" style={{ paddingLeft: 32 }}>
                            {object.entries.map((entry) => (
                              <VariableRow key={entry.key} entry={entry} />
                            ))}
                          </div>
                        </LocalHierarchyBranch>
                      ))}
                      {component.entries.length > 0 ? (
                        <div className="space-y-1" style={{ paddingLeft: 32 }}>
                          {component.entries.map((entry) => (
                            <VariableRow key={entry.key} entry={entry} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </LocalHierarchyBranch>
                ))}

                {sceneHierarchy.map((scene) => (
                  <LocalHierarchyBranch
                    key={scene.key}
                    icon={<Earth className="size-3.5" />}
                    isExpanded={expandedLocalKeys.has(scene.key)}
                    onToggle={() => toggleExpandedLocalKey(scene.key)}
                    subtitle={scene.subtitle}
                    title={scene.title}
                  >
                    <div className="space-y-1">
                      {scene.objects.map((object) => (
                        <LocalHierarchyBranch
                          key={object.key}
                          icon={(
                            <ShelfObjectThumbnail
                              currentCostumeIndex={object.currentCostumeIndex}
                              costumes={object.costumes}
                              name={object.title}
                            />
                          )}
                          isExpanded={expandedLocalKeys.has(object.key)}
                          level={1}
                          onToggle={() => toggleExpandedLocalKey(object.key)}
                          subtitle={object.subtitle}
                          title={object.title}
                        >
                          <div className="space-y-1" style={{ paddingLeft: 32 }}>
                            {object.entries.map((entry) => (
                              <VariableRow key={entry.key} entry={entry} />
                            ))}
                          </div>
                        </LocalHierarchyBranch>
                      ))}
                    </div>
                  </LocalHierarchyBranch>
                ))}
              </div>
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
            <Label htmlFor="variable-name">Name</Label>
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

          <div className="w-full overflow-visible rounded-lg border border-border/70 bg-muted/20">
            <VariableOptionRow label="Type" helpText={VARIABLE_FIELD_HELP.type}>
              <SegmentedControl
                ariaLabel="Variable type"
                className="min-w-0 flex-1"
                layout="fill"
                options={VARIABLE_TYPES}
                value={type}
                onValueChange={(nextValue) => {
                  setType(nextValue as VariableType);
                  setError(null);
                }}
              />
            </VariableOptionRow>

            <VariableOptionRow
              label="Scope"
              helpText={VARIABLE_FIELD_HELP.scope}
              className="border-t border-border/70"
            >
              <SegmentedControl
                ariaLabel="Variable scope"
                className="min-w-0 flex-1"
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

            <VariableOptionRow
              label="Structure"
              helpText={VARIABLE_FIELD_HELP.values}
              className="border-t border-border/70"
            >
              <SegmentedControl
                ariaLabel="Variable values"
                className="min-w-0 flex-1"
                layout="fill"
                options={VARIABLE_CARDINALITIES}
                value={cardinality}
                onValueChange={(nextValue) => {
                  setCardinality(nextValue as VariableCardinality);
                  setError(null);
                }}
              />
            </VariableOptionRow>
          </div>

          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}
