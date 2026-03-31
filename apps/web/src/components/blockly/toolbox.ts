import * as Blockly from 'blockly';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { getAppIconDataUri, type AppIconName } from '@/components/ui/icons';
import type { MessageDefinition, Variable, VariableType } from '@/types';
import { COMPONENT_ANY_PREFIX, PICK_FROM_STAGE } from '@/lib/blocklyReferenceMaps';
import { KEY_DROPDOWN_OPTIONS } from '@/utils/keyboard';

const CREATE_MESSAGE_OPTION = '__CREATE_MESSAGE_OPTION__';
const RENAME_SELECTED_MESSAGE_OPTION = '__RENAME_SELECTED_MESSAGE_OPTION__';
const TOOLBOX_CATEGORY_ORDER = [
  'Events',
  'Actions',
  'Motion',
  'Looks',
  'Sensing',
  'Sound',
  'Physics',
  'Camera',
  'Inventory',
  'Variables',
  'Operators',
] as const;
const ADVANCED_BLOCK_TYPES = new Set<string>([
  'camera_set_follow_offset',
  'camera_set_follow_smoothness',
  'control_current_item',
  'control_for_each',
  'control_group_block',
  'debug_console_log',
  'looks_change_axis_scale',
  'looks_speak',
  'looks_stop_speaking',
  'looks_target_speak',
  'looks_target_stop_speaking',
  'motion_attach_block_to_me',
  'motion_attach_to_block',
  'motion_detach',
  'motion_limit_world_boundary_off',
  'motion_limit_world_boundary_on',
  'object_from_dropdown',
  'operator_mathop',
  'operator_mod',
  'physics_set_bounce',
  'physics_set_friction',
  'event_when_touching_direction_value',
  'sensing_my_type',
  'sensing_all_touching_objects',
  'sensing_touching_direction_value',
  'sensing_type_literal',
  'sensing_type_of_object',
  'target_camera',
  'target_ground',
  'target_mouse',
  'target_myself',
]);
const BLOCKLY_INLINE_ICON_DEFAULT_SIZE = 16;
const BLOCKLY_INLINE_ICON_DEFAULT_TEXT = '#ffffff';

type MessageDialogMode = 'create' | 'rename';
type MessageDialogCallback = (
  mode: MessageDialogMode,
  selectedMessageId: string | null,
  applySelectedMessageId: (messageId: string) => void,
) => void;

let messageDialogCallback: MessageDialogCallback | null = null;

export type ToolboxShadowConfig = {
  type: string;
  fields?: Record<string, string>;
};

export type ToolboxBlockInputConfig = {
  block?: ToolboxBlockConfig;
  shadow?: ToolboxShadowConfig;
};

export type ToolboxBlockConfig = {
  kind: 'block';
  type: string;
  inputs?: Record<string, ToolboxBlockInputConfig>;
  fields?: Record<string, string>;
  extraState?: Record<string, unknown>;
};

export type ToolboxButtonConfig = {
  kind: 'button';
  text: string;
  callbackKey: string;
};

export type ToolboxSeparatorConfig = {
  kind: 'sep';
  gap: string;
};

export type ToolboxLabelConfig = {
  kind: 'label';
  text: string;
};

export type ToolboxCategoryConfig = {
  kind: 'category';
  name: string;
  colour: string;
  contents: ToolboxContentItem[];
};

export type ToolboxContentItem =
  | ToolboxBlockConfig
  | ToolboxButtonConfig
  | ToolboxSeparatorConfig
  | ToolboxLabelConfig
  | ToolboxCategoryConfig;

export type ToolboxConfig = {
  kind: 'categoryToolbox';
  contents: ToolboxCategoryConfig[];
};

export type ToolboxConfigOptions = {
  includeAdvancedBlocks?: boolean;
};

// Custom FieldDropdown that preserves unknown values (for object IDs that may not be loaded yet)
class PreservingFieldDropdown extends Blockly.FieldDropdown {
  // Override doClassValidation_ to accept any value, not just those in the dropdown
  protected override doClassValidation_(newValue?: any): string | null {
    // Always accept the value - we'll handle unknown values in getText
    if (newValue === null || newValue === undefined) {
      return null;
    }
    return String(newValue);
  }

  // Override getText to show a friendly name for unknown values
  override getText(): string {
    const value = this.getValue();
    if (!value) return '';

    // Check if value is in current options
    const options = this.getOptions(false);
    for (const option of options) {
      if (option[1] === value && typeof option[0] === 'string') {
        return option[0];
      }
    }

    // Value not in options - try to find the object name from the project
    const project = useProjectStore.getState().project;
    if (project) {
      for (const scene of project.scenes) {
        const obj = scene.objects.find(o => o.id === value);
        if (obj) {
          return obj.name;
        }
      }
    }

    // Still not found - show placeholder
    return '(select object)';
  }
}

// Custom FieldDropdown for variables that preserves unknown values
class VariableFieldDropdown extends Blockly.FieldDropdown {
  // Override doClassValidation_ to accept any value
  protected override doClassValidation_(newValue?: any): string | null {
    // Always accept the value - we'll handle unknown values in getText
    if (newValue === null || newValue === undefined) {
      return null;
    }
    return String(newValue);
  }

  // Override getText to show a friendly name for unknown values
  override getText(): string {
    const value = this.getValue();
    if (!value) return '(no variable)';

    // Check if value is in current options
    const options = this.getOptions(false);
    for (const option of options) {
      if (option[1] === value && typeof option[0] === 'string') {
        return option[0];
      }
    }

    // Value not in options - try to find the variable name from the project
    const project = useProjectStore.getState().project;
    const selectedSceneId = useEditorStore.getState().selectedSceneId;
    const selectedObjectId = useEditorStore.getState().selectedObjectId;
    const selectedComponentId = useEditorStore.getState().selectedComponentId;

    if (project) {
      // Check global variables
      const globalVar = project.globalVariables?.find(v => v.id === value);
      if (globalVar) {
        return `${getVariableTypeToken(globalVar.type)} ${globalVar.name}`;
      }

      // Check local variables
      if (selectedSceneId && selectedObjectId) {
        const scene = project.scenes.find(s => s.id === selectedSceneId);
        const obj = scene?.objects.find(o => o.id === selectedObjectId);
        const component = obj?.componentId
          ? (project.components || []).find((componentItem) => componentItem.id === obj.componentId)
          : null;
        const componentLocalVariables = component?.localVariables || [];
        const localVariables = componentLocalVariables.length > 0
          ? componentLocalVariables
          : (obj?.localVariables || []);
        const localVar = localVariables.find(v => v.id === value);
        if (localVar) {
          return `(local) ${getVariableTypeToken(localVar.type)} ${localVar.name}`;
        }
      }

      if (selectedComponentId) {
        const component = (project.components || []).find((componentItem) => componentItem.id === selectedComponentId);
        const localVar = (component?.localVariables || []).find((variable) => variable.id === value);
        if (localVar) {
          return `(local) ${getVariableTypeToken(localVar.type)} ${localVar.name}`;
        }
      }
    }

    // Still not found - show placeholder
    return '(unknown variable)';
  }
}

// Custom FieldDropdown for scene references that preserves unknown values
class PreservingSceneFieldDropdown extends Blockly.FieldDropdown {
  protected override doClassValidation_(newValue?: any): string | null {
    if (newValue === null || newValue === undefined) {
      return null;
    }
    return String(newValue);
  }

  override getText(): string {
    const value = this.getValue();
    if (!value) return '(select scene)';

    const options = this.getOptions(false);
    for (const option of options) {
      if (option[1] === value && typeof option[0] === 'string') {
        return option[0];
      }
    }

    const project = useProjectStore.getState().project;
    if (project) {
      const byId = project.scenes.find((scene) => scene.id === value);
      if (byId) {
        return byId.name;
      }

      const byNameCount = project.scenes.filter((scene) => scene.name === value).length;
      if (byNameCount === 1) {
        return value;
      }
    }

    return '(select scene)';
  }
}

class PreservingMessageFieldDropdown extends Blockly.FieldDropdown {
  protected override doClassValidation_(newValue?: any): string | null {
    if (newValue === null || newValue === undefined) {
      return null;
    }
    return String(newValue);
  }

  override getText(): string {
    const value = this.getValue();
    if (!value) return '(select message)';

    const options = this.getOptions(false);
    for (const option of options) {
      if (option[1] === value && typeof option[0] === 'string') {
        return option[0];
      }
    }

    const project = useProjectStore.getState().project;
    if (project) {
      const byId = project.messages?.find((message) => message.id === value);
      if (byId) {
        return byId.name;
      }

      const byNameCount = (project.messages || []).filter((message) => message.name === value).length;
      if (byNameCount === 1) {
        return value;
      }
    }

    return '(select message)';
  }
}

// Store reference to the field being picked for (so callback can update it)
let pendingPickerField: Blockly.FieldDropdown | null = null;

function isBlockAttachedToWorkspace(block: Blockly.Block | null | undefined): block is Blockly.Block {
  if (!block || block.isDeadOrDying() || block.isDisposed()) {
    return false;
  }

  const workspace = block.workspace;
  return Boolean(workspace?.getBlockById(block.id));
}

function isLiveDropdownField(field: Blockly.FieldDropdown | null | undefined): field is Blockly.FieldDropdown {
  if (!field || field.disposed) {
    return false;
  }

  return isBlockAttachedToWorkspace(field.getSourceBlock());
}

function buildGroupBlockToggleIcon(collapsed: boolean): string {
  const vertical = collapsed
    ? '<line x1="6" y1="3" x2="6" y2="9" stroke="#555" stroke-width="1.5" stroke-linecap="round" />'
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">
    <rect x="0.75" y="0.75" width="10.5" height="10.5" rx="2" fill="#fff" stroke="#777" />
    <line x1="3" y1="6" x2="9" y2="6" stroke="#555" stroke-width="1.5" stroke-linecap="round" />
    ${vertical}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const GROUP_BLOCK_EXPANDED_ICON = buildGroupBlockToggleIcon(false);
const GROUP_BLOCK_COLLAPSED_ICON = buildGroupBlockToggleIcon(true);
const GROUP_BLOCK_COLOUR = '#9AA0A6';

type BlocklyInlineIconOptions = {
  color?: string;
  size?: number;
};

function getBlockSvgRoot(block: Blockly.Block | null | undefined): SVGElement | null {
  if (!block) return null;
  const maybeSvgBlock = block as Blockly.Block & { getSvgRoot?: () => SVGElement | null };
  return maybeSvgBlock.getSvgRoot?.() ?? null;
}

function getBlocklyInlineIconTextColor(block: Blockly.Block): string {
  const svgRoot = getBlockSvgRoot(block);
  const textNode = svgRoot?.querySelector(
    '.blocklyNonEditableField > text, '
    + '.blocklyNonEditableField > g > text, '
    + '.blocklyEditableField > text, '
    + '.blocklyEditableField > g > text, '
    + 'text.blocklyText',
  );
  if (textNode && typeof window !== 'undefined') {
    const computedFill = window.getComputedStyle(textNode).fill;
    if (computedFill && computedFill !== 'none') {
      return computedFill;
    }
  }

  return BLOCKLY_INLINE_ICON_DEFAULT_TEXT;
}

class BlocklyInlineIconField extends Blockly.FieldImage {
  private readonly iconName: AppIconName;
  private readonly iconSize: number;
  private readonly explicitColor?: string;

  constructor(iconName: AppIconName, altText: string, options: BlocklyInlineIconOptions = {}) {
    const size = options.size ?? BLOCKLY_INLINE_ICON_DEFAULT_SIZE;
    super(
      getAppIconDataUri(iconName, { color: options.color ?? BLOCKLY_INLINE_ICON_DEFAULT_TEXT, size }),
      size,
      size,
      altText,
    );

    this.iconName = iconName;
    this.iconSize = size;
    this.explicitColor = options.color;
  }

  override initView(): void {
    super.initView();
    this.syncIconColour();
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => this.syncIconColour());
    }
  }

  override applyColour(): void {
    super.applyColour();
    this.syncIconColour();
  }

  protected override render_(): void {
    super.render_();
    this.syncIconColour();
  }

  private syncIconColour(): void {
    const sourceBlock = this.getSourceBlock();
    if (!sourceBlock) return;

    const color = this.explicitColor ?? getBlocklyInlineIconTextColor(sourceBlock);
    const nextValue = getAppIconDataUri(this.iconName, { color, size: this.iconSize });
    if (this.getValue() !== nextValue) {
      this.setValue(nextValue);
    }
  }
}

function createBlocklyInlineIcon(
  iconName: AppIconName,
  altText: string,
  options: BlocklyInlineIconOptions = {},
): BlocklyInlineIconField {
  return new BlocklyInlineIconField(iconName, altText, options);
}

function appendBlocklyInlineIcon(
  input: Blockly.Input,
  iconName: AppIconName,
  altText: string,
  fieldName?: string,
  options: BlocklyInlineIconOptions = {},
): Blockly.Input {
  return input.appendField(createBlocklyInlineIcon(iconName, altText, options), fieldName);
}

function syncGroupBlockToggleIcon(block: Blockly.Block): void {
  if (!isBlockAttachedToWorkspace(block)) return;
  const toggleField = block.getField('TOGGLE');
  if (!(toggleField instanceof Blockly.FieldImage)) return;

  const icon = block.isCollapsed() ? GROUP_BLOCK_COLLAPSED_ICON : GROUP_BLOCK_EXPANDED_ICON;
  if (toggleField.getValue() !== icon) {
    toggleField.setValue(icon);
  }
}

function updateCollapsedGroupRow(block: Blockly.Block): void {
  if (!isBlockAttachedToWorkspace(block)) return;
  if (!block.isCollapsed()) return;
  const collapsedInput = block.getInput(Blockly.Block.COLLAPSED_INPUT_NAME);
  if (!collapsedInput) return;

  const nameOnly = block.getFieldValue('NAME') || 'group';
  const collapsedTextField = collapsedInput.fieldRow.find((field) => {
    return (field as Blockly.Field<unknown> & { name?: string }).name === Blockly.Block.COLLAPSED_FIELD_NAME;
  });
  if (collapsedTextField) {
    collapsedTextField.setValue(nameOnly);
  }

  collapsedInput.removeField('GROUP_COLLAPSE_TOGGLE', true);

  const collapsedToggleField = new Blockly.FieldImage(
    GROUP_BLOCK_COLLAPSED_ICON,
    12,
    12,
    '',
    (field: Blockly.FieldImage) => {
      const sourceBlock = field.getSourceBlock();
      if (!sourceBlock) return;
      sourceBlock.setCollapsed(false);
      syncGroupBlockToggleIcon(sourceBlock);
    }
  );
  collapsedInput.insertFieldAt(0, collapsedToggleField, 'GROUP_COLLAPSE_TOGGLE');
}

function setGroupBlockCollapsed(block: Blockly.Block, collapsed: boolean): void {
  if (!isBlockAttachedToWorkspace(block)) return;
  block.setCollapsed(collapsed);
  syncGroupBlockToggleIcon(block);
  updateCollapsedGroupRow(block);
  if (block.rendered && block instanceof Blockly.BlockSvg) {
    block.render();
  }
}

// Helper to generate dropdown options with component grouping
function generateObjectDropdownOptions(
  excludeId?: string,
  includePicker: boolean = true
): Array<[string, string]> {
  const project = useProjectStore.getState().project;
  const selectedSceneId = useEditorStore.getState().selectedSceneId;

  if (!project || !selectedSceneId) {
    return [['(no objects)', '']];
  }

  const scene = project.scenes.find(s => s.id === selectedSceneId);
  if (!scene || scene.objects.length === 0) {
    return [['(no objects)', '']];
  }

  const components = project.components || [];
  const result: Array<[string, string]> = [];

  // Group objects by componentId
  const regularObjects: Array<{ id: string; name: string }> = [];
  const componentGroups = new Map<string, Array<{ id: string; name: string }>>();

  for (const obj of scene.objects) {
    if (obj.id === excludeId) continue;

    if (obj.componentId) {
      const group = componentGroups.get(obj.componentId) || [];
      group.push({ id: obj.id, name: obj.name });
      componentGroups.set(obj.componentId, group);
    } else {
      regularObjects.push({ id: obj.id, name: obj.name });
    }
  }

  // Add regular objects with unique naming for duplicates
  const regularNameCounts = new Map<string, number>();
  const regularNameIndices = new Map<string, number>();

  for (const obj of regularObjects) {
    regularNameCounts.set(obj.name, (regularNameCounts.get(obj.name) || 0) + 1);
  }

  for (const obj of regularObjects) {
    const count = regularNameCounts.get(obj.name) || 0;
    if (count > 1) {
      const index = (regularNameIndices.get(obj.name) || 0) + 1;
      regularNameIndices.set(obj.name, index);
      result.push([`${obj.name} (${index})`, obj.id]);
    } else {
      result.push([obj.name, obj.id]);
    }
  }

  // Add component instance groups
  for (const [componentId, instances] of componentGroups) {
    const component = components.find(c => c.id === componentId);
    const componentName = component?.name || 'Component';

    // Add individual instances numbered
    instances.forEach((inst, index) => {
      result.push([`${componentName} (${index + 1})`, inst.id]);
    });

    // Add "(any)" option for this component if there's more than one instance
    if (instances.length > 1) {
      result.push([`${componentName} (any)`, `${COMPONENT_ANY_PREFIX}${componentId}`]);
    }
  }

  if (result.length === 0) {
    return [['(no other objects)', '']];
  }

  // Add "pick from stage" option at the end
  if (includePicker) {
    result.push(['pick from stage...', PICK_FROM_STAGE]);
  }

  return result;
}

// Dynamic dropdown generator for object selection (excludes current object)
function getObjectDropdownOptions(includePicker: boolean = true): Array<[string, string]> {
  const selectedObjectId = useEditorStore.getState().selectedObjectId;
  return generateObjectDropdownOptions(selectedObjectId || undefined, includePicker);
}

// All objects including current (for camera follow etc.)
function getAllObjectsDropdownOptions(includePicker: boolean = true): Array<[string, string]> {
  return generateObjectDropdownOptions(undefined, includePicker);
}

function getInventoryReferenceDropdownOptions(): Array<[string, string]> {
  const project = useProjectStore.getState().project;
  if (!project) {
    return [['(no inventory items)', '']];
  }

  const componentsById = new Map((project.components || []).map((component) => [component.id, component]));
  const result: Array<[string, string]> = [];
  const componentIdsWithObjects = new Set<string>();

  for (const scene of project.scenes) {
    for (const obj of scene.objects) {
      result.push([`${scene.name} / ${obj.name}`, obj.id]);
      if (obj.componentId) {
        componentIdsWithObjects.add(obj.componentId);
      }
    }
  }

  for (const componentId of componentIdsWithObjects) {
    const componentName = componentsById.get(componentId)?.name || 'Component';
    result.push([`${componentName} (any)`, `${COMPONENT_ANY_PREFIX}${componentId}`]);
  }

  return result.length > 0 ? result : [['(no inventory items)', '']];
}

function getComponentTypeDropdownOptions(): Array<[string, string]> {
  const project = useProjectStore.getState().project;
  const components = project?.components || [];
  if (components.length === 0) {
    return [['(no component types)', '']];
  }

  const nameCounts = new Map<string, number>();
  for (const component of components) {
    nameCounts.set(component.name, (nameCounts.get(component.name) || 0) + 1);
  }

  const seenCounts = new Map<string, number>();
  return components.map((component) => {
    const duplicateCount = nameCounts.get(component.name) || 0;
    if (duplicateCount <= 1) {
      return [component.name, `component:${component.id}`] as [string, string];
    }
    const nextIndex = (seenCounts.get(component.name) || 0) + 1;
    seenCounts.set(component.name, nextIndex);
    return [`${component.name} (${nextIndex})`, `component:${component.id}`] as [string, string];
  });
}

// Dynamic dropdown generator for sound selection (from current object's sounds)
function getSoundDropdownOptions(): Array<[string, string]> {
  const project = useProjectStore.getState().project;
  const selectedSceneId = useEditorStore.getState().selectedSceneId;
  const selectedObjectId = useEditorStore.getState().selectedObjectId;
  const selectedComponentId = useEditorStore.getState().selectedComponentId;

  if (!project) {
    return [['(no sounds)', '']];
  }

  // Get sounds from the object (or from its component if it's a component instance)
  let sounds: Array<{ id: string; name: string }> = [];
  if (selectedSceneId && selectedObjectId) {
    const scene = project.scenes.find(s => s.id === selectedSceneId);
    const object = scene?.objects.find(o => o.id === selectedObjectId);
    if (!object) {
      return [['(no sounds)', '']];
    }

    if (object.componentId) {
      const component = project.components?.find(c => c.id === object.componentId);
      if (component?.sounds) {
        sounds = component.sounds;
      }
    } else {
      sounds = object.sounds || [];
    }
  } else if (selectedComponentId) {
    const component = (project.components || []).find((componentItem) => componentItem.id === selectedComponentId);
    sounds = component?.sounds || [];
  } else {
    return [['(no sounds)', '']];
  }

  if (sounds.length === 0) {
    return [['(no sounds)', '']];
  }

  return sounds.map(sound => [sound.name, sound.id]);
}

function getTouchDirectionOptions(): Array<[string, string]> {
  return [
    ['top', 'TOP'],
    ['bottom', 'BOTTOM'],
    ['left', 'LEFT'],
    ['right', 'RIGHT'],
    ['side', 'SIDE'],
  ];
}

function getKeyDropdownOptions(): Array<[string, string]> {
  return KEY_DROPDOWN_OPTIONS.map(([label, value]) => [label, value]);
}

function getSceneDropdownOptions(): Array<[string, string]> {
  const project = useProjectStore.getState().project;
  if (!project || project.scenes.length === 0) {
    return [['(no scenes)', '']];
  }

  const nameCounts = new Map<string, number>();
  for (const scene of project.scenes) {
    nameCounts.set(scene.name, (nameCounts.get(scene.name) || 0) + 1);
  }

  const seenCounts = new Map<string, number>();
  return project.scenes.map((scene) => {
    const duplicateCount = nameCounts.get(scene.name) || 0;
    if (duplicateCount <= 1) {
      return [scene.name, scene.id];
    }
    const nextIndex = (seenCounts.get(scene.name) || 0) + 1;
    seenCounts.set(scene.name, nextIndex);
    return [`${scene.name} (${nextIndex})`, scene.id];
  });
}

function getMessageDropdownOptions(selectedMessageId?: string | null): Array<[string, string]> {
  const project = useProjectStore.getState().project;
  const messages = (project?.messages || []).filter((message): message is MessageDefinition => {
    return (
      typeof message.id === 'string' &&
      message.id.trim().length > 0 &&
      typeof message.name === 'string' &&
      message.name.trim().length > 0
    );
  });

  const options: Array<[string, string]> = [];
  if (messages.length === 0) {
    options.push(['(select message)', '']);
  } else {
    const nameCounts = new Map<string, number>();
    for (const message of messages) {
      nameCounts.set(message.name, (nameCounts.get(message.name) || 0) + 1);
    }

    const seenCounts = new Map<string, number>();
    for (const message of messages) {
      const duplicateCount = nameCounts.get(message.name) || 0;
      if (duplicateCount <= 1) {
        options.push([message.name, message.id]);
        continue;
      }
      const nextIndex = (seenCounts.get(message.name) || 0) + 1;
      seenCounts.set(message.name, nextIndex);
      options.push([`${message.name} (${nextIndex})`, message.id]);
    }
  }

  options.push(['+ New message...', CREATE_MESSAGE_OPTION]);
  const hasSelectedMessage = !!selectedMessageId && messages.some((message) => message.id === selectedMessageId);
  if (hasSelectedMessage) {
    options.push(['Rename selected message...', RENAME_SELECTED_MESSAGE_OPTION]);
  }
  return options;
}

// Dropdown with special options + objects
function getTargetDropdownOptions(
  _includeEdge: boolean = false,
  includeMouse: boolean = false,
  includeMyType: boolean = false,
  includeGround: boolean = false
): () => Array<[string, string]> {
  return function() {
    const specialOptions: Array<[string, string]> = [];
    if (includeGround) {
      specialOptions.push(['ground', 'GROUND']);
    }
    if (includeMouse) {
      specialOptions.push(['mouse', 'MOUSE']);
    }
    if (includeMyType) {
      specialOptions.push(['my type', 'MY_TYPE']);
    }

    const objectOptions = getObjectDropdownOptions(true);

    // If no real objects, just return special options + placeholder
    if (objectOptions.length === 1 && objectOptions[0][1] === '') {
      return [...specialOptions, ...objectOptions];
    }

    return [...specialOptions, ...objectOptions];
  };
}

// Validator for object picker dropdowns
function createObjectPickerValidator(excludeCurrentObject: boolean = true) {
  return function(this: Blockly.FieldDropdown, newValue: string): string | null {
    if (newValue === PICK_FROM_STAGE) {
      // Store reference to this field
      pendingPickerField = this;

      // Get exclude ID
      const excludeId = excludeCurrentObject
        ? useEditorStore.getState().selectedObjectId
        : null;

      // Open picker with callback
      useEditorStore.getState().openObjectPicker((pickedObjectId: string) => {
        if (isLiveDropdownField(pendingPickerField)) {
          // Update the field value
          pendingPickerField.setValue(pickedObjectId);
        }
        pendingPickerField = null;
      }, excludeId);

      // Return null to prevent the field from changing to PICK_FROM_STAGE
      return null;
    }
    return newValue;
  };
}

function createMessageDropdownValidator() {
  return function(this: Blockly.FieldDropdown, newValue: string): string | null {
    if (newValue !== CREATE_MESSAGE_OPTION && newValue !== RENAME_SELECTED_MESSAGE_OPTION) {
      return newValue;
    }
    if (!messageDialogCallback) {
      return null;
    }

    const selectedMessageId = this.getValue();
    if (newValue === RENAME_SELECTED_MESSAGE_OPTION) {
      const messages = useProjectStore.getState().project?.messages || [];
      const selectedExists = messages.some((message) => message.id === selectedMessageId);
      if (!selectedExists) {
        return null;
      }
    }

    messageDialogCallback(
      newValue === CREATE_MESSAGE_OPTION ? 'create' : 'rename',
      selectedMessageId || null,
      (messageId: string) => {
        if (!isLiveDropdownField(this)) {
          return;
        }
        this.setValue(messageId);
      },
    );

    return null;
  };
}

// Register custom blocks
registerCustomBlocks();

export function isAdvancedBlockType(blockType: string): boolean {
  return ADVANCED_BLOCK_TYPES.has(blockType);
}

function isToolboxItemActionable(item: ToolboxContentItem): boolean {
  return item.kind === 'block' || item.kind === 'button';
}

function pruneToolboxCategoryContents(contents: ToolboxContentItem[]): ToolboxContentItem[] {
  return contents.filter((item, index) => {
    if (item.kind === 'sep') {
      const hasActionableBefore = contents.slice(0, index).some(isToolboxItemActionable);
      const hasActionableAfter = contents.slice(index + 1).some(isToolboxItemActionable);
      return hasActionableBefore && hasActionableAfter;
    }

    if (item.kind === 'label') {
      return contents.slice(index + 1).some(isToolboxItemActionable);
    }

    return true;
  });
}

function filterToolboxContentItems(
  contents: ToolboxContentItem[],
  includeAdvancedBlocks: boolean,
): ToolboxContentItem[] {
  const filtered = contents.flatMap<ToolboxContentItem>((item) => {
    if (item.kind === 'block') {
      return includeAdvancedBlocks || !isAdvancedBlockType(item.type) ? [item] : [];
    }

    if (item.kind === 'category') {
      const nextContents = pruneToolboxCategoryContents(
        filterToolboxContentItems(item.contents, includeAdvancedBlocks),
      );
      return nextContents.length > 0
        ? [{ ...item, contents: nextContents }]
        : [];
    }

    return [item];
  });

  return pruneToolboxCategoryContents(filtered);
}

function sortToolboxCategories(categories: ToolboxCategoryConfig[]): ToolboxCategoryConfig[] {
  const rankByName = new Map<string, number>(TOOLBOX_CATEGORY_ORDER.map((name, index) => [name, index]));
  return [...categories].sort((left, right) => {
    const leftRank = rankByName.get(left.name) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rankByName.get(right.name) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.name.localeCompare(right.name);
  });
}

export function getToolboxConfig(options: ToolboxConfigOptions = {}): ToolboxConfig {
  const { includeAdvancedBlocks = true } = options;
  const toolbox: ToolboxConfig = {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Events',
        colour: '#FFAB19',
        contents: [
          { kind: 'block', type: 'event_game_start' },
          { kind: 'block', type: 'event_key_pressed' },
          { kind: 'block', type: 'event_world_clicked' },
          { kind: 'block', type: 'event_clicked' },
          { kind: 'block', type: 'event_forever' },
          { kind: 'block', type: 'event_when_receive' },
          { kind: 'block', type: 'control_broadcast' },
          { kind: 'block', type: 'control_broadcast_wait' },
          {
            kind: 'block',
            type: 'event_when_touching_value',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
            },
          },
          {
            kind: 'block',
            type: 'event_when_touching_direction_value',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
            },
          },
        ],
      },
      {
        kind: 'category',
        name: 'Actions',
        colour: '#FFBF00',
        contents: [
          {
            kind: 'block',
            type: 'control_wait',
            inputs: {
              SECONDS: { shadow: { type: 'math_number', fields: { NUM: '1' } } }
            }
          },
          {
            kind: 'block',
            type: 'control_repeat',
            inputs: {
              TIMES: { shadow: { type: 'math_number', fields: { NUM: '10' } } }
            }
          },
          { kind: 'block', type: 'control_repeat_until' },
          { kind: 'block', type: 'control_while' },
          { kind: 'block', type: 'control_for_each' },
          { kind: 'block', type: 'control_current_item' },
          { kind: 'block', type: 'control_wait_until' },
          { kind: 'block', type: 'controls_if' },
          {
            kind: 'block',
            type: 'controls_if',
            extraState: { hasElse: true },
          },
          { kind: 'block', type: 'control_random_choice' },
          { kind: 'block', type: 'control_stop' },
          { kind: 'block', type: 'control_switch_scene' },
          {
            kind: 'block',
            type: 'control_spawn_type_at',
            inputs: {
              X: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              Y: { shadow: { type: 'math_number', fields: { NUM: '0' } } }
            },
          },
          {
            kind: 'block',
            type: 'control_delete_object',
            inputs: {
              OBJECT: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
            },
          },
        ],
      },
      {
        kind: 'category',
        name: 'Inventory',
        colour: '#FF8C42',
        contents: [
          { kind: 'block', type: 'event_any_inventory_item_dropped' },
          { kind: 'block', type: 'event_inventory_item_dropped' },
          { kind: 'block', type: 'inventory_show' },
          { kind: 'block', type: 'inventory_hide' },
          { kind: 'block', type: 'inventory_move_to_inventory' },
          { kind: 'block', type: 'inventory_use_dropped_item' },
        ],
      },
      {
        kind: 'category',
        name: 'Motion',
        colour: '#4C97FF',
        contents: [
          {
            kind: 'block',
            type: 'motion_move_steps',
            inputs: {
              STEPS: { shadow: { type: 'math_number', fields: { NUM: '10' } } }
            }
          },
          {
            kind: 'block',
            type: 'motion_move_towards',
            inputs: {
              X: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              Y: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              STEPS: { shadow: { type: 'math_number', fields: { NUM: '10' } } }
            }
          },
          {
            kind: 'block',
            type: 'motion_go_to',
            inputs: {
              X: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              Y: { shadow: { type: 'math_number', fields: { NUM: '0' } } }
            }
          },
          {
            kind: 'block',
            type: 'motion_glide_to',
            inputs: {
              X: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              Y: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              SECONDS: { shadow: { type: 'math_number', fields: { NUM: '1' } } }
            }
          },
          {
            kind: 'block',
            type: 'motion_glide_to_speed',
            inputs: {
              X: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              Y: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              SPEED: { shadow: { type: 'math_number', fields: { NUM: '200' } } }
            }
          },
          { kind: 'block', type: 'motion_limit_world_boundary_on' },
          { kind: 'block', type: 'motion_limit_world_boundary_off' },
          {
            kind: 'block',
            type: 'motion_change_x',
            inputs: {
              VALUE: {
                shadow: {
                  type: 'math_number',
                  fields: { NUM: '10' }
                }
              }
            }
          },
          {
            kind: 'block',
            type: 'motion_change_y',
            inputs: {
              VALUE: { shadow: { type: 'math_number', fields: { NUM: '10' } } }
            }
          },
          {
            kind: 'block',
            type: 'motion_set_x',
            inputs: {
              VALUE: { shadow: { type: 'math_number', fields: { NUM: '0' } } }
            }
          },
          {
            kind: 'block',
            type: 'motion_set_y',
            inputs: {
              VALUE: { shadow: { type: 'math_number', fields: { NUM: '0' } } }
            }
          },
          {
            kind: 'block',
            type: 'motion_point_direction',
            inputs: {
              DIRECTION: { shadow: { type: 'math_number', fields: { NUM: '90' } } }
            }
          },
          {
            kind: 'block',
            type: 'motion_point_towards_value',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'target_mouse' },
              },
            },
          },
          {
            kind: 'block',
            type: 'motion_rotate_tween',
            inputs: {
              DEGREES: { shadow: { type: 'math_number', fields: { NUM: '90' } } },
              SECONDS: { shadow: { type: 'math_number', fields: { NUM: '1' } } }
            }
          },
          { kind: 'sep', gap: '16' },
          { kind: 'block', type: 'motion_my_x' },
          { kind: 'block', type: 'motion_my_y' },
          { kind: 'block', type: 'motion_is_moving' },
          {
            kind: 'block',
            type: 'sensing_object_x',
            inputs: {
              OBJECT: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
            },
          },
          {
            kind: 'block',
            type: 'sensing_object_y',
            inputs: {
              OBJECT: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
            },
          },
          { kind: 'sep', gap: '16' },
          {
            kind: 'block',
            type: 'motion_attach_to_block',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
            },
          },
          {
            kind: 'block',
            type: 'motion_attach_block_to_me',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
            },
          },
          { kind: 'block', type: 'motion_detach' },
        ],
      },
      {
        kind: 'category',
        name: 'Looks',
        colour: '#9966FF',
        contents: [
          { kind: 'block', type: 'looks_show' },
          { kind: 'block', type: 'looks_hide' },
          {
            kind: 'block',
            type: 'looks_speak',
            inputs: {
              TEXT: { shadow: { type: 'text', fields: { TEXT: 'Hello!' } } }
            }
          },
          {
            kind: 'block',
            type: 'looks_speak_and_stop',
            inputs: {
              TEXT: { shadow: { type: 'text', fields: { TEXT: 'Hello!' } } }
            }
          },
          { kind: 'block', type: 'looks_stop_speaking' },
          {
            kind: 'block',
            type: 'looks_target_speak',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
              TEXT: { shadow: { type: 'text', fields: { TEXT: 'Hello!' } } }
            }
          },
          {
            kind: 'block',
            type: 'looks_target_speak_and_stop',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
              TEXT: { shadow: { type: 'text', fields: { TEXT: 'Hello!' } } }
            }
          },
          {
            kind: 'block',
            type: 'looks_target_stop_speaking',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
            }
          },
          { kind: 'block', type: 'looks_go_to_front' },
          { kind: 'block', type: 'looks_go_to_back' },
          {
            kind: 'block',
            type: 'looks_set_size',
            inputs: {
              SIZE: { shadow: { type: 'math_number', fields: { NUM: '100' } } }
            }
          },
          {
            kind: 'block',
            type: 'looks_change_size',
            inputs: {
              SIZE: { shadow: { type: 'math_number', fields: { NUM: '10' } } }
            }
          },
          {
            kind: 'block',
            type: 'looks_change_axis_scale',
            inputs: {
              SIZE: { shadow: { type: 'math_number', fields: { NUM: '10' } } }
            }
          },
          { kind: 'block', type: 'looks_flip_axis' },
          {
            kind: 'block',
            type: 'looks_set_opacity',
            inputs: {
              OPACITY: { shadow: { type: 'math_number', fields: { NUM: '100' } } }
            }
          },
          { kind: 'block', type: 'looks_previous_costume' },
          { kind: 'block', type: 'looks_next_costume' },
          {
            kind: 'block',
            type: 'looks_switch_costume',
            inputs: {
              COSTUME: { shadow: { type: 'math_number', fields: { NUM: '1' } } }
            }
          },
          { kind: 'block', type: 'looks_costume_number' },
          {
            kind: 'block',
            type: 'sensing_object_costume',
            inputs: {
              OBJECT: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
            },
          },
        ],
      },
      {
        kind: 'category',
        name: 'Physics',
        colour: '#40BF4A',
        contents: [
          { kind: 'block', type: 'physics_enable' },
          { kind: 'block', type: 'physics_disable' },
          { kind: 'block', type: 'physics_enabled' },
          {
            kind: 'block',
            type: 'physics_set_velocity',
            inputs: {
              VX: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              VY: { shadow: { type: 'math_number', fields: { NUM: '0' } } }
            }
          },
          {
            kind: 'block',
            type: 'physics_set_velocity_x',
            inputs: {
              VX: { shadow: { type: 'math_number', fields: { NUM: '5' } } }
            }
          },
          {
            kind: 'block',
            type: 'physics_set_velocity_y',
            inputs: {
              VY: { shadow: { type: 'math_number', fields: { NUM: '8' } } }
            }
          },
          {
            kind: 'block',
            type: 'physics_set_gravity',
            inputs: {
              GRAVITY: { shadow: { type: 'math_number', fields: { NUM: '1' } } }
            }
          },
          {
            kind: 'block',
            type: 'physics_set_bounce',
            inputs: {
              BOUNCE: { shadow: { type: 'math_number', fields: { NUM: '0.5' } } }
            }
          },
          {
            kind: 'block',
            type: 'physics_set_friction',
            inputs: {
              FRICTION: { shadow: { type: 'math_number', fields: { NUM: '0.1' } } }
            }
          },
          { kind: 'block', type: 'physics_make_dynamic' },
          { kind: 'block', type: 'physics_make_static' },
        ],
      },
      {
        kind: 'category',
        name: 'Camera',
        colour: '#0fBDA8',
        contents: [
          {
            kind: 'block',
            type: 'camera_follow_object_value',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'target_myself' },
              },
            },
          },
          {
            kind: 'block',
            type: 'camera_follow_object_value',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
            },
          },
          { kind: 'block', type: 'camera_stop_follow' },
          {
            kind: 'block',
            type: 'camera_go_to',
            inputs: {
              X: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              Y: { shadow: { type: 'math_number', fields: { NUM: '0' } } }
            }
          },
          {
            kind: 'block',
            type: 'camera_shake',
            inputs: {
              DURATION: { shadow: { type: 'math_number', fields: { NUM: '0.5' } } }
            }
          },
          {
            kind: 'block',
            type: 'camera_zoom',
            inputs: {
              ZOOM: { shadow: { type: 'math_number', fields: { NUM: '100' } } }
            }
          },
          {
            kind: 'block',
            type: 'camera_fade',
            inputs: {
              DURATION: { shadow: { type: 'math_number', fields: { NUM: '1' } } }
            }
          },
          {
            kind: 'block',
            type: 'camera_set_follow_range',
            inputs: {
              WIDTH: { shadow: { type: 'math_number', fields: { NUM: '100' } } },
              HEIGHT: { shadow: { type: 'math_number', fields: { NUM: '100' } } }
            }
          },
          {
            kind: 'block',
            type: 'camera_set_follow_offset',
            inputs: {
              X: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              Y: { shadow: { type: 'math_number', fields: { NUM: '0' } } }
            }
          },
          {
            kind: 'block',
            type: 'camera_set_follow_smoothness',
            inputs: {
              SMOOTHNESS: { shadow: { type: 'math_number', fields: { NUM: '50' } } }
            }
          },
        ],
      },
      {
        kind: 'category',
        name: 'Sensing',
        colour: '#5CB1D6',
        contents: [
          { kind: 'block', type: 'sensing_key_pressed' },
          { kind: 'block', type: 'sensing_mouse_down' },
          { kind: 'block', type: 'sensing_mouse_x' },
          { kind: 'block', type: 'sensing_mouse_y' },
          { kind: 'block', type: 'sensing_timer' },
          { kind: 'block', type: 'sensing_reset_timer' },
          {
            kind: 'block',
            type: 'sensing_touching_value',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'target_ground' },
              },
            },
          },
          {
            kind: 'block',
            type: 'sensing_touching_direction_value',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'target_ground' },
              },
            },
          },
          { kind: 'block', type: 'sensing_touching_object' },
          { kind: 'block', type: 'sensing_all_touching_objects' },
          { kind: 'block', type: 'sensing_my_type' },
          {
            kind: 'block',
            type: 'sensing_type_of_object',
            inputs: {
              OBJECT: {
                block: { kind: 'block', type: 'object_from_dropdown' },
              },
            },
          },
          { kind: 'block', type: 'sensing_type_literal' },
          {
            kind: 'block',
            type: 'sensing_distance_to_value',
            inputs: {
              TARGET: {
                block: { kind: 'block', type: 'target_mouse' },
              },
            },
          },
        ],
      },
      {
        kind: 'category',
        name: 'Targets',
        colour: '#5CB1D6',
        contents: [
          { kind: 'block', type: 'object_from_dropdown' },
          { kind: 'block', type: 'target_camera' },
          { kind: 'block', type: 'target_myself' },
          { kind: 'block', type: 'target_mouse' },
          { kind: 'block', type: 'target_ground' },
        ],
      },
      {
        kind: 'category',
        name: 'Sound',
        colour: '#CF63CF',
        contents: [
          { kind: 'block', type: 'sound_play' },
          { kind: 'block', type: 'sound_play_until_done' },
          { kind: 'block', type: 'sound_stop_all' },
          {
            kind: 'block',
            type: 'sound_set_volume',
            inputs: {
              VOLUME: { shadow: { type: 'math_number', fields: { NUM: '100' } } }
            }
          },
          {
            kind: 'block',
            type: 'sound_change_volume',
            inputs: {
              DELTA: { shadow: { type: 'math_number', fields: { NUM: '-10' } } }
            }
          },
        ],
      },
      {
        kind: 'category',
        name: 'Variables',
        colour: '#FF8C1A',
        contents: [
          {
            kind: 'button',
            text: '+ Add Variable',
            callbackKey: 'ADD_VARIABLE',
          },
          {
            kind: 'button',
            text: 'Manage Variables',
            callbackKey: 'MANAGE_VARIABLES',
          },
          { kind: 'sep', gap: '16' },
          { kind: 'label', text: 'Get Variable' },
          { kind: 'block', type: 'typed_variable_get' },
          { kind: 'sep', gap: '8' },
          { kind: 'label', text: 'Set Variable' },
          {
            kind: 'block',
            type: 'typed_variable_set',
            inputs: {
              VALUE: { shadow: { type: 'math_number', fields: { NUM: '0' } } }
            }
          },
          {
            kind: 'block',
            type: 'typed_variable_change',
            inputs: {
              DELTA: { shadow: { type: 'math_number', fields: { NUM: '1' } } }
            }
          },
          { kind: 'sep', gap: '8' },
          { kind: 'label', text: 'Boolean Value' },
          { kind: 'block', type: 'logic_boolean' },
        ],
      },
      {
        kind: 'category',
        name: 'Operators',
        colour: '#59C059',
        contents: [
          {
            kind: 'block',
            type: 'math_arithmetic',
            inputs: {
              A: { shadow: { type: 'math_number', fields: { NUM: '1' } } },
              B: { shadow: { type: 'math_number', fields: { NUM: '1' } } }
            }
          },
          {
            kind: 'block',
            type: 'math_random_int',
            inputs: {
              FROM: { shadow: { type: 'math_number', fields: { NUM: '1' } } },
              TO: { shadow: { type: 'math_number', fields: { NUM: '10' } } }
            }
          },
          {
            kind: 'block',
            type: 'logic_compare',
            inputs: {
              A: { shadow: { type: 'math_number', fields: { NUM: '0' } } },
              B: { shadow: { type: 'math_number', fields: { NUM: '0' } } }
            }
          },
          { kind: 'block', type: 'logic_operation' },
          { kind: 'block', type: 'logic_negate' },
          {
            kind: 'block',
            type: 'operator_join',
            inputs: {
              STRING1: { shadow: { type: 'text', fields: { TEXT: 'apple' } } },
              STRING2: { shadow: { type: 'text', fields: { TEXT: 'banana' } } }
            }
          },
          {
            kind: 'block',
            type: 'operator_letter_of',
            inputs: {
              LETTER: { shadow: { type: 'math_number', fields: { NUM: '1' } } },
              STRING: { shadow: { type: 'text', fields: { TEXT: 'apple' } } }
            }
          },
          {
            kind: 'block',
            type: 'operator_length',
            inputs: {
              STRING: { shadow: { type: 'text', fields: { TEXT: 'apple' } } }
            }
          },
          {
            kind: 'block',
            type: 'operator_contains',
            inputs: {
              STRING1: { shadow: { type: 'text', fields: { TEXT: 'apple' } } },
              STRING2: { shadow: { type: 'text', fields: { TEXT: 'a' } } }
            }
          },
          {
            kind: 'block',
            type: 'operator_mod',
            inputs: {
              NUM1: { shadow: { type: 'math_number', fields: { NUM: '10' } } },
              NUM2: { shadow: { type: 'math_number', fields: { NUM: '3' } } }
            }
          },
          {
            kind: 'block',
            type: 'operator_round',
            inputs: {
              NUM: { shadow: { type: 'math_number', fields: { NUM: '3.14' } } }
            }
          },
          {
            kind: 'block',
            type: 'operator_mathop',
            fields: { OP: 'SQRT' },
            inputs: {
              NUM: { shadow: { type: 'math_number', fields: { NUM: '9' } } }
            }
          },
        ],
      },
      {
        kind: 'category',
        name: 'Debug',
        colour: '#888888',
        contents: [
          { kind: 'block', type: 'control_group_block' },
          { kind: 'block', type: 'debug_console_log' },
        ],
      },
    ],
  };

  const orderedToolbox: ToolboxConfig = {
    ...toolbox,
    contents: sortToolboxCategories(toolbox.contents),
  };

  if (includeAdvancedBlocks) {
    return orderedToolbox;
  }

  return {
    ...orderedToolbox,
    contents: filterToolboxContentItems(orderedToolbox.contents, includeAdvancedBlocks) as ToolboxCategoryConfig[],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectBlockTypeFromInputSpec(inputSpec: unknown, collected: Set<string>): void {
  if (!isRecord(inputSpec)) return;

  for (const key of ['block', 'shadow']) {
    const maybeNested = inputSpec[key];
    if (!isRecord(maybeNested)) continue;

    const nestedType = maybeNested.type;
    if (typeof nestedType === 'string' && nestedType.trim()) {
      collected.add(nestedType);
    }

    const nestedInputs = maybeNested.inputs;
    if (!isRecord(nestedInputs)) continue;
    for (const nestedInputSpec of Object.values(nestedInputs)) {
      collectBlockTypeFromInputSpec(nestedInputSpec, collected);
    }
  }
}

function collectToolboxBlockTypes(item: unknown, collected: Set<string>): void {
  if (!isRecord(item)) return;

  if (item.kind === 'block') {
    const blockType = item.type;
    if (typeof blockType === 'string' && blockType.trim()) {
      collected.add(blockType);
    }

    const inputs = item.inputs;
    if (isRecord(inputs)) {
      for (const inputSpec of Object.values(inputs)) {
        collectBlockTypeFromInputSpec(inputSpec, collected);
      }
    }
  }

  const contents = item.contents;
  if (Array.isArray(contents)) {
    for (const child of contents) {
      collectToolboxBlockTypes(child, collected);
    }
  }
}

export function getToolboxRegisteredBlockTypes(options: ToolboxConfigOptions = {}): string[] {
  const toolbox = getToolboxConfig(options);
  const collected = new Set<string>();
  collectToolboxBlockTypes(toolbox, collected);
  return Array.from(collected).sort((a, b) => a.localeCompare(b));
}

function registerCustomBlocks() {
  // Events
  Blockly.Blocks['event_game_start'] = {
    init: function() {
      appendBlocklyInlineIcon(this.appendDummyInput(), 'blocklyEventStart', 'When I start')
        .appendField('When I start');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when this object starts (including spawned objects)');
    }
  };

  Blockly.Blocks['event_key_pressed'] = {
    init: function() {
      appendBlocklyInlineIcon(this.appendDummyInput(), 'blocklyEventKey', 'when')
        .appendField('when')
        .appendField(new Blockly.FieldDropdown(getKeyDropdownOptions()), 'KEY')
        .appendField('is pressed');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when a key is pressed');
    }
  };

  Blockly.Blocks['event_clicked'] = {
    init: function() {
      appendBlocklyInlineIcon(this.appendDummyInput(), 'blocklyEventClick', 'when this is clicked')
        .appendField('when this is clicked');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when this object is clicked');
    }
  };

  Blockly.Blocks['event_world_clicked'] = {
    init: function() {
      appendBlocklyInlineIcon(this.appendDummyInput(), 'blocklyEventWorld', 'when world is clicked')
        .appendField('when world is clicked');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when the world is clicked, including clicks on objects but not UI.');
    }
  };

  Blockly.Blocks['event_inventory_item_dropped'] = {
    init: function() {
      appendBlocklyInlineIcon(this.appendDummyInput(), 'blocklyEventInventory', 'when inventory item')
        .appendField('when inventory item')
        .appendField(new PreservingFieldDropdown(getInventoryReferenceDropdownOptions), 'ITEM')
        .appendField('is dropped on me');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when the selected inventory item is dropped on this object.');
    }
  };

  Blockly.Blocks['event_any_inventory_item_dropped'] = {
    init: function() {
      appendBlocklyInlineIcon(this.appendDummyInput(), 'blocklyEventInventory', 'when any inventory item is dropped')
        .appendField('when any inventory item is dropped');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs whenever any inventory item is dropped, even if it is not over a valid target.');
    }
  };

  Blockly.Blocks['event_forever'] = {
    init: function() {
      appendBlocklyInlineIcon(this.appendDummyInput(), 'blocklyEventForever', 'forever')
        .appendField('forever');
      this.appendStatementInput('DO')
        .setCheck(null);
      this.setPreviousStatement(true, null);
      // No next statement - forever loops don't end
      this.setColour('#FFAB19');
      this.setTooltip('Runs continuously');
    }
  };

  // Motion
  Blockly.Blocks['motion_move_steps'] = {
    init: function() {
      this.appendValueInput('STEPS')
        .setCheck('Number')
        .appendField('move');
      this.appendDummyInput()
        .appendField('steps');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Move forward');
    }
  };

  Blockly.Blocks['motion_move_towards'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('move towards x:');
      this.appendValueInput('X')
        .setCheck('Number');
      this.appendDummyInput()
        .appendField('y:');
      this.appendValueInput('Y')
        .setCheck('Number');
      this.appendValueInput('STEPS')
        .setCheck('Number')
        .appendField('by');
      this.appendDummyInput()
        .appendField('steps');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Move instantly toward an x/y position without changing facing');
    }
  };

  Blockly.Blocks['motion_go_to'] = {
    init: function() {
      this.appendValueInput('X')
        .setCheck('Number')
        .appendField('go to x:');
      this.appendValueInput('Y')
        .setCheck('Number')
        .appendField('y:');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Go to position');
    }
  };

  Blockly.Blocks['motion_glide_to'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('glide to x:');
      this.appendValueInput('X')
        .setCheck('Number');
      this.appendDummyInput()
        .appendField('y:');
      this.appendValueInput('Y')
        .setCheck('Number');
      this.appendDummyInput()
        .appendField('in');
      this.appendValueInput('SECONDS')
        .setCheck('Number');
      this.appendDummyInput()
        .appendField('sec')
        .appendField(new Blockly.FieldDropdown([
          ['linear', 'Linear'],
          ['ease in', 'Quad.easeIn'],
          ['ease out', 'Quad.easeOut'],
          ['ease in-out', 'Quad.easeInOut'],
          ['bounce', 'Bounce.easeOut'],
          ['elastic', 'Elastic.easeOut'],
          ['back', 'Back.easeOut'],
        ]), 'EASING');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Glide smoothly to position over time');
    }
  };

  Blockly.Blocks['motion_glide_to_speed'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('glide to x:');
      this.appendValueInput('X')
        .setCheck('Number');
      this.appendDummyInput()
        .appendField('y:');
      this.appendValueInput('Y')
        .setCheck('Number');
      this.appendDummyInput()
        .appendField('at speed');
      this.appendValueInput('SPEED')
        .setCheck('Number');
      this.appendDummyInput()
        .appendField('px/sec')
        .appendField(new Blockly.FieldDropdown([
          ['linear', 'Linear'],
          ['ease in', 'Quad.easeIn'],
          ['ease out', 'Quad.easeOut'],
          ['ease in-out', 'Quad.easeInOut'],
          ['bounce', 'Bounce.easeOut'],
          ['elastic', 'Elastic.easeOut'],
          ['back', 'Back.easeOut'],
        ]), 'EASING');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Glide smoothly to position using speed instead of duration.');
    }
  };

  Blockly.Blocks['motion_limit_world_boundary_on'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('limit myself inside world boundary');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Keep this object inside the scene world boundary.');
    }
  };

  Blockly.Blocks['motion_limit_world_boundary_off'] = {
    init: function() {
      this.appendDummyInput()
        .appendField("don't limit myself inside world boundary");
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Allow this object to ignore the scene world boundary.');
    }
  };

  Blockly.Blocks['motion_change_x'] = {
    init: function() {
      this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField('change x by');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Change x position');
    }
  };

  Blockly.Blocks['motion_change_y'] = {
    init: function() {
      this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField('change y by');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Change y position');
    }
  };

  Blockly.Blocks['motion_set_x'] = {
    init: function() {
      this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField('set x to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Set x position');
    }
  };

  Blockly.Blocks['motion_set_y'] = {
    init: function() {
      this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField('set y to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Set y position');
    }
  };

  Blockly.Blocks['motion_point_direction'] = {
    init: function() {
      this.appendValueInput('DIRECTION')
        .setCheck('Number')
        .appendField('point in direction');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Point in a direction (0-360)');
    }
  };

  Blockly.Blocks['motion_my_x'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('my x');
      this.setOutput(true, 'Number');
      this.setColour('#4C97FF');
      this.setTooltip('Current x position');
    }
  };

  Blockly.Blocks['motion_my_y'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('my y');
      this.setOutput(true, 'Number');
      this.setColour('#4C97FF');
      this.setTooltip('Current y position');
    }
  };

  Blockly.Blocks['motion_is_moving'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('is moving?');
      this.setOutput(true, 'Boolean');
      this.setColour('#4C97FF');
      this.setTooltip('Returns true while this object is translating');
    }
  };

  // Looks
  Blockly.Blocks['looks_show'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('show');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Show this object');
    }
  };

  Blockly.Blocks['looks_hide'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('hide');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Hide this object');
    }
  };

  Blockly.Blocks['looks_speak'] = {
    init: function() {
      this.appendValueInput('TEXT')
        .appendField('keep speaking');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Show a speech bubble above this object and keep it visible until something stops or replaces it');
    }
  };

  const initSpeakAndStopBlock = function(this: Blockly.Block) {
    this.appendValueInput('TEXT')
      .appendField('speak');
    this.appendDummyInput()
      .appendField('and stop');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour('#9966FF');
    this.setTooltip('Show a speech bubble above this object, reveal the words naturally, then stop speaking shortly after the last word');
  };

  Blockly.Blocks['looks_speak_and_stop'] = {
    init: initSpeakAndStopBlock
  };

  Blockly.Blocks['looks_speak_for_seconds'] = {
    init: function() {
      initSpeakAndStopBlock.call(this);
    }
  };

  Blockly.Blocks['looks_stop_speaking'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('stop speaking');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Hide this object\'s speech bubble');
    }
  };

  Blockly.Blocks['looks_target_speak'] = {
    init: function() {
      this.appendValueInput('TARGET')
        .setCheck('Object')
        .appendField('make');
      this.appendValueInput('TEXT')
        .appendField('keep speaking');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Make another object keep showing a speech bubble until something stops or replaces it');
    }
  };

  const initTargetSpeakAndStopBlock = function(this: Blockly.Block) {
    this.appendValueInput('TARGET')
      .setCheck('Object')
      .appendField('make');
    this.appendValueInput('TEXT')
      .appendField('speak');
    this.appendDummyInput()
      .appendField('and stop');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour('#9966FF');
    this.setTooltip('Make another object speak naturally and stop shortly after the last word');
  };

  Blockly.Blocks['looks_target_speak_and_stop'] = {
    init: initTargetSpeakAndStopBlock
  };

  Blockly.Blocks['looks_target_speak_for_seconds'] = {
    init: function() {
      initTargetSpeakAndStopBlock.call(this);
    }
  };

  Blockly.Blocks['looks_target_stop_speaking'] = {
    init: function() {
      this.appendValueInput('TARGET')
        .setCheck('Object')
        .appendField('make');
      this.appendDummyInput()
        .appendField('stop speaking');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Hide another object\'s speech bubble');
    }
  };

  Blockly.Blocks['looks_set_size'] = {
    init: function() {
      this.appendValueInput('SIZE')
        .setCheck('Number')
        .appendField('set size to');
      this.appendDummyInput()
        .appendField('%');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Set size percentage');
    }
  };

  Blockly.Blocks['looks_change_size'] = {
    init: function() {
      this.appendValueInput('SIZE')
        .setCheck('Number')
        .appendField('change size by');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Change size by amount');
    }
  };

  Blockly.Blocks['looks_change_axis_scale'] = {
    init: function() {
      this.appendValueInput('SIZE')
        .setCheck('Number')
        .appendField('change')
        .appendField(new Blockly.FieldDropdown([
          ['horizontal', 'HORIZONTAL'],
          ['vertical', 'VERTICAL'],
        ]), 'AXIS')
        .appendField('scale by');
      this.appendDummyInput()
        .appendField('%');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Change horizontal or vertical scale while preserving the current flip direction');
    }
  };

  Blockly.Blocks['looks_flip_axis'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('flip')
        .appendField(new Blockly.FieldDropdown([
          ['horizontal', 'HORIZONTAL'],
          ['vertical', 'VERTICAL'],
        ]), 'AXIS');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Flip this object on one axis');
    }
  };

  Blockly.Blocks['looks_next_costume'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('next costume');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Switch to the next costume');
    }
  };

  Blockly.Blocks['looks_previous_costume'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('previous costume');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Switch to the previous costume');
    }
  };

  Blockly.Blocks['looks_switch_costume'] = {
    init: function() {
      this.appendValueInput('COSTUME')
        .setCheck(['Number', 'String'])
        .appendField('switch costume to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Switch to costume by name or number');
    }
  };

  Blockly.Blocks['looks_costume_number'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('costume #');
      this.setOutput(true, 'Number');
      this.setColour('#9966FF');
      this.setTooltip('Current costume number');
    }
  };

  // Control
  const clampRandomChoiceBranchCount = (rawCount: number): number => {
    if (!Number.isFinite(rawCount)) return 2;
    return Math.max(2, Math.min(10, Math.floor(rawCount)));
  };

  const syncRandomChoiceInputs = (block: Blockly.Block, requestedCount?: number) => {
    const count = clampRandomChoiceBranchCount(
      Number.isFinite(requestedCount as number)
        ? Number(requestedCount)
        : Number(block.getFieldValue('COUNT'))
    );

    if (block.getFieldValue('COUNT') !== String(count)) {
      block.setFieldValue(String(count), 'COUNT');
    }

    let existing = 0;
    while (block.getInput(`DO${existing}`)) {
      existing++;
    }

    for (let i = existing; i < count; i++) {
      const input = block.appendStatementInput(`DO${i}`).setCheck(null);
      input.appendField(i === 0 ? 'do' : 'or');
    }

    for (let i = existing - 1; i >= count; i--) {
      block.removeInput(`DO${i}`, true);
    }
  };

  Blockly.Blocks['control_random_choice'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('randomly choose among')
        .appendField(new Blockly.FieldNumber(2, 2, 10, 1), 'COUNT')
        .appendField('branches');
      syncRandomChoiceInputs(this, 2);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Randomly runs one of the branches');
    },
    mutationToDom: function() {
      const mutation = Blockly.utils.xml.createElement('mutation');
      mutation.setAttribute('count', String(clampRandomChoiceBranchCount(Number(this.getFieldValue('COUNT')))));
      return mutation;
    },
    domToMutation: function(xmlElement: Element) {
      syncRandomChoiceInputs(this, Number(xmlElement.getAttribute('count')));
    },
    saveExtraState: function() {
      return { count: clampRandomChoiceBranchCount(Number(this.getFieldValue('COUNT'))) };
    },
    loadExtraState: function(state: { count?: number }) {
      syncRandomChoiceInputs(this, Number(state?.count));
    },
    onchange: function(event: Blockly.Events.Abstract) {
      if (!event) return;
      if (event.type !== Blockly.Events.BLOCK_CREATE && event.type !== Blockly.Events.BLOCK_CHANGE) {
        return;
      }
      if (event.type === Blockly.Events.BLOCK_CREATE) {
        syncRandomChoiceInputs(this);
        return;
      }
      const changeEvent = event as Blockly.Events.BlockChange;
      if (changeEvent.blockId === this.id && changeEvent.name === 'COUNT') {
        syncRandomChoiceInputs(this);
      }
    },
  };

  Blockly.Blocks['control_wait'] = {
    init: function() {
      this.appendValueInput('SECONDS')
        .setCheck('Number')
        .appendField('wait');
      this.appendDummyInput()
        .appendField('seconds');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Wait for some time');
    }
  };

  Blockly.Blocks['control_repeat'] = {
    init: function() {
      this.appendValueInput('TIMES')
        .setCheck('Number')
        .appendField('repeat');
      this.appendDummyInput()
        .appendField('times');
      this.appendStatementInput('DO')
        .setCheck(null);
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Repeat some number of times');
    }
  };

  Blockly.Blocks['control_repeat_until'] = {
    init: function() {
      this.appendValueInput('CONDITION')
        .setCheck('Boolean')
        .appendField('repeat until');
      this.appendStatementInput('DO')
        .setCheck(null);
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Repeat until condition is true');
    }
  };

  Blockly.Blocks['control_while'] = {
    init: function() {
      this.appendValueInput('CONDITION')
        .setCheck('Boolean')
        .appendField('while');
      this.appendStatementInput('DO')
        .setCheck(null);
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Repeat while condition is true');
    }
  };

  Blockly.Blocks['control_group_block'] = {
    init: function() {
      const toggleField = new Blockly.FieldImage(
        GROUP_BLOCK_EXPANDED_ICON,
        12,
        12,
        '',
        (field: Blockly.FieldImage) => {
          const sourceBlock = field.getSourceBlock();
          if (!sourceBlock) return;
          setGroupBlockCollapsed(sourceBlock, !sourceBlock.isCollapsed());
        }
      );

      this.appendDummyInput()
        .appendField(toggleField, 'TOGGLE')
        .appendField(new Blockly.FieldTextInput('group'), 'NAME');
      this.appendStatementInput('DO')
        .setCheck(null);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(GROUP_BLOCK_COLOUR);
      this.setTooltip('Visually group blocks with a name. Does not affect behavior.');
      setTimeout(() => {
        syncGroupBlockToggleIcon(this);
        updateCollapsedGroupRow(this);
      }, 0);
    },
    toString: function(opt_maxLength?: number) {
      const name = this.getFieldValue('NAME') || 'group';
      if (opt_maxLength && name.length > opt_maxLength) {
        return `${name.slice(0, Math.max(0, opt_maxLength - 3))}...`;
      }
      return name;
    },
    onchange: function(event: Blockly.Events.Abstract) {
      if (!event) return;

      if (event.type === Blockly.Events.BLOCK_CREATE) {
        const createEvent = event as Blockly.Events.BlockCreate;
        if (createEvent.ids?.includes(this.id)) {
          syncGroupBlockToggleIcon(this);
        }
        return;
      }

      if (event.type !== Blockly.Events.BLOCK_CHANGE) return;
      const changeEvent = event as Blockly.Events.BlockChange;
      if (changeEvent.blockId !== this.id) return;
      if (changeEvent.element === 'collapsed') {
        syncGroupBlockToggleIcon(this);
        setTimeout(() => updateCollapsedGroupRow(this), 0);
        return;
      }

      if (changeEvent.element === 'field' && changeEvent.name === 'NAME' && this.isCollapsed()) {
        updateCollapsedGroupRow(this);
      }
    },
  };

  Blockly.Blocks['control_for_each'] = {
    init: function() {
      this.appendValueInput('LIST')
        .setCheck('Array')
        .appendField('for each');
      this.appendStatementInput('DO')
        .setCheck(null);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Run the code inside for each item in the list. Use "current item" block to refer to each item.');
    }
  };

  Blockly.Blocks['control_current_item'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('current item');
      this.setOutput(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Use inside "for each" loop to get the current item');
    }
  };

  Blockly.Blocks['control_wait_until'] = {
    init: function() {
      this.appendValueInput('CONDITION')
        .setCheck('Boolean')
        .appendField('wait until');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Wait until condition is true');
    }
  };

  Blockly.Blocks['control_stop'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('stop')
        .appendField(new Blockly.FieldDropdown([
          ['all', 'ALL'],
          ['this script', 'THIS'],
        ]), 'STOP_OPTION');
      this.setPreviousStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Stop scripts');
    }
  };

  // Sensing
  Blockly.Blocks['sensing_key_pressed'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('key')
        .appendField(new Blockly.FieldDropdown(getKeyDropdownOptions()), 'KEY')
        .appendField('pressed?');
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Is a key pressed?');
    }
  };

  Blockly.Blocks['sensing_mouse_down'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('mouse down?');
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Is mouse button pressed?');
    }
  };

  Blockly.Blocks['sensing_mouse_x'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('mouse x');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('Mouse x position');
    }
  };

  Blockly.Blocks['sensing_mouse_y'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('mouse y');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('Mouse y position');
    }
  };

  Blockly.Blocks['sensing_timer'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('timer');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('Seconds since game start (2 decimal places)');
    }
  };

  Blockly.Blocks['sensing_reset_timer'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('reset timer');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#5CB1D6');
      this.setTooltip('Reset timer to 0 seconds');
    }
  };

  Blockly.Blocks['sensing_touching'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('touching')
        .appendField(new PreservingFieldDropdown(getTargetDropdownOptions(true, false, true, true)), 'TARGET')
        .appendField('?');
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Is this touching something?');
      // Add validator for pick from stage
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(true));
    }
  };

  Blockly.Blocks['sensing_touching_value'] = {
    init: function() {
      this.appendValueInput('TARGET')
        .setCheck('Object')
        .appendField('touching');
      this.appendDummyInput()
        .appendField('?');
      this.setInputsInline(true);
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Is this touching the selected target?');
    }
  };

  Blockly.Blocks['sensing_touching_direction'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('touching')
        .appendField(new PreservingFieldDropdown(getTargetDropdownOptions(true, false, true, true)), 'TARGET')
        .appendField('from')
        .appendField(new Blockly.FieldDropdown(getTouchDirectionOptions()), 'DIRECTION')
        .appendField('?');
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Is this touching target from a specific direction?');
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(true));
    }
  };

  Blockly.Blocks['sensing_touching_direction_value'] = {
    init: function() {
      this.appendValueInput('TARGET')
        .setCheck('Object')
        .appendField('touching');
      this.appendDummyInput()
        .appendField('from')
        .appendField(new Blockly.FieldDropdown(getTouchDirectionOptions()), 'DIRECTION')
        .appendField('?');
      this.setInputsInline(true);
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Is this touching target from a specific direction?');
    }
  };

  Blockly.Blocks['sensing_distance_to'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('distance to')
        .appendField(new PreservingFieldDropdown(getTargetDropdownOptions(false, true)), 'TARGET');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('Distance to target');
      // Add validator for pick from stage
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(true));
    }
  };

  Blockly.Blocks['sensing_distance_to_value'] = {
    init: function() {
      this.appendValueInput('TARGET')
        .setCheck('Object')
        .appendField('distance to');
      this.setInputsInline(true);
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('Distance to target');
    }
  };

  Blockly.Blocks['sensing_touching_object'] = {
    init: function() {
      this.appendDummyInput()
        .appendField("object I'm touching");
      this.setOutput(true, 'Object');
      this.setColour('#5CB1D6');
      this.setTooltip('Returns the object this sprite is touching, or null if not touching anything');
    }
  };

  Blockly.Blocks['object_from_dropdown'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('object')
        .appendField(new PreservingFieldDropdown(getObjectDropdownOptions), 'TARGET');
      this.setOutput(true, 'Object');
      this.setColour('#5CB1D6');
      this.setTooltip('Pick an object from a dropdown');
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(true));
    }
  };

  Blockly.Blocks['target_mouse'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('mouse pointer');
      this.setOutput(true, 'Object');
      this.setColour('#5CB1D6');
      this.setTooltip('Mouse pointer target');
    }
  };

  Blockly.Blocks['target_myself'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('myself');
      this.setOutput(true, 'Object');
      this.setColour('#5CB1D6');
      this.setTooltip('Current object target');
    }
  };

  Blockly.Blocks['target_camera'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('camera');
      this.setOutput(true, 'Object');
      this.setColour('#5CB1D6');
      this.setTooltip('Camera target');
    }
  };

  Blockly.Blocks['target_ground'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('ground collider');
      this.setOutput(true, 'Object');
      this.setColour('#5CB1D6');
      this.setTooltip('Ground collision target');
    }
  };

  Blockly.Blocks['sensing_my_type'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('my type');
      this.setOutput(true, 'String');
      this.setColour('#5CB1D6');
      this.setTooltip('Get this object type token');
    }
  };

  Blockly.Blocks['sensing_type_of_object'] = {
    init: function() {
      this.appendValueInput('OBJECT')
        .setCheck('Object');
      this.appendDummyInput()
        .appendField("'s type");
      this.setInputsInline(true);
      this.setOutput(true, 'String');
      this.setColour('#5CB1D6');
      this.setTooltip("Get another object's type token");
    }
  };

  Blockly.Blocks['sensing_type_literal'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('type')
        .appendField(new PreservingFieldDropdown(getComponentTypeDropdownOptions), 'TYPE');
      this.setOutput(true, 'String');
      this.setColour('#5CB1D6');
      this.setTooltip('Component type literal for comparison');
    }
  };

  Blockly.Blocks['sensing_all_touching_objects'] = {
    init: function() {
      this.appendDummyInput()
        .appendField("all objects I'm touching");
      this.setOutput(true, 'Array');
      this.setColour('#5CB1D6');
      this.setTooltip('Returns a list of all objects that I\'m currently touching');
    }
  };

  Blockly.Blocks['sensing_object_x'] = {
    init: function() {
      this.appendValueInput('OBJECT')
        .setCheck('Object');
      this.appendDummyInput()
        .appendField("'s x");
      this.setInputsInline(true);
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip("Get an object's x position");
    }
  };

  Blockly.Blocks['sensing_object_y'] = {
    init: function() {
      this.appendValueInput('OBJECT')
        .setCheck('Object');
      this.appendDummyInput()
        .appendField("'s y");
      this.setInputsInline(true);
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip("Get an object's y position");
    }
  };

  Blockly.Blocks['sensing_object_costume'] = {
    init: function() {
      this.appendValueInput('OBJECT')
        .setCheck('Object');
      this.appendDummyInput()
        .appendField("'s costume #");
      this.setInputsInline(true);
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip("Get an object's current costume number");
    }
  };

  // Physics blocks
  Blockly.Blocks['physics_enable'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('enable physics');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Enable physics for this object');
    }
  };

  Blockly.Blocks['physics_disable'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('disable physics');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Disable physics for this object');
    }
  };

  Blockly.Blocks['physics_enabled'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('physics enabled?');
      this.setOutput(true, 'Boolean');
      this.setColour('#40BF4A');
      this.setTooltip('Returns true if physics is enabled for this object');
    }
  };

  Blockly.Blocks['physics_set_velocity'] = {
    init: function() {
      this.appendValueInput('VX')
        .setCheck('Number')
        .appendField('set velocity x:');
      this.appendValueInput('VY')
        .setCheck('Number')
        .appendField('y:');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set velocity');
    }
  };

  Blockly.Blocks['physics_set_velocity_x'] = {
    init: function() {
      this.appendValueInput('VX')
        .setCheck('Number')
        .appendField('set velocity x to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set horizontal velocity');
    }
  };

  Blockly.Blocks['physics_set_velocity_y'] = {
    init: function() {
      this.appendValueInput('VY')
        .setCheck('Number')
        .appendField('set velocity y to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set vertical velocity');
    }
  };

  Blockly.Blocks['physics_set_gravity'] = {
    init: function() {
      this.appendValueInput('GRAVITY')
        .setCheck('Number')
        .appendField('set gravity to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set gravity strength');
    }
  };

  Blockly.Blocks['physics_set_bounce'] = {
    init: function() {
      this.appendValueInput('BOUNCE')
        .setCheck('Number')
        .appendField('set bounce to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set bounce (0-1)');
    }
  };

  Blockly.Blocks['physics_set_friction'] = {
    init: function() {
      this.appendValueInput('FRICTION')
        .setCheck('Number')
        .appendField('set friction to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set surface friction (0 = slippery, 1 = grippy)');
    }
  };

  Blockly.Blocks['physics_make_dynamic'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('make myself dynamic');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Make this object respond to forces and collisions as a dynamic physics body');
    }
  };

  Blockly.Blocks['physics_make_static'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('make myself static');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Make this object a static physics body, like a platform');
    }
  };

  Blockly.Blocks['physics_ground_on'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('enable ground collision');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Enable ground collision for this object');
    }
  };

  Blockly.Blocks['physics_ground_off'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('disable ground collision');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Disable ground collision for this object');
    }
  };

  // Camera blocks
  Blockly.Blocks['camera_follow_me'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('camera follow me');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Camera follows this object');
    }
  };

  Blockly.Blocks['camera_follow_object'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('camera follow')
        .appendField(new PreservingFieldDropdown(getAllObjectsDropdownOptions), 'TARGET');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Camera follows an object');
      // Add validator for pick from stage (don't exclude current object)
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(false));
    }
  };

  Blockly.Blocks['camera_follow_object_value'] = {
    init: function() {
      this.appendValueInput('TARGET')
        .setCheck('Object')
        .appendField('camera follow');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Camera follows the specified object');
    }
  };

  Blockly.Blocks['camera_stop_follow'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('camera stop following');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Camera stops following');
    }
  };

  Blockly.Blocks['camera_go_to'] = {
    init: function() {
      this.appendValueInput('X')
        .setCheck('Number')
        .appendField('camera go to x:');
      this.appendValueInput('Y')
        .setCheck('Number')
        .appendField('y:');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Move camera to position');
    }
  };

  Blockly.Blocks['camera_shake'] = {
    init: function() {
      this.appendValueInput('DURATION')
        .setCheck('Number')
        .appendField('camera shake for');
      this.appendDummyInput()
        .appendField('seconds');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Shake the camera');
    }
  };

  Blockly.Blocks['camera_zoom'] = {
    init: function() {
      this.appendValueInput('ZOOM')
        .setCheck('Number')
        .appendField('set camera zoom to');
      this.appendDummyInput()
        .appendField('%');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Set camera zoom level');
    }
  };

  Blockly.Blocks['camera_fade'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('camera fade')
        .appendField(new Blockly.FieldDropdown([
          ['in', 'IN'],
          ['out', 'OUT'],
        ]), 'DIRECTION');
      this.appendValueInput('DURATION')
        .setCheck('Number');
      this.appendDummyInput()
        .appendField('seconds');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Fade camera in or out');
    }
  };

  Blockly.Blocks['camera_set_follow_range'] = {
    init: function() {
      this.appendValueInput('WIDTH')
        .setCheck('Number')
        .appendField('set camera follow range width:');
      this.appendValueInput('HEIGHT')
        .setCheck('Number')
        .appendField('height:');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Set how far the target can move from center before camera follows (deadzone)');
    }
  };

  Blockly.Blocks['camera_set_follow_smoothness'] = {
    init: function() {
      this.appendValueInput('SMOOTHNESS')
        .setCheck('Number')
        .appendField('set camera follow smoothness');
      this.appendDummyInput()
        .appendField('%');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Set camera smoothness: 0% = instant, 100% = very smooth');
    }
  };

  Blockly.Blocks['camera_set_follow_offset'] = {
    init: function() {
      this.appendValueInput('X')
        .setCheck('Number')
        .appendField('set camera offset x:');
      this.appendValueInput('Y')
        .setCheck('Number')
        .appendField('y:');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#0fBDA8');
      this.setTooltip('Set camera follow offset from the target center');
    }
  };

  // Sound blocks
  Blockly.Blocks['sound_play'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('play sound')
        .appendField(new PreservingFieldDropdown(getSoundDropdownOptions), 'SOUND');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Play a sound');
    }
  };

  Blockly.Blocks['sound_play_until_done'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('play sound')
        .appendField(new PreservingFieldDropdown(getSoundDropdownOptions), 'SOUND')
        .appendField('until done');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Play sound and wait until finished');
    }
  };

  Blockly.Blocks['sound_stop_all'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('stop all sounds');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Stop all playing sounds');
    }
  };

  Blockly.Blocks['sound_set_volume'] = {
    init: function() {
      this.appendValueInput('VOLUME')
        .setCheck('Number')
        .appendField('set volume to');
      this.appendDummyInput()
        .appendField('%');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Set volume level (0-100)');
    }
  };

  Blockly.Blocks['sound_change_volume'] = {
    init: function() {
      this.appendValueInput('DELTA')
        .setCheck('Number')
        .appendField('change volume by');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Change volume by amount');
    }
  };

  // Advanced events
  Blockly.Blocks['event_when_receive'] = {
    init: function() {
      let messageFieldRef: PreservingMessageFieldDropdown | null = null;
      const messageOptions = () => getMessageDropdownOptions(messageFieldRef?.getValue() ?? null);
      messageFieldRef = new PreservingMessageFieldDropdown(messageOptions);

      this.appendDummyInput()
        .appendField('when I receive')
        .appendField(messageFieldRef, 'MESSAGE');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when message is received');
      const messageField = this.getField('MESSAGE') as Blockly.FieldDropdown;
      if (messageField) messageField.setValidator(createMessageDropdownValidator());
    }
  };

  Blockly.Blocks['event_when_touching'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('when touching')
        .appendField(new PreservingFieldDropdown(getTargetDropdownOptions(true, false, true, true)), 'TARGET');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when touching target');
      // Add validator for pick from stage
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(true));
    }
  };

  Blockly.Blocks['event_when_touching_value'] = {
    init: function() {
      this.appendValueInput('TARGET')
        .setCheck('Object')
        .appendField('when touching');
      this.setInputsInline(true);
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when touching target');
    }
  };

  Blockly.Blocks['event_when_touching_direction'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('when touching')
        .appendField(new PreservingFieldDropdown(getTargetDropdownOptions(true, false, true, true)), 'TARGET')
        .appendField('from')
        .appendField(new Blockly.FieldDropdown(getTouchDirectionOptions()), 'DIRECTION');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when touching target from a specific direction');
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(true));
    }
  };

  Blockly.Blocks['event_when_touching_direction_value'] = {
    init: function() {
      this.appendValueInput('TARGET')
        .setCheck('Object')
        .appendField('when touching');
      this.setInputsInline(true);
      this.appendDummyInput()
        .appendField('from')
        .appendField(new Blockly.FieldDropdown(getTouchDirectionOptions()), 'DIRECTION');
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when touching target from a specific direction');
    }
  };


  // Advanced control
  Blockly.Blocks['control_switch_scene'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('switch scene')
        .appendField(new PreservingSceneFieldDropdown(getSceneDropdownOptions), 'SCENE')
        .appendField('mode')
        .appendField(new Blockly.FieldDropdown([
          ['resume', 'RESUME'],
          ['restart', 'RESTART'],
        ]), 'MODE');
      this.setPreviousStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Switch to another scene (resume = continue where you left off, restart = start fresh)');
    }
  };

  Blockly.Blocks['control_spawn_type_at'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('spawn')
        .appendField(new PreservingFieldDropdown(getComponentTypeDropdownOptions), 'TYPE')
        .appendField('at');
      this.appendValueInput('X')
        .setCheck('Number')
        .appendField('x');
      this.appendValueInput('Y')
        .setCheck('Number')
        .appendField('y');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Spawn a component type at the specified position');
    }
  };

  Blockly.Blocks['control_delete_object'] = {
    init: function() {
      this.appendValueInput('OBJECT')
        .setCheck('Object')
        .appendField('delete');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Delete the specified object');
    }
  };

  Blockly.Blocks['inventory_move_to_inventory'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('move myself to inventory');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Remove this object from the scene and put it into the shared inventory.');
    }
  };

  Blockly.Blocks['inventory_show'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('show inventory');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Show the inventory UI.');
    }
  };

  Blockly.Blocks['inventory_hide'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('hide inventory');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Hide the inventory UI.');
    }
  };

  Blockly.Blocks['inventory_use_dropped_item'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('use the dropped item');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Confirm the dropped inventory item was used and remove it from inventory.');
    }
  };

  Blockly.Blocks['control_broadcast'] = {
    init: function() {
      let messageFieldRef: PreservingMessageFieldDropdown | null = null;
      const messageOptions = () => getMessageDropdownOptions(messageFieldRef?.getValue() ?? null);
      messageFieldRef = new PreservingMessageFieldDropdown(messageOptions);

      this.appendDummyInput()
        .appendField('broadcast')
        .appendField(messageFieldRef, 'MESSAGE');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Send a message to all objects');
      const messageField = this.getField('MESSAGE') as Blockly.FieldDropdown;
      if (messageField) messageField.setValidator(createMessageDropdownValidator());
    }
  };

  Blockly.Blocks['control_broadcast_wait'] = {
    init: function() {
      let messageFieldRef: PreservingMessageFieldDropdown | null = null;
      const messageOptions = () => getMessageDropdownOptions(messageFieldRef?.getValue() ?? null);
      messageFieldRef = new PreservingMessageFieldDropdown(messageOptions);

      this.appendDummyInput()
        .appendField('broadcast')
        .appendField(messageFieldRef, 'MESSAGE')
        .appendField('and wait');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Send a message and wait');
      const messageField = this.getField('MESSAGE') as Blockly.FieldDropdown;
      if (messageField) messageField.setValidator(createMessageDropdownValidator());
    }
  };

  // Additional motion blocks
  Blockly.Blocks['motion_point_towards'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('point towards')
        .appendField(new PreservingFieldDropdown(getTargetDropdownOptions(false, true)), 'TARGET');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Point towards target');
      // Add validator for pick from stage
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(true));
    }
  };

  Blockly.Blocks['motion_point_towards_value'] = {
    init: function() {
      this.appendValueInput('TARGET')
        .setCheck('Object')
        .appendField('point towards');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Point towards target');
    }
  };

  // Rotate animation block
  Blockly.Blocks['motion_rotate_tween'] = {
    init: function() {
      this.appendValueInput('DEGREES')
        .setCheck('Number')
        .appendField('rotate');
      this.appendDummyInput()
        .appendField('° in');
      this.appendValueInput('SECONDS')
        .setCheck('Number');
      this.appendDummyInput()
        .appendField('sec')
        .appendField(new Blockly.FieldDropdown([
          ['linear', 'Linear'],
          ['ease in', 'Quad.easeIn'],
          ['ease out', 'Quad.easeOut'],
          ['ease in-out', 'Quad.easeInOut'],
          ['bounce', 'Bounce.easeOut'],
          ['elastic', 'Elastic.easeOut'],
          ['back', 'Back.easeOut'],
        ]), 'EASING');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Rotate by degrees over time');
    }
  };

  // Attachment blocks - parent/child relationships
  Blockly.Blocks['motion_attach_to_dropdown'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('attach myself to')
        .appendField(new PreservingFieldDropdown(getObjectDropdownOptions), 'TARGET');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Attach this object to another (becomes child)');
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(true));
    }
  };

  Blockly.Blocks['motion_attach_to_block'] = {
    init: function() {
      this.appendValueInput('TARGET')
        .setCheck('Object')
        .appendField('attach myself to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Attach this object to another (becomes child)');
    }
  };

  Blockly.Blocks['motion_attach_dropdown_to_me'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('attach')
        .appendField(new PreservingFieldDropdown(getObjectDropdownOptions), 'TARGET')
        .appendField('to myself');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Attach another object to this one (becomes parent)');
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(true));
    }
  };

  Blockly.Blocks['motion_attach_block_to_me'] = {
    init: function() {
      this.appendValueInput('TARGET')
        .setCheck('Object')
        .appendField('attach');
      this.appendDummyInput()
        .appendField('to myself');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Attach another object to this one (becomes parent)');
    }
  };

  Blockly.Blocks['motion_detach'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('detach from parent');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Detach this object from its parent');
    }
  };

  // Additional looks blocks
  Blockly.Blocks['looks_set_opacity'] = {
    init: function() {
      this.appendValueInput('OPACITY')
        .setCheck('Number')
        .appendField('set opacity to');
      this.appendDummyInput()
        .appendField('%');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Set transparency (0-100)');
    }
  };

  Blockly.Blocks['looks_go_to_front'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('go to front layer');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Move to front of display');
    }
  };

  Blockly.Blocks['looks_go_to_back'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('go to back layer');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#9966FF');
      this.setTooltip('Move to back of display');
    }
  };

  // Operators
  Blockly.Blocks['operator_join'] = {
    init: function() {
      this.appendValueInput('STRING1')
        .appendField('join');
      this.appendValueInput('STRING2');
      this.setInputsInline(true);
      this.setOutput(true, 'String');
      this.setColour('#59C059');
      this.setTooltip('Join two values as text');
    }
  };

  Blockly.Blocks['operator_letter_of'] = {
    init: function() {
      this.appendValueInput('LETTER')
        .setCheck('Number')
        .appendField('letter');
      this.appendValueInput('STRING')
        .appendField('of');
      this.setInputsInline(true);
      this.setOutput(true, 'String');
      this.setColour('#59C059');
      this.setTooltip('Get the letter at position (1-based)');
    }
  };

  Blockly.Blocks['operator_length'] = {
    init: function() {
      this.appendValueInput('STRING')
        .appendField('length of');
      this.setInputsInline(true);
      this.setOutput(true, 'Number');
      this.setColour('#59C059');
      this.setTooltip('Get text length');
    }
  };

  Blockly.Blocks['operator_contains'] = {
    init: function() {
      this.appendValueInput('STRING1');
      this.appendValueInput('STRING2')
        .appendField('contains');
      this.appendDummyInput()
        .appendField('?');
      this.setInputsInline(true);
      this.setOutput(true, 'Boolean');
      this.setColour('#59C059');
      this.setTooltip('Check whether text contains another value');
    }
  };

  Blockly.Blocks['operator_mod'] = {
    init: function() {
      this.appendValueInput('NUM1')
        .setCheck('Number');
      this.appendValueInput('NUM2')
        .setCheck('Number')
        .appendField('mod');
      this.setInputsInline(true);
      this.setOutput(true, 'Number');
      this.setColour('#59C059');
      this.setTooltip('Modulo (remainder) operation');
    }
  };

  Blockly.Blocks['operator_round'] = {
    init: function() {
      this.appendValueInput('NUM')
        .setCheck('Number')
        .appendField('round');
      this.setInputsInline(true);
      this.setOutput(true, 'Number');
      this.setColour('#59C059');
      this.setTooltip('Round to nearest integer');
    }
  };

  Blockly.Blocks['operator_mathop'] = {
    init: function() {
      this.appendDummyInput()
        .appendField(new Blockly.FieldDropdown([
          ['abs', 'ABS'],
          ['floor', 'FLOOR'],
          ['ceiling', 'CEILING'],
          ['sqrt', 'SQRT'],
          ['sin', 'SIN'],
          ['cos', 'COS'],
          ['tan', 'TAN'],
          ['asin', 'ASIN'],
          ['acos', 'ACOS'],
          ['atan', 'ATAN'],
          ['ln', 'LN'],
          ['log', 'LOG'],
          ['e ^', 'EXP'],
          ['10 ^', 'POW10'],
        ]), 'OP')
        .appendField('of');
      this.appendValueInput('NUM')
        .setCheck('Number');
      this.setInputsInline(true);
      this.setOutput(true, 'Number');
      this.setColour('#59C059');
      this.setTooltip('Apply a math operation to a number');
    }
  };

  // Custom math_number block (reporter block with editable number)
  Blockly.Blocks['math_number'] = {
    init: function() {
      this.appendDummyInput()
        .appendField(new Blockly.FieldNumber(0), 'NUM');
      this.setOutput(true, 'Number');
      this.setColour('#59C059');
      this.setTooltip('A number');
    }
  };

  // Text/string block
  Blockly.Blocks['text'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('"')
        .appendField(new Blockly.FieldTextInput(''), 'TEXT')
        .appendField('"');
      this.setOutput(true, 'String');
      this.setColour('#59C059');
      this.setTooltip('A text string');
    }
  };

  // === Typed Variable Blocks ===

  // Typed variable getter - shape depends on type (diamond for boolean, round for others)
  Blockly.Blocks['typed_variable_get'] = {
    init: function() {
      this.appendDummyInput()
        .appendField(new VariableFieldDropdown(() => getVariableDropdownOptions()), 'VAR');
      this.setOutput(true, null); // Allow any type until we resolve variable type
      this.setColour('#FF8C1A');
      this.setTooltip('Get the value of a variable');
    },
    onchange: function(event: Blockly.Events.Abstract) {
      if (event.type === Blockly.Events.BLOCK_CHANGE ||
          event.type === Blockly.Events.BLOCK_CREATE ||
          event.type === Blockly.Events.BLOCK_MOVE) {
        updateVariableBlockAppearance(this);
      }
    }
  };

  // Typed variable setter
  Blockly.Blocks['typed_variable_set'] = {
    init: function() {
      this.appendValueInput('VALUE')
        .appendField('set')
        .appendField(new VariableFieldDropdown(() => getVariableDropdownOptions()), 'VAR')
        .appendField('to');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FF8C1A');
      this.setTooltip('Set the value of a variable');
    },
    onchange: function(event: Blockly.Events.Abstract) {
      if (event.type === Blockly.Events.BLOCK_CHANGE ||
          event.type === Blockly.Events.BLOCK_CREATE ||
          event.type === Blockly.Events.BLOCK_MOVE) {
        validateVariableType(this);
      }
    }
  };

  // Typed variable change (for numeric types only)
  Blockly.Blocks['typed_variable_change'] = {
    init: function() {
      this.appendValueInput('DELTA')
        .appendField('change')
        .appendField(new VariableFieldDropdown(() => getNumericVariableDropdownOptions()), 'VAR')
        .appendField('by');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FF8C1A');
      this.setTooltip('Change a numeric variable by an amount');
    },
    onchange: function(event: Blockly.Events.Abstract) {
      if (event.type === Blockly.Events.BLOCK_CHANGE ||
          event.type === Blockly.Events.BLOCK_CREATE ||
          event.type === Blockly.Events.BLOCK_MOVE) {
        validateNumericInput(this);
      }
    }
  };

  // Boolean literal block (for boolean variables)
  // Zelos renderer automatically uses hexagonal shape for Boolean output type
  Blockly.Blocks['logic_boolean'] = {
    init: function() {
      this.appendDummyInput()
        .appendField(new Blockly.FieldDropdown([
          ['true', 'TRUE'],
          ['false', 'FALSE']
        ]), 'BOOL');
      this.setOutput(true, 'Boolean'); // Zelos renders Boolean as hexagonal/diamond
      this.setColour('#59C059');
      this.setTooltip('A boolean value (true or false)');
    }
  };

  // Debug blocks
  Blockly.Blocks['debug_console_log'] = {
    init: function() {
      this.appendValueInput('VALUE')
        .appendField('console log');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#888888');
      this.setTooltip('Log a value to the debug console');
    }
  };
}

// === Variable Helper Functions ===

// Get all available variables (global + local for current object)
function getAllVariables(): Variable[] {
  const project = useProjectStore.getState().project;
  const selectedSceneId = useEditorStore.getState().selectedSceneId;
  const selectedObjectId = useEditorStore.getState().selectedObjectId;
  const selectedComponentId = useEditorStore.getState().selectedComponentId;

  if (!project) return [];

  // Handle older projects that might not have globalVariables
  const variables: Variable[] = [...(project.globalVariables || [])];

  // Add local variables from current object
  if (selectedSceneId && selectedObjectId) {
    const scene = project.scenes.find(s => s.id === selectedSceneId);
    const obj = scene?.objects.find(o => o.id === selectedObjectId);
    if (obj) {
      const component = obj.componentId
        ? (project.components || []).find((componentItem) => componentItem.id === obj.componentId)
        : null;
      const componentLocalVariables = component?.localVariables || [];
      const localVariables = componentLocalVariables.length > 0
        ? componentLocalVariables
        : (obj.localVariables || []);
      variables.push(...localVariables);
    }
  } else if (selectedComponentId) {
    const component = (project.components || []).find((componentItem) => componentItem.id === selectedComponentId);
    if (component?.localVariables) {
      variables.push(...component.localVariables);
    }
  }

  return variables;
}

// Get dropdown options for all variables
function getVariableDropdownOptions(): Array<[string, string]> {
  const variables = getAllVariables();
  if (variables.length === 0) {
    return [['(no variables)', '']];
  }

  return variables.map(v => {
    const scopePrefix = v.scope === 'local' ? '(local) ' : '';
    const typeLabel = getVariableTypeToken(v.type);
    return [`${scopePrefix}${typeLabel} ${v.name}`, v.id];
  });
}

// Get dropdown options for numeric variables only
function getNumericVariableDropdownOptions(): Array<[string, string]> {
  const variables = getAllVariables().filter(v => v.type === 'integer' || v.type === 'float');
  if (variables.length === 0) {
    return [['(no numeric variables)', '']];
  }

  return variables.map(v => {
    const scopePrefix = v.scope === 'local' ? '(local) ' : '';
    const typeLabel = getVariableTypeToken(v.type);
    return [`${scopePrefix}${typeLabel} ${v.name}`, v.id];
  });
}

function getVariableTypeToken(type: VariableType): string {
  switch (type) {
    case 'string': return 'Text';
    case 'integer': return 'Int';
    case 'float': return 'Float';
    case 'boolean': return 'Bool';
  }
}

// Get variable by ID
function getVariableById(varId: string): Variable | undefined {
  return getAllVariables().find(v => v.id === varId);
}

let typedVariableLoading = false;

function getZelosShapes(block: Blockly.Block): { HEXAGONAL: number; ROUND: number } | null {
  // Get shapes from the workspace renderer
  const workspace = block.workspace as Blockly.WorkspaceSvg | undefined;
  const renderer = workspace?.getRenderer?.();
  const constants = renderer?.getConstants?.();
  const shapes = constants?.SHAPES;
  if (!shapes) return null;
  return {
    HEXAGONAL: shapes.HEXAGONAL,
    ROUND: shapes.ROUND,
  };
}

function setVariableOutputShape(block: Blockly.Block, variable?: Variable) {
  const shapes = getZelosShapes(block);
  if (!shapes) return;
  if (variable?.type === 'boolean') {
    block.setOutputShape(shapes.HEXAGONAL);
  } else if (variable) {
    block.setOutputShape(shapes.ROUND);
  } else {
    block.setOutputShape(null);
  }
}

export function setTypedVariableLoading(isLoading: boolean) {
  typedVariableLoading = isLoading;
}

// Update variable getter block appearance based on type
// Zelos renderer automatically determines shape from output type:
// - Boolean = hexagonal (diamond)
// - Number/String = round
export function updateVariableBlockAppearance(block: Blockly.Block, force: boolean = false) {
  if (typedVariableLoading && !force) {
    return;
  }
  const varId = block.getFieldValue('VAR');
  const variable = getVariableById(varId);

  const output = block.outputConnection;
  if (!output) return;

  let desiredCheck: string | null = null;
  if (variable) {
    if (variable.type === 'boolean') desiredCheck = 'Boolean';
    else if (variable.type === 'string') desiredCheck = 'String';
    else desiredCheck = 'Number';
  }

  if (!output.isConnected()) {
    output.setCheck(desiredCheck);
  } else {
    const targetCheck = output.targetConnection?.getCheck();
    const compatible = !desiredCheck || !targetCheck || targetCheck.includes(desiredCheck);
    if (compatible) {
      output.setCheck(desiredCheck);
    }
    console.log('[Blockly][TypedVar][Connected]', {
      blockId: block.id,
      varId,
      varType: variable?.type,
      outputCheck: output.getCheck(),
      targetCheck,
      desiredCheck,
      compatible,
    });
  }

  // Update shape without affecting connections
  setVariableOutputShape(block, variable);
}

function getTypedVariableOutputCheck(block: Blockly.Block): string | null {
  const variable = getVariableById(block.getFieldValue('VAR'));
  if (!variable) return null;
  if (variable.type === 'boolean') return 'Boolean';
  if (variable.type === 'string') return 'String';
  return 'Number';
}

function getOutputChecks(block: Blockly.Block): string[] | null {
  if (block.type === 'typed_variable_get') {
    const typedCheck = getTypedVariableOutputCheck(block);
    return typedCheck ? [typedCheck] : null;
  }
  const checks = block.outputConnection?.getCheck();
  return checks && checks.length > 0 ? checks : null;
}

function isBlockCompatibleWithExpectedType(expectedType: VariableType, valueBlock: Blockly.Block): boolean {
  const outputChecks = getOutputChecks(valueBlock);
  if (!outputChecks) {
    // Unknown/any output type: don't block the user with a false warning.
    return true;
  }

  if (expectedType === 'integer' || expectedType === 'float') {
    return outputChecks.includes('Number');
  }
  if (expectedType === 'boolean') {
    return outputChecks.includes('Boolean');
  }
  return outputChecks.includes('String');
}

// Validate type for variable set block
function validateVariableType(block: Blockly.Block) {
  const varId = block.getFieldValue('VAR');
  const variable = getVariableById(varId);
  if (!variable) return;

  const valueBlock = block.getInputTargetBlock('VALUE');
  if (!valueBlock) return;

  const isTypeValid = checkTypeCompatibility(variable.type, valueBlock);

  // Visual feedback for type errors
  if (!isTypeValid) {
    block.setWarningText(`Type mismatch: expected ${variable.type}`);
    block.setColour('#CC0000'); // Red for error
  } else {
    block.setWarningText(null);
    block.setColour('#FF8C1A'); // Normal color
  }
}

// Validate numeric input for change block
function validateNumericInput(block: Blockly.Block) {
  const valueBlock = block.getInputTargetBlock('DELTA');
  if (!valueBlock) return;

  const isNumeric = isBlockCompatibleWithExpectedType('float', valueBlock);

  if (!isNumeric) {
    block.setWarningText('Expected a number');
    block.setColour('#CC0000');
  } else {
    block.setWarningText(null);
    block.setColour('#FF8C1A');
  }
}

// Check if a block's output is compatible with expected type
function checkTypeCompatibility(expectedType: VariableType, valueBlock: Blockly.Block): boolean {
  return isBlockCompatibleWithExpectedType(expectedType, valueBlock);
}

// Callbacks for variable category actions - set externally by BlocklyEditor
let addVariableCallback: (() => void) | null = null;
let manageVariablesCallback: (() => void) | null = null;

export function setAddVariableCallback(callback: (() => void) | null) {
  addVariableCallback = callback;
}

export function setManageVariablesCallback(callback: (() => void) | null) {
  manageVariablesCallback = callback;
}

export function setMessageDialogCallback(callback: MessageDialogCallback | null) {
  messageDialogCallback = callback;
}

// Register button callbacks for the Variables category
export function registerTypedVariablesCategory(workspace: Blockly.WorkspaceSvg) {
  workspace.registerButtonCallback('ADD_VARIABLE', () => {
    if (addVariableCallback) {
      addVariableCallback();
    }
  });

  workspace.registerButtonCallback('MANAGE_VARIABLES', () => {
    if (manageVariablesCallback) {
      manageVariablesCallback();
    }
  });
}
