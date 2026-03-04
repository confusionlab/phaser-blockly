import type { ActionSpec, EventFlowSelector, InputLiteralSpec, ProposedEdits, Scalar, SemanticOp } from '@/lib/llm/types';

type ValidationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      errors: string[];
    };

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getAlias<T>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (obj[key] !== undefined) {
      return obj[key] as T;
    }
  }
  return undefined;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function parseInputLiteral(value: unknown, path: string, errors: string[]): InputLiteralSpec | null {
  if (isScalar(value)) return value;
  if (!isRecord(value)) {
    errors.push(`${path}: expected scalar or object`);
    return null;
  }

  const block = value.block;
  if (typeof block !== 'string' || !block.trim()) {
    errors.push(`${path}.block: expected non-empty string`);
    return null;
  }

  const parsed: InputLiteralSpec = { block };

  if (value.fields !== undefined) {
    if (!isRecord(value.fields)) {
      errors.push(`${path}.fields: expected object`);
    } else {
      const fields: Record<string, Scalar> = {};
      for (const [fieldName, fieldValue] of Object.entries(value.fields)) {
        if (!isScalar(fieldValue)) {
          errors.push(`${path}.fields.${fieldName}: expected scalar`);
          continue;
        }
        fields[fieldName] = fieldValue;
      }
      if (Object.keys(fields).length > 0) {
        parsed.fields = fields;
      }
    }
  }

  if (value.inputs !== undefined) {
    if (!isRecord(value.inputs)) {
      errors.push(`${path}.inputs: expected object`);
    } else {
      const inputs: Record<string, InputLiteralSpec> = {};
      for (const [inputName, inputValue] of Object.entries(value.inputs)) {
        const parsedInput = parseInputLiteral(inputValue, `${path}.inputs.${inputName}`, errors);
        if (parsedInput !== null) {
          inputs[inputName] = parsedInput;
        }
      }
      if (Object.keys(inputs).length > 0) {
        parsed.inputs = inputs;
      }
    }
  }

  if (value.statements !== undefined) {
    if (!isRecord(value.statements)) {
      errors.push(`${path}.statements: expected object`);
    } else {
      const statements: Record<string, ActionSpec[]> = {};
      for (const [inputName, statementValue] of Object.entries(value.statements)) {
        const parsedStatements = parseActionArray(statementValue, `${path}.statements.${inputName}`, errors);
        if (parsedStatements.length > 0) {
          statements[inputName] = parsedStatements;
        }
      }
      if (Object.keys(statements).length > 0) {
        parsed.statements = statements;
      }
    }
  }

  return parsed;
}

function parseAction(value: unknown, path: string, errors: string[]): ActionSpec | null {
  if (!isRecord(value)) {
    errors.push(`${path}: expected object`);
    return null;
  }

  const action = value.action;
  if (typeof action !== 'string' || !action.trim()) {
    errors.push(`${path}.action: expected non-empty string`);
    return null;
  }

  const parsed: ActionSpec = { action };

  if (value.fields !== undefined) {
    if (!isRecord(value.fields)) {
      errors.push(`${path}.fields: expected object`);
    } else {
      const fields: Record<string, Scalar> = {};
      for (const [fieldName, fieldValue] of Object.entries(value.fields)) {
        if (!isScalar(fieldValue)) {
          errors.push(`${path}.fields.${fieldName}: expected scalar`);
          continue;
        }
        fields[fieldName] = fieldValue;
      }
      if (Object.keys(fields).length > 0) {
        parsed.fields = fields;
      }
    }
  }

  if (value.inputs !== undefined) {
    if (!isRecord(value.inputs)) {
      errors.push(`${path}.inputs: expected object`);
    } else {
      const inputs: Record<string, InputLiteralSpec> = {};
      for (const [inputName, inputValue] of Object.entries(value.inputs)) {
        const parsedInput = parseInputLiteral(inputValue, `${path}.inputs.${inputName}`, errors);
        if (parsedInput !== null) {
          inputs[inputName] = parsedInput;
        }
      }
      if (Object.keys(inputs).length > 0) {
        parsed.inputs = inputs;
      }
    }
  }

  if (value.statements !== undefined) {
    if (!isRecord(value.statements)) {
      errors.push(`${path}.statements: expected object`);
    } else {
      const statements: Record<string, ActionSpec[]> = {};
      for (const [inputName, statementValue] of Object.entries(value.statements)) {
        const parsedStatements = parseActionArray(statementValue, `${path}.statements.${inputName}`, errors);
        if (parsedStatements.length > 0) {
          statements[inputName] = parsedStatements;
        }
      }
      if (Object.keys(statements).length > 0) {
        parsed.statements = statements;
      }
    }
  }

  return parsed;
}

function parseActionArray(value: unknown, path: string, errors: string[]): ActionSpec[] {
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array`);
    return [];
  }

  const actions: ActionSpec[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsedAction = parseAction(value[index], `${path}[${index}]`, errors);
    if (parsedAction) {
      actions.push(parsedAction);
    }
  }
  return actions;
}

function parseSemanticOp(value: unknown, index: number, errors: string[]): SemanticOp | null {
  const path = `semanticOps[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path}: expected object`);
    return null;
  }

  const op = value.op;
  if (typeof op !== 'string' || !op.trim()) {
    errors.push(`${path}.op: expected non-empty string`);
    return null;
  }

  switch (op) {
    case 'create_event_flow': {
      const event = getAlias<string>(value, 'event');
      if (typeof event !== 'string' || !event.trim()) {
        errors.push(`${path}.event: expected non-empty string`);
        return null;
      }
      const parsed: SemanticOp = {
        op: 'create_event_flow',
        event,
      };
      const index = getAlias<number>(value, 'index');
      if (index !== undefined && typeof index === 'number') {
        parsed.index = Math.max(0, Math.floor(index));
      }
      const fieldsCandidate = getAlias<unknown>(value, 'fields');
      if (fieldsCandidate !== undefined) {
        if (!isRecord(fieldsCandidate)) {
          errors.push(`${path}.fields: expected object`);
        } else {
          const fields: Record<string, Scalar> = {};
          for (const [fieldName, fieldValue] of Object.entries(fieldsCandidate)) {
            if (!isScalar(fieldValue)) {
              errors.push(`${path}.fields.${fieldName}: expected scalar`);
              continue;
            }
            fields[fieldName] = fieldValue;
          }
          if (Object.keys(fields).length > 0) {
            parsed.fields = fields;
          }
        }
      }
      const actionsCandidate = getAlias<unknown>(value, 'actions');
      if (actionsCandidate !== undefined) {
        parsed.actions = parseActionArray(actionsCandidate, `${path}.actions`, errors);
      }
      return parsed;
    }
    case 'append_actions': {
      const flowSelectorCandidate = getAlias<unknown>(value, 'flowSelector', 'flow_selector');
      if (!isRecord(flowSelectorCandidate)) {
        errors.push(`${path}.flowSelector: expected object`);
        return null;
      }
      const flowSelector = flowSelectorCandidate;
      const parsedSelector: EventFlowSelector = {};
      const eventBlockId = getAlias<string>(flowSelector, 'eventBlockId', 'event_block_id');
      if (typeof eventBlockId === 'string' && eventBlockId.trim()) {
        parsedSelector.eventBlockId = eventBlockId;
      }
      const eventType = getAlias<string>(flowSelector, 'eventType', 'event_type');
      if (typeof eventType === 'string' && eventType.trim()) {
        parsedSelector.eventType = eventType;
      }
      const eventFieldEqualsCandidate = getAlias<unknown>(flowSelector, 'eventFieldEquals', 'event_field_equals');
      if (eventFieldEqualsCandidate !== undefined) {
        if (!isRecord(eventFieldEqualsCandidate)) {
          errors.push(`${path}.flowSelector.eventFieldEquals: expected object`);
        } else {
          const fieldMatches: Record<string, string> = {};
          for (const [fieldName, fieldValue] of Object.entries(eventFieldEqualsCandidate)) {
            if (typeof fieldValue !== 'string') {
              errors.push(`${path}.flowSelector.eventFieldEquals.${fieldName}: expected string`);
              continue;
            }
            fieldMatches[fieldName] = fieldValue;
          }
          parsedSelector.eventFieldEquals = fieldMatches;
        }
      }
      const selectorIndex = getAlias<number>(flowSelector, 'index');
      if (typeof selectorIndex === 'number') {
        parsedSelector.index = Math.max(0, Math.floor(selectorIndex));
      }
      const actions = parseActionArray(getAlias(value, 'actions'), `${path}.actions`, errors);
      if (actions.length === 0) {
        errors.push(`${path}.actions: requires at least one action`);
      }
      return {
        op: 'append_actions',
        flowSelector: parsedSelector,
        actions,
      };
    }
    case 'replace_action': {
      const targetBlockId = getAlias<string>(value, 'targetBlockId', 'target_block_id');
      if (typeof targetBlockId !== 'string' || !targetBlockId.trim()) {
        errors.push(`${path}.targetBlockId: expected non-empty string`);
        return null;
      }
      const action = parseAction(getAlias(value, 'action'), `${path}.action`, errors);
      if (!action) return null;
      return {
        op: 'replace_action',
        targetBlockId,
        action,
      };
    }
    case 'set_block_field': {
      const targetBlockId = getAlias<string>(value, 'targetBlockId', 'target_block_id');
      if (typeof targetBlockId !== 'string' || !targetBlockId.trim()) {
        errors.push(`${path}.targetBlockId: expected non-empty string`);
        return null;
      }
      const field = getAlias<string>(value, 'field');
      if (typeof field !== 'string' || !field.trim()) {
        errors.push(`${path}.field: expected non-empty string`);
        return null;
      }
      const fieldValue = getAlias<unknown>(value, 'value');
      if (!isScalar(fieldValue)) {
        errors.push(`${path}.value: expected scalar`);
        return null;
      }
      return {
        op: 'set_block_field',
        targetBlockId,
        field,
        value: fieldValue,
      };
    }
    case 'ensure_variable': {
      const scope = getAlias<string>(value, 'scope');
      if (scope !== 'global' && scope !== 'local') {
        errors.push(`${path}.scope: expected "global" or "local"`);
        return null;
      }
      const name = getAlias<string>(value, 'name');
      if (typeof name !== 'string' || !name.trim()) {
        errors.push(`${path}.name: expected non-empty string`);
        return null;
      }
      const variableType = getAlias<string>(value, 'variableType', 'variable_type');
      if (
        variableType !== 'string' &&
        variableType !== 'integer' &&
        variableType !== 'float' &&
        variableType !== 'boolean'
      ) {
        errors.push(`${path}.variableType: invalid variable type`);
        return null;
      }
      const defaultValue = getAlias<unknown>(value, 'defaultValue', 'default_value');
      if (defaultValue !== undefined && !isScalar(defaultValue)) {
        errors.push(`${path}.defaultValue: expected scalar`);
        return null;
      }
      return {
        op: 'ensure_variable',
        scope,
        name,
        variableType,
        defaultValue,
      };
    }
    case 'ensure_message': {
      const name = getAlias<string>(value, 'name');
      if (typeof name !== 'string' || !name.trim()) {
        errors.push(`${path}.name: expected non-empty string`);
        return null;
      }
      return {
        op: 'ensure_message',
        name,
      };
    }
    case 'retarget_reference': {
      const validKinds = ['object', 'scene', 'sound', 'message', 'variable', 'type'] as const;
      const referenceKind = getAlias<string>(value, 'referenceKind', 'reference_kind') as (typeof validKinds)[number];
      if (!validKinds.includes(referenceKind)) {
        errors.push(`${path}.referenceKind: invalid reference kind`);
        return null;
      }
      const from = getAlias<string>(value, 'from');
      if (typeof from !== 'string' || !from.trim()) {
        errors.push(`${path}.from: expected non-empty string`);
        return null;
      }
      const to = getAlias<string>(value, 'to');
      if (typeof to !== 'string' || !to.trim()) {
        errors.push(`${path}.to: expected non-empty string`);
        return null;
      }
      return {
        op: 'retarget_reference',
        referenceKind,
        from,
        to,
      };
    }
    case 'delete_subtree': {
      const targetBlockId = getAlias<string>(value, 'targetBlockId', 'target_block_id');
      if (typeof targetBlockId !== 'string' || !targetBlockId.trim()) {
        errors.push(`${path}.targetBlockId: expected non-empty string`);
        return null;
      }
      return {
        op: 'delete_subtree',
        targetBlockId,
      };
    }
    default: {
      errors.push(`${path}.op: unsupported op "${op}"`);
      return null;
    }
  }
}

export function validateSemanticOpsPayload(value: unknown): ValidationResult<ProposedEdits> {
  if (!isRecord(value)) {
    return { ok: false, errors: ['Payload must be an object'] };
  }

  const errors: string[] = [];

  const intentSummaryRaw = getAlias<string>(value, 'intentSummary', 'intent_summary');
  const intentSummary = typeof intentSummaryRaw === 'string' && intentSummaryRaw.trim()
    ? intentSummaryRaw.trim()
    : 'No summary provided.';

  const assumptions = parseStringArray(getAlias(value, 'assumptions') || []);
  const semanticOpsRaw = getAlias<unknown>(value, 'semanticOps', 'semantic_ops');
  if (!Array.isArray(semanticOpsRaw)) {
    return { ok: false, errors: ['semanticOps must be an array'] };
  }

  const semanticOps: SemanticOp[] = [];
  for (let index = 0; index < semanticOpsRaw.length; index += 1) {
    const parsedOp = parseSemanticOp(semanticOpsRaw[index], index, errors);
    if (parsedOp) {
      semanticOps.push(parsedOp);
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }

  return {
    ok: true,
    value: {
      intentSummary,
      assumptions,
      semanticOps,
    },
  };
}
