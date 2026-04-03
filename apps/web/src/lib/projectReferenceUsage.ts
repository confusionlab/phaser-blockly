import { normalizeBlocklyXml } from '../../../../packages/ui-shared/src/blocklyXml';
import {
  MESSAGE_REFERENCE_BLOCKS,
  VARIABLE_REFERENCE_BLOCKS,
} from '@/lib/blocklyReferenceMaps';
import type { Project } from '@/types';

export type ProjectReferenceEntityKind = 'message' | 'variable';

export type ProjectReferenceOwnerTarget =
  | { kind: 'component'; componentId: string }
  | { kind: 'object'; sceneId: string; objectId: string };

export interface ProjectReferenceUsage {
  owner: ProjectReferenceOwnerTarget;
  title: string;
  subtitle: string | null;
  referenceCount: number;
}

export interface ProjectReferenceImpact {
  entityId: string;
  entityKind: ProjectReferenceEntityKind;
  referenceCount: number;
  usages: ProjectReferenceUsage[];
}

export type ProjectVariableTarget =
  | { kind: 'global' }
  | { kind: 'component'; componentId: string }
  | { kind: 'object'; sceneId: string; objectId: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countReferenceMatchesInBlocklyXml(
  blocklyXml: string,
  referenceBlocks: Readonly<Record<string, string>>,
  acceptedValues: ReadonlySet<string>,
): number {
  const normalizedXml = normalizeBlocklyXml(blocklyXml);
  if (!normalizedXml.trim() || acceptedValues.size === 0) {
    return 0;
  }

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(normalizedXml, 'text/xml');
      if (xmlDoc.getElementsByTagName('parsererror').length === 0) {
        let count = 0;
        const blocks = Array.from(xmlDoc.getElementsByTagName('*')).filter(
          (node): node is Element => node.tagName === 'block' || node.tagName === 'shadow',
        );

        for (const block of blocks) {
          const blockType = block.getAttribute('type') || '';
          const fieldName = referenceBlocks[blockType];
          if (!fieldName) continue;

          const fields = Array.from(block.children).filter(
            (child): child is Element =>
              child.tagName === 'field' && child.getAttribute('name') === fieldName,
          );
          for (const field of fields) {
            if (acceptedValues.has((field.textContent || '').trim())) {
              count += 1;
            }
          }
        }

        return count;
      }
    } catch {
      // Fall back to regex matching below.
    }
  }

  let count = 0;
  for (const acceptedValue of acceptedValues) {
    const escapedAcceptedValue = escapeRegExp(acceptedValue);
    for (const [blockType, fieldName] of Object.entries(referenceBlocks)) {
      const escapedBlockType = escapeRegExp(blockType);
      const escapedFieldName = escapeRegExp(fieldName);
      const pattern = new RegExp(
        `<(?:block|shadow)\\b[^>]*\\btype=["']${escapedBlockType}["'][^>]*>[\\s\\S]*?<field\\b[^>]*\\bname=["']${escapedFieldName}["'][^>]*>\\s*${escapedAcceptedValue}\\s*<\\/field>`,
        'g',
      );
      count += normalizedXml.match(pattern)?.length ?? 0;
    }
  }

  return count;
}

function getAcceptedReferenceValues(
  project: Project,
  entityKind: ProjectReferenceEntityKind,
  entityId: string,
): Set<string> {
  const acceptedValues = new Set<string>();
  if (!entityId) {
    return acceptedValues;
  }

  acceptedValues.add(entityId);

  if (entityKind === 'message') {
    const message = (project.messages || []).find((entry) => entry.id === entityId);
    const messageName = message?.name?.trim() || '';
    if (messageName) {
      const duplicateCount = (project.messages || []).filter((entry) => entry.name === messageName).length;
      if (duplicateCount === 1) {
        acceptedValues.add(messageName);
      }
    }
  }

  return acceptedValues;
}

function buildReferenceImpact(
  project: Project,
  entityKind: ProjectReferenceEntityKind,
  entityId: string,
  referenceBlocks: Readonly<Record<string, string>>,
): ProjectReferenceImpact {
  const usages: ProjectReferenceUsage[] = [];
  const acceptedValues = getAcceptedReferenceValues(project, entityKind, entityId);

  for (const component of project.components || []) {
    const referenceCount = countReferenceMatchesInBlocklyXml(component.blocklyXml || '', referenceBlocks, acceptedValues);
    if (referenceCount <= 0) {
      continue;
    }

    const linkedObjectCount = project.scenes.reduce((count, scene) => (
      count + scene.objects.filter((object) => object.componentId === component.id).length
    ), 0);
    usages.push({
      owner: { kind: 'component', componentId: component.id },
      title: component.name,
      subtitle: linkedObjectCount > 0
        ? `${linkedObjectCount} linked ${linkedObjectCount === 1 ? 'object' : 'objects'}`
        : 'Reusable component',
      referenceCount,
    });
  }

  for (const scene of project.scenes) {
    for (const object of scene.objects) {
      if (object.componentId) {
        continue;
      }

      const referenceCount = countReferenceMatchesInBlocklyXml(object.blocklyXml || '', referenceBlocks, acceptedValues);
      if (referenceCount <= 0) {
        continue;
      }

      usages.push({
        owner: { kind: 'object', sceneId: scene.id, objectId: object.id },
        title: object.name,
        subtitle: scene.name,
        referenceCount,
      });
    }
  }

  return {
    entityId,
    entityKind,
    referenceCount: usages.reduce((count, usage) => count + usage.referenceCount, 0),
    usages,
  };
}

export function getVariableReferenceImpact(project: Project, variableId: string): ProjectReferenceImpact {
  return buildReferenceImpact(project, 'variable', variableId, VARIABLE_REFERENCE_BLOCKS);
}

export function getMessageReferenceImpact(project: Project, messageId: string): ProjectReferenceImpact {
  return buildReferenceImpact(project, 'message', messageId, MESSAGE_REFERENCE_BLOCKS);
}

export function findVariableTarget(project: Project, variableId: string): ProjectVariableTarget | null {
  if ((project.globalVariables || []).some((variable) => variable.id === variableId)) {
    return { kind: 'global' };
  }

  for (const component of project.components || []) {
    if ((component.localVariables || []).some((variable) => variable.id === variableId)) {
      return { kind: 'component', componentId: component.id };
    }
  }

  for (const scene of project.scenes) {
    for (const object of scene.objects) {
      if ((object.localVariables || []).some((variable) => variable.id === variableId)) {
        return { kind: 'object', sceneId: scene.id, objectId: object.id };
      }
    }
  }

  return null;
}
