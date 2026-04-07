import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { DisclosureButton } from '@/components/ui/disclosure-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppIcon, ChevronDown, ChevronRight, Component as ComponentIcon, Earth, Pencil, Plus, Trash2, type AppIconName } from '@/components/ui/icons';
import { HoverHelp } from '@/components/ui/hover-help';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShelfObjectThumbnail } from '@/components/stage/ShelfObjectThumbnail';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import {
  coerceDefaultValue,
  getDefaultVariableValue,
  hasVariableNameConflict,
  normalizeVariableCardinality,
  normalizeVariableName,
} from '@/lib/variableUtils';
import type { Costume, Variable, VariableCardinality, VariableType } from '@/types';
import { useModal } from '@/components/ui/modal-provider';
import { Modal } from '@/components/ui/modal';
import {
  ProjectPropertyManagerContextMenu,
  type ProjectPropertyManagerContextMenuAction,
  ProjectPropertyManagerDialog,
  useProjectPropertyManagerContextMenu,
} from '@/components/dialogs/ProjectPropertyManagerDialog';
import { ReferenceUsageDialog } from '@/components/dialogs/ReferenceUsageDialog';
import type { ProjectReferenceImpact, ProjectReferenceOwnerTarget } from '@/lib/projectReferenceUsage';

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
};

type VariableDefaultDraft =
  | { type: 'number'; cardinality: 'single'; value: string }
  | { type: 'string'; cardinality: 'single'; value: string }
  | { type: 'boolean'; cardinality: 'single'; value: boolean }
  | { type: 'number'; cardinality: 'array'; items: string[] }
  | { type: 'string'; cardinality: 'array'; items: string[] }
  | { type: 'boolean'; cardinality: 'array'; items: boolean[] };

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
  { value: 'local', label: 'Local' },
  { value: 'global', label: 'Global' },
];

const VARIABLE_LIST_TABS: { value: VariableListTab; label: string }[] = [
  { value: 'global', label: 'Global' },
  { value: 'local', label: 'Local' },
];

const VARIABLE_TYPES: { value: VariableType; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'string', label: 'Text' },
  { value: 'boolean', label: 'Boolean' },
];
const VARIABLE_CARDINALITIES: { value: VariableCardinality; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'array', label: 'Multiple' },
];
const VARIABLE_KIND_OPTIONS: ReadonlyArray<{
  value: `${VariableType}:${VariableCardinality}`;
  label: string;
  type: VariableType;
  cardinality: VariableCardinality;
}> = [
  { value: 'number:single', label: 'Number', type: 'number', cardinality: 'single' },
  { value: 'string:single', label: 'Text', type: 'string', cardinality: 'single' },
  { value: 'boolean:single', label: 'Boolean', type: 'boolean', cardinality: 'single' },
  { value: 'number:array', label: 'Number Array', type: 'number', cardinality: 'array' },
  { value: 'string:array', label: 'Text Array', type: 'string', cardinality: 'array' },
  { value: 'boolean:array', label: 'Boolean Array', type: 'boolean', cardinality: 'array' },
] as const;

const VARIABLE_FIELD_HELP = {
  scope: 'Global variables are available everywhere. Local variables belong to the current object or reusable component selection.',
  type: 'Choose what kind of data the variable stores: text, number, or true/false.',
  values: 'Single stores one value. Multiple stores a list of values in order.',
  startValue: 'This is the value the game starts with before any blocks change it.',
} as const;

const LOCAL_HIERARCHY_INDENT_PX = 20;
const LOCAL_HIERARCHY_ENTRY_INDENT_PX = LOCAL_HIERARCHY_INDENT_PX * 3;

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

function createVariableDefaultDraft(
  type: VariableType,
  cardinality: VariableCardinality,
  sourceValue: Variable['defaultValue'] = getDefaultVariableValue(type, cardinality),
): VariableDefaultDraft {
  const normalizedValue = coerceDefaultValue(type, cardinality, sourceValue);

  if (cardinality === 'array') {
    const items = Array.isArray(normalizedValue) ? normalizedValue : [];
    switch (type) {
      case 'number':
        return { type, cardinality, items: items.map((item) => String(item)) };
      case 'string':
        return { type, cardinality, items: items.map((item) => String(item)) };
      case 'boolean':
        return { type, cardinality, items: items.map((item) => Boolean(item)) };
    }
  }

  switch (type) {
    case 'number':
      return { type, cardinality: 'single', value: String(normalizedValue) };
    case 'string':
      return { type, cardinality: 'single', value: String(normalizedValue) };
    case 'boolean':
      return { type, cardinality: 'single', value: Boolean(normalizedValue) };
  }
}

function materializeVariableDefaultDraft(draft: VariableDefaultDraft): Variable['defaultValue'] {
  if (draft.cardinality === 'array') {
    return coerceDefaultValue(draft.type, draft.cardinality, draft.items);
  }
  return coerceDefaultValue(draft.type, draft.cardinality, draft.value);
}

function createArrayDraftItem(type: VariableType): string | boolean {
  switch (type) {
    case 'number':
      return '0';
    case 'string':
      return '';
    case 'boolean':
      return false;
  }
}

function getVariableKindValue(
  type: VariableType,
  cardinality: VariableCardinality,
): `${VariableType}:${VariableCardinality}` {
  return `${type}:${cardinality}`;
}

function parseVariableKindValue(value: string): {
  type: VariableType;
  cardinality: VariableCardinality;
} | null {
  const matched = VARIABLE_KIND_OPTIONS.find((option) => option.value === value);
  return matched ? { type: matched.type, cardinality: matched.cardinality } : null;
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

function VariableDefaultEditor({
  draft,
  onChange,
  onCommit,
  inputIdPrefix,
}: {
  draft: VariableDefaultDraft;
  onChange: (draft: VariableDefaultDraft) => void;
  onCommit?: (draft: VariableDefaultDraft) => void;
  inputIdPrefix: string;
}) {
  if (draft.cardinality === 'single') {
    if (draft.type === 'boolean') {
      const checkboxId = `${inputIdPrefix}-boolean`;
      return (
        <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/80 px-3 py-2">
          <Checkbox
            checked={draft.value}
            id={checkboxId}
            onCheckedChange={(checked) => {
              const nextDraft = { ...draft, value: checked === true };
              onChange(nextDraft);
              onCommit?.(nextDraft);
            }}
          />
          <Label className="cursor-pointer text-sm text-foreground" htmlFor={checkboxId}>
            Start as true
          </Label>
        </div>
      );
    }

    return (
      <Input
        id={`${inputIdPrefix}-single`}
        type={draft.type === 'number' ? 'number' : 'text'}
        value={draft.value}
        onChange={(event) => {
          onChange({ ...draft, value: event.target.value });
        }}
        onBlur={() => {
          onCommit?.(draft);
        }}
        placeholder={draft.type === 'number' ? '0' : 'Enter text'}
      />
    );
  }

  if (draft.type === 'boolean') {
    return (
      <div className="space-y-3">
        {draft.items.length > 0 ? (
          <div className="space-y-2">
            {draft.items.map((item, index) => {
              const itemId = `${inputIdPrefix}-item-${index}`;
              return (
                <div
                  key={itemId}
                  className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/80 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={item}
                        id={itemId}
                        onCheckedChange={(checked) => {
                          const nextItems = [...draft.items];
                          nextItems[index] = checked === true;
                          const nextDraft = { ...draft, items: nextItems };
                          onChange(nextDraft);
                          onCommit?.(nextDraft);
                        }}
                      />
                      <Label className="cursor-pointer text-sm text-foreground" htmlFor={itemId}>
                        Item {index + 1} is true
                      </Label>
                    </div>
                  </div>
                  <Button
                    aria-label={`Remove item ${index + 1}`}
                    className="shrink-0"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      const nextDraft = {
                        ...draft,
                        items: draft.items.filter((_, itemIndex) => itemIndex !== index),
                      };
                      onChange(nextDraft);
                      onCommit?.(nextDraft);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            No items yet.
          </div>
        )}

        <Button
          aria-label="Add item"
          className="self-start"
          size="icon-sm"
          variant="outline"
          onClick={() => {
            const nextDraft = {
              ...draft,
              items: [...draft.items, false],
            };
            onChange(nextDraft);
            onCommit?.(nextDraft);
          }}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {draft.items.length > 0 ? (
        <div className="space-y-2">
          {draft.items.map((item, index) => {
            const itemId = `${inputIdPrefix}-item-${index}`;
            return (
              <div
                key={itemId}
                className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/80 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <Input
                    id={itemId}
                    type={draft.type === 'number' ? 'number' : 'text'}
                    value={item}
                    onChange={(event) => {
                      const nextItems = [...draft.items];
                      nextItems[index] = event.target.value;
                      onChange({ ...draft, items: nextItems });
                    }}
                    onBlur={() => {
                      onCommit?.(draft);
                    }}
                    placeholder={draft.type === 'number' ? '0' : `Item ${index + 1}`}
                  />
                </div>
                <Button
                  aria-label={`Remove item ${index + 1}`}
                  className="shrink-0"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    const nextDraft = {
                      ...draft,
                      items: draft.items.filter((_, itemIndex) => itemIndex !== index),
                    };
                    onChange(nextDraft);
                    onCommit?.(nextDraft);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
          <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            No items yet.
          </div>
        )}

      <Button
        aria-label="Add item"
        className="self-start"
        size="icon-sm"
        variant="outline"
        onClick={() => {
          const nextDraft = {
            ...draft,
            items: [...draft.items, String(createArrayDraftItem(draft.type))],
          };
          onChange(nextDraft);
          onCommit?.(nextDraft);
        }}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}

function VariableDefaultField({
  draft,
  onChange,
  inputIdPrefix,
}: {
  draft: VariableDefaultDraft;
  onChange: (draft: VariableDefaultDraft) => void;
  inputIdPrefix: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">Starts with</div>
          <p className="text-xs text-muted-foreground">
            {VARIABLE_FIELD_HELP.startValue}
          </p>
        </div>
        <HoverHelp
          label="Startup value help"
          panelClassName="max-w-[18rem]"
          triggerClassName="h-7 w-7 p-0"
        >
          {VARIABLE_FIELD_HELP.startValue}
        </HoverHelp>
      </div>
      <VariableDefaultEditor
        draft={draft}
        inputIdPrefix={inputIdPrefix}
        onChange={onChange}
      />
    </div>
  );
}

function VariableGridHeader() {
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_180px_minmax(0,2.2fr)] items-center gap-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
      <div>Name</div>
      <div>Type</div>
      <div>Default</div>
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
  const toggleLabel = `Toggle ${title}`;

  return (
    <div className="space-y-1">
      <div
        aria-expanded={isExpanded}
        aria-label={toggleLabel}
        className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        role="button"
        style={level > 0 ? { marginLeft: level * LOCAL_HIERARCHY_INDENT_PX } : undefined}
        tabIndex={0}
      >
        <DisclosureButton
          aria-expanded={isExpanded}
          aria-label={toggleLabel}
          className="opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
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
    getVariableDeletionImpact,
    removeGlobalVariable,
    removeComponentLocalVariable,
    updateGlobalVariable,
    addLocalVariable,
    removeLocalVariable,
    updateLocalVariable,
    updateComponent,
  } = useProjectStore();
  const { selectedSceneId, selectedObjectId, selectedComponentId, focusCodeOwner } = useEditorStore();
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
  const [defaultDraft, setDefaultDraft] = useState<VariableDefaultDraft>(
    () => createVariableDefaultDraft('number', 'single'),
  );
  const [expandedLocalKeys, setExpandedLocalKeys] = useState<Set<string>>(new Set());
  const [blockedDelete, setBlockedDelete] = useState<{ entityLabel: string; impact: ProjectReferenceImpact } | null>(null);

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
    setDefaultDraft(createVariableDefaultDraft('number', 'single'));
    setError(null);
    setScope(nextScope);
  };

  useEffect(() => {
    if (!open) return;
    setIsAdding(false);
    setEditingKey(null);
    setEditName('');
    setActiveTab(preferredScope);
    setBlockedDelete(null);
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

  const canCreateVariable = normalizeVariableName(name).length > 0;

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
    const impact = getVariableDeletionImpact(entry.variable.id);
    if (impact && impact.referenceCount > 0) {
      setBlockedDelete({ entityLabel: entry.variable.name, impact });
      return;
    }

    const confirmed = await showConfirm({
      title: 'Delete Variable',
      description: 'Delete this variable?',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!confirmed) return;

    let deleted = false;
    let deleteImpact: ProjectReferenceImpact | null = null;
    switch (entry.target.kind) {
      case 'global':
        ({ deleted, impact: deleteImpact } = removeGlobalVariable(entry.variable.id));
        break;
      case 'component':
        ({ deleted, impact: deleteImpact } = removeComponentLocalVariable(entry.target.componentId, entry.variable.id));
        break;
      case 'object':
        ({ deleted, impact: deleteImpact } = removeLocalVariable(entry.target.sceneId, entry.target.objectId, entry.variable.id));
        break;
    }

    if (!deleted) {
      if (deleteImpact && deleteImpact.referenceCount > 0) {
        setBlockedDelete({ entityLabel: entry.variable.name, impact: deleteImpact });
      }
      return;
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

  const applyVariableUpdates = (entry: VariableEntry, updates: Partial<Variable>) => {
    switch (entry.target.kind) {
      case 'global':
        updateGlobalVariable(entry.variable.id, updates);
        break;
      case 'component': {
        const component = componentById.get(entry.target.componentId);
        if (!component) return;
        updateComponent(entry.target.componentId, {
          localVariables: (component.localVariables || []).map((variable) =>
            variable.id === entry.variable.id ? { ...variable, ...updates } : variable,
          ),
        });
        break;
      }
      case 'object':
        updateLocalVariable(entry.target.sceneId, entry.target.objectId, entry.variable.id, updates);
        break;
    }
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
      defaultValue: materializeVariableDefaultDraft(defaultDraft),
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
    const {
      contextMenuPosition,
      contextMenuRef,
      openContextMenuAt,
      closeContextMenu,
    } = useProjectPropertyManagerContextMenu();
    const [inlineDefaultDraft, setInlineDefaultDraft] = useState<VariableDefaultDraft>(() =>
      createVariableDefaultDraft(
        entry.variable.type,
        normalizeVariableCardinality(entry.variable.cardinality),
        entry.variable.defaultValue,
      ),
    );

    useEffect(() => {
      setInlineDefaultDraft(
        createVariableDefaultDraft(
          entry.variable.type,
          normalizeVariableCardinality(entry.variable.cardinality),
          entry.variable.defaultValue,
        ),
      );
    }, [entry.variable.cardinality, entry.variable.defaultValue, entry.variable.type]);

    const variableKindValue = getVariableKindValue(
      entry.variable.type,
      normalizeVariableCardinality(entry.variable.cardinality),
    );
    const beginRename = () => {
      closeContextMenu();
      setEditingKey(entry.key);
      setEditName(entry.variable.name);
    };
    const contextMenuActions: ProjectPropertyManagerContextMenuAction[] = [
      {
        key: 'rename',
        label: 'Rename Variable',
        icon: <Pencil className="size-4" />,
        onSelect: beginRename,
      },
      {
        key: 'delete',
        label: 'Delete Variable',
        icon: <Trash2 className="size-4" />,
        intent: 'destructive',
        onSelect: () => void handleDelete(entry),
      },
    ];
    const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
      if (isEditing) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openContextMenuAt({ left: event.clientX, top: event.clientY });
    };

    return (
      <>
        <div
          data-property-manager-row="true"
          className="grid grid-cols-[minmax(0,1.6fr)_180px_minmax(0,2.2fr)] items-start gap-3 rounded-lg border border-border/60 bg-background/70 px-3 py-3 transition-colors hover:bg-accent/70"
          onContextMenu={handleContextMenu}
          onDoubleClick={(event) => {
            if (isEditing) {
              return;
            }
            const target = event.target as HTMLElement | null;
            if (target?.closest('button, input, textarea, a')) {
              return;
            }
            event.preventDefault();
            beginRename();
          }}
        >
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <AppIcon
                className="size-4 flex-shrink-0 text-muted-foreground"
                decorative={false}
                name={getTypeIconName(entry.variable.type)}
                title={getTypeLabel(entry.variable.type)}
              />
              {isEditing ? (
                <Input
                  aria-label={`Rename ${entry.variable.name}`}
                  autoFocus
                  className="h-8"
                  value={editName}
                  onBlur={() => saveRename(entry)}
                  onChange={(event) => setEditName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      saveRename(entry);
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setEditingKey(null);
                      setEditName('');
                    }
                  }}
                />
              ) : (
                <div className="min-w-0 truncate text-sm font-medium text-foreground">
                  {entry.variable.name}
                </div>
              )}
            </div>
          </div>

          <Select
            value={variableKindValue}
            onValueChange={(value) => {
              const nextKind = parseVariableKindValue(value);
              if (!nextKind) return;
              const nextDraft = createVariableDefaultDraft(
                nextKind.type,
                nextKind.cardinality,
                materializeVariableDefaultDraft(inlineDefaultDraft),
              );
              setInlineDefaultDraft(nextDraft);
              applyVariableUpdates(entry, {
                type: nextKind.type,
                cardinality: nextKind.cardinality,
                defaultValue: materializeVariableDefaultDraft(nextDraft),
              });
            }}
          >
            <SelectTrigger className="h-9 w-full bg-muted/40 shadow-none focus-visible:ring-2" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VARIABLE_KIND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="min-w-0 rounded-md bg-muted/30 px-2 py-2">
            <VariableDefaultEditor
              draft={inlineDefaultDraft}
              inputIdPrefix={`variable-${entry.variable.id}`}
              onChange={setInlineDefaultDraft}
              onCommit={(nextDraft) => {
                setInlineDefaultDraft(nextDraft);
                applyVariableUpdates(entry, { defaultValue: materializeVariableDefaultDraft(nextDraft) });
              }}
            />
          </div>
        </div>
        <ProjectPropertyManagerContextMenu
          actions={contextMenuActions}
          contextMenuPosition={contextMenuPosition}
          contextMenuRef={contextMenuRef}
          onClose={closeContextMenu}
        />
      </>
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
                <VariableGridHeader />
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
                          <div className="space-y-1" style={{ paddingLeft: LOCAL_HIERARCHY_ENTRY_INDENT_PX }}>
                            <VariableGridHeader />
                            {object.entries.map((entry) => (
                              <VariableRow key={entry.key} entry={entry} />
                            ))}
                          </div>
                        </LocalHierarchyBranch>
                      ))}
                      {component.entries.length > 0 ? (
                        <div className="space-y-1" style={{ paddingLeft: LOCAL_HIERARCHY_ENTRY_INDENT_PX }}>
                          <VariableGridHeader />
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
                          <div className="space-y-1" style={{ paddingLeft: LOCAL_HIERARCHY_ENTRY_INDENT_PX }}>
                            <VariableGridHeader />
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
          <Button disabled={!canCreateVariable} onClick={handleAdd}>Create</Button>
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
                  const nextType = nextValue as VariableType;
                  setType(nextType);
                  setDefaultDraft(createVariableDefaultDraft(nextType, cardinality));
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
                  const nextCardinality = nextValue as VariableCardinality;
                  setCardinality(nextCardinality);
                  setDefaultDraft(createVariableDefaultDraft(type, nextCardinality));
                  setError(null);
                }}
              />
            </VariableOptionRow>
          </div>

          <VariableDefaultField
            draft={defaultDraft}
            inputIdPrefix="variable-default"
            onChange={setDefaultDraft}
          />

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
