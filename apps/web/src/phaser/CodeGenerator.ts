import * as Blockly from 'blockly';
import { javascriptGenerator, Order } from 'blockly/javascript';
import { normalizeBlocklyXml } from '../../../../packages/ui-shared/src/blocklyXml';

function asJsString(value: string | null | undefined): string {
  return JSON.stringify(value ?? '');
}

let codeGeneratorsRegistered = false;

// Hat blocks (event blocks) that start code execution.
const HAT_BLOCKS = [
  'event_game_start',
  'event_key_pressed',
  'event_clicked',
  'event_world_clicked',
  'event_forever',
  'event_any_inventory_item_dropped',
  'event_inventory_item_dropped',
  'event_when_receive',
  'event_when_touching',
  'event_when_touching_value',
  'event_when_touching_direction',
  'event_when_touching_direction_value',
] as const;

const HAT_BLOCK_TYPES = new Set<string>(HAT_BLOCKS);
const ONE_SHOT_HAT_BLOCKS = new Set<string>(HAT_BLOCKS.filter((blockType) => blockType !== 'event_forever'));

function generateHatBodyFromNextConnection(block: Blockly.Block): string {
  const nextBlock = block.getNextBlock();
  if (!nextBlock) {
    return '';
  }

  const nextCode = javascriptGenerator.blockToCode(nextBlock);
  const rawCode = typeof nextCode === 'string' ? nextCode : nextCode[0];
  return rawCode ? javascriptGenerator.prefixLines(rawCode, javascriptGenerator.INDENT) : '';
}

/**
 * Register code generators for all custom blocks.
 * Generated code calls runtime.* methods.
 */
export function registerCodeGenerators(): void {
  if (codeGeneratorsRegistered) {
    return;
  }
  codeGeneratorsRegistered = true;

  const objectExprToId = (expr: string): string => {
    return `runtime.getTargetId(${expr})`;
  };

  const originalScrub = javascriptGenerator.scrub_;
  javascriptGenerator.scrub_ = function(block, code, thisOnly) {
    if (ONE_SHOT_HAT_BLOCKS.has(block.type)) {
      return originalScrub.call(this, block, code, true);
    }
    return originalScrub.call(this, block, code, thisOnly);
  };

  // --- Events ---

  // Event handlers receive sprite as parameter so they work correctly for clones
  javascriptGenerator.forBlock['event_game_start'] = function(block) {
    const nextCode = generateHatBodyFromNextConnection(block);
    return `runtime.onGameStart(spriteId, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_key_pressed'] = function(block) {
    const key = block.getFieldValue('KEY');
    const nextCode = generateHatBodyFromNextConnection(block);
    return `runtime.onKeyPressed(spriteId, ${asJsString(key)}, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_clicked'] = function(block) {
    const nextCode = generateHatBodyFromNextConnection(block);
    return `runtime.onClicked(spriteId, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_world_clicked'] = function(block) {
    const nextCode = generateHatBodyFromNextConnection(block);
    return `runtime.onWorldClicked(spriteId, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_forever'] = function(block) {
    const statements = javascriptGenerator.statementToCode(block, 'DO');
    // Use sprite.id instead of spriteId so that when this runs inside a clone's
    // onStart handler, it registers the forever loop for the clone, not the original
    return `runtime.forever(sprite.id, async function(sprite) {\n${statements}});\n`;
  };

  javascriptGenerator.forBlock['event_when_touching'] = function(block) {
    const target = block.getFieldValue('TARGET');
    const nextCode = generateHatBodyFromNextConnection(block);
    return `runtime.onTouching(spriteId, ${asJsString(target)}, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_when_touching_value'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    const targetId = objectExprToId(target);
    const nextCode = generateHatBodyFromNextConnection(block);
    return `if (${targetId}) runtime.onTouching(spriteId, ${targetId}, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_when_touching_direction'] = function(block) {
    const target = block.getFieldValue('TARGET');
    const direction = block.getFieldValue('DIRECTION') || 'SIDE';
    const nextCode = generateHatBodyFromNextConnection(block);
    return `runtime.onTouchingDirection(spriteId, ${asJsString(target)}, ${asJsString(direction)}, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_when_touching_direction_value'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    const targetId = objectExprToId(target);
    const direction = block.getFieldValue('DIRECTION') || 'SIDE';
    const nextCode = generateHatBodyFromNextConnection(block);
    return `if (${targetId}) runtime.onTouchingDirection(spriteId, ${targetId}, ${asJsString(direction)}, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_inventory_item_dropped'] = function(block) {
    const item = block.getFieldValue('ITEM');
    const nextCode = generateHatBodyFromNextConnection(block);
    return `runtime.onInventoryDropped(spriteId, ${asJsString(item)}, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['event_any_inventory_item_dropped'] = function(block) {
    const nextCode = generateHatBodyFromNextConnection(block);
    return `runtime.onAnyInventoryDropped(spriteId, async function(sprite) {\n${nextCode}});\n`;
  };

  // --- Motion ---

  javascriptGenerator.forBlock['motion_move_steps'] = function(block) {
    const steps = javascriptGenerator.valueToCode(block, 'STEPS', Order.ATOMIC) || '10';
    return `sprite.moveSteps(${steps});\n`;
  };

  javascriptGenerator.forBlock['motion_move_towards'] = function(block) {
    const x = javascriptGenerator.valueToCode(block, 'X', Order.ATOMIC) || '0';
    const y = javascriptGenerator.valueToCode(block, 'Y', Order.ATOMIC) || '0';
    const steps = javascriptGenerator.valueToCode(block, 'STEPS', Order.ATOMIC) || '10';
    return `sprite.moveTowards(${x}, ${y}, ${steps});\n`;
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

  javascriptGenerator.forBlock['motion_glide_to_speed'] = function(block) {
    const x = javascriptGenerator.valueToCode(block, 'X', Order.ATOMIC) || '0';
    const y = javascriptGenerator.valueToCode(block, 'Y', Order.ATOMIC) || '0';
    const speed = javascriptGenerator.valueToCode(block, 'SPEED', Order.ATOMIC) || '200';
    const easing = block.getFieldValue('EASING') || 'Linear';
    return `await runtime.glideToAtSpeed(sprite.id, ${x}, ${y}, ${speed}, ${asJsString(easing)});\n`;
  };

  javascriptGenerator.forBlock['motion_limit_world_boundary_on'] = function() {
    return 'runtime.setSpriteWorldBoundaryLimited(sprite.id, true);\n';
  };

  javascriptGenerator.forBlock['motion_limit_world_boundary_off'] = function() {
    return 'runtime.setSpriteWorldBoundaryLimited(sprite.id, false);\n';
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

  javascriptGenerator.forBlock['motion_point_towards_value'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    return `{
  const __targetPosition = runtime.getTargetPosition(${target});
  if (__targetPosition) {
    sprite.pointTowards(__targetPosition.x, __targetPosition.y);
  }
}\n`;
  };

  javascriptGenerator.forBlock['motion_my_x'] = function() {
    return ['sprite.getX()', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['motion_my_y'] = function() {
    return ['sprite.getY()', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['motion_is_moving'] = function() {
    return ['sprite.isMoving()', Order.FUNCTION_CALL];
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
    const targetId = objectExprToId(target);
    return `if (${targetId}) runtime.attachTo(sprite.id, ${targetId});\n`;
  };

  javascriptGenerator.forBlock['motion_attach_dropdown_to_me'] = function(block) {
    const target = block.getFieldValue('TARGET');
    return `runtime.attachTo(${asJsString(target)}, sprite.id);\n`;
  };

  javascriptGenerator.forBlock['motion_attach_block_to_me'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    const targetId = objectExprToId(target);
    return `if (${targetId}) runtime.attachTo(${targetId}, sprite.id);\n`;
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

  javascriptGenerator.forBlock['looks_speak'] = function(block) {
    const text = javascriptGenerator.valueToCode(block, 'TEXT', Order.ATOMIC) || "''";
    return `sprite.keepSpeaking(${text});\n`;
  };

  const generateSpeakAndStop = function(block: Blockly.Block) {
    const text = javascriptGenerator.valueToCode(block, 'TEXT', Order.ATOMIC) || "''";
    return `await sprite.speakAndStop(${text});\n`;
  };
  javascriptGenerator.forBlock['looks_speak_and_stop'] = generateSpeakAndStop;
  javascriptGenerator.forBlock['looks_speak_for_seconds'] = generateSpeakAndStop;

  javascriptGenerator.forBlock['looks_stop_speaking'] = function() {
    return 'sprite.stopSpeaking();\n';
  };

  javascriptGenerator.forBlock['looks_target_speak'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    const targetId = objectExprToId(target);
    const text = javascriptGenerator.valueToCode(block, 'TEXT', Order.ATOMIC) || "''";
    return `{
  const __targetId = ${targetId};
  if (__targetId) {
    runtime.getSprite(__targetId)?.keepSpeaking(${text});
  }
}\n`;
  };

  const generateTargetSpeakAndStop = function(block: Blockly.Block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    const targetId = objectExprToId(target);
    const text = javascriptGenerator.valueToCode(block, 'TEXT', Order.ATOMIC) || "''";
    return `{
  const __targetId = ${targetId};
  const __targetSprite = __targetId ? runtime.getSprite(__targetId) : null;
  if (__targetSprite) {
    await __targetSprite.speakAndStop(${text});
  }
}\n`;
  };
  javascriptGenerator.forBlock['looks_target_speak_and_stop'] = generateTargetSpeakAndStop;
  javascriptGenerator.forBlock['looks_target_speak_for_seconds'] = generateTargetSpeakAndStop;

  javascriptGenerator.forBlock['looks_target_stop_speaking'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    const targetId = objectExprToId(target);
    return `{
  const __targetId = ${targetId};
  if (__targetId) {
    runtime.getSprite(__targetId)?.stopSpeaking();
  }
}\n`;
  };

  javascriptGenerator.forBlock['looks_set_size'] = function(block) {
    const size = javascriptGenerator.valueToCode(block, 'SIZE', Order.ATOMIC) || '100';
    return `sprite.setSize(${size});\n`;
  };

  javascriptGenerator.forBlock['looks_change_size'] = function(block) {
    const size = javascriptGenerator.valueToCode(block, 'SIZE', Order.ATOMIC) || '10';
    return `sprite.changeSize(${size});\n`;
  };

  javascriptGenerator.forBlock['looks_change_axis_scale'] = function(block) {
    const axis = block.getFieldValue('AXIS') || 'HORIZONTAL';
    const size = javascriptGenerator.valueToCode(block, 'SIZE', Order.ATOMIC) || '10';
    return `sprite.changeAxisScale(${asJsString(axis)}, ${size});\n`;
  };

  javascriptGenerator.forBlock['looks_flip_axis'] = function(block) {
    const axis = block.getFieldValue('AXIS') || 'HORIZONTAL';
    return `sprite.flipAxis(${asJsString(axis)});\n`;
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

  javascriptGenerator.forBlock['looks_previous_costume'] = function() {
    return 'sprite.previousCostume();\n';
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

  javascriptGenerator.forBlock['control_while'] = function(block) {
    const condition = javascriptGenerator.valueToCode(block, 'CONDITION', Order.ATOMIC) || 'false';
    const statements = javascriptGenerator.statementToCode(block, 'DO');
    return `while (${condition}) {\n${statements}  await runtime.wait(0);\n}\n`;
  };

  javascriptGenerator.forBlock['control_group_block'] = function(block) {
    return javascriptGenerator.statementToCode(block, 'DO');
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

  javascriptGenerator.forBlock['control_random_choice'] = function(block) {
    const branches: string[] = [];
    let i = 0;
    while (block.getInput(`DO${i}`)) {
      branches.push(javascriptGenerator.statementToCode(block, `DO${i}`));
      i++;
    }

    if (branches.length === 0) {
      return '';
    }

    let code = `switch (Math.floor(Math.random() * ${branches.length})) {\n`;
    for (let idx = 0; idx < branches.length; idx++) {
      code += `  case ${idx}:\n${branches[idx]}    break;\n`;
    }
    code += '}\n';
    return code;
  };

  javascriptGenerator.forBlock['control_stop'] = function(block) {
    const option = block.getFieldValue('STOP_OPTION');
    if (option === 'ALL') {
      return 'runtime.stopAll();\nreturn;\n';
    } else {
      return 'runtime.stopSprite(sprite.id);\nreturn;\n';
    }
  };

  // --- Operators ---

  javascriptGenerator.forBlock['operator_join'] = function(block) {
    const string1 = javascriptGenerator.valueToCode(block, 'STRING1', Order.ATOMIC) || "''";
    const string2 = javascriptGenerator.valueToCode(block, 'STRING2', Order.ATOMIC) || "''";
    return [`(String(${string1} ?? '') + String(${string2} ?? ''))`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['operator_letter_of'] = function(block) {
    const letter = javascriptGenerator.valueToCode(block, 'LETTER', Order.ATOMIC) || '1';
    const string = javascriptGenerator.valueToCode(block, 'STRING', Order.ATOMIC) || "''";
    return [
      `((__text, __index) => {
  const __s = String(__text ?? '');
  const __i = Math.floor(Number(__index)) - 1;
  return Number.isFinite(__i) && __i >= 0 && __i < __s.length ? __s.charAt(__i) : '';
})(${string}, ${letter})`,
      Order.FUNCTION_CALL,
    ];
  };

  javascriptGenerator.forBlock['operator_length'] = function(block) {
    const string = javascriptGenerator.valueToCode(block, 'STRING', Order.ATOMIC) || "''";
    return [`String(${string} ?? '').length`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['operator_contains'] = function(block) {
    const string1 = javascriptGenerator.valueToCode(block, 'STRING1', Order.ATOMIC) || "''";
    const string2 = javascriptGenerator.valueToCode(block, 'STRING2', Order.ATOMIC) || "''";
    return [`String(${string1} ?? '').includes(String(${string2} ?? ''))`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['operator_mod'] = function(block) {
    const num1 = javascriptGenerator.valueToCode(block, 'NUM1', Order.ATOMIC) || '0';
    const num2 = javascriptGenerator.valueToCode(block, 'NUM2', Order.ATOMIC) || '0';
    return [
      `((__a, __b) => {
  const a = Number(__a);
  const b = Number(__b);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return ((a % b) + b) % b;
})(${num1}, ${num2})`,
      Order.FUNCTION_CALL,
    ];
  };

  javascriptGenerator.forBlock['operator_round'] = function(block) {
    const num = javascriptGenerator.valueToCode(block, 'NUM', Order.ATOMIC) || '0';
    return [`((__n) => { const n = Number(__n); return Number.isFinite(n) ? Math.round(n) : 0; })(${num})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['operator_mathop'] = function(block) {
    const operation = block.getFieldValue('OP') || 'SQRT';
    const num = javascriptGenerator.valueToCode(block, 'NUM', Order.ATOMIC) || '0';
    return [
      `((__op, __n) => {
  const n = Number(__n);
  if (!Number.isFinite(n)) return 0;
  switch (__op) {
    case 'ABS': return Math.abs(n);
    case 'FLOOR': return Math.floor(n);
    case 'CEILING': return Math.ceil(n);
    case 'SQRT': return Math.sqrt(n);
    case 'SIN': return Math.sin((n * Math.PI) / 180);
    case 'COS': return Math.cos((n * Math.PI) / 180);
    case 'TAN': return Math.tan((n * Math.PI) / 180);
    case 'ASIN': return (Math.asin(n) * 180) / Math.PI;
    case 'ACOS': return (Math.acos(n) * 180) / Math.PI;
    case 'ATAN': return (Math.atan(n) * 180) / Math.PI;
    case 'LN': return Math.log(n);
    case 'LOG': return Math.log10(n);
    case 'EXP': return Math.exp(n);
    case 'POW10': return Math.pow(10, n);
    default: return n;
  }
})(${asJsString(operation)}, ${num})`,
      Order.FUNCTION_CALL,
    ];
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

  javascriptGenerator.forBlock['sensing_timer'] = function() {
    return ['runtime.getTimerSeconds()', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_reset_timer'] = function() {
    return 'runtime.resetTimer();\n';
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

  // --- Camera ---

  javascriptGenerator.forBlock['camera_follow_me'] = function() {
    return 'runtime.cameraFollowSprite(sprite.id);\n';
  };

  javascriptGenerator.forBlock['camera_follow_object'] = function(block) {
    const targetId = block.getFieldValue('TARGET');
    return `runtime.cameraFollowSprite(${asJsString(targetId)});\n`;
  };

  javascriptGenerator.forBlock['camera_follow_object_value'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    const targetId = objectExprToId(target);
    return `if (${targetId}) runtime.cameraFollowSprite(${targetId});\n`;
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

  javascriptGenerator.forBlock['sensing_touching_value'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    const targetId = objectExprToId(target);
    return [`(${targetId} ? runtime.isTouching(sprite.id, ${targetId}) : false)`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_touching_direction'] = function(block) {
    const targetId = block.getFieldValue('TARGET');
    const direction = block.getFieldValue('DIRECTION') || 'SIDE';
    return [`runtime.isTouchingDirection(sprite.id, ${asJsString(targetId)}, ${asJsString(direction)})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_touching_direction_value'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    const targetId = objectExprToId(target);
    const direction = block.getFieldValue('DIRECTION') || 'SIDE';
    return [`(${targetId} ? runtime.isTouchingDirection(sprite.id, ${targetId}, ${asJsString(direction)}) : false)`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_distance_to'] = function(block) {
    const targetId = block.getFieldValue('TARGET');
    return [`runtime.distanceTo(sprite.id, ${asJsString(targetId)})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_distance_to_value'] = function(block) {
    const target = javascriptGenerator.valueToCode(block, 'TARGET', Order.ATOMIC) || 'null';
    const targetId = objectExprToId(target);
    return [`(${targetId} ? runtime.distanceTo(sprite.id, ${targetId}) : 0)`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_touching_object'] = function() {
    return ['runtime.getTouchingObject(sprite.id)', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['object_from_dropdown'] = function(block) {
    const target = block.getFieldValue('TARGET') || '';
    if (!target) {
      return ['null', Order.ATOMIC];
    }
    return [`runtime.getSprite(${asJsString(target)})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['target_mouse'] = function() {
    return [asJsString('MOUSE'), Order.ATOMIC];
  };

  javascriptGenerator.forBlock['target_myself'] = function() {
    return ['sprite', Order.ATOMIC];
  };

  javascriptGenerator.forBlock['target_ground'] = function() {
    return [asJsString('GROUND'), Order.ATOMIC];
  };

  javascriptGenerator.forBlock['target_camera'] = function() {
    return ['runtime.getCameraTarget()', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_my_type'] = function() {
    return ['runtime.getMyType(sprite.id)', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_type_of_object'] = function(block) {
    const obj = javascriptGenerator.valueToCode(block, 'OBJECT', Order.ATOMIC) || 'null';
    return [`runtime.getTypeOf(${obj})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_type_literal'] = function(block) {
    const typeToken = block.getFieldValue('TYPE') || '';
    return [asJsString(typeToken), Order.ATOMIC];
  };

  javascriptGenerator.forBlock['sensing_all_touching_objects'] = function() {
    return ['runtime.getAllTouchingObjects(sprite.id)', Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_object_x'] = function(block) {
    const obj = javascriptGenerator.valueToCode(block, 'OBJECT', Order.ATOMIC) || 'null';
    return [`runtime.getTargetX(${obj})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_object_y'] = function(block) {
    const obj = javascriptGenerator.valueToCode(block, 'OBJECT', Order.ATOMIC) || 'null';
    return [`runtime.getTargetY(${obj})`, Order.FUNCTION_CALL];
  };

  javascriptGenerator.forBlock['sensing_object_costume'] = function(block) {
    const obj = javascriptGenerator.valueToCode(block, 'OBJECT', Order.ATOMIC) || 'null';
    return [`runtime.getTargetCostumeNumber(${obj})`, Order.FUNCTION_CALL];
  };

  // --- Messages ---

  javascriptGenerator.forBlock['event_when_receive'] = function(block) {
    const message = block.getFieldValue('MESSAGE') || '';
    if (!message) {
      return '/* when I receive: message not selected */\n';
    }
    const nextCode = generateHatBodyFromNextConnection(block);
    return `runtime.onMessage(spriteId, ${asJsString(message)}, async function(sprite) {\n${nextCode}});\n`;
  };

  javascriptGenerator.forBlock['control_broadcast'] = function(block) {
    const message = block.getFieldValue('MESSAGE') || '';
    if (!message) {
      return '/* broadcast: message not selected */\n';
    }
    return `runtime.broadcast(${asJsString(message)});\n`;
  };

  javascriptGenerator.forBlock['control_broadcast_wait'] = function(block) {
    const message = block.getFieldValue('MESSAGE') || '';
    if (!message) {
      return '/* broadcast and wait: message not selected */\n';
    }
    return `await runtime.broadcastAndWait(${asJsString(message)});\n`;
  };

  // --- Spawn ---

  javascriptGenerator.forBlock['control_spawn_type_at'] = function(block) {
    const typeToken = block.getFieldValue('TYPE') || '';
    const x = javascriptGenerator.valueToCode(block, 'X', Order.ATOMIC) || '0';
    const y = javascriptGenerator.valueToCode(block, 'Y', Order.ATOMIC) || '0';
    if (!typeToken) {
      return '/* spawn type: type not selected */\n';
    }
    return `await runtime.spawnTypeAt(${asJsString(typeToken)}, ${x}, ${y});\n`;
  };

  javascriptGenerator.forBlock['control_delete_object'] = function(block) {
    const obj = javascriptGenerator.valueToCode(block, 'OBJECT', Order.ATOMIC) || 'null';
    return `runtime.deleteObject(${obj});\n`;
  };

  javascriptGenerator.forBlock['inventory_move_to_inventory'] = function() {
    return 'runtime.moveSpriteToInventory(sprite.id);\n';
  };

  javascriptGenerator.forBlock['inventory_use_dropped_item'] = function() {
    return 'runtime.useDroppedItem();\n';
  };

  javascriptGenerator.forBlock['inventory_show'] = function() {
    return 'runtime.showInventory();\n';
  };

  javascriptGenerator.forBlock['inventory_hide'] = function() {
    return 'runtime.hideInventory();\n';
  };


  // --- Scene Switching ---

  javascriptGenerator.forBlock['control_switch_scene'] = function(block) {
    const sceneRef = block.getFieldValue('SCENE') || '';
    const mode = block.getFieldValue('MODE') || 'RESUME';
    const restart = mode === 'RESTART';
    return `runtime.switchToScene(${asJsString(sceneRef)}, ${restart});\n`;
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
    // Legacy Blockly variables are treated as global-only.
    return [`runtime.getVariable(${asJsString(varName)})`, Order.ATOMIC];
  };

  javascriptGenerator.forBlock['variables_set'] = function(block) {
    const varName = javascriptGenerator.getVariableName(block.getFieldValue('VAR'));
    const value = javascriptGenerator.valueToCode(block, 'VALUE', Order.ASSIGNMENT) || '0';
    return `runtime.setVariable(${asJsString(varName)}, ${value});\n`;
  };

  // Change variable by
  javascriptGenerator.forBlock['math_change'] = function(block) {
    const varName = javascriptGenerator.getVariableName(block.getFieldValue('VAR'));
    const delta = javascriptGenerator.valueToCode(block, 'DELTA', Order.ASSIGNMENT) || '1';
    return `runtime.changeVariable(${asJsString(varName)}, ${delta});\n`;
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

interface GenerateCodeForObjectOptions {
  logErrors?: boolean;
}

function withBlocklyEventsDisabled<T>(callback: () => T): T {
  Blockly.Events.disable();
  try {
    return callback();
  } finally {
    Blockly.Events.enable();
  }
}

function disposeBlocklyWorkspaceSilently(workspace: Blockly.Workspace | null | undefined): void {
  if (!workspace) {
    return;
  }

  try {
    withBlocklyEventsDisabled(() => {
      workspace.dispose();
    });
  } catch {
    // Ignore disposal errors from best-effort headless workspaces.
  }
}

/**
 * Generate executable code for a single game object.
 * Only generates code for hat blocks (event blocks) and their children.
 * Orphan blocks without an event are ignored.
 */
export function generateCodeForObject(
  blocklyXml: string,
  objectId: string,
  options: GenerateCodeForObjectOptions = {},
): string {
  if (!blocklyXml) return '';
  registerCodeGenerators();
  const normalizedBlocklyXml = normalizeBlocklyXml(blocklyXml);
  const logErrors = options.logErrors === true;

  let workspace: Blockly.Workspace | null = null;
  try {
    // Create a hidden workspace to load the XML
    workspace = new Blockly.Workspace();
    const activeWorkspace = workspace;

    // Parse XML
    let xmlDom;
    try {
      xmlDom = Blockly.utils.xml.textToDom(normalizedBlocklyXml);
    } catch (parseError) {
      if (logErrors) {
        console.error('XML parsing error for object', objectId, parseError);
      }
      return '';
    }

    // Load into workspace
    try {
      withBlocklyEventsDisabled(() => {
        Blockly.Xml.domToWorkspace(xmlDom, activeWorkspace);
      });
    } catch (loadError) {
      if (logErrors) {
        console.error('Workspace load error for object', objectId, loadError);
      }
      disposeBlocklyWorkspaceSilently(activeWorkspace);
      return '';
    }

    // IMPORTANT: Initialize the generator with the workspace before generating code
    // This is required for blocks that use provideFunction_ (like math_random_int)
    javascriptGenerator.init(activeWorkspace);

    // Get only top-level hat blocks (event blocks)
    const topBlocks = activeWorkspace.getTopBlocks(false);
    const hatBlocks = topBlocks.filter((block) => HAT_BLOCK_TYPES.has(block.type));

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
        if (logErrors) {
          console.error('Block code generation error for block', block.type, 'in object', objectId, genError);
        }
      }
    }

    // IMPORTANT: Call finish() to get helper function definitions (like mathRandomInt)
    // This prepends any required helper functions to the code
    code = javascriptGenerator.finish(code);

    // Clean up
    disposeBlocklyWorkspaceSilently(activeWorkspace);

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
    if (logErrors) {
      console.error('Code generation error for object', objectId, e);
    }
    disposeBlocklyWorkspaceSilently(workspace);
    return '';
  }
}
