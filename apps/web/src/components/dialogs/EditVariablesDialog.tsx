import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { DisclosureButton } from '@/components/ui/disclosure-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppIcon, ChevronDown, ChevronRight, Component as ComponentIcon, Earth, GripVertical, Plus, Trash2, type AppIconName } from '@/components/ui/icons';
import { HoverHelp } from '@/components/ui/hover-help';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShelfObjectThumbnail } from '@/components/stage/ShelfObjectThumbnail';
import { getShelfRowDropPosition, getTransparentShelfDragImage, useShelfDropTargetBoundaryGuard, type ShelfDropPosition } from '@/components/stage/shelfDrag';
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
import type { VariableKindDefinition, VariableTypeChangeImpact } from '@/lib/variableTypeChangeImpact';
import { getVariableTypeChangeImpact } from '@/lib/variableTypeChangeImpact';

interface EditVariablesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createRequestId?: number;
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

type PendingVariableKindChange = {
  entry: VariableEntry;
  nextKind: VariableKindDefinition;
  nextDefaultValue: Variable['defaultValue'];
  impact: VariableTypeChangeImpact;
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
  costumes: Costume[];
  currentCostumeIndex: number;
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
  { value: 'array', label: 'Array' },
];

const VARIABLE_FIELD_HELP = {
  scope: 'Global variables are available everywhere. Local variables belong to the current object or reusable component selection.',
  type: 'Choose what kind of data the variable stores: text, number, or true/false.',
  values: 'Single stores one value. Array stores a list of values in order.',
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

function normalizeVariableDefaultDraft(draft: VariableDefaultDraft): VariableDefaultDraft {
  return createVariableDefaultDraft(
    draft.type,
    draft.cardinality,
    materializeVariableDefaultDraft(draft),
  );
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

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; position: Exclude<ShelfDropPosition, 'on'> } | null>(null);
  const dragBoundaryRef = useRef<HTMLDivElement | null>(null);

  const commitArrayReorder = (items: string[] | boolean[]) => {
    if (draft.cardinality !== 'array') {
      return;
    }

    const nextDraft: VariableDefaultDraft = draft.type === 'boolean'
      ? { ...draft, items: items as boolean[] }
      : { ...draft, items: items as string[] };
    onChange(nextDraft);
    onCommit?.(nextDraft);
  };

  const handleArrayDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleArrayDragEnd = () => {
    setDraggedIndex(null);
    setDropTarget(null);
  };

  useShelfDropTargetBoundaryGuard({
    active: draggedIndex !== null,
    boundaryRef: dragBoundaryRef,
    onExit: () => setDropTarget(null),
  });

  const handleArrayDragOver = (
    event: DragEvent<HTMLDivElement>,
    targetIndex: number,
  ) => {
    if (draggedIndex === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';

    const rect = event.currentTarget.getBoundingClientRect();
    const position = getShelfRowDropPosition({
      isFolder: false,
      isExpandedFolder: false,
      clientY: event.clientY,
      rect,
    });

    setDropTarget({
      index: targetIndex,
      position: position === 'before' ? 'before' : 'after',
    });
  };

  const handleArrayDrop = () => {
    if (draggedIndex === null || !dropTarget) {
      setDraggedIndex(null);
      setDropTarget(null);
      return;
    }

    if (draft.cardinality !== 'array') {
      setDraggedIndex(null);
      setDropTarget(null);
      return;
    }

    const insertionIndex = dropTarget.position === 'before'
      ? dropTarget.index
      : dropTarget.index + 1;
    const nextIndex = draggedIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;

    if (nextIndex === draggedIndex) {
      setDraggedIndex(null);
      setDropTarget(null);
      return;
    }

    if (draft.type === 'boolean') {
      commitArrayReorder(moveArrayItem(draft.items, draggedIndex, nextIndex));
    } else {
      commitArrayReorder(moveArrayItem(draft.items, draggedIndex, nextIndex));
    }
    setDraggedIndex(null);
    setDropTarget(null);
  };

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
            True
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
          const normalizedDraft = normalizeVariableDefaultDraft(draft);
          onChange(normalizedDraft);
          onCommit?.(normalizedDraft);
        }}
        placeholder={draft.type === 'number' ? '0' : 'Enter text'}
      />
    );
  }

  if (draft.type === 'boolean') {
    return (
      <div className="space-y-3" ref={dragBoundaryRef}>
        {draft.items.length > 0 ? (
          <div className="space-y-2">
            {draft.items.map((item, index) => {
              const itemId = `${inputIdPrefix}-item-${index}`;
              const dropInsertionIndex = dropTarget
                ? (dropTarget.position === 'before' ? dropTarget.index : dropTarget.index + 1)
                : null;
              const showDropBefore = dropInsertionIndex === index;
              const showDropAfter = dropInsertionIndex === draft.items.length && index === draft.items.length - 1;
              return (
                <div
                  key={itemId}
                  className="relative"
                  onDragOver={(event) => handleArrayDragOver(event, index)}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleArrayDrop();
                  }}
                >
                  {showDropBefore ? (
                    <div className="pointer-events-none absolute inset-x-2 -top-1 z-10 h-0 border-t-2 border-primary" />
                  ) : null}
                  {showDropAfter ? (
                    <div className="pointer-events-none absolute inset-x-2 -bottom-1 z-10 h-0 border-t-2 border-primary" />
                  ) : null}
                  <div className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-0 ${
                    draggedIndex === index ? 'opacity-70' : ''
                  }`}>
                    <button
                      aria-label={`Reorder item ${index + 1}`}
                      className="flex h-9 w-6 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:cursor-grabbing"
                      draggable
                      onDragEnd={handleArrayDragEnd}
                      onDragStart={(event) => {
                        handleArrayDragStart(index);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', String(index));
                        const dragImage = getTransparentShelfDragImage();
                        if (dragImage) {
                          event.dataTransfer.setDragImage(dragImage, 0, 0);
                        }
                      }}
                      type="button"
                    >
                      <GripVertical className="size-4" />
                    </button>
                    <div className="flex min-w-0 items-center gap-3">
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
                    <Button
                      aria-label={`Remove item ${index + 1}`}
                      className="h-8 w-8 shrink-0 px-0"
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
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            No items yet.
          </div>
        )}

        <div className="flex justify-center">
          <Button
            aria-label="Add item"
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
      </div>
    );
  }

  return (
    <div className="space-y-3" ref={dragBoundaryRef}>
      {draft.items.length > 0 ? (
        <div className="space-y-2">
          {draft.items.map((item, index) => {
            const itemId = `${inputIdPrefix}-item-${index}`;
            const dropInsertionIndex = dropTarget
              ? (dropTarget.position === 'before' ? dropTarget.index : dropTarget.index + 1)
              : null;
            const showDropBefore = dropInsertionIndex === index;
            const showDropAfter = dropInsertionIndex === draft.items.length && index === draft.items.length - 1;
            return (
              <div
                key={itemId}
                className="relative"
                onDragOver={(event) => handleArrayDragOver(event, index)}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleArrayDrop();
                }}
              >
                {showDropBefore ? (
                  <div className="pointer-events-none absolute inset-x-2 -top-1 z-10 h-0 border-t-2 border-primary" />
                ) : null}
                {showDropAfter ? (
                  <div className="pointer-events-none absolute inset-x-2 -bottom-1 z-10 h-0 border-t-2 border-primary" />
                ) : null}
                <div className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-0 ${
                  draggedIndex === index ? 'opacity-70' : ''
                }`}>
                  <button
                    aria-label={`Reorder item ${index + 1}`}
                    className="flex h-9 w-6 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:cursor-grabbing"
                    draggable
                    onDragEnd={handleArrayDragEnd}
                    onDragStart={(event) => {
                      handleArrayDragStart(index);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', String(index));
                      const dragImage = getTransparentShelfDragImage();
                      if (dragImage) {
                        event.dataTransfer.setDragImage(dragImage, 0, 0);
                      }
                    }}
                    type="button"
                  >
                    <GripVertical className="size-4" />
                  </button>
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
                      const normalizedDraft = normalizeVariableDefaultDraft(draft);
                      onChange(normalizedDraft);
                      onCommit?.(normalizedDraft);
                    }}
                    placeholder={draft.type === 'number' ? '0' : `Item ${index + 1}`}
                  />
                  <Button
                    aria-label={`Remove item ${index + 1}`}
                    className="h-8 w-8 shrink-0 px-0"
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
              </div>
            );
          })}
        </div>
      ) : (
          <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            No items yet.
          </div>
        )}

      <div className="flex justify-center">
        <Button
          aria-label="Add item"
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
        <div className="text-sm font-medium text-foreground">Starts with</div>
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
    <div className="grid grid-cols-[minmax(0,1.35fr)_132px_118px_minmax(0,2fr)] items-center gap-3 px-3 pt-2 text-xs font-medium text-muted-foreground">
      <div>Name</div>
      <div>Type</div>
      <div>Structure</div>
      <div>Default</div>
    </div>
  );
}

function getVariableKindLabel(type: VariableType, cardinality: VariableCardinality): string {
  const base = type === 'string' ? 'Text' : type === 'boolean' ? 'Boolean' : 'Number';
  return cardinality === 'array' ? `${base} Array` : base;
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
        className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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

export function EditVariablesDialog({
  open,
  onOpenChange,
  createRequestId = 0,
  onVariablesChanged,
}: EditVariablesDialogProps) {
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
  const [defaultDraft, setDefaultDraft] = useState<VariableDefaultDraft>(
    () => createVariableDefaultDraft('number', 'single'),
  );
  const [expandedLocalKeys, setExpandedLocalKeys] = useState<Set<string>>(new Set());
  const [blockedDelete, setBlockedDelete] = useState<{ entityLabel: string; impact: ProjectReferenceImpact } | null>(null);
  const [pendingKindChange, setPendingKindChange] = useState<PendingVariableKindChange | null>(null);
  const lastHandledCreateRequestRef = useRef(0);

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

  const preferredTab: VariableListTab = localSelectionTarget ? 'local' : 'global';

  const resetAddDialog = (nextScope: AddVariableScope) => {
    setName('');
    setType('number');
    setCardinality('single');
    setScope(nextScope);
    setDefaultDraft(createVariableDefaultDraft('number', 'single'));
    setError(null);
  };

  useEffect(() => {
    if (!open) return;
    setIsAdding(false);
    setActiveTab(preferredTab);
    setBlockedDelete(null);
    setPendingKindChange(null);
    resetAddDialog(preferredTab);
  }, [open, preferredTab]);

  useEffect(() => {
    if (!open || createRequestId === 0) {
      return;
    }
    if (createRequestId === lastHandledCreateRequestRef.current) {
      return;
    }

    lastHandledCreateRequestRef.current = createRequestId;
    setActiveTab(preferredTab);
    setBlockedDelete(null);
    setPendingKindChange(null);
    resetAddDialog(preferredTab);
    setIsAdding(true);
  }, [createRequestId, open, preferredTab]);

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

  const createVariableTitle = useMemo(() => {
    if (scope === 'global') {
      return 'Create Global Variable';
    }

    if (!localSelectionTarget) {
      return 'Create Local Variable';
    }

    if (localSelectionTarget.kind === 'component') {
      const componentName = componentById.get(localSelectionTarget.componentId)?.name || 'Component';
      return `Create Local Variable for ${componentName}`;
    }

    const scene = scenes.find((sceneItem) => sceneItem.id === localSelectionTarget.sceneId);
    const objectName = scene?.objects.find((objectItem) => objectItem.id === localSelectionTarget.objectId)?.name || 'Object';
    return `Create Local Variable for ${objectName}`;
  }, [componentById, localSelectionTarget, scenes, scope]);

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
        costumes: component.costumes || [],
        currentCostumeIndex: component.currentCostumeIndex ?? 0,
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
    if (componentHierarchy.length > 0) {
      keys.add('components-root');
    }
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

    emitVariablesChanged();
  };

  const saveRename = (entry: VariableEntry, nextName: string): boolean => {
    const trimmed = normalizeVariableName(nextName);
    if (!trimmed) {
      void showAlert({
        title: 'Missing Variable Name',
        description: 'Please enter a variable name.',
      });
      return false;
    }

    if (trimmed === entry.variable.name) {
      return true;
    }

    if (hasVariableNameConflict(getVariablesForTarget(entry.target), trimmed, entry.variable.id)) {
      void showAlert({
        title: 'Duplicate Variable Name',
        description: 'A variable with this name already exists in that location.',
      });
      return false;
    }

    switch (entry.target.kind) {
      case 'global':
        updateGlobalVariable(entry.variable.id, { name: trimmed });
        break;
      case 'component': {
        const component = componentById.get(entry.target.componentId);
        if (!component) return false;
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

    emitVariablesChanged();
    return true;
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

  const commitVariableKindChange = (
    entry: VariableEntry,
    nextKind: VariableKindDefinition,
    nextDefaultValue: Variable['defaultValue'],
  ) => {
    applyVariableUpdates(entry, {
      type: nextKind.type,
      cardinality: nextKind.cardinality,
      defaultValue: nextDefaultValue,
    });
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
    resetAddDialog(activeTab);
    emitVariablesChanged();
  };

  const VariableRow = ({ entry }: { entry: VariableEntry }) => {
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
    const [inlineName, setInlineName] = useState(entry.variable.name);

    useEffect(() => {
      setInlineName(entry.variable.name);
    }, [entry.variable.name]);

    const contextMenuActions: ProjectPropertyManagerContextMenuAction[] = [
      {
        key: 'delete',
        label: 'Delete Variable',
        icon: <Trash2 className="size-4" />,
        intent: 'destructive',
        onSelect: () => void handleDelete(entry),
      },
    ];
    const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenuAt({ left: event.clientX, top: event.clientY });
    };

    return (
      <>
        <div
          data-property-manager-row="true"
          className="grid grid-cols-[minmax(0,1.35fr)_132px_118px_minmax(0,2fr)] items-start gap-3 rounded-lg border border-border/60 bg-background/70 px-3 py-3"
          onContextMenu={handleContextMenu}
        >
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <AppIcon
                className="size-4 flex-shrink-0 text-muted-foreground"
                decorative={false}
                name={getTypeIconName(entry.variable.type)}
                title={getTypeLabel(entry.variable.type)}
              />
              <Input
                aria-label={`Variable name for ${entry.variable.name}`}
                className="h-8"
                value={inlineName}
                onBlur={() => {
                  if (!saveRename(entry, inlineName)) {
                    setInlineName(entry.variable.name);
                  }
                }}
                onChange={(event) => setInlineName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (!saveRename(entry, inlineName)) {
                      setInlineName(entry.variable.name);
                    }
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setInlineName(entry.variable.name);
                  }
                }}
              />
            </div>
          </div>

          <Select
            value={entry.variable.type}
            onValueChange={(value) => {
              const nextType = value as VariableType;
              const nextKind = {
                type: nextType,
                cardinality: normalizeVariableCardinality(entry.variable.cardinality),
              };
              const nextDraft = createVariableDefaultDraft(
                nextKind.type,
                nextKind.cardinality,
                materializeVariableDefaultDraft(inlineDefaultDraft),
              );
              const nextDefaultValue = materializeVariableDefaultDraft(nextDraft);

              if (!project) {
                setInlineDefaultDraft(nextDraft);
                commitVariableKindChange(entry, nextKind, nextDefaultValue);
                return;
              }

              const impact = getVariableTypeChangeImpact(project, entry.variable, nextKind);
              if (impact.incompatibleBlockCount > 0) {
                setPendingKindChange({
                  entry,
                  nextKind,
                  nextDefaultValue,
                  impact,
                });
                return;
              }

              setInlineDefaultDraft(nextDraft);
              commitVariableKindChange(entry, nextKind, nextDefaultValue);
            }}
          >
            <SelectTrigger className="h-9 w-full bg-muted/40 shadow-none focus-visible:ring-2" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VARIABLE_TYPES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={normalizeVariableCardinality(entry.variable.cardinality)}
            onValueChange={(value) => {
              const nextCardinality = value as VariableCardinality;
              const nextKind = {
                type: entry.variable.type,
                cardinality: nextCardinality,
              };
              const nextDraft = createVariableDefaultDraft(
                nextKind.type,
                nextKind.cardinality,
                materializeVariableDefaultDraft(inlineDefaultDraft),
              );
              const nextDefaultValue = materializeVariableDefaultDraft(nextDraft);

              if (!project) {
                setInlineDefaultDraft(nextDraft);
                commitVariableKindChange(entry, nextKind, nextDefaultValue);
                return;
              }

              const impact = getVariableTypeChangeImpact(project, entry.variable, nextKind);
              if (impact.incompatibleBlockCount > 0) {
                setPendingKindChange({
                  entry,
                  nextKind,
                  nextDefaultValue,
                  impact,
                });
                return;
              }

              setInlineDefaultDraft(nextDraft);
              commitVariableKindChange(entry, nextKind, nextDefaultValue);
            }}
          >
            <SelectTrigger className="h-9 w-full bg-muted/40 shadow-none focus-visible:ring-2" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VARIABLE_CARDINALITIES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="min-w-0">
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
        layout="workspace"
        title="Variables"
        addButtonLabel="Add variable"
        addButtonText="New variable"
        onAdd={() => {
          resetAddDialog(activeTab);
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
                {componentHierarchy.length > 0 ? (
                  <LocalHierarchyBranch
                    key="components-root"
                    icon={<ComponentIcon className="size-3.5" />}
                    isExpanded={expandedLocalKeys.has('components-root')}
                    onToggle={() => toggleExpandedLocalKey('components-root')}
                    title="Components"
                  >
                    <div className="space-y-1">
                      {componentHierarchy.map((component) => (
                        <LocalHierarchyBranch
                          key={component.key}
                          icon={(
                            <ShelfObjectThumbnail
                              currentCostumeIndex={component.currentCostumeIndex}
                              costumes={component.costumes}
                              name={component.title}
                            />
                          )}
                          isExpanded={expandedLocalKeys.has(component.key)}
                          level={1}
                          onToggle={() => toggleExpandedLocalKey(component.key)}
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
                                level={2}
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
                    </div>
                  </LocalHierarchyBranch>
                ) : null}

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
        title={createVariableTitle}
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
      <Modal
        open={!!pendingKindChange}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPendingKindChange(null);
          }
        }}
        title="Change Variable Type?"
        contentClassName="sm:max-w-2xl"
        footer={(
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingKindChange(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!pendingKindChange) {
                  return;
                }
                commitVariableKindChange(
                  pendingKindChange.entry,
                  pendingKindChange.nextKind,
                  pendingKindChange.nextDefaultValue,
                );
                setPendingKindChange(null);
              }}
            >
              Change Anyway
            </Button>
          </div>
        )}
      >
        {pendingKindChange ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Changing <span className="font-medium text-foreground">{pendingKindChange.entry.variable.name}</span> from{' '}
              <span className="font-medium text-foreground">
                {getVariableKindLabel(
                  pendingKindChange.impact.currentKind.type,
                  pendingKindChange.impact.currentKind.cardinality,
                )}
              </span>{' '}
              to{' '}
              <span className="font-medium text-foreground">
                {getVariableKindLabel(
                  pendingKindChange.impact.nextKind.type,
                  pendingKindChange.impact.nextKind.cardinality,
                )}
              </span>{' '}
              will leave {pendingKindChange.impact.incompatibleBlockCount} incompatible block
              {pendingKindChange.impact.incompatibleBlockCount === 1 ? '' : 's'} across{' '}
              {pendingKindChange.impact.usages.length} object
              {pendingKindChange.impact.usages.length === 1 ? '' : 's'} or component
              {pendingKindChange.impact.usages.length === 1 ? '' : 's'}.
            </p>

            <div className="max-h-[18rem] overflow-y-auto rounded-md border">
              {pendingKindChange.impact.usages.map((usage) => (
                <div className="border-b last:border-b-0" key={
                  usage.owner.kind === 'component'
                    ? `component:${usage.owner.componentId}`
                    : `object:${usage.owner.sceneId}:${usage.owner.objectId}`
                }>
                  <button
                    className="w-full px-4 py-3 text-left transition-colors hover:bg-accent/50"
                    onClick={() => {
                      handleNavigateToUsage(usage.owner);
                      setPendingKindChange(null);
                    }}
                    type="button"
                  >
                    <div className="text-sm font-medium text-foreground">
                      {usage.title}
                    </div>
                    {usage.subtitle ? (
                      <div className="text-xs text-muted-foreground">{usage.subtitle}</div>
                    ) : null}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {usage.blockCount} incompatible block{usage.blockCount === 1 ? '' : 's'}
                    </div>
                  </button>
                  <div className="space-y-2 px-4 pb-3">
                    {usage.issues.map((issue) => (
                      <div className="rounded-md bg-muted/35 px-3 py-2" key={`${issue.blockId}:${issue.message}`}>
                        <div className="text-xs font-medium text-foreground">
                          [{issue.blockType}] {issue.message}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Cancel to keep the variable unchanged, or change it anyway and fix the listed blocks afterward.
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
