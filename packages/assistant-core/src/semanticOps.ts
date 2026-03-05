import type {
  ActionSpec,
  AssistantValidationResult,
  EventFlowSelector,
  InputLiteralSpec,
  ProjectOp,
  ProposedEdits,
  Scalar,
  SemanticOp,
} from './types';

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

const SEMANTIC_OP_NAMES = new Set([
  'create_event_flow',
  'append_actions',
  'replace_action',
  'set_block_field',
  'ensure_variable',
  'ensure_message',
  'retarget_reference',
  'delete_subtree',
]);

const PROJECT_OP_NAMES = new Set([
  'rename_project',
  'create_scene',
  'rename_scene',
  'reorder_scenes',
  'create_object',
  'rename_object',
  'set_object_property',
  'set_object_physics',
  'set_object_collider_type',
  'create_folder',
  'rename_folder',
  'move_object_to_folder',
  'add_costume_from_image_url',
  'add_costume_text_circle',
  'rename_costume',
  'reorder_costumes',
  'set_current_costume',
  'validate_project',
]);

const PROJECT_OP_ALIASES: Record<string, string> = {
  add_svg_text_costume: 'add_costume_text_circle',
  add_text_costume: 'add_costume_text_circle',
  create_text_costume: 'add_costume_text_circle',
  add_image_costume: 'add_costume_from_image_url',
  add_costume_from_image: 'add_costume_from_image_url',
  import_image_costume: 'add_costume_from_image_url',
  set_physics: 'set_object_physics',
  set_collider_type: 'set_object_collider_type',
};

function readOpName(
  value: Record<string, unknown>,
  allowed: Set<string>,
  aliases?: Record<string, string>,
): string | null {
  const normalize = (raw: unknown): string => (typeof raw === 'string' ? raw.trim() : '');
  const applyAlias = (raw: string): string => aliases?.[raw] ?? raw;

  const direct = applyAlias(normalize(getAlias(value, 'op')));
  if (direct) return direct;

  const typeAlias = applyAlias(normalize(getAlias(value, 'type')));
  if (!typeAlias || !allowed.has(typeAlias)) return null;
  return typeAlias;
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

  const block = getAlias<string>(value, 'block', 'type', 'blockType', 'block_type');
  if ((typeof block !== 'string' || !block.trim()) && value.shadow !== undefined) {
    const parsedShadow = parseInputLiteral(value.shadow, `${path}.shadow`, errors);
    if (parsedShadow !== null) {
      return parsedShadow;
    }
  }
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

  const action = getAlias<string>(value, 'action', 'type', 'block', 'blockType', 'block_type');
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

  const op = readOpName(value, SEMANTIC_OP_NAMES);
  if (!op) {
    errors.push(`${path}.op: expected non-empty string`);
    return null;
  }

  switch (op) {
    case 'create_event_flow': {
      const event = getAlias<string>(value, 'event', 'eventType', 'event_type');
      if (typeof event !== 'string' || !event.trim()) {
        errors.push(`${path}.event: expected non-empty string`);
        return null;
      }
      const parsed: SemanticOp = {
        op: 'create_event_flow',
        event,
      };
      const opIndex = getAlias<number>(value, 'index');
      if (opIndex !== undefined && typeof opIndex === 'number') {
        parsed.index = Math.max(0, Math.floor(opIndex));
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
      let flowSelectorCandidate = getAlias<unknown>(value, 'flowSelector', 'flow_selector');
      if (!isRecord(flowSelectorCandidate)) {
        const inferredSelector: Record<string, unknown> = {};
        const inferredEventBlockId = getAlias<string>(value, 'eventBlockId', 'event_block_id');
        if (typeof inferredEventBlockId === 'string' && inferredEventBlockId.trim()) {
          inferredSelector.eventBlockId = inferredEventBlockId;
        }
        const inferredEventType = getAlias<string>(value, 'eventType', 'event_type', 'event');
        if (typeof inferredEventType === 'string' && inferredEventType.trim()) {
          inferredSelector.eventType = inferredEventType;
        }
        const inferredFieldEquals = getAlias<unknown>(value, 'eventFieldEquals', 'event_field_equals');
        if (inferredFieldEquals !== undefined) {
          inferredSelector.eventFieldEquals = inferredFieldEquals;
        }
        const inferredIndex = getAlias<number>(value, 'index');
        if (typeof inferredIndex === 'number') {
          inferredSelector.index = inferredIndex;
        }
        if (Object.keys(inferredSelector).length > 0) {
          flowSelectorCandidate = inferredSelector;
        }
      }
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
      const targetBlockId = getAlias<string>(value, 'targetBlockId', 'target_block_id', 'blockId', 'block_id');
      if (typeof targetBlockId !== 'string' || !targetBlockId.trim()) {
        errors.push(`${path}.targetBlockId: expected non-empty string`);
        return null;
      }
      const action = parseAction(getAlias(value, 'action', 'newAction', 'replacement'), `${path}.action`, errors);
      if (!action) return null;
      return {
        op: 'replace_action',
        targetBlockId,
        action,
      };
    }
    case 'set_block_field': {
      const targetBlockId = getAlias<string>(value, 'targetBlockId', 'target_block_id', 'blockId', 'block_id');
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
      const targetBlockId = getAlias<string>(value, 'targetBlockId', 'target_block_id', 'blockId', 'block_id');
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

function parseProjectOp(value: unknown, index: number, errors: string[]): ProjectOp | null {
  const path = `projectOps[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path}: expected object`);
    return null;
  }

  const op = readOpName(value, PROJECT_OP_NAMES, PROJECT_OP_ALIASES);
  if (!op) {
    errors.push(`${path}.op: expected non-empty string`);
    return null;
  }

  const requireString = (key: string, ...aliases: string[]): string | null => {
    const raw = getAlias<string>(value, key, ...aliases);
    if (typeof raw !== 'string' || !raw.trim()) {
      errors.push(`${path}.${key}: expected non-empty string`);
      return null;
    }
    return raw;
  };

  switch (op) {
    case 'rename_project': {
      const name = requireString('name');
      if (!name) return null;
      return { op: 'rename_project', name };
    }
    case 'create_scene': {
      const name = requireString('name');
      if (!name) return null;
      return { op: 'create_scene', name };
    }
    case 'rename_scene': {
      const sceneId = requireString('sceneId', 'scene_id');
      const name = requireString('name');
      if (!sceneId || !name) return null;
      return { op: 'rename_scene', sceneId, name };
    }
    case 'reorder_scenes': {
      const sceneIds = getAlias<unknown>(value, 'sceneIds', 'scene_ids');
      if (!Array.isArray(sceneIds) || !sceneIds.every((item) => typeof item === 'string')) {
        errors.push(`${path}.sceneIds: expected string[]`);
        return null;
      }
      return { op: 'reorder_scenes', sceneIds };
    }
    case 'create_object': {
      const sceneId = requireString('sceneId', 'scene_id');
      const name = requireString('name');
      if (!sceneId || !name) return null;
      const parsed: ProjectOp = { op: 'create_object', sceneId, name };
      const x = getAlias<unknown>(value, 'x');
      const y = getAlias<unknown>(value, 'y');
      if (typeof x === 'number' && Number.isFinite(x)) parsed.x = x;
      if (typeof y === 'number' && Number.isFinite(y)) parsed.y = y;
      return parsed;
    }
    case 'rename_object': {
      const sceneId = requireString('sceneId', 'scene_id');
      const objectId = requireString('objectId', 'object_id');
      const name = requireString('name');
      if (!sceneId || !objectId || !name) return null;
      return { op: 'rename_object', sceneId, objectId, name };
    }
    case 'set_object_property': {
      const sceneId = requireString('sceneId', 'scene_id');
      const objectId = requireString('objectId', 'object_id');
      const property = getAlias<string>(value, 'property');
      const allowed = new Set(['x', 'y', 'scaleX', 'scaleY', 'rotation', 'visible']);
      if (!sceneId || !objectId) return null;
      if (typeof property !== 'string' || !allowed.has(property)) {
        errors.push(`${path}.property: invalid property`);
        return null;
      }
      const opValue = getAlias<unknown>(value, 'value');
      if (!isScalar(opValue)) {
        errors.push(`${path}.value: expected scalar`);
        return null;
      }
      return {
        op: 'set_object_property',
        sceneId,
        objectId,
        property: property as 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'visible',
        value: opValue,
      };
    }
    case 'set_object_physics': {
      const sceneId = requireString('sceneId', 'scene_id');
      const objectId = requireString('objectId', 'object_id');
      if (!sceneId || !objectId) return null;
      const physicsCandidate = getAlias<unknown>(value, 'physics');
      if (physicsCandidate === null) {
        return { op: 'set_object_physics', sceneId, objectId, physics: null };
      }
      if (!isRecord(physicsCandidate)) {
        errors.push(`${path}.physics: expected object or null`);
        return null;
      }
      const enabled = getAlias<unknown>(physicsCandidate, 'enabled');
      if (typeof enabled !== 'boolean') {
        errors.push(`${path}.physics.enabled: expected boolean`);
        return null;
      }
      const parsedPhysics: {
        enabled: boolean;
        bodyType?: 'dynamic' | 'static';
        gravityY?: number;
        velocityX?: number;
        velocityY?: number;
        bounce?: number;
        friction?: number;
        allowRotation?: boolean;
      } = { enabled };

      const bodyType = getAlias<unknown>(physicsCandidate, 'bodyType', 'body_type');
      if (bodyType !== undefined) {
        if (bodyType !== 'dynamic' && bodyType !== 'static') {
          errors.push(`${path}.physics.bodyType: expected "dynamic" or "static"`);
        } else {
          parsedPhysics.bodyType = bodyType;
        }
      }

      const numericFields: Array<{
        key: 'gravityY' | 'velocityX' | 'velocityY' | 'bounce' | 'friction';
        aliases?: string[];
      }> = [
        { key: 'gravityY', aliases: ['gravity_y'] },
        { key: 'velocityX', aliases: ['velocity_x'] },
        { key: 'velocityY', aliases: ['velocity_y'] },
        { key: 'bounce' },
        { key: 'friction' },
      ];
      for (const field of numericFields) {
        const candidate = getAlias<unknown>(physicsCandidate, field.key, ...(field.aliases || []));
        if (candidate === undefined) continue;
        if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
          errors.push(`${path}.physics.${field.key}: expected number`);
          continue;
        }
        parsedPhysics[field.key] = candidate;
      }

      const allowRotation = getAlias<unknown>(physicsCandidate, 'allowRotation', 'allow_rotation');
      if (allowRotation !== undefined) {
        if (typeof allowRotation !== 'boolean') {
          errors.push(`${path}.physics.allowRotation: expected boolean`);
        } else {
          parsedPhysics.allowRotation = allowRotation;
        }
      }

      return { op: 'set_object_physics', sceneId, objectId, physics: parsedPhysics };
    }
    case 'set_object_collider_type': {
      const sceneId = requireString('sceneId', 'scene_id');
      const objectId = requireString('objectId', 'object_id');
      const colliderType = getAlias<string>(value, 'colliderType', 'collider_type', 'type');
      if (!sceneId || !objectId) return null;
      if (colliderType !== 'none' && colliderType !== 'box' && colliderType !== 'circle' && colliderType !== 'capsule') {
        errors.push(`${path}.colliderType: invalid collider type`);
        return null;
      }
      return { op: 'set_object_collider_type', sceneId, objectId, colliderType };
    }
    case 'create_folder': {
      const sceneId = requireString('sceneId', 'scene_id');
      const name = requireString('name');
      if (!sceneId || !name) return null;
      const parentIdCandidate = getAlias<unknown>(value, 'parentId', 'parent_id');
      const parsed: ProjectOp = { op: 'create_folder', sceneId, name };
      if (typeof parentIdCandidate === 'string') {
        parsed.parentId = parentIdCandidate;
      } else if (parentIdCandidate === null) {
        parsed.parentId = null;
      }
      return parsed;
    }
    case 'rename_folder': {
      const sceneId = requireString('sceneId', 'scene_id');
      const folderId = requireString('folderId', 'folder_id');
      const name = requireString('name');
      if (!sceneId || !folderId || !name) return null;
      return { op: 'rename_folder', sceneId, folderId, name };
    }
    case 'move_object_to_folder': {
      const sceneId = requireString('sceneId', 'scene_id');
      const objectId = requireString('objectId', 'object_id');
      if (!sceneId || !objectId) return null;
      const folderIdCandidate = getAlias<unknown>(value, 'folderId', 'folder_id');
      if (folderIdCandidate !== null && typeof folderIdCandidate !== 'string') {
        errors.push(`${path}.folderId: expected string or null`);
        return null;
      }
      return { op: 'move_object_to_folder', sceneId, objectId, folderId: folderIdCandidate as string | null };
    }
    case 'add_costume_from_image_url': {
      const sceneId = requireString('sceneId', 'scene_id');
      const objectId = requireString('objectId', 'object_id');
      const name = requireString('name');
      const imageUrl = requireString('imageUrl', 'image_url');
      if (!sceneId || !objectId || !name || !imageUrl) return null;
      return { op: 'add_costume_from_image_url', sceneId, objectId, name, imageUrl };
    }
    case 'add_costume_text_circle': {
      const sceneId = requireString('sceneId', 'scene_id');
      const objectId = requireString('objectId', 'object_id');
      const name = requireString('name');
      const text = requireString('text');
      if (!sceneId || !objectId || !name || !text) return null;
      const parsed: ProjectOp = { op: 'add_costume_text_circle', sceneId, objectId, name, text };
      const fillColor = getAlias<unknown>(value, 'fillColor', 'fill_color');
      if (typeof fillColor === 'string' && fillColor.trim()) parsed.fillColor = fillColor;
      const textColor = getAlias<unknown>(value, 'textColor', 'text_color');
      if (typeof textColor === 'string' && textColor.trim()) parsed.textColor = textColor;
      return parsed;
    }
    case 'rename_costume': {
      const sceneId = requireString('sceneId', 'scene_id');
      const objectId = requireString('objectId', 'object_id');
      const costumeId = requireString('costumeId', 'costume_id');
      const name = requireString('name');
      if (!sceneId || !objectId || !costumeId || !name) return null;
      return { op: 'rename_costume', sceneId, objectId, costumeId, name };
    }
    case 'reorder_costumes': {
      const sceneId = requireString('sceneId', 'scene_id');
      const objectId = requireString('objectId', 'object_id');
      if (!sceneId || !objectId) return null;
      const costumeIds = getAlias<unknown>(value, 'costumeIds', 'costume_ids');
      if (!Array.isArray(costumeIds) || !costumeIds.every((item) => typeof item === 'string')) {
        errors.push(`${path}.costumeIds: expected string[]`);
        return null;
      }
      return { op: 'reorder_costumes', sceneId, objectId, costumeIds };
    }
    case 'set_current_costume': {
      const sceneId = requireString('sceneId', 'scene_id');
      const objectId = requireString('objectId', 'object_id');
      const costumeId = requireString('costumeId', 'costume_id');
      if (!sceneId || !objectId || !costumeId) return null;
      return { op: 'set_current_costume', sceneId, objectId, costumeId };
    }
    case 'validate_project': {
      return { op: 'validate_project' };
    }
    default: {
      errors.push(`${path}.op: unsupported op "${op}"`);
      return null;
    }
  }
}

export function validateSemanticOpsPayload(value: unknown): AssistantValidationResult<ProposedEdits> {
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
  const projectOpsRaw = getAlias<unknown>(value, 'projectOps', 'project_ops');

  const semanticOps: SemanticOp[] = [];
  if (semanticOpsRaw !== undefined) {
    if (!Array.isArray(semanticOpsRaw)) {
      errors.push('semanticOps must be an array');
    } else {
      for (let index = 0; index < semanticOpsRaw.length; index += 1) {
        const parsedOp = parseSemanticOp(semanticOpsRaw[index], index, errors);
        if (parsedOp) {
          semanticOps.push(parsedOp);
        }
      }
    }
  }

  const projectOps: ProjectOp[] = [];
  if (projectOpsRaw !== undefined) {
    if (!Array.isArray(projectOpsRaw)) {
      errors.push('projectOps must be an array');
    } else {
      for (let index = 0; index < projectOpsRaw.length; index += 1) {
        const parsedOp = parseProjectOp(projectOpsRaw[index], index, errors);
        if (parsedOp) {
          projectOps.push(parsedOp);
        }
      }
    }
  }

  if (semanticOpsRaw === undefined && projectOpsRaw === undefined) {
    errors.push('Payload must include semanticOps or projectOps');
  }

  if (semanticOps.length === 0 && projectOps.length === 0) {
    errors.push('At least one semanticOp or projectOp is required');
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
      projectOps,
    },
  };
}
