import * as Blockly from 'blockly';
import type { GameObject, Project, Scene } from '@/types';
import { getEffectiveObjectProps } from '@/types';
import { buildVariableDefinitionIndex } from '@/lib/variableUtils';
import {
  COMPONENT_ANY_PREFIX,
  OBJECT_REFERENCE_BLOCKS,
  PICK_FROM_STAGE,
  SCENE_REFERENCE_BLOCKS,
  SOUND_REFERENCE_BLOCKS,
  VALID_OBJECT_SPECIAL_VALUES,
  VARIABLE_REFERENCE_BLOCKS,
} from '@/lib/blocklyReferenceMaps';
import '@/components/blockly/toolbox';

const TYPE_REFERENCE_BLOCKS: Record<string, string> = {
  control_spawn_type_at: 'TYPE',
  sensing_type_literal: 'TYPE',
};

const TYPE_REPORTER_BLOCK_TYPES = new Set([
  'sensing_type_literal',
  'sensing_my_type',
  'sensing_type_of_object',
]);
const DEPRECATED_BLOCK_MESSAGES: Record<string, string> = {
  control_clone: 'Deprecated clone block. Use "spawn type at x,y".',
  control_clone_object: 'Deprecated clone block. Use "spawn type at x,y".',
  control_delete_clone: 'Deprecated clone block. Use "delete object" patterns with spawned instances.',
  sensing_is_clone_of: 'Deprecated clone/type check. Use "my type", "type of(object)", and "=".',
};
export interface PlayValidationIssue {
  id: string;
  sceneId: string;
  sceneName: string;
  objectId: string;
  objectName: string;
  blockId: string;
  blockType: string;
  message: string;
}

type SceneValidationContext = Pick<Scene, 'id' | 'name' | 'objects'>;
type ObjectValidationContext = Pick<GameObject, 'id' | 'name'>;

function getFieldValue(blockElement: Element, fieldName: string): string {
  const fields = Array.from(blockElement.children).filter((node) => node.tagName === 'field');
  const field = fields.find((node) => node.getAttribute('name') === fieldName);
  return (field?.textContent || '').trim();
}

function getInputBlockElement(blockElement: Element, inputName: string): Element | null {
  const valueNode = Array.from(blockElement.children).find(
    (node) => node.tagName === 'value' && node.getAttribute('name') === inputName
  );
  if (!valueNode) return null;
  const candidate = Array.from(valueNode.children).find(
    (node) => node.tagName === 'block' || node.tagName === 'shadow'
  );
  return candidate || null;
}

function isTypeReporterElement(blockElement: Element | null): boolean {
  if (!blockElement) return false;
  const blockType = blockElement.getAttribute('type') || '';
  return TYPE_REPORTER_BLOCK_TYPES.has(blockType);
}

function validateBlockElement(
  blockElement: Element,
  blockIndex: number,
  scene: SceneValidationContext,
  object: ObjectValidationContext,
  soundIds: Set<string>,
  variableIds: Set<string>,
  sceneIds: Set<string>,
  sceneNameCounts: Map<string, number>,
  componentsById: Map<string, Project['components'][number]>
): PlayValidationIssue[] {
  const issues: PlayValidationIssue[] = [];
  const blockType = blockElement.getAttribute('type') || '';
  const blockId = blockElement.getAttribute('id') || 'unknown';

  const pushIssue = (message: string) => {
    issues.push({
      id: `${scene.id}:${object.id}:${blockId}:${blockIndex}:${issues.length}`,
      sceneId: scene.id,
      sceneName: scene.name,
      objectId: object.id,
      objectName: object.name,
      blockId,
      blockType,
      message,
    });
  };

  if (!blockType || !Blockly.Blocks[blockType]) {
    pushIssue(`Missing block type: "${blockType || 'unknown'}".`);
    return issues;
  }

  const deprecatedMessage = DEPRECATED_BLOCK_MESSAGES[blockType];
  if (deprecatedMessage) {
    pushIssue(deprecatedMessage);
  }

  const objectFieldName = OBJECT_REFERENCE_BLOCKS[blockType];
  if (objectFieldName) {
    const value = getFieldValue(blockElement, objectFieldName);
    if (!value || value === PICK_FROM_STAGE) {
      pushIssue('Missing object selection in dropdown.');
    } else if (value === 'MY_CLONES') {
      pushIssue('Deprecated target "myself (cloned)". Use "my type".');
    } else if (value.startsWith(COMPONENT_ANY_PREFIX)) {
      const componentId = value.slice(COMPONENT_ANY_PREFIX.length);
      const component = componentsById.get(componentId);
      const hasInstanceInScene = scene.objects.some((o) => o.componentId === componentId);
      if (!component || !hasInstanceInScene) {
        pushIssue('Selected component target is missing in this scene.');
      }
    } else if (!VALID_OBJECT_SPECIAL_VALUES.has(value) && !scene.objects.some((o) => o.id === value)) {
      pushIssue('Selected object target is missing in this scene.');
    }
  }

  const soundFieldName = SOUND_REFERENCE_BLOCKS[blockType];
  if (soundFieldName) {
    const value = getFieldValue(blockElement, soundFieldName);
    if (!value) {
      pushIssue('Missing sound selection in dropdown.');
    } else if (!soundIds.has(value)) {
      pushIssue('Selected sound is missing on this object.');
    }
  }

  const variableFieldName = VARIABLE_REFERENCE_BLOCKS[blockType];
  if (variableFieldName) {
    const value = getFieldValue(blockElement, variableFieldName);
    if (!value) {
      pushIssue('Missing variable selection in dropdown.');
    } else if (!variableIds.has(value)) {
      pushIssue('Selected variable no longer exists.');
    }
  }

  const sceneFieldName = SCENE_REFERENCE_BLOCKS[blockType];
  if (sceneFieldName) {
    const value = getFieldValue(blockElement, sceneFieldName);
    if (!value) {
      pushIssue('Missing scene selection in dropdown.');
    } else {
      const hasLegacyUniqueName = (sceneNameCounts.get(value) || 0) === 1;
      if (!sceneIds.has(value) && !hasLegacyUniqueName) {
        pushIssue('Selected scene target is missing in this project.');
      }
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
      if (!componentsById.has(componentId)) {
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

export function validateProjectBeforePlay(project: Project): PlayValidationIssue[] {
  const issues: PlayValidationIssue[] = [];
  const componentsById = new Map((project.components || []).map((component) => [component.id, component]));
  const sceneIds = new Set(project.scenes.map((scene) => scene.id));
  const sceneNameCounts = new Map<string, number>();
  for (const scene of project.scenes) {
    sceneNameCounts.set(scene.name, (sceneNameCounts.get(scene.name) || 0) + 1);
  }

  const allObjects = project.scenes.flatMap((scene) => scene.objects);
  const { conflicts: variableConflicts } = buildVariableDefinitionIndex(
    project.globalVariables || [],
    project.components || [],
    allObjects,
  );
  for (const conflict of variableConflicts.slice(0, 20)) {
    issues.push({
      id: `variable-conflict:${conflict.id}:${conflict.existingSource}:${conflict.incomingSource}`,
      sceneId: project.scenes[0]?.id || '',
      sceneName: project.scenes[0]?.name || 'Project',
      objectId: '',
      objectName: 'Variables',
      blockId: 'variables',
      blockType: 'variables',
      message: `Variable ID "${conflict.id}" is defined inconsistently (${conflict.existingSource} vs ${conflict.incomingSource}).`,
    });
  }

  for (const scene of project.scenes) {
    for (const object of scene.objects) {
      const { blocklyXml, sounds } = getEffectiveObjectProps(object, project.components || []);
      if (!blocklyXml.trim()) continue;

      const soundIds = new Set(sounds.map((sound) => sound.id));
      const variableIds = new Set<string>(project.globalVariables.map((variable) => variable.id));
      const componentLocalVariables = object.componentId
        ? componentsById.get(object.componentId)?.localVariables || []
        : [];
      const localVariablesForValidation = componentLocalVariables.length > 0
        ? componentLocalVariables
        : (object.localVariables || []);
      for (const localVariable of localVariablesForValidation) {
        variableIds.add(localVariable.id);
      }

      try {
        const xml = Blockly.utils.xml.textToDom(blocklyXml);
        const blocks = Array.from(xml.getElementsByTagName('block'));
        for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
          issues.push(
            ...validateBlockElement(
              blocks[blockIndex],
              blockIndex,
              scene,
              object,
              soundIds,
              variableIds,
              sceneIds,
              sceneNameCounts,
              componentsById
            )
          );
        }
      } catch {
        issues.push({
          id: `${scene.id}:${object.id}:xml-parse`,
          sceneId: scene.id,
          sceneName: scene.name,
          objectId: object.id,
          objectName: object.name,
          blockId: 'xml',
          blockType: 'xml',
          message: 'Invalid block XML (cannot parse object code).',
        });
      }
    }
  }

  const componentValidationScene: SceneValidationContext = {
    id: project.scenes[0]?.id || '',
    name: project.scenes[0]?.name || 'Project',
    objects: allObjects,
  };

  for (const component of project.components || []) {
    const blocklyXml = component.blocklyXml || '';
    if (!blocklyXml.trim()) continue;

    const soundIds = new Set((component.sounds || []).map((sound) => sound.id));
    const variableIds = new Set<string>(project.globalVariables.map((variable) => variable.id));
    for (const localVariable of component.localVariables || []) {
      variableIds.add(localVariable.id);
    }

    try {
      const xml = Blockly.utils.xml.textToDom(blocklyXml);
      const blocks = Array.from(xml.getElementsByTagName('block'));
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        issues.push(
          ...validateBlockElement(
            blocks[blockIndex],
            blockIndex,
            componentValidationScene,
            { id: '', name: `[Component] ${component.name}` },
            soundIds,
            variableIds,
            sceneIds,
            sceneNameCounts,
            componentsById,
          )
        );
      }
    } catch {
      issues.push({
        id: `component:${component.id}:xml-parse`,
        sceneId: componentValidationScene.id,
        sceneName: componentValidationScene.name,
        objectId: '',
        objectName: `[Component] ${component.name}`,
        blockId: 'xml',
        blockType: 'xml',
        message: 'Invalid block XML (cannot parse component code).',
      });
    }
  }

  return issues;
}
