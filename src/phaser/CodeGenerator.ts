import * as Blockly from 'blockly';
import { javascriptGenerator, Order } from 'blockly/javascript';

/**
 * Register code generators for all custom blocks.
 * Generated code calls runtime.* methods.
 */
export function registerCodeGenerators(): void {
  // --- Events ---

  javascriptGenerator.forBlock['event_game_start'] = function(block) {
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    // This becomes a registration call
    return `runtime.onGameStart(spriteId, async function() {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_key_pressed'] = function(block) {
    const key = block.getFieldValue('KEY');
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    return `runtime.onKeyPressed(spriteId, '${key}', async function() {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_clicked'] = function(block) {
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    return `runtime.onClicked(spriteId, async function() {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_forever'] = function(block) {
    const statements = javascriptGenerator.statementToCode(block, 'DO');
    return `runtime.forever(spriteId, function() {\n${statements}});\n`;
  };

  javascriptGenerator.forBlock['event_when_touching'] = function(block) {
    const target = block.getFieldValue('TARGET');
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    return `runtime.onTouching(spriteId, '${target}', async function() {\n${nextCode}});\n`;
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
      return 'sprite.pointTowards(runtime.getMouseX(), runtime.getMouseY());\n';
    }
    return `sprite.pointTowards(runtime.getSprite('${target}')?.container.x ?? 0, runtime.getSprite('${target}')?.container.y ?? 0);\n`;
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

  javascriptGenerator.forBlock['control_stop'] = function(block) {
    const option = block.getFieldValue('STOP_OPTION');
    if (option === 'ALL') {
      return 'runtime.stopAll();\nreturn;\n';
    } else {
      return 'runtime.stopSprite(spriteId);\nreturn;\n';
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
    return `runtime.setGroundColor('${color}');\n`;
  };

  // --- Camera ---

  javascriptGenerator.forBlock['camera_follow_me'] = function() {
    return 'runtime.cameraFollowSprite(spriteId);\n';
  };

  javascriptGenerator.forBlock['camera_follow_object'] = function(block) {
    const targetId = block.getFieldValue('TARGET');
    return `runtime.cameraFollowSprite('${targetId}');\n`;
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

  javascriptGenerator.forBlock['camera_set_follow_smoothness'] = function(block) {
    const smoothness = javascriptGenerator.valueToCode(block, 'SMOOTHNESS', Order.ATOMIC) || '50';
    return `runtime.cameraSetFollowSmoothness(${smoothness});\n`;
  };

  // --- Advanced Sensing ---

  javascriptGenerator.forBlock['sensing_touching'] = function(block) {
    const targetId = block.getFieldValue('TARGET');
    return [`runtime.isTouching(spriteId, '${targetId}')`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_touching_ground'] = function() {
    return ['sprite.isTouchingGround()', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_distance_to'] = function(block) {
    const targetId = block.getFieldValue('TARGET');
    return [`runtime.distanceTo(spriteId, '${targetId}')`, Order.FUNCTION_CALL];
  };

  // --- Messages ---

  javascriptGenerator.forBlock['event_when_receive'] = function(block) {
    const message = block.getFieldValue('MESSAGE') || 'message1';
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    return `runtime.onMessage(spriteId, '${message}', async function() {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['control_broadcast'] = function(block) {
    const message = block.getFieldValue('MESSAGE') || 'message1';
    return `runtime.broadcast('${message}');\n`;
  };

  javascriptGenerator.forBlock['control_broadcast_wait'] = function(block) {
    const message = block.getFieldValue('MESSAGE') || 'message1';
    return `await runtime.broadcastAndWait('${message}');\n`;
  };

  // --- Clone ---

  javascriptGenerator.forBlock['control_clone'] = function() {
    return 'runtime.cloneSprite(spriteId);\n';
  };

  javascriptGenerator.forBlock['control_delete_clone'] = function() {
    return 'runtime.deleteClone(spriteId);\n';
  };

  javascriptGenerator.forBlock['event_when_clone_start'] = function(block) {
    const nextCode = javascriptGenerator.statementToCode(block, 'NEXT');
    return `runtime.onCloneStart(spriteId, async function() {\n${nextCode}});\n`;
  };

  // --- Scene Switching ---

  javascriptGenerator.forBlock['control_switch_scene'] = function(block) {
    const sceneName = block.getFieldValue('SCENE') || 'Scene 1';
    return `runtime.switchToScene('${sceneName}');\n`;
  };

  // --- Sound ---

  javascriptGenerator.forBlock['sound_play'] = function(block) {
    const sound = block.getFieldValue('SOUND') || 'pop';
    return `runtime.playSound('${sound}');\n`;
  };

  javascriptGenerator.forBlock['sound_play_until_done'] = function(block) {
    const sound = block.getFieldValue('SOUND') || 'pop';
    return `await runtime.playSoundUntilDone('${sound}');\n`;
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
    return [`runtime.getVariable('${varName}', spriteId)`, Order.ATOMIC];
  };

  javascriptGenerator.forBlock['variables_set'] = function(block) {
    const varName = javascriptGenerator.getVariableName(block.getFieldValue('VAR'));
    const value = javascriptGenerator.valueToCode(block, 'VALUE', Order.ASSIGNMENT) || '0';
    return `runtime.setVariable('${varName}', ${value}, spriteId);\n`;
  };

  // Change variable by
  javascriptGenerator.forBlock['math_change'] = function(block) {
    const varName = javascriptGenerator.getVariableName(block.getFieldValue('VAR'));
    const delta = javascriptGenerator.valueToCode(block, 'DELTA', Order.ASSIGNMENT) || '1';
    return `runtime.changeVariable('${varName}', ${delta}, spriteId);\n`;
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
  'event_when_clone_start',
];

/**
 * Generate executable code for a single game object.
 * Only generates code for hat blocks (event blocks) and their children.
 * Orphan blocks without an event are ignored.
 */
export function generateCodeForObject(blocklyXml: string, objectId: string): string {
  if (!blocklyXml) return '';

  try {
    // Create a hidden workspace to load the XML
    const workspace = new Blockly.Workspace();
    Blockly.Xml.domToWorkspace(
      Blockly.utils.xml.textToDom(blocklyXml),
      workspace
    );

    // Get only top-level hat blocks (event blocks)
    const topBlocks = workspace.getTopBlocks(false);
    const hatBlocks = topBlocks.filter(block => HAT_BLOCKS.includes(block.type));

    // Generate code only for hat blocks
    let code = '';
    for (const block of hatBlocks) {
      const blockCode = javascriptGenerator.blockToCode(block);
      if (blockCode) {
        // blockToCode returns [code, order] for value blocks, just code for statement blocks
        code += typeof blockCode === 'string' ? blockCode : blockCode[0];
      }
    }

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
    return '';
  }
}
