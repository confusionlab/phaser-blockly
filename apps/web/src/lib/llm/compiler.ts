import * as Blockly from 'blockly';
import '@/components/blockly/toolbox';
import {
  COMPONENT_ANY_PREFIX,
  MESSAGE_REFERENCE_BLOCKS,
  OBJECT_REFERENCE_BLOCKS,
  SCENE_REFERENCE_BLOCKS,
  SOUND_REFERENCE_BLOCKS,
  TYPE_REFERENCE_BLOCKS,
  VALID_OBJECT_SPECIAL_VALUES,
  VARIABLE_REFERENCE_BLOCKS,
} from '@/lib/blocklyReferenceMaps';
import { createCandidateDiff } from '@/lib/llm/diff';
import type {
  ActionSpec,
  BlockInputCapability,
  BlocklyCapabilities,
  BuildCandidateResult,
  InputLiteralSpec,
  PendingMessageEnsure,
  PendingVariableEnsure,
  ProgramContext,
  Scalar,
  SemanticOp,
} from '@/lib/llm/types';

type BlockDescriptor = {
  type: string;
  fields?: Record<string, Scalar>;
  inputs?: Record<string, InputLiteralSpec>;
  statements?: Record<string, ActionSpec[]>;
};

type ReferenceMap = {
  byId: Map<string, string>;
  byName: Map<string, string>;
};

type CompilerState = {
  workspace: Blockly.Workspace;
  capabilities: BlocklyCapabilities;
  context: ProgramContext;
  idCounter: number;
  pendingEnsures: {
    messages: PendingMessageEnsure[];
    variables: PendingVariableEnsure[];
  };
  references: {
    objects: ReferenceMap;
    scenes: ReferenceMap;
    sounds: ReferenceMap;
    messages: ReferenceMap;
    globalVariables: ReferenceMap;
    localVariables: ReferenceMap;
    componentTypes: ReferenceMap;
  };
};

function createReferenceMap(items: Array<{ id: string; label: string }>): ReferenceMap {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const item of items) {
    byId.set(item.id, item.id);
    const normalized = item.label.trim().toLowerCase();
    if (!byName.has(normalized)) {
      byName.set(normalized, item.id);
    }
  }
  return { byId, byName };
}

function initializeState(
  capabilities: BlocklyCapabilities,
  context: ProgramContext,
  workspace: Blockly.Workspace,
): CompilerState {
  return {
    workspace,
    capabilities,
    context,
    idCounter: 0,
    pendingEnsures: {
      messages: [],
      variables: [],
    },
    references: {
      objects: createReferenceMap(context.sceneObjects),
      scenes: createReferenceMap(context.scenes),
      sounds: createReferenceMap(context.sounds),
      messages: createReferenceMap(context.messages),
      globalVariables: createReferenceMap(context.globalVariables.map((item) => ({ id: item.id, label: item.label }))),
      localVariables: createReferenceMap(context.localVariables.map((item) => ({ id: item.id, label: item.label }))),
      componentTypes: createReferenceMap(context.componentTypes),
    },
  };
}

function withLower(value: string): string {
  return value.trim().toLowerCase();
}

function resolveByReferenceMap(value: string, map: ReferenceMap): string | null {
  if (!value.trim()) return null;
  if (map.byId.has(value)) return value;
  return map.byName.get(withLower(value)) || null;
}

function createDeterministicId(state: CompilerState, opIndex: number): string {
  state.idCounter += 1;
  return `llm_${opIndex}_${state.idCounter}`;
}

function normalizeVariableDefault(variableType: PendingVariableEnsure['variableType'], input?: Scalar): Scalar {
  if (input !== undefined) return input;
  switch (variableType) {
    case 'boolean':
      return false;
    case 'string':
      return '';
    case 'float':
    case 'integer':
      return 0;
    default:
      return 0;
  }
}

function ensureMessage(name: string, state: CompilerState): string {
  const existing = resolveByReferenceMap(name, state.references.messages);
  if (existing) return existing;

  const tempId = `ENSURE_MESSAGE_${state.pendingEnsures.messages.length + 1}`;
  state.pendingEnsures.messages.push({ tempId, name });
  state.references.messages.byId.set(tempId, tempId);
  state.references.messages.byName.set(withLower(name), tempId);
  return tempId;
}

function ensureVariable(op: Extract<SemanticOp, { op: 'ensure_variable' }>, state: CompilerState): string {
  const scopeMap = op.scope === 'global' ? state.references.globalVariables : state.references.localVariables;
  const existing = resolveByReferenceMap(op.name, scopeMap);
  if (existing) return existing;

  const tempId = `ENSURE_VAR_${op.scope.toUpperCase()}_${state.pendingEnsures.variables.length + 1}`;
  const defaultValue = normalizeVariableDefault(op.variableType, op.defaultValue);
  const pending: PendingVariableEnsure = {
    tempId,
    name: op.name,
    scope: op.scope,
    variableType: op.variableType,
    defaultValue,
  };
  state.pendingEnsures.variables.push(pending);

  scopeMap.byId.set(tempId, tempId);
  scopeMap.byName.set(withLower(op.name), tempId);
  return tempId;
}

function resolveReferenceValue(blockType: string, fieldName: string, rawValue: Scalar, state: CompilerState): string {
  const value = String(rawValue);

  if (OBJECT_REFERENCE_BLOCKS[blockType] === fieldName) {
    if (VALID_OBJECT_SPECIAL_VALUES.has(value)) return value;
    if (value.startsWith(COMPONENT_ANY_PREFIX)) return value;
    return resolveByReferenceMap(value, state.references.objects) || value;
  }

  if (SCENE_REFERENCE_BLOCKS[blockType] === fieldName) {
    return resolveByReferenceMap(value, state.references.scenes) || value;
  }

  if (SOUND_REFERENCE_BLOCKS[blockType] === fieldName) {
    return resolveByReferenceMap(value, state.references.sounds) || value;
  }

  if (MESSAGE_REFERENCE_BLOCKS[blockType] === fieldName) {
    return resolveByReferenceMap(value, state.references.messages) || value;
  }

  if (TYPE_REFERENCE_BLOCKS[blockType] === fieldName) {
    if (value.startsWith('component:')) {
      const componentId = value.slice('component:'.length);
      return resolveByReferenceMap(componentId, state.references.componentTypes)
        ? `component:${componentId}`
        : value;
    }
    const resolved = resolveByReferenceMap(value, state.references.componentTypes);
    return resolved ? `component:${resolved}` : value;
  }

  if (VARIABLE_REFERENCE_BLOCKS[blockType] === fieldName) {
    const localResolved = resolveByReferenceMap(value, state.references.localVariables);
    if (localResolved) return localResolved;
    const globalResolved = resolveByReferenceMap(value, state.references.globalVariables);
    if (globalResolved) return globalResolved;
    return value;
  }

  return value;
}

function assertKnownBlockType(blockType: string, state: CompilerState): void {
  if (!state.capabilities.byType[blockType]) {
    throw new Error(`Unknown block/action type: ${blockType}`);
  }
}

function safeConnect(parent: Blockly.Connection, child: Blockly.Connection, reasonLabel: string): void {
  const parentConnection = parent as Blockly.Connection & {
    canConnectWithReason?: (other: Blockly.Connection) => number;
  };
  if (typeof parentConnection.canConnectWithReason === 'function') {
    const reason = parentConnection.canConnectWithReason(child);
    if (reason !== Blockly.Connection.CAN_CONNECT) {
      throw new Error(`Illegal connection for ${reasonLabel}. Reason code: ${reason}`);
    }
  }
  parent.connect(child);
}

function firstStatementInput(block: Blockly.Block): Blockly.Input | null {
  return block.inputList.find((input) => input.connection?.type === Blockly.NEXT_STATEMENT) || null;
}

function createLiteralReporterBlock(
  inputCapability: BlockInputCapability,
  literal: Scalar,
  state: CompilerState,
  opIndex: number,
): Blockly.Block {
  const checks = inputCapability.checks;
  const literalAsString = String(literal);

  if (checks.includes('Object')) {
    const block = state.workspace.newBlock('object_from_dropdown', createDeterministicId(state, opIndex));
    block.initModel();
    const resolvedTarget = resolveReferenceValue('object_from_dropdown', 'TARGET', literalAsString, state);
    block.setFieldValue(resolvedTarget, 'TARGET');
    return block;
  }

  if (checks.includes('Type')) {
    const block = state.workspace.newBlock('sensing_type_literal', createDeterministicId(state, opIndex));
    block.initModel();
    const resolvedType = resolveReferenceValue('sensing_type_literal', 'TYPE', literalAsString, state);
    block.setFieldValue(resolvedType, 'TYPE');
    return block;
  }

  if (typeof literal === 'boolean' || checks.includes('Boolean')) {
    const block = state.workspace.newBlock('logic_boolean', createDeterministicId(state, opIndex));
    block.initModel();
    const boolValue = typeof literal === 'boolean'
      ? literal
      : literalAsString.toLowerCase() === 'true';
    block.setFieldValue(boolValue ? 'TRUE' : 'FALSE', 'BOOL');
    return block;
  }

  if (typeof literal === 'number' || checks.includes('Number')) {
    const block = state.workspace.newBlock('math_number', createDeterministicId(state, opIndex));
    block.initModel();
    const numericValue = typeof literal === 'number'
      ? literal
      : Number.parseFloat(literalAsString);
    block.setFieldValue(Number.isFinite(numericValue) ? String(numericValue) : '0', 'NUM');
    return block;
  }

  const textBlock = state.workspace.newBlock('text', createDeterministicId(state, opIndex));
  textBlock.initModel();
  textBlock.setFieldValue(literalAsString, 'TEXT');
  return textBlock;
}

function createBlockFromDescriptor(
  descriptor: BlockDescriptor,
  state: CompilerState,
  opIndex: number,
): Blockly.Block {
  assertKnownBlockType(descriptor.type, state);

  const block = state.workspace.newBlock(descriptor.type, createDeterministicId(state, opIndex));
  block.initModel();

  for (const [fieldName, fieldValue] of Object.entries(descriptor.fields || {})) {
    const field = block.getField(fieldName);
    if (!field) {
      throw new Error(`Unknown field "${fieldName}" for block "${descriptor.type}"`);
    }
    const resolvedValue = resolveReferenceValue(descriptor.type, fieldName, fieldValue, state);
    block.setFieldValue(String(resolvedValue), fieldName);
  }

  for (const [inputName, inputValue] of Object.entries(descriptor.inputs || {})) {
    const input = block.getInput(inputName);
    if (!input || !input.connection) {
      throw new Error(`Unknown input "${inputName}" for block "${descriptor.type}"`);
    }
    if (input.connection.type !== Blockly.INPUT_VALUE) {
      throw new Error(`Input "${inputName}" on "${descriptor.type}" is not a value input`);
    }

    let childBlock: Blockly.Block;
    if (typeof inputValue === 'object' && inputValue !== null && 'block' in inputValue) {
      childBlock = createBlockFromDescriptor(
        {
          type: inputValue.block,
          fields: inputValue.fields,
          inputs: inputValue.inputs,
          statements: inputValue.statements,
        },
        state,
        opIndex,
      );
    } else {
      childBlock = createLiteralReporterBlock(
        {
          name: inputName,
          kind: 'value',
          checks: input.connection.getCheck() || [],
        },
        inputValue as Scalar,
        state,
        opIndex,
      );
    }

    const outputConnection = childBlock.outputConnection;
    if (!outputConnection) {
      throw new Error(`Block "${childBlock.type}" cannot be connected to value input "${inputName}"`);
    }
    safeConnect(input.connection, outputConnection, `${descriptor.type}.${inputName}`);
  }

  for (const [statementInputName, actions] of Object.entries(descriptor.statements || {})) {
    const statementInput = block.getInput(statementInputName);
    if (!statementInput?.connection || statementInput.connection.type !== Blockly.NEXT_STATEMENT) {
      throw new Error(`Unknown statement input "${statementInputName}" for block "${descriptor.type}"`);
    }
    appendActionChain(statementInput.connection, actions, state, opIndex);
  }

  return block;
}

function createActionBlock(action: ActionSpec, state: CompilerState, opIndex: number): Blockly.Block {
  return createBlockFromDescriptor(
    {
      type: action.action,
      fields: action.fields,
      inputs: action.inputs,
      statements: action.statements,
    },
    state,
    opIndex,
  );
}

function appendActionChain(
  parentConnection: Blockly.Connection,
  actions: ActionSpec[],
  state: CompilerState,
  opIndex: number,
): void {
  if (actions.length === 0) return;

  const actionBlocks = actions.map((action) => createActionBlock(action, state, opIndex));
  for (const actionBlock of actionBlocks) {
    if (!actionBlock.previousConnection) {
      throw new Error(`Action block "${actionBlock.type}" cannot be used in a statement chain`);
    }
  }

  if (!parentConnection.targetConnection) {
    safeConnect(parentConnection, actionBlocks[0].previousConnection!, `${actionBlocks[0].type}:start`);
  } else {
    let tail = parentConnection.targetBlock();
    while (tail?.getNextBlock()) {
      tail = tail.getNextBlock();
    }
    if (!tail?.nextConnection) {
      throw new Error('Could not find tail next connection for statement chain append');
    }
    safeConnect(tail.nextConnection, actionBlocks[0].previousConnection!, `${tail.type}:append`);
  }

  for (let index = 1; index < actionBlocks.length; index += 1) {
    const previousBlock = actionBlocks[index - 1];
    const currentBlock = actionBlocks[index];
    if (!previousBlock.nextConnection || !currentBlock.previousConnection) {
      throw new Error(`Cannot chain "${previousBlock.type}" -> "${currentBlock.type}"`);
    }
    safeConnect(previousBlock.nextConnection, currentBlock.previousConnection, `${previousBlock.type}:next`);
  }
}

function findFlowBlock(selector: Extract<SemanticOp, { op: 'append_actions' }>['flowSelector'], workspace: Blockly.Workspace): Blockly.Block | null {
  if (selector.eventBlockId) {
    return workspace.getBlockById(selector.eventBlockId) || null;
  }

  const topBlocks = workspace.getTopBlocks(true);
  let candidates = topBlocks;
  if (selector.eventType) {
    candidates = candidates.filter((block) => block.type === selector.eventType);
  }
  if (selector.eventFieldEquals) {
    candidates = candidates.filter((block) =>
      Object.entries(selector.eventFieldEquals || {}).every(
        ([fieldName, expectedValue]) => String(block.getFieldValue(fieldName) || '') === expectedValue
      )
    );
  }
  if (candidates.length === 0) return null;
  const index = Math.max(0, selector.index || 0);
  return candidates[index] || null;
}

function applyRetargetReference(op: Extract<SemanticOp, { op: 'retarget_reference' }>, state: CompilerState): void {
  const mappingByKind: Record<SemanticOp['op'] | string, Record<string, string>> = {
    object: OBJECT_REFERENCE_BLOCKS,
    scene: SCENE_REFERENCE_BLOCKS,
    sound: SOUND_REFERENCE_BLOCKS,
    message: MESSAGE_REFERENCE_BLOCKS,
    variable: VARIABLE_REFERENCE_BLOCKS,
    type: TYPE_REFERENCE_BLOCKS,
  };
  const fieldMap = mappingByKind[op.referenceKind];
  if (!fieldMap) return;

  for (const block of state.workspace.getAllBlocks(false)) {
    const fieldName = fieldMap[block.type];
    if (!fieldName) continue;
    const current = block.getFieldValue(fieldName);
    if (current === op.from) {
      block.setFieldValue(op.to, fieldName);
    }
  }
}

function normalizeTopLevelOrder(workspace: Blockly.Workspace): void {
  // Headless workspace blocks do not expose rendering position APIs.
  // Deterministic top-level ordering is applied during XML serialization.
  void workspace;
}

function applySemanticOp(op: SemanticOp, state: CompilerState, opIndex: number): void {
  switch (op.op) {
    case 'ensure_message': {
      ensureMessage(op.name, state);
      return;
    }
    case 'ensure_variable': {
      ensureVariable(op, state);
      return;
    }
    case 'create_event_flow': {
      const eventBlock = createBlockFromDescriptor(
        {
          type: op.event,
          fields: op.fields,
          statements: {},
        },
        state,
        opIndex,
      );
      const statementInput = firstStatementInput(eventBlock);
      if (!statementInput?.connection) {
        throw new Error(`Event block "${op.event}" has no statement input`);
      }
      appendActionChain(statementInput.connection, op.actions || [], state, opIndex);
      return;
    }
    case 'append_actions': {
      const flowBlock = findFlowBlock(op.flowSelector, state.workspace);
      if (!flowBlock) {
        throw new Error('append_actions: target flow not found');
      }
      const statementInput = firstStatementInput(flowBlock);
      if (!statementInput?.connection) {
        throw new Error(`append_actions: flow "${flowBlock.type}" has no statement input`);
      }
      appendActionChain(statementInput.connection, op.actions, state, opIndex);
      return;
    }
    case 'replace_action': {
      const oldBlock = state.workspace.getBlockById(op.targetBlockId);
      if (!oldBlock) throw new Error(`replace_action: block "${op.targetBlockId}" not found`);
      if (!state.capabilities.byType[oldBlock.type]) {
        throw new Error(`replace_action: target block type "${oldBlock.type}" is not LLM-exposed`);
      }

      const previousTarget = oldBlock.previousConnection?.targetConnection || null;
      const nextTarget = oldBlock.nextConnection?.targetConnection || null;

      if (oldBlock.previousConnection?.isConnected()) oldBlock.previousConnection.disconnect();
      if (oldBlock.nextConnection?.isConnected()) oldBlock.nextConnection.disconnect();

      oldBlock.dispose(true);

      const newBlock = createActionBlock(op.action, state, opIndex);
      if (!newBlock.previousConnection) {
        throw new Error(`replace_action: replacement block "${newBlock.type}" is not statement-compatible`);
      }
      if (previousTarget) {
        safeConnect(previousTarget, newBlock.previousConnection, `replace_action:${newBlock.type}`);
      }
      if (nextTarget && newBlock.nextConnection) {
        safeConnect(newBlock.nextConnection, nextTarget, `replace_action:${newBlock.type}:next`);
      }
      return;
    }
    case 'set_block_field': {
      const block = state.workspace.getBlockById(op.targetBlockId);
      if (!block) throw new Error(`set_block_field: block "${op.targetBlockId}" not found`);
      if (!state.capabilities.byType[block.type]) {
        throw new Error(`set_block_field: block type "${block.type}" is not LLM-exposed`);
      }
      const field = block.getField(op.field);
      if (!field) throw new Error(`set_block_field: field "${op.field}" not found on block "${block.type}"`);
      const resolved = resolveReferenceValue(block.type, op.field, op.value, state);
      block.setFieldValue(String(resolved), op.field);
      return;
    }
    case 'retarget_reference': {
      applyRetargetReference(op, state);
      return;
    }
    case 'delete_subtree': {
      const block = state.workspace.getBlockById(op.targetBlockId);
      if (!block) throw new Error(`delete_subtree: block "${op.targetBlockId}" not found`);
      if (!state.capabilities.byType[block.type]) {
        throw new Error(`delete_subtree: block type "${block.type}" is not LLM-exposed`);
      }
      block.dispose(true);
      return;
    }
    default: {
      const exhaustive: never = op;
      throw new Error(`Unsupported semantic op: ${(exhaustive as { op?: string }).op}`);
    }
  }
}

function safeLoadWorkspace(workspace: Blockly.Workspace, xmlText: string): void {
  if (!xmlText.trim()) return;
  const xml = Blockly.utils.xml.textToDom(xmlText);
  Blockly.Xml.domToWorkspace(xml, workspace);
}

function workspaceToXmlText(workspace: Blockly.Workspace): string {
  const topBlocks = workspace.getTopBlocks(false);
  if (topBlocks.length === 0) return '';

  const dom = Blockly.Xml.workspaceToDom(workspace);
  const topLevelBlocks = Array.from(dom.children).filter((child) => child.tagName === 'block');
  if (topLevelBlocks.length > 1) {
    const priority: Record<string, number> = {
      event_game_start: 0,
      event_when_receive: 1,
      event_key_pressed: 2,
      event_clicked: 3,
      event_when_touching: 4,
      event_when_touching_direction: 5,
    };

    topLevelBlocks.sort((a, b) => {
      const aType = a.getAttribute('type') || '';
      const bType = b.getAttribute('type') || '';
      const aPriority = priority[aType] ?? 99;
      const bPriority = priority[bType] ?? 99;
      if (aPriority !== bPriority) return aPriority - bPriority;
      if (aType !== bType) return aType.localeCompare(bType);
      const aId = a.getAttribute('id') || '';
      const bId = b.getAttribute('id') || '';
      return aId.localeCompare(bId);
    });

    for (const blockElement of topLevelBlocks) {
      dom.appendChild(blockElement);
    }
  }

  return Blockly.Xml.domToText(dom);
}

export function buildCandidateFromSemanticOps(args: {
  capabilities: BlocklyCapabilities;
  context: ProgramContext;
  semanticOps: SemanticOp[];
}): BuildCandidateResult {
  const workspace = new Blockly.Workspace();
  const previousXml = args.context.targetXml || '';

  try {
    safeLoadWorkspace(workspace, previousXml);
    const state = initializeState(args.capabilities, args.context, workspace);

    const beforeCount = workspace.getAllBlocks(false).length;
    const maxOps = args.capabilities.limits.maxOpsPerRequest;
    if (args.semanticOps.length > maxOps) {
      throw new Error(`Too many semantic ops (${args.semanticOps.length}). Limit: ${maxOps}`);
    }

    for (let opIndex = 0; opIndex < args.semanticOps.length; opIndex += 1) {
      const op = args.semanticOps[opIndex];
      applySemanticOp(op, state, opIndex + 1);
    }

    normalizeTopLevelOrder(workspace);

    const afterCount = workspace.getAllBlocks(false).length;
    const delta = Math.abs(afterCount - beforeCount);
    if (delta > args.capabilities.limits.maxBlocksPerMutation) {
      throw new Error(
        `Block delta too large (${delta}). Limit: ${args.capabilities.limits.maxBlocksPerMutation}`
      );
    }

    const candidateXml = workspaceToXmlText(workspace);
    const diff = createCandidateDiff(previousXml, candidateXml);

    return {
      previousXml,
      candidateXml,
      semanticOps: args.semanticOps,
      diff,
      pendingEnsures: state.pendingEnsures,
      blocksBefore: beforeCount,
      blocksAfter: afterCount,
    };
  } finally {
    workspace.dispose();
  }
}
