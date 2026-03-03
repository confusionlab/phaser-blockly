import * as Blockly from 'blockly';
import type { GameObject, Project, Scene } from '@/types';
import { getEffectiveObjectProps } from '@/types';
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

  return issues;
}
