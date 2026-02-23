import * as Blockly from 'blockly';
import { javascriptGenerator, Order } from 'blockly/javascript';

function asJsString(value: string | null | undefined): string {
  return JSON.stringify(value ?? '');
}

/**
 * Register code generators for all custom blocks.
 * Generated code calls runtime.* methods.
 */
export function registerCodeGenerators(): void {
  // --- Events ---

  // Event handlers receive sprite as parameter so they work correctly for clones
  javascriptGenerator.forBlock['event_game_start'] = function(block) {
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    return `runtime.onGameStart(spriteId, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_key_pressed'] = function(block) {
    const key = block.getFieldValue('KEY');
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    return `runtime.onKeyPressed(spriteId, ${asJsString(key)}, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_clicked'] = function(block) {
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    return `runtime.onClicked(spriteId, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_forever'] = function(block) {
    const statements = javascriptGenerator.statementToCode(block, 'DO');
    // Use sprite.id instead of spriteId so that when this runs inside a clone's
    // onStart handler, it registers the forever loop for the clone, not the original
    return `runtime.forever(sprite.id, async function(sprite) {\n${statements}});\n`;
  };

  javascriptGenerator.forBlock['event_when_touching'] = function(block) {
    const target = block.getFieldValue('TARGET');
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    return `runtime.onTouching(spriteId, ${asJsString(target)}, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_when_touching_direction'] = function(block) {
    const target = block.getFieldValue('TARGET');
    const direction = block.getFieldValue('DIRECTION') || 'SIDE';
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    return `runtime.onTouchingDirection(spriteId, ${asJsString(target)}, ${asJsString(direction)}, async function(sprite) {\n${nextCode}});\n`;
  };

  // --- Motion ---

  javascriptGenerator.forBlock['motion_move_steps'] = function(block) {
    const steps = javascriptGenerator.valueToCode(block, 'STEPS', Order.ATOMIC) || '10';
    return `sprite.moveSteps(${steps});\n`;
  };

  javascriptGenerator.forBlock['motion_go_to'] = function(block) {
    const x = javascriptGenerator.valueToCode(block, 'X', Order.ATOMIC) || '0';
    const y = javascriptGenerator.valueToCode(block, 'Y', Order.ATOMIC) || '0';
    return `sprite.goTo(${x}, ${y});\n`;
  };

  javascriptGenerator.forBlock['motion_glide_to'] = function(block) {
    const x = javascriptGenerator.valueToCode(block, 'X', Order.ATOMIC) || '0';
    const y = javascriptGenerator.valueToCode(block, 'Y', Order.ATOMIC) || '0';
    const seconds = javascriptGenerator.valueToCode(block, 'SECONDS', Order.ATOMIC) || '1';
    const easing = block.getFieldValue('EASING') || 'Linear';
    return `await runtime.glideTo(sprite.id, ${x}, ${y}, ${seconds}, ${asJsString(easing)});\n`;
  };

  javascriptGenerator.forBlock['motion_change_x'] = function(block) {
    const value = javascriptGenerator.valueToCode(block, 'VALUE', Order.ATOMIC) || '10';
    return `sprite.changeX(${value});\n`;
  };

  javascriptGenerator.forBlock['motion_change_y'] = function(block) {
    const value = javascriptGenerator.valueToCode(block, 'VALUE', Order.ATOMIC) || '10';
    return `sprite.changeY(${value});\n`;
  };

  javascriptGenerator.forBlock['motion_set_x'] = function(block) {
    const value = javascriptGenerator.valueToCode(block, 'VALUE', Order.ATOMIC) || '0';
    return `sprite.setX(${value});\n`;
  };

  javascriptGenerator.forBlock['motion_set_y'] = function(block) {
    const value = javascriptGenerator.valueToCode(block, 'VALUE', Order.ATOMIC) || '0';
    return `sprite.setY(${value});\n`;
  };

  javascriptGenerator.forBlock['motion_point_direction'] = function(block) {
    const direction = javascriptGenerator.valueToCode(block, 'DIRECTION', Order.ATOMIC) || '90';
    return `sprite.pointInDirection(${direction});\n`;
  };

  javascriptGenerator.forBlock['motion_point_towards'] = function(block) {
    const target = block.getFieldValue('TARGET');
    if (target === 'MOUSE') {
      return 'sprite.pointTowards(runtime.getMouseWorldX(), runtime.getMouseWorldY());\n';
    }
    return `sprite.pointTowards(runtime.getSprite(${asJsString(target)})?.container.x ?? 0, runtime.getSprite(${asJsString(target)})?.container.y ?? 0);\n`;
  };

  javascriptGenerator.forBlock['motion_my_x'] = function() {
    return ['sprite.getX()', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['motion_my_y'] = function() {
    return ['sprite.getY()', Order.FUNCTION_CALL];
  };

  // Rotate animation
  javascriptGenerator.forBlock['motion_rotate_tween'] = function(block) {
    const degrees = javascriptGenerator.valueToCode(block, 'DEGREES', Order.ATOMIC) || '90';
    const seconds = javascriptGenerator.valueToCode(block, 'SECONDS', Order.ATOMIC) || '1';
    const easing = block.getFieldValue('EASING') || 'Linear';
    return `await runtime.rotateTo(sprite.id, ${degrees}, ${seconds}, ${asJsString(easing)});\n`;
  };

  // Attachment blocks
  javascriptGenerator.forBlock['motion_attach_to_dropdown'] = function(block) {
    const target = block.getFieldValue('TARGET');
    return `runtime.attachTo(sprite.id, ${asJsString(target)});\n`;
  };

  javascriptGenerator.forBlock['motion_attach_to_block'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    return `if (${target}) runtime.attachTo(sprite.id, ${target}.id);\n`;
  };

  javascriptGenerator.forBlock['motion_attach_dropdown_to_me'] = function(block) {
    const target = block.getFieldValue('TARGET');
    return `runtime.attachTo(${asJsString(target)}, sprite.id);\n`;
  };

  javascriptGenerator.forBlock['motion_attach_block_to_me'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    return `if (${target}) runtime.attachTo(${target}.id, sprite.id);\n`;
  };

  javascriptGenerator.forBlock['motion_detach'] = function() {
    return 'runtime.detach(sprite.id);\n';
  };

  // --- Looks ---

  javascriptGenerator.forBlock['looks_show'] = function() {
    return 'sprite.show();\n';
  };

  javascriptGenerator.forBlock['looks_hide'] = function() {
    return 'sprite.hide();\n';
  };

  javascriptGenerator.forBlock['looks_set_size'] = function(block) {
    const size = javascriptGenerator.valueToCode(block, 'SIZE', Order.ATOMIC) || '100';
    return `sprite.setSize(${size});\n`;
  };

  javascriptGenerator.forBlock['looks_change_size'] = function(block) {
    const size = javascriptGenerator.valueToCode(block, 'SIZE', Order.ATOMIC) || '10';
    return `sprite.changeSize(${size});\n`;
  };

  javascriptGenerator.forBlock['looks_set_opacity'] = function(block) {
    const opacity = javascriptGenerator.valueToCode(block, 'OPACITY', Order.ATOMIC) || '100';
    return `sprite.setOpacity(${opacity});\n`;
  };

  javascriptGenerator.forBlock['looks_go_to_front'] = function() {
    return 'sprite.goToFront();\n';
  };

  javascriptGenerator.forBlock['looks_go_to_back'] = function() {
    return 'sprite.goToBack();\n';
  };

  javascriptGenerator.forBlock['looks_next_costume'] = function() {
    return 'sprite.nextCostume();\n';
  };

  javascriptGenerator.forBlock['looks_switch_costume'] = function(block) {
    const costume = javascriptGenerator.valueToCode(block, 'COSTUME', Order.ATOMIC) || '1';
    return `sprite.switchCostume(${costume});\n`;
  };

  javascriptGenerator.forBlock['looks_costume_number'] = function() {
    return ['sprite.getCostumeNumber()', Order.FUNCTION_CALL];
  };

  // --- Control ---

  javascriptGenerator.forBlock['control_wait'] = function(block) {
    const seconds = javascriptGenerator.valueToCode(block, 'SECONDS', Order.ATOMIC) || '1';
    return `await runtime.wait(${seconds});\n`;
  };

  javascriptGenerator.forBlock['control_repeat'] = function(block) {
    const times = javascriptGenerator.valueToCode(block, 'TIMES', Order.ATOMIC) || '10';
    const statements = javascriptGenerator.statementToCode(block, 'DO');
    return `for (let i = 0; i < ${times}; i++) {\n${statements}}\n`;
  };

  javascriptGenerator.forBlock['control_repeat_until'] = function(block) {
    const condition = javascriptGenerator.valueToCode(block, 'CONDITION', Order.ATOMIC) || 'false';
    const statements = javascriptGenerator.statementToCode(block, 'DO');
    return `while (!(${condition})) {\n${statements}  await runtime.wait(0);\n}\n`;
  };

  javascriptGenerator.forBlock['control_for_each'] = function(block) {
    const list = javascriptGenerator.valueToCode(block, 'LIST', Order.ATOMIC) || '[]';
    const statements = javascriptGenerator.statementToCode(block, 'DO');
    return `for (const __currentItem__ of (${list} || [])) {\n${statements}}\n`;
  };

  javascriptGenerator.forBlock['control_current_item'] = function() {
    return ['__currentItem__', Order.ATOMIC];
  };

  javascriptGenerator.forBlock['control_wait_until'] = function(block) {
    const condition = javascriptGenerator.valueToCode(block, 'CONDITION', Order.ATOMIC) || 'false';
    return `while (!(${condition})) { await runtime.wait(0); }\n`;
  };

  javascriptGenerator.forBlock['control_stop'] = function(block) {
    const option = block.getFieldValue('STOP_OPTION');
    if (option === 'ALL') {
      return 'runtime.stopAll();\nreturn;\n';
    } else {
      return 'runtime.stopSprite(sprite.id);\nreturn;\n';
    }
  };

  // --- Sensing ---

  javascriptGenerator.forBlock['sensing_key_pressed'] = function(block) {
    const key = block.getFieldValue('KEY');
    return [`runtime.isKeyPressed('${key}')`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_mouse_down'] = function() {
    return ['runtime.isMouseDown()', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_mouse_x'] = function() {
    return ['runtime.getMouseX()', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_mouse_y'] = function() {
    return ['runtime.getMouseY()', Order.FUNCTION_CALL];
  };

  // --- Physics ---

  javascriptGenerator.forBlock['physics_enable'] = function() {
    return 'sprite.enablePhysics();\n';
  };

  javascriptGenerator.forBlock['physics_disable'] = function() {
    return 'sprite.disablePhysics();\n';
  };

  javascriptGenerator.forBlock['physics_enabled'] = function() {
    return ['sprite.isPhysicsEnabled()', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['physics_set_velocity'] = function(block) {
    const vx = javascriptGenerator.valueToCode(block, 'VX', Order.ATOMIC) || '0';
    const vy = javascriptGenerator.valueToCode(block, 'VY', Order.ATOMIC) || '0';
    return `sprite.setVelocity(${vx}, ${vy});\n`;
  };

  javascriptGenerator.forBlock['physics_set_velocity_x'] = function(block) {
    const vx = javascriptGenerator.valueToCode(block, 'VX', Order.ATOMIC) || '0';
    return `sprite.setVelocityX(${vx});\n`;
  };

  javascriptGenerator.forBlock['physics_set_velocity_y'] = function(block) {
    const vy = javascriptGenerator.valueToCode(block, 'VY', Order.ATOMIC) || '0';
    return `sprite.setVelocityY(${vy});\n`;
  };

  javascriptGenerator.forBlock['physics_set_gravity'] = function(block) {
    const gravity = javascriptGenerator.valueToCode(block, 'GRAVITY', Order.ATOMIC) || '300';
    return `sprite.setGravity(${gravity});\n`;
  };

  javascriptGenerator.forBlock['physics_set_bounce'] = function(block) {
    const bounce = javascriptGenerator.valueToCode(block, 'BOUNCE', Order.ATOMIC) || '0.5';
    return `sprite.setBounce(${bounce});\n`;
  };

  javascriptGenerator.forBlock['physics_set_friction'] = function(block) {
    const friction = javascriptGenerator.valueToCode(block, 'FRICTION', Order.ATOMIC) || '0.1';
    return `sprite.setFriction(${friction});\n`;
  };

  javascriptGenerator.forBlock['physics_collide_bounds'] = function(block) {
    const enabled = block.getFieldValue('ENABLED') === 'TRUE';
    return `sprite.setCollideWorldBounds(${enabled});\n`;
  };

  javascriptGenerator.forBlock['physics_immovable'] = function() {
    return 'sprite.makeImmovable();\n';
  };

  javascriptGenerator.forBlock['physics_ground_on'] = function() {
    return 'runtime.setGroundEnabled(true);\n';
  };

  javascriptGenerator.forBlock['physics_ground_off'] = function() {
    return 'runtime.setGroundEnabled(false);\n';
  };

  javascriptGenerator.forBlock['physics_set_ground_y'] = function(block) {
    const y = javascriptGenerator.valueToCode(block, 'Y', Order.ATOMIC) || '500';
    return `runtime.setGroundY(${y});\n`;
  };

  javascriptGenerator.forBlock['physics_set_ground_color'] = function(block) {
    const color = block.getFieldValue('COLOR') || '#8B4513';
    return `runtime.setGroundColor(${asJsString(color)});\n`;
  };

  // --- Camera ---

  javascriptGenerator.forBlock['camera_follow_me'] = function() {
    return 'runtime.cameraFollowSprite(sprite.id);\n';
  };

  javascriptGenerator.forBlock['camera_follow_object'] = function(block) {
    const targetId = block.getFieldValue('TARGET');
    return `runtime.cameraFollowSprite(${asJsString(targetId)});\n`;
  };

  javascriptGenerator.forBlock['camera_stop_follow'] = function() {
    return 'runtime.cameraStopFollow();\n';
  };

  javascriptGenerator.forBlock['camera_go_to'] = function(block) {
    const x = javascriptGenerator.valueToCode(block, 'X', Order.ATOMIC) || '0';
    const y = javascriptGenerator.valueToCode(block, 'Y', Order.ATOMIC) || '0';
    return `runtime.cameraGoTo(${x}, ${y});\n`;
  };

  javascriptGenerator.forBlock['camera_shake'] = function(block) {
    const duration = javascriptGenerator.valueToCode(block, 'DURATION', Order.ATOMIC) || '0.5';
    return `runtime.cameraShake(${duration});\n`;
  };

  javascriptGenerator.forBlock['camera_zoom'] = function(block) {
    const zoom = javascriptGenerator.valueToCode(block, 'ZOOM', Order.ATOMIC) || '100';
    return `runtime.cameraZoom(${zoom});\n`;
  };

  javascriptGenerator.forBlock['camera_fade'] = function(block) {
    const direction = block.getFieldValue('DIRECTION');
    const duration = javascriptGenerator.valueToCode(block, 'DURATION', Order.ATOMIC) || '1';
    if (direction === 'IN') {
      return `runtime.cameraFadeIn(${duration});\n`;
    } else {
      return `runtime.cameraFadeOut(${duration});\n`;
    }
  };

  javascriptGenerator.forBlock['camera_set_follow_range'] = function(block) {
    const width = javascriptGenerator.valueToCode(block, 'WIDTH', Order.ATOMIC) || '100';
    const height = javascriptGenerator.valueToCode(block, 'HEIGHT', Order.ATOMIC) || '100';
    return `runtime.cameraSetFollowRange(${width}, ${height});\n`;
  };

  javascriptGenerator.forBlock['camera_set_follow_offset'] = function(block) {
    const x = javascriptGenerator.valueToCode(block, 'X', Order.ATOMIC) || '0';
    const y = javascriptGenerator.valueToCode(block, 'Y', Order.ATOMIC) || '0';
    return `runtime.cameraSetFollowOffset(${x}, ${y});\n`;
  };

  javascriptGenerator.forBlock['camera_set_follow_smoothness'] = function(block) {
    const smoothness = javascriptGenerator.valueToCode(block, 'SMOOTHNESS', Order.ATOMIC) || '50';
    return `runtime.cameraSetFollowSmoothness(${smoothness});\n`;
  };

  // --- Advanced Sensing ---

  javascriptGenerator.forBlock['sensing_touching'] = function(block) {
    const targetId = block.getFieldValue('TARGET');
    return [`runtime.isTouching(sprite.id, ${asJsString(targetId)})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_touching_direction'] = function(block) {
    const targetId = block.getFieldValue('TARGET');
    const direction = block.getFieldValue('DIRECTION') || 'SIDE';
    return [`runtime.isTouchingDirection(sprite.id, ${asJsString(targetId)}, ${asJsString(direction)})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_touching_ground'] = function() {
    return [`runtime.isTouching(sprite.id, 'GROUND')`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_distance_to'] = function(block) {
    const targetId = block.getFieldValue('TARGET');
    return [`runtime.distanceTo(sprite.id, ${asJsString(targetId)})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_touching_object'] = function() {
    return ['runtime.getTouchingObject(sprite.id)', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_is_clone_of'] = function(block) {
    const obj = javascriptGenerator.valueToCode(block, 'OBJECT', Order.ATOMIC) || 'null';
    const targetId = block.getFieldValue('TARGET');
    if (targetId === 'MYSELF') {
      // Use original object ID (handles case when sprite is itself a clone)
      return [`runtime.isCloneOf(${obj}, sprite.cloneParentId || sprite.id)`, Order.FUNCTION_CALL];
    }
    return [`runtime.isCloneOf(${obj}, ${asJsString(targetId)})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_all_touching_objects'] = function() {
    return ['runtime.getAllTouchingObjects(sprite.id)', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_object_x'] = function(block) {
    const obj = javascriptGenerator.valueToCode(block, 'OBJECT', Order.ATOMIC) || 'null';
    return [`(${obj}?.getX() ?? 0)`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_object_y'] = function(block) {
    const obj = javascriptGenerator.valueToCode(block, 'OBJECT', Order.ATOMIC) || 'null';
    return [`(${obj}?.getY() ?? 0)`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_object_costume'] = function(block) {
    const obj = javascriptGenerator.valueToCode(block, 'OBJECT', Order.ATOMIC) || 'null';
    return [`(${obj}?.getCostumeNumber() ?? 0)`, Order.FUNCTION_CALL];
  };

  // --- Messages ---

  javascriptGenerator.forBlock['event_when_receive'] = function(block) {
    const message = block.getFieldValue('MESSAGE') || 'message1';
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    return `runtime.onMessage(spriteId, ${asJsString(message)}, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['control_broadcast'] = function(block) {
    const message = block.getFieldValue('MESSAGE') || 'message1';
    return `runtime.broadcast(${asJsString(message)});\n`;
  };

  javascriptGenerator.forBlock['control_broadcast_wait'] = function(block) {
    const message = block.getFieldValue('MESSAGE') || 'message1';
    return `await runtime.broadcastAndWait(${asJsString(message)});\n`;
  };

  // --- Clone ---

  javascriptGenerator.forBlock['control_clone'] = function() {
    return 'await runtime.cloneSprite(sprite.id);\n';
  };

  javascriptGenerator.forBlock['control_clone_object'] = function(block) {
    const targetId = block.getFieldValue('TARGET') || '';
    // If targetId is empty, skip cloning
    if (!targetId) {
      return '/* clone target not set */\n';
    }
    return `await runtime.cloneSprite(${asJsString(targetId)});\n`;
  };

  javascriptGenerator.forBlock['control_delete_clone'] = function() {
    return 'runtime.deleteSelf(sprite.id);\n';
  };

  javascriptGenerator.forBlock['control_delete_object'] = function(block) {
    const obj = javascriptGenerator.valueToCode(block, 'OBJECT', Order.ATOMIC) || 'null';
    return `runtime.deleteObject(${obj});\n`;
  };


  // --- Scene Switching ---

  javascriptGenerator.forBlock['control_switch_scene'] = function(block) {
    const sceneName = block.getFieldValue('SCENE') || 'Scene 1';
    const mode = block.getFieldValue('MODE') || 'RESUME';
    const restart = mode === 'RESTART';
    return `runtime.switchToScene(${asJsString(sceneName)}, ${restart});\n`;
  };

  // --- Sound ---

  javascriptGenerator.forBlock['sound_play'] = function(block) {
    const sound = block.getFieldValue('SOUND') || 'pop';
    return `runtime.playSound(${asJsString(sound)});\n`;
  };

  javascriptGenerator.forBlock['sound_play_until_done'] = function(block) {
    const sound = block.getFieldValue('SOUND') || 'pop';
    return `await runtime.playSoundUntilDone(${asJsString(sound)});\n`;
  };

  javascriptGenerator.forBlock['sound_stop_all'] = function() {
    return 'runtime.stopAllSounds();\n';
  };

  javascriptGenerator.forBlock['sound_set_volume'] = function(block) {
    const volume = javascriptGenerator.valueToCode(block, 'VOLUME', Order.ATOMIC) || '100';
    return `runtime.setVolume(${volume});\n`;
  };

  javascriptGenerator.forBlock['sound_change_volume'] = function(block) {
    const delta = javascriptGenerator.valueToCode(block, 'DELTA', Order.ATOMIC) || '-10';
    return `runtime.changeVolume(${delta});\n`;
  };

  // --- Variable generators ---
  // Override the default variable getter/setter to use runtime

  javascriptGenerator.forBlock['variables_get'] = function(block) {
    const varName = javascriptGenerator.getVariableName(block.getFieldValue('VAR'));
    return [`runtime.getVariable('${varName}', sprite.id)`, Order.ATOMIC];
  };

  javascriptGenerator.forBlock['variables_set'] = function(block) {
    const varName = javascriptGenerator.getVariableName(block.getFieldValue('VAR'));
    const value = javascriptGenerator.valueToCode(block, 'VALUE', Order.ASSIGNMENT) || '0';
    return `runtime.setVariable('${varName}', ${value}, sprite.id);\n`;
  };

  // Change variable by
  javascriptGenerator.forBlock['math_change'] = function(block) {
    const varName = javascriptGenerator.getVariableName(block.getFieldValue('VAR'));
    const delta = javascriptGenerator.valueToCode(block, 'DELTA', Order.ASSIGNMENT) || '1';
    return `runtime.changeVariable('${varName}', ${delta}, sprite.id);\n`;
  };

  // --- Typed Variable generators ---

  javascriptGenerator.forBlock['typed_variable_get'] = function(block) {
    try {
      const varId = block.getFieldValue('VAR') || '';
      // If no variable is selected (empty ID), return 0 as a safe default
      if (!varId) {
        return ['0 /* no variable selected */', Order.ATOMIC];
      }
      // Use variable ID to get value - runtime will resolve name from store
      return [`runtime.getTypedVariable('${varId}', sprite.id)`, Order.ATOMIC];
    } catch (e) {
      console.error('Error in typed_variable_get generator:', e);
      return ['0 /* error */', Order.ATOMIC];
    }
  };

  javascriptGenerator.forBlock['typed_variable_set'] = function(block) {
    const varId = block.getFieldValue('VAR') || '';
    // If no variable is selected, skip the operation
    if (!varId) {
      return '/* no variable selected */\n';
    }
    const value = javascriptGenerator.valueToCode(block, 'VALUE', Order.ASSIGNMENT) || '0';
    return `runtime.setTypedVariable('${varId}', ${value}, sprite.id);\n`;
  };

  javascriptGenerator.forBlock['typed_variable_change'] = function(block) {
    const varId = block.getFieldValue('VAR') || '';
    // If no variable is selected, skip the operation
    if (!varId) {
      return '/* no variable selected */\n';
    }
    const delta = javascriptGenerator.valueToCode(block, 'DELTA', Order.ASSIGNMENT) || '1';
    return `runtime.changeTypedVariable('${varId}', ${delta}, sprite.id);\n`;
  };

  // Boolean literal
  javascriptGenerator.forBlock['logic_boolean'] = function(block) {
    const value = block.getFieldValue('BOOL') === 'TRUE';
    return [value ? 'true' : 'false', Order.ATOMIC];
  };

  // Debug
  javascriptGenerator.forBlock['debug_console_log'] = function(block) {
    const value = javascriptGenerator.valueToCode(block, 'VALUE', Order.ATOMIC) || "''";
    return `runtime.consoleLog(${value});\n`;
  };
}

// Hat blocks (event blocks) that start code execution
const HAT_BLOCKS = [
  'event_game_start',
  'event_key_pressed',
  'event_clicked',
  'event_forever',
  'event_when_receive',
  'event_when_touching',
  'event_when_touching_direction',
];

/**
 * Generate executable code for a single game object.
 * Only generates code for hat blocks (event blocks) and their children.
 * Orphan blocks without an event are ignored.
 */
export function generateCodeForObject(blocklyXml: string, objectId: string): string {
  if (!blocklyXml) return '';

  let workspace: Blockly.Workspace | null = null;
  try {
    // Create a hidden workspace to load the XML
    workspace = new Blockly.Workspace();

    // Parse XML
    let xmlDom;
    try {
      xmlDom = Blockly.utils.xml.textToDom(blocklyXml);
    } catch (parseError) {
      console.error('XML parsing error for object', objectId, parseError);
      return '';
    }

    // Load into workspace
    try {
      Blockly.Xml.domToWorkspace(xmlDom, workspace);
    } catch (loadError) {
      console.error('Workspace load error for object', objectId, loadError);
      workspace.dispose();
      return '';
    }

    // IMPORTANT: Initialize the generator with the workspace before generating code
    // This is required for blocks that use provideFunction_ (like math_random_int)
    javascriptGenerator.init(workspace);

    // Get only top-level hat blocks (event blocks)
    const topBlocks = workspace.getTopBlocks(false);
    const hatBlocks = topBlocks.filter(block => HAT_BLOCKS.includes(block.type));

    // Generate code only for hat blocks
    let code = '';
    for (const block of hatBlocks) {
      try {
        const blockCode = javascriptGenerator.blockToCode(block);
        if (blockCode) {
          // blockToCode returns [code, order] for value blocks, just code for statement blocks
          code += typeof blockCode === 'string' ? blockCode : blockCode[0];
        }
      } catch (genError) {
        console.error('Block code generation error for block', block.type, 'in object', objectId, genError);
      }
    }

    // IMPORTANT: Call finish() to get helper function definitions (like mathRandomInt)
    // This prepends any required helper functions to the code
    code = javascriptGenerator.finish(code);

    // Clean up
    workspace.dispose();

    // If no hat blocks, return empty
    if (!code.trim()) {
      return '';
    }

    // Wrap in a function that receives runtime context
    // IMPORTANT: No newline before the opening paren, or `return ${code}` will fail due to ASI
    return `(function(runtime, spriteId, sprite) {
${code}
})`;
  } catch (e) {
    console.error('Code generation error for object', objectId, e);
    if (workspace) {
      try { workspace.dispose(); } catch { /* ignore */ }
    }
    return '';
  }
}
