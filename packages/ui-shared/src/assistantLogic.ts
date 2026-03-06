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

function buildMathNumberInput(name: string, value: number): string {
  return `<value name="${name}"><block type="math_number"><field name="NUM">${value}</field></block></value>`;
}

function appendNextBlocks(blocks: readonly string[]): string {
  if (blocks.length === 0) return '';
  if (blocks.length === 1) return blocks[0]!;

  const [head, ...tail] = blocks;
  return head!.replace(/<\/block>$/, `<next>${appendNextBlocks(tail)}</next></block>`);
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
  const actions = appendNextBlocks(script.actions.map((action) => buildActionBlock(action)));

  switch (script.trigger.kind) {
    case 'on_start':
      return `<block type="event_game_start"><statement name="NEXT">${actions}</statement></block>`;
    case 'forever':
      return `<block type="event_game_start"><statement name="NEXT"><block type="event_forever"><statement name="DO">${actions}</statement></block></statement></block>`;
    case 'on_clicked':
      return `<block type="event_clicked"><statement name="NEXT">${actions}</statement></block>`;
    case 'on_key_pressed':
      return `<block type="event_key_pressed"><field name="KEY">${escapeXml(normalizeLogicKey(script.trigger.key))}</field><statement name="NEXT">${actions}</statement></block>`;
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
  const triggerSummary = program.scripts.map((script) => summarizeScriptTrigger(script.trigger)).join(',');
  const actionKinds = Array.from(new Set(
    program.scripts.flatMap((script) => script.actions.map((action) => summarizeAction(action))),
  ));
  return `Logic v${program.formatVersion} (${program.scripts.length} scripts; triggers=${triggerSummary || 'none'}; actions=${actionKinds.slice(0, 4).join(',') || 'none'}${actionKinds.length > 4 ? ',+more' : ''})`;
}

export function summarizeStoredBlocklyLogic(
  blocklyXml: string,
  editableWith: AssistantLogicOverview['editableWith'],
): AssistantLogicOverview {
  const blockTypes = extractBlocklyBlockTypes(blocklyXml);
  return {
    hasLogic: blockTypes.length > 0,
    editableWith,
    blockTypes,
    summary: blockTypes.length > 0
      ? `Stored Blockly logic (${blockTypes.slice(0, 6).join(', ')}${blockTypes.length > 6 ? ', +more' : ''})`
      : 'No logic',
  };
}
