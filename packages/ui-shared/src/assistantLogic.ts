import { DOMParser } from '@xmldom/xmldom';
import { normalizeBlocklyXml } from './blocklyXml';
import { assistantStatementUsesNextConnection } from './assistantBlocks';

export type AssistantLogicTrigger =
  | { kind: 'on_start' }
  | { kind: 'forever' }
  | { kind: 'on_key_pressed'; key: string }
  | { kind: 'on_clicked' };

export type AssistantLogicConditionAtom =
  | { kind: 'key_pressed'; key: string }
  | { kind: 'touching_ground' };

export type AssistantLogicCondition =
  | AssistantLogicConditionAtom
  | { kind: 'all'; conditions: AssistantLogicConditionAtom[] }
  | { kind: 'any'; conditions: AssistantLogicConditionAtom[] }
  | { kind: 'not'; condition: AssistantLogicConditionAtom };

export type AssistantLogicPrimitiveAction =
  | { kind: 'set_velocity'; x: number; y: number }
  | { kind: 'set_velocity_x'; value: number }
  | { kind: 'set_velocity_y'; value: number }
  | { kind: 'change_x'; value: number }
  | { kind: 'change_y'; value: number }
  | { kind: 'wait'; seconds: number }
  | { kind: 'broadcast'; message: string; wait?: boolean };

export type AssistantLogicAction =
  | AssistantLogicPrimitiveAction
  | {
      kind: 'if';
      condition: AssistantLogicCondition;
      thenActions: AssistantLogicPrimitiveAction[];
      elseActions?: AssistantLogicPrimitiveAction[];
    };

export interface AssistantLogicScript {
  trigger: AssistantLogicTrigger;
  actions: AssistantLogicAction[];
}

export interface AssistantLogicProgram {
  formatVersion: 1;
  scripts: AssistantLogicScript[];
}

export interface AssistantLogicOverview {
  hasLogic: boolean;
  editableWith: 'set_object_logic' | 'set_component_logic';
  blockTypes: string[];
  summary: string;
  generatedCode?: string;
  generatedCodeTruncated?: boolean;
}

const BLOCKLY_XML_NS = 'https://developers.google.com/blockly/xml';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeLogicKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) return '';

  if (trimmed.length === 1 && /[a-z0-9]/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const upper = trimmed.toUpperCase();
  switch (upper) {
    case ' ':
    case 'SPACEBAR':
      return 'SPACE';
    case 'ESC':
      return 'ESCAPE';
    case 'RETURN':
      return 'ENTER';
    case 'ARROWUP':
      return 'UP';
    case 'ARROWDOWN':
      return 'DOWN';
    case 'ARROWLEFT':
      return 'LEFT';
    case 'ARROWRIGHT':
      return 'RIGHT';
    case 'CONTROL':
      return 'CTRL';
    case 'COMMAND':
    case 'CMD':
      return 'META';
    default:
      return upper;
  }
}

function extractBlocklyBlockTypes(blocklyXml: string): string[] {
  const blockTypes: string[] = [];
  const seen = new Set<string>();
  const pattern = /<(?:block|shadow)\b[^>]*type=(["'])([^"']+)\1/gi;

  for (let match = pattern.exec(blocklyXml); match; match = pattern.exec(blocklyXml)) {
    const blockType = match[2]?.trim();
    if (!blockType || seen.has(blockType)) continue;
    seen.add(blockType);
    blockTypes.push(blockType);
  }

  return blockTypes;
}

function summarizeScriptTrigger(trigger: AssistantLogicTrigger): string {
  switch (trigger.kind) {
    case 'on_start':
      return 'on_start';
    case 'forever':
      return 'forever';
    case 'on_clicked':
      return 'on_clicked';
    case 'on_key_pressed':
      return `on_key_pressed(${normalizeLogicKey(trigger.key)})`;
  }
}

function summarizeAction(action: AssistantLogicAction): string {
  switch (action.kind) {
    case 'set_velocity':
      return `set_velocity(${action.x},${action.y})`;
    case 'set_velocity_x':
      return `set_velocity_x(${action.value})`;
    case 'set_velocity_y':
      return `set_velocity_y(${action.value})`;
    case 'change_x':
      return `change_x(${action.value})`;
    case 'change_y':
      return `change_y(${action.value})`;
    case 'wait':
      return `wait(${action.seconds})`;
    case 'broadcast':
      return action.wait ? `broadcast_wait(${action.message})` : `broadcast(${action.message})`;
    case 'if':
      return `if(${action.condition.kind})`;
  }
}

function summarizeUnknownAction(action: unknown): string {
  if (!action || typeof action !== 'object' || typeof (action as { kind?: unknown }).kind !== 'string') {
    return 'invalid_action';
  }

  try {
    return summarizeAction(action as AssistantLogicAction);
  } catch {
    return `invalid_${(action as { kind: string }).kind}`;
  }
}

type BlocklyProjectionNode = {
  type: string;
  fields: Record<string, string>;
  values: Record<string, BlocklyProjectionNode>;
  statements: Record<string, BlocklyProjectionNode>;
  next: BlocklyProjectionNode | null;
};

type LogicProjectionOptions = {
  codeMode?: 'preview' | 'full';
  maxChars?: number;
  maxLines?: number;
};

type LogicProjectionResult = {
  code: string;
  truncated: boolean;
};

const DEFAULT_LOGIC_PREVIEW_CHAR_LIMIT = 1600;
const DEFAULT_LOGIC_PREVIEW_LINE_LIMIT = 32;

function getElementChildren(node: any): any[] {
  const children: any[] = [];
  const childNodes = node?.childNodes ?? [];
  for (let index = 0; index < childNodes.length; index += 1) {
    const child = childNodes[index];
    if (child?.nodeType === 1) {
      children.push(child);
    }
  }
  return children;
}

function getFirstChildBlock(node: any): any | null {
  return getElementChildren(node).find((child) => {
    const tagName = String(child?.tagName ?? '').toLowerCase();
    return tagName === 'block' || tagName === 'shadow';
  }) ?? null;
}

function parseBlocklyProjectionNode(element: any): BlocklyProjectionNode {
  const fields: Record<string, string> = {};
  const values: Record<string, BlocklyProjectionNode> = {};
  const statements: Record<string, BlocklyProjectionNode> = {};
  let next: BlocklyProjectionNode | null = null;

  for (const child of getElementChildren(element)) {
    const tagName = String(child?.tagName ?? '').toLowerCase();
    const name = String(child?.getAttribute?.('name') ?? '');
    switch (tagName) {
      case 'field':
        if (name) {
          fields[name] = String(child.textContent ?? '').trim();
        }
        break;
      case 'value': {
        const block = getFirstChildBlock(child);
        if (name && block) {
          values[name] = parseBlocklyProjectionNode(block);
        }
        break;
      }
      case 'statement': {
        const block = getFirstChildBlock(child);
        if (name && block) {
          statements[name] = parseBlocklyProjectionNode(block);
        }
        break;
      }
      case 'next': {
        const block = getFirstChildBlock(child);
        if (block) {
          next = parseBlocklyProjectionNode(block);
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    type: String(element?.getAttribute?.('type') ?? '').trim() || 'unknown_block',
    fields,
    values,
    statements,
    next,
  };
}

function parseBlocklyProjectionRoots(blocklyXml: string): BlocklyProjectionNode[] {
  const normalizedXml = normalizeBlocklyXml(blocklyXml);
  if (!normalizedXml.trim()) {
    return [];
  }

  try {
    const xmlDocument = new DOMParser().parseFromString(normalizedXml, 'text/xml');
    const root = xmlDocument?.documentElement;
    if (!root || String(root.tagName ?? '').toLowerCase() !== 'xml') {
      return [];
    }

    if (root.getElementsByTagName('parsererror').length > 0) {
      return [];
    }

    return getElementChildren(root)
      .filter((child) => {
        const tagName = String(child?.tagName ?? '').toLowerCase();
        return tagName === 'block' || tagName === 'shadow';
      })
      .map((child) => parseBlocklyProjectionNode(child));
  } catch {
    return [];
  }
}

function indentLine(level: number, text: string): string {
  return `${'  '.repeat(level)}${text}`;
}

function toFriendlyBlockName(blockType: string): string {
  const withoutPrefix = blockType
    .replace(/^(event|control|controls|motion|looks|physics|camera|sensing|sound|typed_variable|operator|debug|math|logic|text|target)_/, '');
  return withoutPrefix || blockType;
}

function quoteValue(value: string): string {
  return JSON.stringify(value);
}

function formatFieldValue(fieldName: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '""';
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  if (trimmed === 'TRUE' || trimmed === 'FALSE') {
    return trimmed.toLowerCase();
  }

  if (fieldName === 'BOOL') {
    return trimmed.toLowerCase();
  }

  return quoteValue(trimmed);
}

function getField(node: BlocklyProjectionNode, name: string): string | undefined {
  return node.fields[name];
}

function getValue(node: BlocklyProjectionNode, name: string): BlocklyProjectionNode | undefined {
  return node.values[name];
}

function getStatement(node: BlocklyProjectionNode, ...names: string[]): BlocklyProjectionNode | null {
  for (const name of names) {
    const statement = node.statements[name];
    if (statement) {
      return statement;
    }
  }
  return null;
}

function renderBlocklyExpression(node?: BlocklyProjectionNode | null): string {
  if (!node) {
    return 'null';
  }

  switch (node.type) {
    case 'math_number':
      return getField(node, 'NUM') ?? '0';
    case 'text':
      return quoteValue(getField(node, 'TEXT') ?? '');
    case 'logic_boolean':
      return (getField(node, 'BOOL') ?? 'FALSE').toLowerCase();
    case 'motion_my_x':
      return 'my.x';
    case 'motion_my_y':
      return 'my.y';
    case 'motion_is_moving':
      return 'isMoving()';
    case 'looks_costume_number':
      return 'costumeNumber()';
    case 'control_current_item':
      return 'currentItem';
    case 'sensing_mouse_down':
      return 'mouse.isDown';
    case 'sensing_mouse_x':
      return 'mouse.x';
    case 'sensing_mouse_y':
      return 'mouse.y';
    case 'sensing_timer':
      return 'timer()';
    case 'physics_enabled':
      return 'physicsEnabled()';
    case 'sensing_touching_object':
      return 'touchingObject()';
    case 'sensing_all_touching_objects':
      return 'allTouchingObjects()';
    case 'sensing_my_type':
      return 'my.type';
    case 'sensing_type_literal':
      return quoteValue(getField(node, 'TYPE') ?? '');
    case 'typed_variable_get':
      return `var(${formatFieldValue('VAR', getField(node, 'VAR') ?? '')})`;
    case 'sensing_key_pressed':
      return `keyPressed(${formatFieldValue('KEY', getField(node, 'KEY') ?? '')})`;
    case 'sensing_touching':
      return `touching(${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')})`;
    case 'sensing_touching_value':
      return `touching(${renderBlocklyExpression(getValue(node, 'TARGET'))})`;
    case 'sensing_touching_direction':
      return `touching(${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')}, from=${formatFieldValue('DIRECTION', getField(node, 'DIRECTION') ?? 'SIDE')})`;
    case 'sensing_touching_direction_value':
      return `touching(${renderBlocklyExpression(getValue(node, 'TARGET'))}, from=${formatFieldValue('DIRECTION', getField(node, 'DIRECTION') ?? 'SIDE')})`;
    case 'sensing_distance_to':
      return `distanceTo(${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')})`;
    case 'sensing_distance_to_value':
      return `distanceTo(${renderBlocklyExpression(getValue(node, 'TARGET'))})`;
    case 'sensing_type_of_object':
      return `typeOf(${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')})`;
    case 'sensing_type_of_object_value':
      return `typeOf(${renderBlocklyExpression(getValue(node, 'TARGET'))})`;
    case 'sensing_object_x':
      return `xOf(${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')})`;
    case 'sensing_object_y':
      return `yOf(${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')})`;
    case 'sensing_object_costume':
      return `costumeOf(${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')})`;
    case 'math_arithmetic': {
      const op = getField(node, 'OP') ?? 'ADD';
      const left = renderBlocklyExpression(getValue(node, 'A'));
      const right = renderBlocklyExpression(getValue(node, 'B'));
      const symbol = ({
        ADD: '+',
        MINUS: '-',
        MULTIPLY: '*',
        DIVIDE: '/',
        POWER: '^',
      } as const)[op as 'ADD' | 'MINUS' | 'MULTIPLY' | 'DIVIDE' | 'POWER'] ?? op;
      return `(${left} ${symbol} ${right})`;
    }
    case 'math_random_int':
      return `randomInt(${renderBlocklyExpression(getValue(node, 'FROM'))}, ${renderBlocklyExpression(getValue(node, 'TO'))})`;
    case 'logic_compare': {
      const op = getField(node, 'OP') ?? 'EQ';
      const left = renderBlocklyExpression(getValue(node, 'A'));
      const right = renderBlocklyExpression(getValue(node, 'B'));
      const symbol = ({
        EQ: '==',
        NEQ: '!=',
        LT: '<',
        LTE: '<=',
        GT: '>',
        GTE: '>=',
      } as const)[op as 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE'] ?? op;
      return `(${left} ${symbol} ${right})`;
    }
    case 'logic_operation': {
      const op = getField(node, 'OP') ?? 'AND';
      const left = renderBlocklyExpression(getValue(node, 'A'));
      const right = renderBlocklyExpression(getValue(node, 'B'));
      return `(${left} ${op === 'OR' ? 'or' : 'and'} ${right})`;
    }
    case 'logic_negate':
      return `(not ${renderBlocklyExpression(getValue(node, 'BOOL'))})`;
    case 'operator_join':
      return `join(${renderBlocklyExpression(getValue(node, 'STRING1'))}, ${renderBlocklyExpression(getValue(node, 'STRING2'))})`;
    case 'operator_letter_of':
      return `letter(${renderBlocklyExpression(getValue(node, 'LETTER'))}, ${renderBlocklyExpression(getValue(node, 'STRING'))})`;
    case 'operator_length':
      return `length(${renderBlocklyExpression(getValue(node, 'STRING'))})`;
    case 'operator_contains':
      return `contains(${renderBlocklyExpression(getValue(node, 'STRING1'))}, ${renderBlocklyExpression(getValue(node, 'STRING2'))})`;
    case 'operator_mod':
      return `mod(${renderBlocklyExpression(getValue(node, 'NUM1'))}, ${renderBlocklyExpression(getValue(node, 'NUM2'))})`;
    case 'operator_round':
      return `round(${renderBlocklyExpression(getValue(node, 'NUM'))})`;
    case 'operator_mathop':
      return `${String(getField(node, 'OP') ?? 'MATH').toLowerCase()}(${renderBlocklyExpression(getValue(node, 'NUM'))})`;
    case 'object_from_dropdown':
      return formatFieldValue('TARGET', getField(node, 'TARGET') ?? '');
    case 'target_mouse':
      return '"MOUSE"';
    case 'target_myself':
      return '"MYSELF"';
    case 'target_camera':
      return '"CAMERA"';
    case 'target_ground':
      return '"GROUND"';
    default:
      return renderGenericBlockCall(node);
  }
}

function renderGenericBlockCall(node: BlocklyProjectionNode): string {
  const fieldArgs = Object.entries(node.fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name.toLowerCase()}=${formatFieldValue(name, value)}`);
  const valueArgs = Object.entries(node.values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name.toLowerCase()}=${renderBlocklyExpression(value)}`);
  const args = [...fieldArgs, ...valueArgs].join(', ');
  return `${toFriendlyBlockName(node.type)}(${args})`;
}

function renderBlockBodyLines(block: BlocklyProjectionNode | null, indent: number): string[] {
  if (!block) {
    return [indentLine(indent, 'pass')];
  }
  return renderBlocklyBlockChain(block, indent);
}

function renderRandomChoiceBranches(node: BlocklyProjectionNode, indent: number): string[] {
  const lines: string[] = [];
  const branchNames = Object.keys(node.statements)
    .filter((name) => /^DO\d+$/.test(name))
    .sort((left, right) => Number(left.slice(2)) - Number(right.slice(2)));
  branchNames.forEach((branchName, index) => {
    lines.push(indentLine(indent, `branch ${index + 1}:`));
    lines.push(...renderBlockBodyLines(node.statements[branchName] ?? null, indent + 1));
  });
  return lines;
}

function renderBlocklyStatement(node: BlocklyProjectionNode, indent: number): string[] {
  switch (node.type) {
    case 'controls_if': {
      const lines: string[] = [];
      const branchIndexes = Object.keys(node.values)
        .filter((name) => /^IF\d+$/.test(name))
        .map((name) => Number(name.slice(2)))
        .filter((value) => Number.isFinite(value))
        .sort((left, right) => left - right);
      if (branchIndexes.length === 0) {
        return [indentLine(indent, 'if <missing condition>:')];
      }

      branchIndexes.forEach((branchIndex, index) => {
        const condition = renderBlocklyExpression(node.values[`IF${branchIndex}`] ?? null);
        lines.push(indentLine(indent, `${index === 0 ? 'if' : 'else if'} ${condition}:`));
        lines.push(...renderBlockBodyLines(node.statements[`DO${branchIndex}`] ?? null, indent + 1));
      });

      if (node.statements.ELSE) {
        lines.push(indentLine(indent, 'else:'));
        lines.push(...renderBlockBodyLines(node.statements.ELSE, indent + 1));
      }
      return lines;
    }
    case 'control_repeat':
      return [
        indentLine(indent, `repeat ${renderBlocklyExpression(getValue(node, 'TIMES'))} times:`),
        ...renderBlockBodyLines(getStatement(node, 'DO'), indent + 1),
      ];
    case 'control_repeat_until':
      return [
        indentLine(indent, `repeat until ${renderBlocklyExpression(getValue(node, 'CONDITION'))}:`),
        ...renderBlockBodyLines(getStatement(node, 'DO'), indent + 1),
      ];
    case 'control_while':
      return [
        indentLine(indent, `while ${renderBlocklyExpression(getValue(node, 'CONDITION'))}:`),
        ...renderBlockBodyLines(getStatement(node, 'DO'), indent + 1),
      ];
    case 'control_wait_until':
      return [indentLine(indent, `wait until ${renderBlocklyExpression(getValue(node, 'CONDITION'))}`)];
    case 'control_random_choice':
      return [
        indentLine(indent, 'choose randomly:'),
        ...renderRandomChoiceBranches(node, indent + 1),
      ];
    case 'control_group_block':
      return [
        indentLine(indent, `group ${formatFieldValue('NAME', getField(node, 'NAME') ?? 'group')}:`),
        ...renderBlockBodyLines(getStatement(node, 'DO'), indent + 1),
      ];
    case 'control_for_each':
      return [
        indentLine(indent, `for each currentItem in ${renderBlocklyExpression(getValue(node, 'LIST'))}:`),
        ...renderBlockBodyLines(getStatement(node, 'DO'), indent + 1),
      ];
    case 'event_forever':
      return [
        indentLine(indent, 'forever:'),
        ...renderBlockBodyLines(getStatement(node, 'DO', 'NEXT'), indent + 1),
      ];
    case 'event_game_start':
      return [
        indentLine(indent, 'when game starts:'),
        ...renderBlockBodyLines(getStatement(node, 'NEXT', 'DO'), indent + 1),
      ];
    case 'event_key_pressed':
      return [
        indentLine(indent, `when key ${formatFieldValue('KEY', getField(node, 'KEY') ?? '')} is pressed:`),
        ...renderBlockBodyLines(getStatement(node, 'NEXT', 'DO'), indent + 1),
      ];
    case 'event_clicked':
      return [
        indentLine(indent, 'when this is clicked:'),
        ...renderBlockBodyLines(getStatement(node, 'NEXT', 'DO'), indent + 1),
      ];
    case 'event_when_receive':
      return [
        indentLine(indent, `when message ${formatFieldValue('MESSAGE', getField(node, 'MESSAGE') ?? '')} is received:`),
        ...renderBlockBodyLines(getStatement(node, 'NEXT', 'DO'), indent + 1),
      ];
    case 'event_when_touching':
      return [
        indentLine(indent, `when I touch ${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')}:`),
        ...renderBlockBodyLines(getStatement(node, 'NEXT', 'DO'), indent + 1),
      ];
    case 'event_when_touching_value':
      return [
        indentLine(indent, `when I touch ${renderBlocklyExpression(getValue(node, 'TARGET'))}:`),
        ...renderBlockBodyLines(getStatement(node, 'NEXT', 'DO'), indent + 1),
      ];
    case 'event_when_touching_direction':
      return [
        indentLine(indent, `when I touch ${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')} from ${formatFieldValue('DIRECTION', getField(node, 'DIRECTION') ?? 'SIDE')}:`),
        ...renderBlockBodyLines(getStatement(node, 'NEXT', 'DO'), indent + 1),
      ];
    case 'event_when_touching_direction_value':
      return [
        indentLine(indent, `when I touch ${renderBlocklyExpression(getValue(node, 'TARGET'))} from ${formatFieldValue('DIRECTION', getField(node, 'DIRECTION') ?? 'SIDE')}:`),
        ...renderBlockBodyLines(getStatement(node, 'NEXT', 'DO'), indent + 1),
      ];
    case 'looks_show':
      return [indentLine(indent, 'show')];
    case 'looks_hide':
      return [indentLine(indent, 'hide')];
    case 'looks_set_size':
      return [indentLine(indent, `set size to ${renderBlocklyExpression(getValue(node, 'SIZE'))}`)];
    case 'looks_change_size':
      return [indentLine(indent, `change size by ${renderBlocklyExpression(getValue(node, 'SIZE'))}`)];
    case 'looks_change_axis_scale':
      return [indentLine(indent, `change ${(getField(node, 'AXIS') ?? 'HORIZONTAL').toLowerCase()} scale by ${renderBlocklyExpression(getValue(node, 'SIZE'))}`)];
    case 'looks_flip_axis':
      return [indentLine(indent, `flip ${(getField(node, 'AXIS') ?? 'HORIZONTAL').toLowerCase()}`)];
    case 'looks_set_opacity':
      return [indentLine(indent, `set opacity to ${renderBlocklyExpression(getValue(node, 'OPACITY'))}`)];
    case 'looks_go_to_front':
      return [indentLine(indent, 'go to front layer')];
    case 'looks_go_to_back':
      return [indentLine(indent, 'go to back layer')];
    case 'looks_speak':
      return [indentLine(indent, `keep speaking ${renderBlocklyExpression(getValue(node, 'TEXT'))}`)];
    case 'looks_speak_and_stop':
    case 'looks_speak_for_seconds':
      return [indentLine(indent, `speak ${renderBlocklyExpression(getValue(node, 'TEXT'))} and stop`)];
    case 'looks_stop_speaking':
      return [indentLine(indent, 'stop speaking')];
    case 'looks_target_speak':
      return [indentLine(indent, `make ${renderBlocklyExpression(getValue(node, 'TARGET'))} keep speaking ${renderBlocklyExpression(getValue(node, 'TEXT'))}`)];
    case 'looks_target_speak_and_stop':
    case 'looks_target_speak_for_seconds':
      return [indentLine(indent, `make ${renderBlocklyExpression(getValue(node, 'TARGET'))} speak ${renderBlocklyExpression(getValue(node, 'TEXT'))} and stop`)];
    case 'looks_target_stop_speaking':
      return [indentLine(indent, `make ${renderBlocklyExpression(getValue(node, 'TARGET'))} stop speaking`)];
    case 'looks_next_costume':
      return [indentLine(indent, 'next costume')];
    case 'looks_previous_costume':
      return [indentLine(indent, 'previous costume')];
    case 'looks_switch_costume':
      return [indentLine(indent, `switch costume to ${renderBlocklyExpression(getValue(node, 'COSTUME'))}`)];
    case 'motion_move_steps':
      return [indentLine(indent, `move ${renderBlocklyExpression(getValue(node, 'STEPS'))} steps`)];
    case 'motion_move_towards':
      return [indentLine(indent, `move ${renderBlocklyExpression(getValue(node, 'STEPS'))} steps towards x=${renderBlocklyExpression(getValue(node, 'X'))}, y=${renderBlocklyExpression(getValue(node, 'Y'))}`)];
    case 'motion_go_to':
      return [indentLine(indent, `go to x=${renderBlocklyExpression(getValue(node, 'X'))}, y=${renderBlocklyExpression(getValue(node, 'Y'))}`)];
    case 'motion_glide_to':
      return [indentLine(indent, `glide to x=${renderBlocklyExpression(getValue(node, 'X'))}, y=${renderBlocklyExpression(getValue(node, 'Y'))} in ${renderBlocklyExpression(getValue(node, 'SECONDS'))} sec easing=${formatFieldValue('EASING', getField(node, 'EASING') ?? 'Linear')}`)];
    case 'motion_change_x':
      return [indentLine(indent, `change x by ${renderBlocklyExpression(getValue(node, 'VALUE'))}`)];
    case 'motion_change_y':
      return [indentLine(indent, `change y by ${renderBlocklyExpression(getValue(node, 'VALUE'))}`)];
    case 'motion_set_x':
      return [indentLine(indent, `set x to ${renderBlocklyExpression(getValue(node, 'VALUE'))}`)];
    case 'motion_set_y':
      return [indentLine(indent, `set y to ${renderBlocklyExpression(getValue(node, 'VALUE'))}`)];
    case 'motion_point_direction':
      return [indentLine(indent, `point in direction ${renderBlocklyExpression(getValue(node, 'DIRECTION'))}`)];
    case 'motion_point_towards':
      return [indentLine(indent, `point towards ${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')}`)];
    case 'motion_point_towards_value':
      return [indentLine(indent, `point towards ${renderBlocklyExpression(getValue(node, 'TARGET'))}`)];
    case 'motion_rotate_tween':
      return [indentLine(indent, `rotate ${renderBlocklyExpression(getValue(node, 'DEGREES'))} degrees in ${renderBlocklyExpression(getValue(node, 'SECONDS'))} sec easing=${formatFieldValue('EASING', getField(node, 'EASING') ?? 'Linear')}`)];
    case 'motion_attach_to_dropdown':
      return [indentLine(indent, `attach myself to ${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')}`)];
    case 'motion_attach_to_block':
      return [indentLine(indent, `attach myself to ${renderBlocklyExpression(getValue(node, 'TARGET'))}`)];
    case 'motion_attach_dropdown_to_me':
      return [indentLine(indent, `attach ${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')} to myself`)];
    case 'motion_attach_block_to_me':
      return [indentLine(indent, `attach ${renderBlocklyExpression(getValue(node, 'TARGET'))} to myself`)];
    case 'motion_detach':
      return [indentLine(indent, 'detach from parent')];
    case 'physics_enable':
      return [indentLine(indent, 'enable physics')];
    case 'physics_disable':
      return [indentLine(indent, 'disable physics')];
    case 'physics_set_velocity':
      return [indentLine(indent, `set velocity x=${renderBlocklyExpression(getValue(node, 'VX'))}, y=${renderBlocklyExpression(getValue(node, 'VY'))}`)];
    case 'physics_set_velocity_x':
      return [indentLine(indent, `set velocity x to ${renderBlocklyExpression(getValue(node, 'VX'))}`)];
    case 'physics_set_velocity_y':
      return [indentLine(indent, `set velocity y to ${renderBlocklyExpression(getValue(node, 'VY'))}`)];
    case 'physics_set_gravity':
      return [indentLine(indent, `set gravity to ${renderBlocklyExpression(getValue(node, 'GRAVITY'))}`)];
    case 'physics_set_bounce':
      return [indentLine(indent, `set bounce to ${renderBlocklyExpression(getValue(node, 'BOUNCE'))}`)];
    case 'physics_set_friction':
      return [indentLine(indent, `set friction to ${renderBlocklyExpression(getValue(node, 'FRICTION'))}`)];
    case 'physics_make_dynamic':
      return [indentLine(indent, 'make myself dynamic')];
    case 'physics_make_static':
    case 'physics_immovable':
      return [indentLine(indent, 'make myself static')];
    case 'physics_ground_on':
      return [indentLine(indent, 'enable ground collision')];
    case 'physics_ground_off':
      return [indentLine(indent, 'disable ground collision')];
    case 'camera_follow_me':
      return [indentLine(indent, 'camera follow me')];
    case 'camera_follow_object':
      return [indentLine(indent, `camera follow ${formatFieldValue('TARGET', getField(node, 'TARGET') ?? '')}`)];
    case 'camera_follow_object_value':
      return [indentLine(indent, `camera follow ${renderBlocklyExpression(getValue(node, 'TARGET'))}`)];
    case 'camera_stop_follow':
      return [indentLine(indent, 'camera stop following')];
    case 'camera_go_to':
      return [indentLine(indent, `camera go to x=${renderBlocklyExpression(getValue(node, 'X'))}, y=${renderBlocklyExpression(getValue(node, 'Y'))}`)];
    case 'camera_shake':
      return [indentLine(indent, `camera shake for ${renderBlocklyExpression(getValue(node, 'DURATION'))} seconds`)];
    case 'camera_zoom':
      return [indentLine(indent, `set camera zoom to ${renderBlocklyExpression(getValue(node, 'ZOOM'))}%`)];
    case 'camera_fade':
      return [indentLine(indent, `camera fade ${formatFieldValue('DIRECTION', getField(node, 'DIRECTION') ?? 'IN')} in ${renderBlocklyExpression(getValue(node, 'DURATION'))} seconds`)];
    case 'camera_set_follow_range':
      return [indentLine(indent, `set camera follow range width=${renderBlocklyExpression(getValue(node, 'WIDTH'))}, height=${renderBlocklyExpression(getValue(node, 'HEIGHT'))}`)];
    case 'camera_set_follow_smoothness':
      return [indentLine(indent, `set camera follow smoothness to ${renderBlocklyExpression(getValue(node, 'SMOOTHNESS'))}%`)];
    case 'camera_set_follow_offset':
      return [indentLine(indent, `set camera offset x=${renderBlocklyExpression(getValue(node, 'X'))}, y=${renderBlocklyExpression(getValue(node, 'Y'))}`)];
    case 'sound_play':
      return [indentLine(indent, `play sound ${formatFieldValue('SOUND', getField(node, 'SOUND') ?? '')}`)];
    case 'sound_play_until_done':
      return [indentLine(indent, `play sound ${formatFieldValue('SOUND', getField(node, 'SOUND') ?? '')} until done`)];
    case 'sound_stop_all':
      return [indentLine(indent, 'stop all sounds')];
    case 'sound_set_volume':
      return [indentLine(indent, `set volume to ${renderBlocklyExpression(getValue(node, 'VOLUME'))}%`)];
    case 'sound_change_volume':
      return [indentLine(indent, `change volume by ${renderBlocklyExpression(getValue(node, 'DELTA'))}`)];
    case 'control_spawn_type_at':
      return [indentLine(indent, `spawn ${formatFieldValue('TYPE', getField(node, 'TYPE') ?? '')} at x=${renderBlocklyExpression(getValue(node, 'X'))}, y=${renderBlocklyExpression(getValue(node, 'Y'))}`)];
    case 'control_delete_object':
      return [indentLine(indent, `delete ${renderBlocklyExpression(getValue(node, 'OBJECT'))}`)];
    case 'control_broadcast':
      return [indentLine(indent, `broadcast ${formatFieldValue('MESSAGE', getField(node, 'MESSAGE') ?? '')}`)];
    case 'control_broadcast_wait':
      return [indentLine(indent, `broadcast ${formatFieldValue('MESSAGE', getField(node, 'MESSAGE') ?? '')} and wait`)];
    case 'control_switch_scene':
      return [indentLine(indent, `switch scene to ${formatFieldValue('SCENE', getField(node, 'SCENE') ?? '')} mode=${formatFieldValue('MODE', getField(node, 'MODE') ?? 'RESUME')}`)];
    case 'sensing_reset_timer':
      return [indentLine(indent, 'reset timer')];
    case 'typed_variable_set':
      return [indentLine(indent, `set ${formatFieldValue('VAR', getField(node, 'VAR') ?? '')} to ${renderBlocklyExpression(getValue(node, 'VALUE'))}`)];
    case 'typed_variable_change':
      return [indentLine(indent, `change ${formatFieldValue('VAR', getField(node, 'VAR') ?? '')} by ${renderBlocklyExpression(getValue(node, 'DELTA'))}`)];
    case 'debug_console_log':
      return [indentLine(indent, `console log ${renderBlocklyExpression(getValue(node, 'VALUE'))}`)];
    default:
      return [indentLine(indent, renderGenericBlockCall(node))];
  }
}

function renderBlocklyBlockChain(block: BlocklyProjectionNode, indent: number): string[] {
  const lines: string[] = [];
  let current: BlocklyProjectionNode | null = block;
  while (current) {
    lines.push(...renderBlocklyStatement(current, indent));
    current = current.next;
  }
  return lines;
}

function truncateGeneratedCode(
  code: string,
  {
    maxChars = DEFAULT_LOGIC_PREVIEW_CHAR_LIMIT,
    maxLines = DEFAULT_LOGIC_PREVIEW_LINE_LIMIT,
  }: Pick<Required<LogicProjectionOptions>, 'maxChars' | 'maxLines'>,
): LogicProjectionResult {
  const rawLines = code.trim().split('\n');
  let lines = rawLines;
  let truncated = false;

  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    truncated = true;
  }

  let truncatedCode = lines.join('\n');
  if (truncatedCode.length > maxChars) {
    truncatedCode = `${truncatedCode.slice(0, maxChars).trimEnd()}\n...`;
    truncated = true;
  } else if (truncated) {
    truncatedCode = `${truncatedCode}\n...`;
  }

  return {
    code: truncatedCode,
    truncated,
  };
}

function buildGeneratedBlocklyLogic(
  blocklyXml: string,
  options: LogicProjectionOptions = {},
): LogicProjectionResult | null {
  const roots = parseBlocklyProjectionRoots(blocklyXml);
  if (roots.length === 0) {
    return null;
  }

  const fullCode = roots
    .flatMap((root) => renderBlocklyBlockChain(root, 0))
    .join('\n')
    .trim();

  if (!fullCode) {
    return null;
  }

  if (options.codeMode === 'full') {
    return {
      code: fullCode,
      truncated: false,
    };
  }

  return truncateGeneratedCode(fullCode, {
    maxChars: options.maxChars ?? DEFAULT_LOGIC_PREVIEW_CHAR_LIMIT,
    maxLines: options.maxLines ?? DEFAULT_LOGIC_PREVIEW_LINE_LIMIT,
  });
}

function buildMathNumberInput(name: string, value: number): string {
  return `<value name="${name}"><block type="math_number"><field name="NUM">${value}</field></block></value>`;
}

function appendNextBlocks(blocks: readonly string[]): string {
  if (blocks.length === 0) return '';
  if (blocks.length === 1) return blocks[0]!;

  const [head, ...tail] = blocks;
  return head!.replace(/<\/block>$/, `<next>${appendNextBlocks(tail)}</next></block>`);
}

function wrapStatementChain(blockType: string, statementName: string, blocks: readonly string[]): string {
  const chain = appendNextBlocks(blocks);
  if (!chain) return '';
  return assistantStatementUsesNextConnection(blockType, statementName)
    ? `<next>${chain}</next>`
    : `<statement name="${statementName}">${chain}</statement>`;
}

function buildConditionBlock(condition: AssistantLogicCondition): string {
  switch (condition.kind) {
    case 'key_pressed':
      return `<block type="sensing_key_pressed"><field name="KEY">${escapeXml(normalizeLogicKey(condition.key))}</field></block>`;
    case 'touching_ground':
      return '<block type="sensing_touching_direction"><field name="TARGET">GROUND</field><field name="DIRECTION">TOP</field></block>';
    case 'not':
      return `<block type="logic_negate"><value name="BOOL">${buildConditionBlock(condition.condition)}</value></block>`;
    case 'all':
    case 'any': {
      const conditions = condition.conditions.map((item) => buildConditionBlock(item));
      if (conditions.length === 0) {
        return '<block type="logic_boolean"><field name="BOOL">TRUE</field></block>';
      }
      if (conditions.length === 1) {
        return conditions[0]!;
      }

      let chained = `<block type="logic_operation"><field name="OP">${condition.kind === 'all' ? 'AND' : 'OR'}</field><value name="A">${conditions[0]}</value><value name="B">${conditions[1]}</value></block>`;
      for (let index = 2; index < conditions.length; index += 1) {
        chained = `<block type="logic_operation"><field name="OP">${condition.kind === 'all' ? 'AND' : 'OR'}</field><value name="A">${chained}</value><value name="B">${conditions[index]}</value></block>`;
      }
      return chained;
    }
  }
}

function buildPrimitiveActionBlock(action: AssistantLogicPrimitiveAction): string {
  switch (action.kind) {
    case 'set_velocity':
      return `<block type="physics_set_velocity">${buildMathNumberInput('VX', action.x)}${buildMathNumberInput('VY', action.y)}</block>`;
    case 'set_velocity_x':
      return `<block type="physics_set_velocity_x">${buildMathNumberInput('VX', action.value)}</block>`;
    case 'set_velocity_y':
      return `<block type="physics_set_velocity_y">${buildMathNumberInput('VY', action.value)}</block>`;
    case 'change_x':
      return `<block type="motion_change_x">${buildMathNumberInput('VALUE', action.value)}</block>`;
    case 'change_y':
      return `<block type="motion_change_y">${buildMathNumberInput('VALUE', action.value)}</block>`;
    case 'wait':
      return `<block type="control_wait">${buildMathNumberInput('SECONDS', action.seconds)}</block>`;
    case 'broadcast':
      return `<block type="${action.wait ? 'control_broadcast_wait' : 'control_broadcast'}"><field name="MESSAGE">${escapeXml(action.message.trim())}</field></block>`;
  }
}

function buildActionBlock(action: AssistantLogicAction): string {
  if (action.kind !== 'if') {
    return buildPrimitiveActionBlock(action);
  }

  const thenChain = appendNextBlocks(action.thenActions.map((item) => buildPrimitiveActionBlock(item)));
  const elseChain = appendNextBlocks((action.elseActions ?? []).map((item) => buildPrimitiveActionBlock(item)));

  return `<block type="controls_if"><value name="IF0">${buildConditionBlock(action.condition)}</value><statement name="DO0">${thenChain}</statement>${elseChain ? `<statement name="ELSE">${elseChain}</statement>` : ''}</block>`;
}

function buildScriptBlock(script: AssistantLogicScript): string {
  const actions = script.actions.map((action) => buildActionBlock(action));

  switch (script.trigger.kind) {
    case 'on_start':
      return `<block type="event_game_start">${wrapStatementChain('event_game_start', 'NEXT', actions)}</block>`;
    case 'forever':
      return `<block type="event_game_start">${wrapStatementChain('event_game_start', 'NEXT', [
        `<block type="event_forever">${wrapStatementChain('event_forever', 'DO', actions)}</block>`,
      ])}</block>`;
    case 'on_clicked':
      return `<block type="event_clicked">${wrapStatementChain('event_clicked', 'NEXT', actions)}</block>`;
    case 'on_key_pressed':
      return `<block type="event_key_pressed"><field name="KEY">${escapeXml(normalizeLogicKey(script.trigger.key))}</field>${wrapStatementChain('event_key_pressed', 'NEXT', actions)}</block>`;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validatePrimitiveAction(action: AssistantLogicPrimitiveAction, path: string): string[] {
  switch (action.kind) {
    case 'set_velocity':
      return [action.x, action.y].every((value) => isFiniteNumber(value))
        ? []
        : [`${path} requires finite numeric x and y values.`];
    case 'set_velocity_x':
    case 'set_velocity_y':
    case 'change_x':
    case 'change_y':
      return isFiniteNumber(action.value) ? [] : [`${path} requires a finite numeric value.`];
    case 'wait':
      return isFiniteNumber(action.seconds) ? [] : [`${path} requires a finite numeric seconds value.`];
    case 'broadcast':
      return action.message.trim()
        ? []
        : [`${path} requires a non-empty message.`];
  }
}

function validateConditionAtom(condition: AssistantLogicConditionAtom, path: string): string[] {
  switch (condition.kind) {
    case 'key_pressed':
      return normalizeLogicKey(condition.key)
        ? []
        : [`${path} requires a non-empty key.`];
    case 'touching_ground':
      return [];
  }
}

function validateCondition(condition: AssistantLogicCondition, path: string): string[] {
  switch (condition.kind) {
    case 'key_pressed':
    case 'touching_ground':
      return validateConditionAtom(condition, path);
    case 'not':
      return validateConditionAtom(condition.condition, `${path}.condition`);
    case 'all':
    case 'any':
      if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
        return [`${path}.conditions must contain at least one condition.`];
      }
      return condition.conditions.flatMap((item, index) =>
        validateConditionAtom(item, `${path}.conditions[${index}]`),
      );
  }
}

export function validateAssistantLogicProgram(program: AssistantLogicProgram): string[] {
  const issues: string[] = [];

  if (!program || typeof program !== 'object') {
    return ['Logic program must be an object.'];
  }

  if (program.formatVersion !== 1) {
    issues.push('Logic program formatVersion must be 1.');
  }

  if (!Array.isArray(program.scripts)) {
    issues.push('Logic program scripts must be an array.');
    return issues;
  }

  program.scripts.forEach((script, scriptIndex) => {
    const scriptPath = `scripts[${scriptIndex}]`;
    if (!script || typeof script !== 'object') {
      issues.push(`${scriptPath} must be an object.`);
      return;
    }

    if (!Array.isArray(script.actions)) {
      issues.push(`${scriptPath}.actions must be an array.`);
      return;
    }

    switch (script.trigger?.kind) {
      case 'on_start':
      case 'forever':
      case 'on_clicked':
        break;
      case 'on_key_pressed':
        if (!normalizeLogicKey(script.trigger.key)) {
          issues.push(`${scriptPath}.trigger.key must be non-empty.`);
        }
        break;
      default:
        issues.push(`${scriptPath}.trigger.kind is unsupported.`);
    }

    script.actions.forEach((action, actionIndex) => {
      const actionPath = `${scriptPath}.actions[${actionIndex}]`;
      if (!action || typeof action !== 'object' || typeof action.kind !== 'string') {
        issues.push(`${actionPath} must be a valid action object.`);
        return;
      }

      if (action.kind === 'if') {
        issues.push(...validateCondition(action.condition, `${actionPath}.condition`));
        if (!Array.isArray(action.thenActions)) {
          issues.push(`${actionPath}.thenActions must be an array.`);
        } else {
          action.thenActions.forEach((thenAction, thenIndex) => {
            issues.push(...validatePrimitiveAction(thenAction, `${actionPath}.thenActions[${thenIndex}]`));
          });
        }
        if (action.elseActions !== undefined) {
          if (!Array.isArray(action.elseActions)) {
            issues.push(`${actionPath}.elseActions must be an array when provided.`);
          } else {
            action.elseActions.forEach((elseAction, elseIndex) => {
              issues.push(...validatePrimitiveAction(elseAction, `${actionPath}.elseActions[${elseIndex}]`));
            });
          }
        }
        return;
      }

      issues.push(...validatePrimitiveAction(action, actionPath));
    });
  });

  return issues;
}

export function compileAssistantLogicProgram(program: AssistantLogicProgram): string {
  const issues = validateAssistantLogicProgram(program);
  if (issues.length > 0) {
    throw new Error(issues.join(' '));
  }

  const scriptBlocks = program.scripts.map((script) => buildScriptBlock(script));
  return `<xml xmlns="${BLOCKLY_XML_NS}">${scriptBlocks.join('')}</xml>`;
}

export function isAssistantLogicProgram(value: unknown): value is AssistantLogicProgram {
  return Boolean(
    value
    && typeof value === 'object'
    && 'formatVersion' in value
    && (value as { formatVersion?: unknown }).formatVersion === 1
    && Array.isArray((value as { scripts?: unknown }).scripts),
  );
}

export function summarizeAssistantLogicProgram(program: AssistantLogicProgram): string {
  const scripts = Array.isArray(program.scripts) ? program.scripts : [];
  const triggerSummary = scripts.map((script) => {
    if (!script || typeof script !== 'object' || !script.trigger || typeof script.trigger !== 'object') {
      return 'invalid_trigger';
    }
    try {
      return summarizeScriptTrigger(script.trigger as AssistantLogicTrigger);
    } catch {
      return 'invalid_trigger';
    }
  }).join(',');
  const actionKinds = Array.from(new Set(
    scripts.flatMap((script) => (
      Array.isArray(script?.actions)
        ? script.actions.map((action) => summarizeUnknownAction(action))
        : ['invalid_actions']
    )),
  ));
  return `Logic v${program.formatVersion} (${scripts.length} scripts; triggers=${triggerSummary || 'none'}; actions=${actionKinds.slice(0, 4).join(',') || 'none'}${actionKinds.length > 4 ? ',+more' : ''})`;
}

export function summarizeStoredBlocklyLogic(
  blocklyXml: string,
  editableWith: AssistantLogicOverview['editableWith'],
  options: LogicProjectionOptions = {},
): AssistantLogicOverview {
  const blockTypes = extractBlocklyBlockTypes(blocklyXml);
  const generatedLogic = buildGeneratedBlocklyLogic(blocklyXml, options);
  return {
    hasLogic: blockTypes.length > 0,
    editableWith,
    blockTypes,
    summary: blockTypes.length > 0
      ? `Logic blocks: ${blockTypes.slice(0, 6).join(', ')}${blockTypes.length > 6 ? ', +more' : ''}`
      : 'No logic',
    generatedCode: generatedLogic?.code,
    generatedCodeTruncated: generatedLogic?.truncated,
  };
}
