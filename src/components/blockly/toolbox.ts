import * as Blockly from 'blockly';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import type { Variable, VariableType } from '@/types';

// Special value for "pick from stage" option
const PICK_FROM_STAGE = '__PICK_FROM_STAGE__';
// Prefix for "any component instance" option
const COMPONENT_ANY_PREFIX = 'COMPONENT_ANY:';

// Custom FieldDropdown that preserves unknown values (for object IDs that may not be loaded yet)
class PreservingFieldDropdown extends Blockly.FieldDropdown {
  // Override doClassValidation_ to accept any value, not just those in the dropdown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    if (project) {
      // Check global variables
      const globalVar = project.globalVariables?.find(v => v.id === value);
      if (globalVar) {
        return `${getTypeIcon(globalVar.type)} ${globalVar.name}`;
      }

      // Check local variables
      if (selectedSceneId && selectedObjectId) {
        const scene = project.scenes.find(s => s.id === selectedSceneId);
        const obj = scene?.objects.find(o => o.id === selectedObjectId);
        const localVar = obj?.localVariables?.find(v => v.id === value);
        if (localVar) {
          return `(local) ${getTypeIcon(localVar.type)} ${localVar.name}`;
        }
      }
    }

    // Still not found - show placeholder
    return '(unknown variable)';
  }
}

// Store reference to the field being picked for (so callback can update it)
let pendingPickerField: Blockly.FieldDropdown | null = null;

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
    result.push(['🎯 pick from stage...', PICK_FROM_STAGE]);
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

// Dynamic dropdown generator for sound selection (from current object's sounds)
function getSoundDropdownOptions(): Array<[string, string]> {
  const project = useProjectStore.getState().project;
  const selectedSceneId = useEditorStore.getState().selectedSceneId;
  const selectedObjectId = useEditorStore.getState().selectedObjectId;

  if (!project || !selectedSceneId || !selectedObjectId) {
    return [['(no sounds)', '']];
  }

  const scene = project.scenes.find(s => s.id === selectedSceneId);
  const object = scene?.objects.find(o => o.id === selectedObjectId);
  if (!object) {
    return [['(no sounds)', '']];
  }

  // Get sounds from the object (or from its component if it's a component instance)
  let sounds: Array<{ id: string; name: string }> = [];
  if (object.componentId) {
    const component = project.components?.find(c => c.id === object.componentId);
    if (component?.sounds) {
      sounds = component.sounds;
    }
  } else {
    sounds = object.sounds || [];
  }

  if (sounds.length === 0) {
    return [['(no sounds)', '']];
  }

  return sounds.map(sound => [sound.name, sound.id]);
}

// Dropdown with special options + objects
function getTargetDropdownOptions(includeEdge: boolean = false, includeMouse: boolean = false, includeMyClones: boolean = false): () => Array<[string, string]> {
  return function() {
    const specialOptions: Array<[string, string]> = [];
    if (includeEdge) {
      specialOptions.push(['edge', 'EDGE']);
    }
    if (includeMouse) {
      specialOptions.push(['mouse', 'MOUSE']);
    }
    if (includeMyClones) {
      specialOptions.push(['myself (cloned)', 'MY_CLONES']);
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
        if (pendingPickerField) {
          // Update the field value
          pendingPickerField.setValue(pickedObjectId);
          pendingPickerField = null;
        }
      }, excludeId);

      // Return null to prevent the field from changing to PICK_FROM_STAGE
      return null;
    }
    return newValue;
  };
}

// Register custom blocks
registerCustomBlocks();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getToolboxConfig(): any {
  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Events',
        colour: '#FFAB19',
        contents: [
          { kind: 'block', type: 'event_game_start' },
          { kind: 'block', type: 'event_key_pressed' },
          { kind: 'block', type: 'event_clicked' },
          { kind: 'block', type: 'event_forever' },
          { kind: 'block', type: 'event_when_receive' },
          { kind: 'block', type: 'event_when_touching' },
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
          { kind: 'block', type: 'motion_point_towards' },
          { kind: 'block', type: 'motion_my_x' },
          { kind: 'block', type: 'motion_my_y' },
          { kind: 'sep', gap: '16' },
          {
            kind: 'block',
            type: 'motion_rotate_tween',
            inputs: {
              DEGREES: { shadow: { type: 'math_number', fields: { NUM: '90' } } },
              SECONDS: { shadow: { type: 'math_number', fields: { NUM: '1' } } }
            }
          },
          { kind: 'sep', gap: '16' },
          { kind: 'block', type: 'motion_attach_to_dropdown' },
          { kind: 'block', type: 'motion_attach_to_block' },
          { kind: 'block', type: 'motion_attach_block_to_me' },
          { kind: 'block', type: 'motion_attach_dropdown_to_me' },
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
            type: 'looks_set_opacity',
            inputs: {
              OPACITY: { shadow: { type: 'math_number', fields: { NUM: '100' } } }
            }
          },
          { kind: 'block', type: 'looks_go_to_front' },
          { kind: 'block', type: 'looks_go_to_back' },
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
          { kind: 'block', type: 'physics_collide_bounds' },
          { kind: 'block', type: 'physics_immovable' },
          { kind: 'block', type: 'physics_ground_on' },
          { kind: 'block', type: 'physics_ground_off' },
          {
            kind: 'block',
            type: 'physics_set_ground_y',
            inputs: {
              Y: { shadow: { type: 'math_number', fields: { NUM: '500' } } }
            }
          },
          { kind: 'block', type: 'physics_set_ground_color' },
        ],
      },
      {
        kind: 'category',
        name: 'Control',
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
          { kind: 'block', type: 'control_for_each' },
          { kind: 'block', type: 'control_current_item' },
          { kind: 'block', type: 'control_wait_until' },
          { kind: 'block', type: 'controls_if' },
          {
            kind: 'block',
            type: 'controls_if',
            extraState: { hasElse: true },
          },
          { kind: 'block', type: 'control_stop' },
          { kind: 'block', type: 'control_switch_scene' },
          { kind: 'block', type: 'control_clone' },
          { kind: 'block', type: 'control_clone_object' },
          { kind: 'block', type: 'control_delete_clone' },
          { kind: 'block', type: 'control_delete_object' },
          { kind: 'block', type: 'control_broadcast' },
          { kind: 'block', type: 'control_broadcast_wait' },
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
          { kind: 'block', type: 'sensing_touching' },
          { kind: 'block', type: 'sensing_touching_ground' },
          { kind: 'block', type: 'sensing_touching_object' },
          { kind: 'block', type: 'sensing_all_touching_objects' },
          { kind: 'block', type: 'sensing_is_clone_of' },
          { kind: 'block', type: 'sensing_distance_to' },
          { kind: 'block', type: 'sensing_object_x' },
          { kind: 'block', type: 'sensing_object_y' },
          { kind: 'block', type: 'sensing_object_costume' },
        ],
      },
      {
        kind: 'category',
        name: 'Camera',
        colour: '#0fBDA8',
        contents: [
          { kind: 'block', type: 'camera_follow_me' },
          { kind: 'block', type: 'camera_follow_object' },
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
            type: 'camera_set_follow_smoothness',
            inputs: {
              SMOOTHNESS: { shadow: { type: 'math_number', fields: { NUM: '50' } } }
            }
          },
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
          { kind: 'sep', gap: '16' },
          { kind: 'label', text: 'Get Variable' },
          { kind: 'block', type: 'typed_variable_get' },
          { kind: 'sep', gap: '8' },
          { kind: 'label', text: 'Set Variable' },
          { kind: 'block', type: 'typed_variable_set' },
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
        name: 'Debug',
        colour: '#888888',
        contents: [
          { kind: 'block', type: 'debug_console_log' },
        ],
      },
    ],
  };
}

function registerCustomBlocks() {
  // Events
  Blockly.Blocks['event_game_start'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('🏁 When I start');
      this.appendStatementInput('NEXT')
        .setCheck(null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when this object starts (including clones)');
    }
  };

  Blockly.Blocks['event_key_pressed'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('🔑 when')
        .appendField(new Blockly.FieldDropdown([
          ['space', 'SPACE'],
          ['up arrow', 'UP'],
          ['down arrow', 'DOWN'],
          ['left arrow', 'LEFT'],
          ['right arrow', 'RIGHT'],
          ['w', 'W'],
          ['a', 'A'],
          ['s', 'S'],
          ['d', 'D'],
        ]), 'KEY')
        .appendField('pressed');
      this.appendStatementInput('NEXT')
        .setCheck(null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when a key is pressed');
    }
  };

  Blockly.Blocks['event_clicked'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('🖱️ when this clicked');
      this.appendStatementInput('NEXT')
        .setCheck(null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when this object is clicked');
    }
  };

  Blockly.Blocks['event_forever'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('🔄 forever');
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
        .appendField(new Blockly.FieldDropdown([
          ['space', 'SPACE'],
          ['up arrow', 'UP'],
          ['down arrow', 'DOWN'],
          ['left arrow', 'LEFT'],
          ['right arrow', 'RIGHT'],
          ['w', 'W'],
          ['a', 'A'],
          ['s', 'S'],
          ['d', 'D'],
        ]), 'KEY')
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

  Blockly.Blocks['sensing_touching'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('touching')
        .appendField(new PreservingFieldDropdown(getTargetDropdownOptions(true, false, true)), 'TARGET')
        .appendField('?');
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Is this touching something?');
      // Add validator for pick from stage
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(true));
    }
  };

  Blockly.Blocks['sensing_touching_ground'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('touching ground?');
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Is this sprite touching the ground?');
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

  Blockly.Blocks['sensing_touching_object'] = {
    init: function() {
      this.appendDummyInput()
        .appendField("object I'm touching");
      this.setOutput(true, 'Object');
      this.setColour('#5CB1D6');
      this.setTooltip('Returns the object this sprite is touching, or null if not touching anything');
    }
  };

  Blockly.Blocks['sensing_is_clone_of'] = {
    init: function() {
      this.appendValueInput('OBJECT')
        .setCheck('Object');
      this.appendDummyInput()
        .appendField('is clone of')
        .appendField(new Blockly.FieldDropdown(() => {
          const options: [string, string][] = [['myself', 'MYSELF']];
          const project = (window as unknown as { __POCHA_PROJECT__?: { scenes: Array<{ objects: Array<{ id: string; name: string }> }> } }).__POCHA_PROJECT__;
          if (project) {
            for (const scene of project.scenes) {
              for (const obj of scene.objects) {
                options.push([obj.name, obj.id]);
              }
            }
          }
          return options.length > 0 ? options : [['(no objects)', '']];
        }), 'TARGET');
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('Check if an object is a clone of the specified object');
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

  Blockly.Blocks['physics_collide_bounds'] = {
    init: function() {
      this.appendDummyInput()
        .appendField(new Blockly.FieldCheckbox('TRUE'), 'ENABLED')
        .appendField('collide with world bounds');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Enable/disable world bounds collision');
    }
  };

  Blockly.Blocks['physics_immovable'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('make immovable');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Make this object immovable (like a platform)');
    }
  };

  Blockly.Blocks['physics_ground_on'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('turn ground on');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Enable ground collision for this object');
    }
  };

  Blockly.Blocks['physics_ground_off'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('turn ground off');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Disable ground collision for this object');
    }
  };

  Blockly.Blocks['physics_set_ground_y'] = {
    init: function() {
      this.appendValueInput('Y')
        .setCheck('Number')
        .appendField('set ground to y:');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set the Y position of the ground');
    }
  };

  Blockly.Blocks['physics_set_ground_color'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('set ground color to')
        .appendField(new Blockly.FieldTextInput('#8B4513'), 'COLOR');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#40BF4A');
      this.setTooltip('Set the color of the ground (hex color like #8B4513)');
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
      this.appendDummyInput()
        .appendField('when I receive')
        .appendField(new Blockly.FieldTextInput('message1'), 'MESSAGE');
      this.appendStatementInput('NEXT')
        .setCheck(null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when message is received');
    }
  };

  Blockly.Blocks['event_when_touching'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('when touching')
        .appendField(new PreservingFieldDropdown(getTargetDropdownOptions(true, false, true)), 'TARGET');
      this.appendStatementInput('NEXT')
        .setCheck(null);
      this.setColour('#FFAB19');
      this.setTooltip('Runs when touching target');
      // Add validator for pick from stage
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(true));
    }
  };


  // Advanced control
  Blockly.Blocks['control_switch_scene'] = {
    init: function() {
      this.appendDummyInput()
        .appendField(new Blockly.FieldDropdown([
          ['go to', 'RESUME'],
          ['restart', 'RESTART'],
        ]), 'MODE')
        .appendField('scene')
        .appendField(new Blockly.FieldTextInput('Scene 1'), 'SCENE');
      this.setPreviousStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Switch to another scene (go to = resume where you left off, restart = start fresh)');
    }
  };

  Blockly.Blocks['control_clone'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('clone myself');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Create a clone of this object');
    }
  };

  Blockly.Blocks['control_clone_object'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('clone')
        .appendField(new PreservingFieldDropdown(getObjectDropdownOptions), 'TARGET');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Create a clone of the selected object');
      // Add validator for pick from stage
      const targetField = this.getField('TARGET') as Blockly.FieldDropdown;
      if (targetField) targetField.setValidator(createObjectPickerValidator(false));
    }
  };

  Blockly.Blocks['control_delete_clone'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('delete myself');
      this.setPreviousStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Delete this object');
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
      this.setTooltip('Delete the specified object/clone');
    }
  };

  Blockly.Blocks['control_broadcast'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('broadcast')
        .appendField(new Blockly.FieldTextInput('message1'), 'MESSAGE');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Send a message to all objects');
    }
  };

  Blockly.Blocks['control_broadcast_wait'] = {
    init: function() {
      this.appendDummyInput()
        .appendField('broadcast')
        .appendField(new Blockly.FieldTextInput('message1'), 'MESSAGE')
        .appendField('and wait');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFBF00');
      this.setTooltip('Send a message and wait');
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

  if (!project) return [];

  // Handle older projects that might not have globalVariables
  const variables: Variable[] = [...(project.globalVariables || [])];

  // Add local variables from current object
  if (selectedSceneId && selectedObjectId) {
    const scene = project.scenes.find(s => s.id === selectedSceneId);
    const obj = scene?.objects.find(o => o.id === selectedObjectId);
    if (obj?.localVariables) {
      variables.push(...obj.localVariables);
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
    const typeIcon = getTypeIcon(v.type);
    return [`${scopePrefix}${typeIcon} ${v.name}`, v.id];
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
    const typeIcon = getTypeIcon(v.type);
    return [`${scopePrefix}${typeIcon} ${v.name}`, v.id];
  });
}

// Get icon for variable type
function getTypeIcon(type: VariableType): string {
  switch (type) {
    case 'string': return '📝';
    case 'integer': return '#';
    case 'float': return '#.#';
    case 'boolean': return '◇';
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

  const outputType = valueBlock.outputConnection?.getCheck();
  const isNumeric = !outputType || outputType.includes('Number') ||
                    valueBlock.type === 'math_number' ||
                    valueBlock.type === 'typed_variable_get';

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
  const blockType = valueBlock.type;

  switch (expectedType) {
    case 'string':
      return blockType === 'text' ||
             (blockType === 'typed_variable_get' && getVariableById(valueBlock.getFieldValue('VAR'))?.type === 'string');
    case 'integer':
    case 'float':
      return blockType === 'math_number' ||
             blockType === 'math_arithmetic' ||
             blockType === 'math_random_int' ||
             (blockType === 'typed_variable_get' && ['integer', 'float'].includes(getVariableById(valueBlock.getFieldValue('VAR'))?.type || ''));
    case 'boolean':
      return blockType === 'logic_boolean' ||
             blockType === 'logic_compare' ||
             blockType === 'logic_operation' ||
             blockType === 'logic_negate' ||
             blockType === 'sensing_key_pressed' ||
             blockType === 'sensing_mouse_down' ||
             blockType === 'sensing_touching' ||
             blockType === 'sensing_touching_ground' ||
             (blockType === 'typed_variable_get' && getVariableById(valueBlock.getFieldValue('VAR'))?.type === 'boolean');
  }
  return true; // Allow if we can't determine
}

// Callback for "Add Variable" button - set externally by BlocklyEditor
let addVariableCallback: (() => void) | null = null;

export function setAddVariableCallback(callback: (() => void) | null) {
  addVariableCallback = callback;
}

// Register button callbacks for the Variables category
export function registerTypedVariablesCategory(workspace: Blockly.WorkspaceSvg) {
  // Register the "Add Variable" button callback
  workspace.registerButtonCallback('ADD_VARIABLE', () => {
    if (addVariableCallback) {
      addVariableCallback();
    }
  });
}
