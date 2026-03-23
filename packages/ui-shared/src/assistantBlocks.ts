export type AssistantBlockKind = 'hat' | 'statement' | 'reporter' | 'boolean';

export interface AssistantBlockCatalogEntry {
  type: string;
  category: string;
  kind: AssistantBlockKind;
  summary: string;
  inputNames: string[];
  statementInputNames: string[];
  fieldNames: string[];
}

export interface AssistantBlockNode {
  type: string;
  fields?: Record<string, string | number | boolean>;
  values?: Record<string, AssistantBlockNode>;
  statements?: Record<string, AssistantBlockNode[]>;
}

export interface AssistantBlockProgram {
  formatVersion: 1;
  blocks: AssistantBlockNode[];
}

const BLOCKLY_XML_NS = 'https://developers.google.com/blockly/xml';

const ASSISTANT_BLOCK_CATALOG: readonly AssistantBlockCatalogEntry[] = [
  { type: 'camera_fade', category: 'Camera', kind: 'statement', summary: 'Fade camera in or out', inputNames: ['DURATION'], statementInputNames: [], fieldNames: [] },
  { type: 'camera_follow_object_value', category: 'Camera', kind: 'statement', summary: 'Camera follows the specified object', inputNames: ['TARGET'], statementInputNames: [], fieldNames: [] },
  { type: 'camera_go_to', category: 'Camera', kind: 'statement', summary: 'Move camera to position', inputNames: ['X', 'Y'], statementInputNames: [], fieldNames: [] },
  { type: 'camera_set_follow_offset', category: 'Camera', kind: 'statement', summary: 'Set camera follow offset from the target center', inputNames: ['X', 'Y'], statementInputNames: [], fieldNames: [] },
  { type: 'camera_set_follow_range', category: 'Camera', kind: 'statement', summary: 'Set how far the target can move from center before camera follows (deadzone)', inputNames: ['WIDTH', 'HEIGHT'], statementInputNames: [], fieldNames: [] },
  { type: 'camera_set_follow_smoothness', category: 'Camera', kind: 'statement', summary: 'Set camera smoothness: 0% = instant, 100% = very smooth', inputNames: ['SMOOTHNESS'], statementInputNames: [], fieldNames: [] },
  { type: 'camera_shake', category: 'Camera', kind: 'statement', summary: 'Shake the camera', inputNames: ['DURATION'], statementInputNames: [], fieldNames: [] },
  { type: 'camera_stop_follow', category: 'Camera', kind: 'statement', summary: 'Camera stops following', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'camera_zoom', category: 'Camera', kind: 'statement', summary: 'Set camera zoom level', inputNames: ['ZOOM'], statementInputNames: [], fieldNames: [] },
  { type: 'control_broadcast', category: 'Events', kind: 'statement', summary: 'Send a message to all objects', inputNames: [], statementInputNames: [], fieldNames: ['MESSAGE'] },
  { type: 'control_broadcast_wait', category: 'Events', kind: 'statement', summary: 'Send a message and wait', inputNames: [], statementInputNames: [], fieldNames: ['MESSAGE'] },
  { type: 'control_current_item', category: 'Actions', kind: 'reporter', summary: 'Use inside "for each" loop to get the current item', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'control_delete_object', category: 'Actions', kind: 'statement', summary: 'Delete the specified object', inputNames: ['OBJECT'], statementInputNames: [], fieldNames: [] },
  { type: 'control_for_each', category: 'Actions', kind: 'statement', summary: 'Iterate over each item in a list', inputNames: ['LIST'], statementInputNames: ['DO'], fieldNames: [] },
  { type: 'control_group_block', category: 'Actions', kind: 'statement', summary: 'Group blocks visually without changing behavior', inputNames: [], statementInputNames: ['DO'], fieldNames: ['NAME'] },
  { type: 'control_random_choice', category: 'Actions', kind: 'statement', summary: 'Randomly run one of the branches', inputNames: [], statementInputNames: ['DO0', 'DO1'], fieldNames: [] },
  { type: 'control_repeat', category: 'Actions', kind: 'statement', summary: 'Repeat some number of times', inputNames: ['TIMES'], statementInputNames: ['DO'], fieldNames: [] },
  { type: 'control_repeat_until', category: 'Actions', kind: 'statement', summary: 'Repeat until condition is true', inputNames: ['CONDITION'], statementInputNames: ['DO'], fieldNames: [] },
  { type: 'control_spawn_type_at', category: 'Actions', kind: 'statement', summary: 'Spawn a component type at the specified position', inputNames: ['X', 'Y'], statementInputNames: [], fieldNames: ['TYPE'] },
  { type: 'control_stop', category: 'Actions', kind: 'statement', summary: 'Stop scripts', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'control_switch_scene', category: 'Actions', kind: 'statement', summary: 'Switch to another scene (resume = continue where you left off, restart = start fresh)', inputNames: [], statementInputNames: [], fieldNames: ['SCENE', 'MODE'] },
  { type: 'control_wait', category: 'Actions', kind: 'statement', summary: 'Wait for some seconds', inputNames: ['SECONDS'], statementInputNames: [], fieldNames: [] },
  { type: 'control_wait_until', category: 'Actions', kind: 'statement', summary: 'Wait until condition is true', inputNames: ['CONDITION'], statementInputNames: [], fieldNames: [] },
  { type: 'control_while', category: 'Actions', kind: 'statement', summary: 'Repeat while condition is true', inputNames: ['CONDITION'], statementInputNames: ['DO'], fieldNames: [] },
  { type: 'controls_if', category: 'Actions', kind: 'statement', summary: 'Conditional branch', inputNames: ['IF0'], statementInputNames: ['DO0', 'ELSE'], fieldNames: [] },
  { type: 'debug_console_log', category: 'Debug', kind: 'statement', summary: 'Log a value to the debug console', inputNames: ['VALUE'], statementInputNames: [], fieldNames: [] },
  { type: 'event_clicked', category: 'Events', kind: 'hat', summary: 'Runs when this object is clicked', inputNames: [], statementInputNames: ['NEXT'], fieldNames: [] },
  { type: 'event_any_inventory_item_dropped', category: 'Inventory', kind: 'hat', summary: 'Runs whenever any inventory item is dropped, even if it is not over a valid target', inputNames: [], statementInputNames: ['NEXT'], fieldNames: [] },
  { type: 'event_forever', category: 'Events', kind: 'statement', summary: 'Runs continuously', inputNames: [], statementInputNames: ['DO'], fieldNames: [] },
  { type: 'event_game_start', category: 'Events', kind: 'hat', summary: 'Runs when this object starts (including spawned objects)', inputNames: [], statementInputNames: ['NEXT'], fieldNames: [] },
  { type: 'event_inventory_item_dropped', category: 'Inventory', kind: 'hat', summary: 'Runs when the selected inventory item is dropped on this object', inputNames: [], statementInputNames: ['NEXT'], fieldNames: ['ITEM'] },
  { type: 'event_key_pressed', category: 'Events', kind: 'hat', summary: 'Runs when a key is pressed', inputNames: [], statementInputNames: ['NEXT'], fieldNames: ['KEY'] },
  { type: 'event_world_clicked', category: 'Events', kind: 'hat', summary: 'Runs when the world is clicked', inputNames: [], statementInputNames: ['NEXT'], fieldNames: [] },
  { type: 'event_when_receive', category: 'Events', kind: 'hat', summary: 'Runs when message is received', inputNames: [], statementInputNames: ['NEXT'], fieldNames: ['MESSAGE'] },
  { type: 'event_when_touching_direction_value', category: 'Events', kind: 'hat', summary: 'Runs when touching target from a specific direction', inputNames: ['TARGET'], statementInputNames: ['NEXT'], fieldNames: ['DIRECTION'] },
  { type: 'event_when_touching_value', category: 'Events', kind: 'hat', summary: 'Runs when touching target', inputNames: ['TARGET'], statementInputNames: ['NEXT'], fieldNames: [] },
  { type: 'logic_boolean', category: 'Variables', kind: 'boolean', summary: 'Boolean literal', inputNames: [], statementInputNames: [], fieldNames: ['BOOL'] },
  { type: 'logic_compare', category: 'Operators', kind: 'boolean', summary: 'Compare two values', inputNames: ['A', 'B'], statementInputNames: [], fieldNames: ['OP'] },
  { type: 'logic_negate', category: 'Operators', kind: 'boolean', summary: 'Invert a boolean', inputNames: ['BOOL'], statementInputNames: [], fieldNames: [] },
  { type: 'logic_operation', category: 'Operators', kind: 'boolean', summary: 'Combine booleans with and/or', inputNames: ['A', 'B'], statementInputNames: [], fieldNames: ['OP'] },
  { type: 'looks_change_size', category: 'Looks', kind: 'statement', summary: 'Change size by amount', inputNames: ['SIZE'], statementInputNames: [], fieldNames: [] },
  { type: 'looks_change_axis_scale', category: 'Looks', kind: 'statement', summary: 'Change horizontal or vertical scale by amount', inputNames: ['SIZE'], statementInputNames: [], fieldNames: ['AXIS'] },
  { type: 'looks_costume_number', category: 'Looks', kind: 'reporter', summary: 'Current costume number', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'looks_flip_axis', category: 'Looks', kind: 'statement', summary: 'Flip horizontally or vertically', inputNames: [], statementInputNames: [], fieldNames: ['AXIS'] },
  { type: 'looks_go_to_back', category: 'Looks', kind: 'statement', summary: 'Move to back of display', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'looks_go_to_front', category: 'Looks', kind: 'statement', summary: 'Move to front of display', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'looks_hide', category: 'Looks', kind: 'statement', summary: 'Hide this object', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'looks_next_costume', category: 'Looks', kind: 'statement', summary: 'Switch to the next costume', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'looks_previous_costume', category: 'Looks', kind: 'statement', summary: 'Switch to the previous costume', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'looks_set_opacity', category: 'Looks', kind: 'statement', summary: 'Set transparency (0-100)', inputNames: ['OPACITY'], statementInputNames: [], fieldNames: [] },
  { type: 'looks_set_size', category: 'Looks', kind: 'statement', summary: 'Set size percentage', inputNames: ['SIZE'], statementInputNames: [], fieldNames: [] },
  { type: 'looks_show', category: 'Looks', kind: 'statement', summary: 'Show this object', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'looks_speak', category: 'Looks', kind: 'statement', summary: 'Show a speech bubble and animate the text word by word', inputNames: ['TEXT'], statementInputNames: [], fieldNames: [] },
  { type: 'looks_speak_for_seconds', category: 'Looks', kind: 'statement', summary: 'Speak for a limited number of seconds', inputNames: ['TEXT', 'SECONDS'], statementInputNames: [], fieldNames: [] },
  { type: 'looks_stop_speaking', category: 'Looks', kind: 'statement', summary: 'Hide this object speech bubble', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'looks_target_speak', category: 'Looks', kind: 'statement', summary: 'Make another object speak', inputNames: ['TARGET', 'TEXT'], statementInputNames: [], fieldNames: [] },
  { type: 'looks_target_speak_for_seconds', category: 'Looks', kind: 'statement', summary: 'Make another object speak for a limited number of seconds', inputNames: ['TARGET', 'TEXT', 'SECONDS'], statementInputNames: [], fieldNames: [] },
  { type: 'looks_target_stop_speaking', category: 'Looks', kind: 'statement', summary: 'Make another object stop speaking', inputNames: ['TARGET'], statementInputNames: [], fieldNames: [] },
  { type: 'looks_switch_costume', category: 'Looks', kind: 'statement', summary: 'Switch to costume by name or number', inputNames: ['COSTUME'], statementInputNames: [], fieldNames: [] },
  { type: 'math_arithmetic', category: 'Operators', kind: 'reporter', summary: 'Arithmetic on two numbers', inputNames: ['A', 'B'], statementInputNames: [], fieldNames: ['OP'] },
  { type: 'math_number', category: 'Operators', kind: 'reporter', summary: 'A number', inputNames: [], statementInputNames: [], fieldNames: ['NUM'] },
  { type: 'math_random_int', category: 'Operators', kind: 'reporter', summary: 'Random integer in range', inputNames: ['FROM', 'TO'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_attach_block_to_me', category: 'Motion', kind: 'statement', summary: 'Attach another object to this one (becomes parent)', inputNames: ['TARGET'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_attach_to_block', category: 'Motion', kind: 'statement', summary: 'Attach this object to another (becomes child)', inputNames: ['TARGET'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_change_x', category: 'Motion', kind: 'statement', summary: 'Change x position', inputNames: ['VALUE'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_change_y', category: 'Motion', kind: 'statement', summary: 'Change y position', inputNames: ['VALUE'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_detach', category: 'Motion', kind: 'statement', summary: 'Detach this object from its parent', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'motion_glide_to', category: 'Motion', kind: 'statement', summary: 'Glide smoothly to position over time', inputNames: ['X', 'Y', 'SECONDS'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_glide_to_speed', category: 'Motion', kind: 'statement', summary: 'Glide smoothly to position at a speed', inputNames: ['X', 'Y', 'SPEED'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_go_to', category: 'Motion', kind: 'statement', summary: 'Go to position', inputNames: ['X', 'Y'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_is_moving', category: 'Motion', kind: 'boolean', summary: 'Returns true while this object is translating', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'motion_limit_world_boundary_off', category: 'Motion', kind: 'statement', summary: 'Allow this object to ignore the world boundary', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'motion_limit_world_boundary_on', category: 'Motion', kind: 'statement', summary: 'Keep this object inside the world boundary', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'motion_move_steps', category: 'Motion', kind: 'statement', summary: 'Move forward', inputNames: ['STEPS'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_my_x', category: 'Motion', kind: 'reporter', summary: 'Current x position', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'motion_my_y', category: 'Motion', kind: 'reporter', summary: 'Current y position', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'motion_point_direction', category: 'Motion', kind: 'statement', summary: 'Point in a direction (0-360)', inputNames: ['DIRECTION'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_point_towards_value', category: 'Motion', kind: 'statement', summary: 'Point towards target', inputNames: ['TARGET'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_rotate_tween', category: 'Motion', kind: 'statement', summary: 'Rotate by degrees over time', inputNames: ['DEGREES', 'SECONDS'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_set_x', category: 'Motion', kind: 'statement', summary: 'Set x position', inputNames: ['VALUE'], statementInputNames: [], fieldNames: [] },
  { type: 'motion_set_y', category: 'Motion', kind: 'statement', summary: 'Set y position', inputNames: ['VALUE'], statementInputNames: [], fieldNames: [] },
  { type: 'object_from_dropdown', category: 'Targets', kind: 'reporter', summary: 'Object reference from dropdown', inputNames: [], statementInputNames: [], fieldNames: ['TARGET'] },
  { type: 'operator_contains', category: 'Operators', kind: 'boolean', summary: 'Check whether text contains another value', inputNames: ['STRING1', 'STRING2'], statementInputNames: [], fieldNames: [] },
  { type: 'operator_join', category: 'Operators', kind: 'reporter', summary: 'Join two values as text', inputNames: ['STRING1', 'STRING2'], statementInputNames: [], fieldNames: [] },
  { type: 'operator_length', category: 'Operators', kind: 'reporter', summary: 'Get text length', inputNames: ['STRING'], statementInputNames: [], fieldNames: [] },
  { type: 'operator_letter_of', category: 'Operators', kind: 'reporter', summary: 'Get the letter at position (1-based)', inputNames: ['LETTER', 'STRING'], statementInputNames: [], fieldNames: [] },
  { type: 'operator_mathop', category: 'Operators', kind: 'reporter', summary: 'Apply a math operation to a number', inputNames: ['NUM'], statementInputNames: [], fieldNames: ['OP'] },
  { type: 'operator_mod', category: 'Operators', kind: 'reporter', summary: 'Modulo (remainder) operation', inputNames: ['NUM1', 'NUM2'], statementInputNames: [], fieldNames: [] },
  { type: 'operator_round', category: 'Operators', kind: 'reporter', summary: 'Round to nearest integer', inputNames: ['NUM'], statementInputNames: [], fieldNames: [] },
  { type: 'physics_disable', category: 'Physics', kind: 'statement', summary: 'Disable physics for this object', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'physics_enable', category: 'Physics', kind: 'statement', summary: 'Enable physics for this object', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'physics_enabled', category: 'Physics', kind: 'boolean', summary: 'Returns true if physics is enabled for this object', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'physics_ground_off', category: 'Physics', kind: 'statement', summary: 'Disable ground collision for this object', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'physics_ground_on', category: 'Physics', kind: 'statement', summary: 'Enable ground collision for this object', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'physics_immovable', category: 'Physics', kind: 'statement', summary: 'Make this object immovable (like a platform)', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'physics_set_bounce', category: 'Physics', kind: 'statement', summary: 'Set bounce (0-1)', inputNames: ['BOUNCE'], statementInputNames: [], fieldNames: [] },
  { type: 'physics_set_friction', category: 'Physics', kind: 'statement', summary: 'Set surface friction (0 = slippery, 1 = grippy)', inputNames: ['FRICTION'], statementInputNames: [], fieldNames: [] },
  { type: 'physics_set_gravity', category: 'Physics', kind: 'statement', summary: 'Set gravity strength', inputNames: ['GRAVITY'], statementInputNames: [], fieldNames: [] },
  { type: 'physics_set_ground_y', category: 'Physics', kind: 'statement', summary: 'Set the Y position of the ground', inputNames: ['Y'], statementInputNames: [], fieldNames: [] },
  { type: 'physics_set_velocity', category: 'Physics', kind: 'statement', summary: 'Set velocity', inputNames: ['VX', 'VY'], statementInputNames: [], fieldNames: [] },
  { type: 'physics_set_velocity_x', category: 'Physics', kind: 'statement', summary: 'Set horizontal velocity', inputNames: ['VX'], statementInputNames: [], fieldNames: [] },
  { type: 'physics_set_velocity_y', category: 'Physics', kind: 'statement', summary: 'Set vertical velocity', inputNames: ['VY'], statementInputNames: [], fieldNames: [] },
  { type: 'inventory_move_to_inventory', category: 'Inventory', kind: 'statement', summary: 'Move this object into the shared inventory', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'inventory_show', category: 'Inventory', kind: 'statement', summary: 'Show the inventory UI', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'inventory_hide', category: 'Inventory', kind: 'statement', summary: 'Hide the inventory UI', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'inventory_use_dropped_item', category: 'Inventory', kind: 'statement', summary: 'Consume the inventory item that was just dropped here', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_all_touching_objects', category: 'Sensing', kind: 'reporter', summary: 'All objects touching this object', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_distance_to_value', category: 'Sensing', kind: 'reporter', summary: 'Distance to target', inputNames: ['TARGET'], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_key_pressed', category: 'Sensing', kind: 'boolean', summary: 'Is a key pressed?', inputNames: [], statementInputNames: [], fieldNames: ['KEY'] },
  { type: 'sensing_mouse_down', category: 'Sensing', kind: 'boolean', summary: 'Is mouse button pressed?', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_mouse_x', category: 'Sensing', kind: 'reporter', summary: 'Mouse x position', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_mouse_y', category: 'Sensing', kind: 'reporter', summary: 'Mouse y position', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_my_type', category: 'Sensing', kind: 'reporter', summary: 'Get this object type token', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_object_costume', category: 'Looks', kind: 'reporter', summary: 'Costume number of an object', inputNames: ['OBJECT'], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_object_x', category: 'Motion', kind: 'reporter', summary: 'X position of an object', inputNames: ['OBJECT'], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_object_y', category: 'Motion', kind: 'reporter', summary: 'Y position of an object', inputNames: ['OBJECT'], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_reset_timer', category: 'Sensing', kind: 'statement', summary: 'Reset timer to 0 seconds', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_timer', category: 'Sensing', kind: 'reporter', summary: 'Seconds since game start (2 decimal places)', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_touching_direction_value', category: 'Sensing', kind: 'boolean', summary: 'Is this touching target from a specific direction?', inputNames: ['TARGET'], statementInputNames: [], fieldNames: ['DIRECTION'] },
  { type: 'sensing_touching_object', category: 'Sensing', kind: 'reporter', summary: 'Returns the object this sprite is touching, or null if not touching anything', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_touching_value', category: 'Sensing', kind: 'boolean', summary: 'Is this touching the selected target?', inputNames: ['TARGET'], statementInputNames: [], fieldNames: [] },
  { type: 'sensing_type_literal', category: 'Sensing', kind: 'reporter', summary: 'Component type literal for comparison', inputNames: [], statementInputNames: [], fieldNames: ['TYPE'] },
  { type: 'sensing_type_of_object', category: 'Sensing', kind: 'reporter', summary: 'Component type token of an object', inputNames: ['OBJECT'], statementInputNames: [], fieldNames: [] },
  { type: 'sound_change_volume', category: 'Sound', kind: 'statement', summary: 'Change volume by amount', inputNames: ['DELTA'], statementInputNames: [], fieldNames: [] },
  { type: 'sound_play', category: 'Sound', kind: 'statement', summary: 'Play a sound', inputNames: [], statementInputNames: [], fieldNames: ['SOUND'] },
  { type: 'sound_play_until_done', category: 'Sound', kind: 'statement', summary: 'Play sound and wait until finished', inputNames: [], statementInputNames: [], fieldNames: ['SOUND'] },
  { type: 'sound_set_volume', category: 'Sound', kind: 'statement', summary: 'Set volume level (0-100)', inputNames: ['VOLUME'], statementInputNames: [], fieldNames: [] },
  { type: 'sound_stop_all', category: 'Sound', kind: 'statement', summary: 'Stop all playing sounds', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'target_ground', category: 'Targets', kind: 'reporter', summary: 'Ground target', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'target_camera', category: 'Targets', kind: 'reporter', summary: 'Camera target', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'target_mouse', category: 'Targets', kind: 'reporter', summary: 'Mouse pointer target', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'target_myself', category: 'Targets', kind: 'reporter', summary: 'Current object target', inputNames: [], statementInputNames: [], fieldNames: [] },
  { type: 'text', category: 'Operators', kind: 'reporter', summary: 'A text string', inputNames: [], statementInputNames: [], fieldNames: ['TEXT'] },
  { type: 'typed_variable_change', category: 'Variables', kind: 'statement', summary: 'Change a numeric variable by an amount', inputNames: ['DELTA'], statementInputNames: [], fieldNames: ['VAR'] },
  { type: 'typed_variable_get', category: 'Variables', kind: 'reporter', summary: 'Get the value of a variable', inputNames: [], statementInputNames: [], fieldNames: ['VAR'] },
  { type: 'typed_variable_set', category: 'Variables', kind: 'statement', summary: 'Set the value of a variable', inputNames: ['VALUE'], statementInputNames: [], fieldNames: ['VAR'] },
];

const BLOCK_CATALOG_BY_TYPE = new Map(
  ASSISTANT_BLOCK_CATALOG.map((entry) => [entry.type, entry]),
);

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stringValue(value: string | number | boolean): string {
  return typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
}

function orderKeys(keys: string[], preferred: readonly string[]): string[] {
  const preferredSet = new Set(preferred);
  const orderedPreferred = preferred.filter((key) => keys.includes(key));
  const extras = keys.filter((key) => !preferredSet.has(key)).sort((a, b) => a.localeCompare(b));
  return [...orderedPreferred, ...extras];
}

function isKnownBlockType(type: string): boolean {
  return BLOCK_CATALOG_BY_TYPE.has(type);
}

function isAllowedDynamicValueName(blockType: string, name: string): boolean {
  if (blockType === 'controls_if') {
    return /^IF\d+$/.test(name);
  }
  return false;
}

function isAllowedDynamicStatementName(blockType: string, name: string): boolean {
  if (blockType === 'controls_if') {
    return name === 'ELSE' || /^DO\d+$/.test(name);
  }
  if (blockType === 'control_random_choice') {
    return /^DO\d+$/.test(name);
  }
  return false;
}

function compileBlockChain(nodes: AssistantBlockNode[]): string {
  if (nodes.length === 0) return '';
  const [first, ...rest] = nodes;
  const current = compileBlockNode(first);
  if (rest.length === 0) {
    return current;
  }
  return current.replace(/<\/block>$/, `<next>${compileBlockChain(rest)}</next></block>`);
}

function compileBlockNode(node: AssistantBlockNode): string {
  const entry = getAssistantBlockCatalogEntry(node.type);
  const fieldKeys = orderKeys(Object.keys(node.fields ?? {}), entry?.fieldNames ?? []);
  const valueKeys = orderKeys(Object.keys(node.values ?? {}), entry?.inputNames ?? []);
  const statementKeys = orderKeys(Object.keys(node.statements ?? {}), entry?.statementInputNames ?? []);

  const fields = fieldKeys
    .map((name) => `<field name="${escapeXml(name)}">${escapeXml(stringValue((node.fields ?? {})[name]!))}</field>`)
    .join('');

  const values = valueKeys
    .map((name) => `<value name="${escapeXml(name)}">${compileBlockNode((node.values ?? {})[name]!)}</value>`)
    .join('');

  const statements = statementKeys
    .map((name) => {
      const blocks = (node.statements ?? {})[name] ?? [];
      return `<statement name="${escapeXml(name)}">${compileBlockChain(blocks)}</statement>`;
    })
    .join('');

  return `<block type="${escapeXml(node.type)}">${fields}${values}${statements}</block>`;
}

function validateBlockNode(node: unknown, path: string): string[] {
  const issues: string[] = [];
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return [`${path} must be an object.`];
  }

  const record = node as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type.trim() : '';
  if (!type) {
    issues.push(`${path}.type must be a non-empty string.`);
    return issues;
  }

  const entry = getAssistantBlockCatalogEntry(type);
  if (!entry) {
    issues.push(`${path}.type "${type}" is not in the supported block catalog.`);
  }

  const fields = record.fields;
  const fieldsRecord =
    fields && typeof fields === 'object' && !Array.isArray(fields)
      ? (fields as Record<string, unknown>)
      : null;
  if (fields !== undefined) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      issues.push(`${path}.fields must be an object when provided.`);
    } else {
      for (const [name, value] of Object.entries(fields)) {
        if (entry && !entry.fieldNames.includes(name)) {
          issues.push(`${path}.fields.${name} is not valid for block "${type}".`);
        }
        if (!['string', 'number', 'boolean'].includes(typeof value)) {
          issues.push(`${path}.fields.${name} must be a string, number, or boolean.`);
        }
      }
    }
  }

  if (entry && entry.fieldNames.length > 0) {
    for (const fieldName of entry.fieldNames) {
      if (!fieldsRecord || !(fieldName in fieldsRecord)) {
        issues.push(`${path}.fields.${fieldName} is required for block "${type}".`);
      }
    }
  }

  if (fieldsRecord) {
    const requiredNonEmptyFieldNames = (
      {
        object_from_dropdown: ['TARGET'],
        sensing_touching: ['TARGET'],
        sensing_touching_direction: ['TARGET'],
        sensing_distance_to: ['TARGET'],
        motion_point_towards: ['TARGET'],
        camera_follow_object: ['TARGET'],
        event_when_touching: ['TARGET'],
        event_when_touching_direction: ['TARGET'],
        motion_attach_to_dropdown: ['TARGET'],
        motion_attach_dropdown_to_me: ['TARGET'],
        sound_play: ['SOUND'],
        sound_play_until_done: ['SOUND'],
        typed_variable_get: ['VAR'],
        typed_variable_set: ['VAR'],
        typed_variable_change: ['VAR'],
        control_switch_scene: ['SCENE', 'MODE'],
        control_spawn_type_at: ['TYPE'],
        sensing_type_literal: ['TYPE'],
        event_when_receive: ['MESSAGE'],
        control_broadcast: ['MESSAGE'],
        control_broadcast_wait: ['MESSAGE'],
      } as const satisfies Record<string, readonly string[]>
    )[type] ?? [];

    for (const fieldName of requiredNonEmptyFieldNames) {
      const value = fieldsRecord[fieldName];
      if (typeof value !== 'string' || value.trim().length === 0) {
        issues.push(`${path}.fields.${fieldName} must be a non-empty string for block "${type}".`);
      }
    }
  }

  const values = record.values;
  if (values !== undefined) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      issues.push(`${path}.values must be an object when provided.`);
    } else {
      for (const [name, value] of Object.entries(values)) {
        if (entry && !entry.inputNames.includes(name) && !isAllowedDynamicValueName(type, name)) {
          issues.push(`${path}.values.${name} is not valid for block "${type}".`);
        }
        issues.push(...validateBlockNode(value, `${path}.values.${name}`));
      }
    }
  }

  const statements = record.statements;
  if (statements !== undefined) {
    if (!statements || typeof statements !== 'object' || Array.isArray(statements)) {
      issues.push(`${path}.statements must be an object when provided.`);
    } else {
      for (const [name, value] of Object.entries(statements)) {
        if (entry && !entry.statementInputNames.includes(name) && !isAllowedDynamicStatementName(type, name)) {
          issues.push(`${path}.statements.${name} is not valid for block "${type}".`);
        }
        if (!Array.isArray(value)) {
          issues.push(`${path}.statements.${name} must be an array of blocks.`);
          continue;
        }
        value.forEach((item, index) => {
          issues.push(...validateBlockNode(item, `${path}.statements.${name}[${index}]`));
        });
      }
    }
  }

  return issues;
}

export function getAssistantBlockCatalog(): readonly AssistantBlockCatalogEntry[] {
  return ASSISTANT_BLOCK_CATALOG;
}

export function getAssistantBlockCatalogEntry(blockType: string): AssistantBlockCatalogEntry | null {
  return BLOCK_CATALOG_BY_TYPE.get(blockType) ?? null;
}

export function searchAssistantBlocks({
  query,
  category,
  kind,
  limit = 12,
}: {
  query?: string;
  category?: string;
  kind?: AssistantBlockKind;
  limit?: number;
}): AssistantBlockCatalogEntry[] {
  const normalizedQuery = query?.trim().toLowerCase() ?? '';
  const normalizedCategory = category?.trim().toLowerCase() ?? '';
  const normalizedKind = kind?.trim().toLowerCase() ?? '';

  const ranked = ASSISTANT_BLOCK_CATALOG
    .filter((entry) => !normalizedCategory || entry.category.toLowerCase() === normalizedCategory)
    .filter((entry) => !normalizedKind || entry.kind === normalizedKind)
    .map((entry) => {
      let score = 0;
      if (!normalizedQuery) {
        score = 1;
      } else {
        const haystacks = [
          entry.type.toLowerCase(),
          entry.category.toLowerCase(),
          entry.summary.toLowerCase(),
          ...entry.inputNames.map((name) => name.toLowerCase()),
          ...entry.statementInputNames.map((name) => name.toLowerCase()),
          ...entry.fieldNames.map((name) => name.toLowerCase()),
        ];

        haystacks.forEach((haystack, index) => {
          if (haystack === normalizedQuery) {
            score = Math.max(score, index === 0 ? 120 : 80);
          } else if (haystack.startsWith(normalizedQuery)) {
            score = Math.max(score, index === 0 ? 90 : 60);
          } else if (haystack.includes(normalizedQuery)) {
            score = Math.max(score, index === 0 ? 70 : 40);
          }
        });
      }

      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.type.localeCompare(b.entry.type))
    .slice(0, Math.max(1, Math.min(limit, 50)))
    .map((item) => item.entry);

  return ranked;
}

export function validateAssistantBlockProgram(program: AssistantBlockProgram): string[] {
  const issues: string[] = [];

  if (!program || typeof program !== 'object') {
    return ['Block program must be an object.'];
  }

  if (program.formatVersion !== 1) {
    issues.push('Block program formatVersion must be 1.');
  }

  if (!Array.isArray(program.blocks)) {
    issues.push('Block program blocks must be an array.');
    return issues;
  }

  program.blocks.forEach((block, index) => {
    issues.push(...validateBlockNode(block, `blocks[${index}]`));
  });

  return issues;
}

export function compileAssistantBlockProgram(program: AssistantBlockProgram): string {
  const issues = validateAssistantBlockProgram(program);
  if (issues.length > 0) {
    throw new Error(`Invalid block program: ${issues[0]}`);
  }

  return `<xml xmlns="${BLOCKLY_XML_NS}">${compileBlockChain(program.blocks)}</xml>`;
}

export function isAssistantBlockCatalogInSync(blockTypes: readonly string[]): boolean {
  if (blockTypes.length !== ASSISTANT_BLOCK_CATALOG.length) {
    return false;
  }

  return blockTypes.every((type) => isKnownBlockType(type));
}
