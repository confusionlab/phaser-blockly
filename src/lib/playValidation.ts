import * as Blockly from 'blockly';
import type { GameObject, Project, Scene } from '@/types';
import { getEffectiveObjectProps } from '@/types';
import '@/components/blockly/toolbox';

const PICK_FROM_STAGE = '__PICK_FROM_STAGE__';
const COMPONENT_ANY_PREFIX = 'COMPONENT_ANY:';

const OBJECT_REFERENCE_BLOCKS: Record<string, string> = {
  sensing_touching: 'TARGET',
  sensing_touching_direction: 'TARGET',
  sensing_distance_to: 'TARGET',
  sensing_touching_object: 'TARGET',
  motion_point_towards: 'TARGET',
  camera_follow_object: 'TARGET',
  control_clone_object: 'TARGET',
  event_when_touching: 'TARGET',
  event_when_touching_direction: 'TARGET',
  motion_attach_to_dropdown: 'TARGET',
  motion_attach_dropdown_to_me: 'TARGET',
};

const SOUND_REFERENCE_BLOCKS: Record<string, string> = {
  sound_play: 'SOUND',
  sound_play_until_done: 'SOUND',
};

const VARIABLE_REFERENCE_BLOCKS: Record<string, string> = {
  typed_variable_get: 'VAR',
  typed_variable_set: 'VAR',
  typed_variable_change: 'VAR',
};

const VALID_SPECIAL_VALUES = new Set(['EDGE', 'GROUND', 'MOUSE', 'MY_CLONES']);

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

function getFieldValue(blockElement: Element, fieldName: string): string {
  const fields = Array.from(blockElement.children).filter((node) => node.tagName === 'field');
  const field = fields.find((node) => node.getAttribute('name') === fieldName);
  return (field?.textContent || '').trim();
}

function validateBlockElement(
  blockElement: Element,
  blockIndex: number,
  scene: Scene,
  object: GameObject,
  soundIds: Set<string>,
  variableIds: Set<string>,
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

  const objectFieldName = OBJECT_REFERENCE_BLOCKS[blockType];
  if (objectFieldName) {
    const value = getFieldValue(blockElement, objectFieldName);
    if (!value || value === PICK_FROM_STAGE) {
      pushIssue('Missing object selection in dropdown.');
    } else if (value.startsWith(COMPONENT_ANY_PREFIX)) {
      const componentId = value.slice(COMPONENT_ANY_PREFIX.length);
      const component = componentsById.get(componentId);
      const hasInstanceInScene = scene.objects.some((o) => o.componentId === componentId);
      if (!component || !hasInstanceInScene) {
        pushIssue('Selected component target is missing in this scene.');
      }
    } else if (!VALID_SPECIAL_VALUES.has(value) && !scene.objects.some((o) => o.id === value)) {
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

  return issues;
}

export function validateProjectBeforePlay(project: Project): PlayValidationIssue[] {
  const issues: PlayValidationIssue[] = [];
  const componentsById = new Map((project.components || []).map((component) => [component.id, component]));

  for (const scene of project.scenes) {
    for (const object of scene.objects) {
      const { blocklyXml, sounds } = getEffectiveObjectProps(object, project.components || []);
      if (!blocklyXml.trim()) continue;

      const soundIds = new Set(sounds.map((sound) => sound.id));
      const variableIds = new Set<string>(project.globalVariables.map((variable) => variable.id));
      for (const localVariable of object.localVariables || []) {
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

  return issues;
}
