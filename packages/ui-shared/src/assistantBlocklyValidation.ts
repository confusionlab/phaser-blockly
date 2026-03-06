import { DOMParser } from '@xmldom/xmldom';
import type { AssistantProjectState } from './assistant';
import { normalizeBlocklyXml } from './blocklyXml';

const COMPONENT_ANY_PREFIX = 'COMPONENT_ANY:';

const OBJECT_SPECIAL_VALUES = ['EDGE', 'GROUND', 'MOUSE', 'MY_TYPE', 'MY_CLONES'] as const;
const VALID_OBJECT_SPECIAL_VALUES = new Set<string>(OBJECT_SPECIAL_VALUES);

const OBJECT_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  object_from_dropdown: 'TARGET',
  sensing_touching: 'TARGET',
  sensing_touching_direction: 'TARGET',
  sensing_distance_to: 'TARGET',
  sensing_touching_object: 'TARGET',
  motion_point_towards: 'TARGET',
  camera_follow_object: 'TARGET',
  event_when_touching: 'TARGET',
  event_when_touching_direction: 'TARGET',
  motion_attach_to_dropdown: 'TARGET',
  motion_attach_dropdown_to_me: 'TARGET',
};

const SOUND_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  sound_play: 'SOUND',
  sound_play_until_done: 'SOUND',
};

const VARIABLE_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  typed_variable_get: 'VAR',
  typed_variable_set: 'VAR',
  typed_variable_change: 'VAR',
};

const SCENE_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  control_switch_scene: 'SCENE',
};

const MESSAGE_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  event_when_receive: 'MESSAGE',
  control_broadcast: 'MESSAGE',
  control_broadcast_wait: 'MESSAGE',
};

const TYPE_REFERENCE_BLOCKS: Readonly<Record<string, string>> = {
  control_spawn_type_at: 'TYPE',
  sensing_type_literal: 'TYPE',
};

const TYPE_REPORTER_BLOCK_TYPES = new Set([
  'sensing_type_literal',
  'sensing_my_type',
  'sensing_type_of_object',
]);

export interface AssistantBlocklySemanticIssue {
  blockType: string;
  message: string;
}

interface BlocklyValidationContext {
  soundIds: ReadonlySet<string>;
  variableIds: ReadonlySet<string>;
  sceneIds: ReadonlySet<string>;
  sceneNameCounts: ReadonlyMap<string, number>;
  messageIds: ReadonlySet<string>;
  objectIdsInScope: ReadonlySet<string>;
  componentIds: ReadonlySet<string>;
  componentIdsWithInstancesInScope: ReadonlySet<string>;
}

function getElementChildren(element: Element | null | undefined): Element[] {
  if (!element) return [];
  return Array.from(element.childNodes ?? []).filter((child): child is Element => child.nodeType === 1);
}

function getFieldValue(blockElement: Element, fieldName: string): string {
  const field = getElementChildren(blockElement).find(
    (node) => node.tagName === 'field' && node.getAttribute('name') === fieldName,
  );
  return String(field?.textContent ?? '').trim();
}

function getInputBlockElement(blockElement: Element, inputName: string): Element | null {
  const valueNode = getElementChildren(blockElement).find(
    (node) => node.tagName === 'value' && node.getAttribute('name') === inputName,
  );
  if (!valueNode) return null;
  return getElementChildren(valueNode).find((node) => node.tagName === 'block' || node.tagName === 'shadow') ?? null;
}

function isTypeReporterElement(blockElement: Element | null): boolean {
  if (!blockElement) return false;
  const blockType = blockElement.getAttribute('type') || '';
  return TYPE_REPORTER_BLOCK_TYPES.has(blockType);
}

function validateBlockElement(
  blockElement: Element,
  context: BlocklyValidationContext,
): AssistantBlocklySemanticIssue[] {
  const issues: AssistantBlocklySemanticIssue[] = [];
  const blockType = blockElement.getAttribute('type') || '';

  const pushIssue = (message: string) => {
    issues.push({ blockType, message });
  };

  const objectFieldName = OBJECT_REFERENCE_BLOCKS[blockType];
  if (objectFieldName) {
    const value = getFieldValue(blockElement, objectFieldName);
    if (!value) {
      pushIssue('Missing object selection in dropdown.');
    } else if (value.startsWith(COMPONENT_ANY_PREFIX)) {
      const componentId = value.slice(COMPONENT_ANY_PREFIX.length);
      if (!context.componentIds.has(componentId) || !context.componentIdsWithInstancesInScope.has(componentId)) {
        pushIssue('Selected component target is missing in scope.');
      }
    } else if (!VALID_OBJECT_SPECIAL_VALUES.has(value) && !context.objectIdsInScope.has(value)) {
      pushIssue('Selected object target is missing in scope.');
    }
  }

  const soundFieldName = SOUND_REFERENCE_BLOCKS[blockType];
  if (soundFieldName) {
    const value = getFieldValue(blockElement, soundFieldName);
    if (!value) {
      pushIssue('Missing sound selection in dropdown.');
    } else if (!context.soundIds.has(value)) {
      pushIssue('Selected sound is missing on this target.');
    }
  }

  const variableFieldName = VARIABLE_REFERENCE_BLOCKS[blockType];
  if (variableFieldName) {
    const value = getFieldValue(blockElement, variableFieldName);
    if (!value) {
      pushIssue('Missing variable selection in dropdown.');
    } else if (!context.variableIds.has(value)) {
      pushIssue('Selected variable no longer exists.');
    }
  }

  const sceneFieldName = SCENE_REFERENCE_BLOCKS[blockType];
  if (sceneFieldName) {
    const value = getFieldValue(blockElement, sceneFieldName);
    if (!value) {
      pushIssue('Missing scene selection in dropdown.');
    } else {
      const hasLegacyUniqueName = (context.sceneNameCounts.get(value) || 0) === 1;
      if (!context.sceneIds.has(value) && !hasLegacyUniqueName) {
        pushIssue('Selected scene target is missing in this project.');
      }
    }
  }

  const messageFieldName = MESSAGE_REFERENCE_BLOCKS[blockType];
  if (messageFieldName) {
    const value = getFieldValue(blockElement, messageFieldName);
    if (!value) {
      pushIssue('Missing message selection in dropdown.');
    } else if (!context.messageIds.has(value)) {
      pushIssue('Selected message no longer exists.');
    }
  }

  const typeFieldName = TYPE_REFERENCE_BLOCKS[blockType];
  if (typeFieldName) {
    const value = getFieldValue(blockElement, typeFieldName);
    if (!value) {
      pushIssue('Missing type selection.');
    } else if (!value.startsWith('component:')) {
      pushIssue('Invalid type token. Expected a component type.');
    } else {
      const componentId = value.slice('component:'.length);
      if (!context.componentIds.has(componentId)) {
        pushIssue('Selected component type is missing in this project.');
      }
    }
  }

  if (blockType === 'logic_compare') {
    const left = getInputBlockElement(blockElement, 'A');
    const right = getInputBlockElement(blockElement, 'B');
    const leftIsTypeLiteral = (left?.getAttribute('type') || '') === 'sensing_type_literal';
    const rightIsTypeLiteral = (right?.getAttribute('type') || '') === 'sensing_type_literal';
    if (leftIsTypeLiteral !== rightIsTypeLiteral) {
      const otherSide = leftIsTypeLiteral ? right : left;
      if (!isTypeReporterElement(otherSide)) {
        pushIssue('Invalid type comparison. Use "type of(object)" or "my type" when comparing to a type literal.');
      }
    }
  }

  return issues;
}

function buildSharedContext(state: AssistantProjectState) {
  const allObjects = state.scenes.flatMap((scene) => scene.objects);
  const sceneIds = new Set(state.scenes.map((scene) => scene.id));
  const sceneNameCounts = new Map<string, number>();
  for (const scene of state.scenes) {
    sceneNameCounts.set(scene.name, (sceneNameCounts.get(scene.name) || 0) + 1);
  }

  return {
    allObjects,
    sceneIds,
    sceneNameCounts,
    componentIds: new Set(state.components.map((component) => component.id)),
    messageIds: new Set(state.messages.map((message) => message.id)),
    globalVariableIds: new Set(state.globalVariables.map((variable) => variable.id)),
  };
}

function collectSemanticIssues(blocklyXml: string, context: BlocklyValidationContext): AssistantBlocklySemanticIssue[] {
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

    const blocks = root.getElementsByTagName('block');
    const issues: AssistantBlocklySemanticIssue[] = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const blockElement = blocks.item(index);
      if (!blockElement) continue;
      issues.push(...validateBlockElement(blockElement, context));
    }
    return issues;
  } catch {
    return [];
  }
}

export function validateAssistantObjectBlocklyXml(
  state: AssistantProjectState,
  sceneId: string,
  objectId: string,
  blocklyXml: string,
): AssistantBlocklySemanticIssue[] {
  const scene = state.scenes.find((candidate) => candidate.id === sceneId);
  const object = scene?.objects.find((candidate) => candidate.id === objectId);
  if (!scene || !object) {
    return [];
  }

  const shared = buildSharedContext(state);
  const linkedComponent = object.componentId
    ? state.components.find((component) => component.id === object.componentId) ?? null
    : null;
  const localVariables = linkedComponent?.localVariables ?? object.localVariables ?? [];
  const soundIds = new Set((linkedComponent?.sounds ?? object.sounds ?? []).map((sound) => sound.id));
  const variableIds = new Set(shared.globalVariableIds);
  for (const localVariable of localVariables) {
    variableIds.add(localVariable.id);
  }

  return collectSemanticIssues(blocklyXml, {
    soundIds,
    variableIds,
    sceneIds: shared.sceneIds,
    sceneNameCounts: shared.sceneNameCounts,
    messageIds: shared.messageIds,
    objectIdsInScope: new Set(scene.objects.map((candidate) => candidate.id)),
    componentIds: shared.componentIds,
    componentIdsWithInstancesInScope: new Set(
      scene.objects.map((candidate) => candidate.componentId).filter((componentId): componentId is string => !!componentId),
    ),
  });
}

export function validateAssistantComponentBlocklyXml(
  state: AssistantProjectState,
  componentId: string,
  blocklyXml: string,
): AssistantBlocklySemanticIssue[] {
  const component = state.components.find((candidate) => candidate.id === componentId);
  if (!component) {
    return [];
  }

  const shared = buildSharedContext(state);
  const variableIds = new Set(shared.globalVariableIds);
  for (const localVariable of component.localVariables ?? []) {
    variableIds.add(localVariable.id);
  }

  return collectSemanticIssues(blocklyXml, {
    soundIds: new Set((component.sounds ?? []).map((sound) => sound.id)),
    variableIds,
    sceneIds: shared.sceneIds,
    sceneNameCounts: shared.sceneNameCounts,
    messageIds: shared.messageIds,
    objectIdsInScope: new Set(shared.allObjects.map((object) => object.id)),
    componentIds: shared.componentIds,
    componentIdsWithInstancesInScope: new Set(
      shared.allObjects.map((object) => object.componentId).filter((candidate): candidate is string => !!candidate),
    ),
  });
}
