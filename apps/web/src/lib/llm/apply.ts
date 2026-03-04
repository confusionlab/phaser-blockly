import * as Blockly from 'blockly';
import { runInHistoryTransaction } from '@/store/universalHistory';
import type {
  ApplyCandidateResult,
  BlocklyEditScope,
  BuildCandidateResult,
  OrchestratedCandidate,
  PendingVariableEnsure,
} from '@/lib/llm/types';
import type { ComponentDefinition, GameObject, Project, Variable } from '@/types';

type ApplyBindings = {
  getProject: () => Project | null;
  addMessage: (name: string) => { id: string } | null;
  addGlobalVariable: (variable: Variable) => void;
  addLocalVariable: (sceneId: string, objectId: string, variable: Variable) => void;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
  updateComponent: (componentId: string, updates: Partial<ComponentDefinition>) => void;
};

type TempIdReplacement = Record<string, string>;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function replaceTempIdsInXml(xmlText: string, replacements: TempIdReplacement): string {
  if (!xmlText.trim()) return xmlText;
  if (Object.keys(replacements).length === 0) return xmlText;

  try {
    const dom = Blockly.utils.xml.textToDom(xmlText);
    const fields = Array.from(dom.getElementsByTagName('field'));
    for (const field of fields) {
      const current = (field.textContent || '').trim();
      const replacement = replacements[current];
      if (replacement) {
        field.textContent = replacement;
      }
    }
    return Blockly.Xml.domToText(dom);
  } catch (error) {
    console.warn('[LLM] Failed to replace temp IDs in XML', error);
    return xmlText;
  }
}

function ensureMessageIds(build: BuildCandidateResult, bindings: ApplyBindings, replacements: TempIdReplacement): number {
  let createdCount = 0;

  for (const pending of build.pendingEnsures.messages) {
    const project = bindings.getProject();
    const existing = (project?.messages || []).find((message) => normalize(message.name) === normalize(pending.name));
    if (existing) {
      replacements[pending.tempId] = existing.id;
      continue;
    }
    const created = bindings.addMessage(pending.name);
    if (created?.id) {
      replacements[pending.tempId] = created.id;
      createdCount += 1;
    }
  }

  return createdCount;
}

function ensureGlobalVariable(
  pending: PendingVariableEnsure,
  bindings: ApplyBindings,
  replacements: TempIdReplacement,
): boolean {
  const project = bindings.getProject();
  const existing = (project?.globalVariables || []).find((variable) => normalize(variable.name) === normalize(pending.name));
  if (existing) {
    replacements[pending.tempId] = existing.id;
    return false;
  }

  const id = crypto.randomUUID();
  bindings.addGlobalVariable({
    id,
    name: pending.name,
    type: pending.variableType,
    defaultValue: pending.defaultValue,
    scope: 'global',
  });
  replacements[pending.tempId] = id;
  return true;
}

function ensureLocalVariableForComponentScope(
  pending: PendingVariableEnsure,
  scope: Extract<BlocklyEditScope, { scope: 'component' }>,
  bindings: ApplyBindings,
  replacements: TempIdReplacement,
): boolean {
  const project = bindings.getProject();
  const component = (project?.components || []).find((item) => item.id === scope.componentId);
  if (!component) {
    return false;
  }

  const existing = (component.localVariables || []).find((variable) => normalize(variable.name) === normalize(pending.name));
  if (existing) {
    replacements[pending.tempId] = existing.id;
    return false;
  }

  const id = crypto.randomUUID();
  const nextLocalVariables = [
    ...(component.localVariables || []),
    {
      id,
      name: pending.name,
      type: pending.variableType,
      defaultValue: pending.defaultValue,
      scope: 'local' as const,
    },
  ];

  bindings.updateComponent(scope.componentId, { localVariables: nextLocalVariables });
  replacements[pending.tempId] = id;
  return true;
}

function ensureVariableIds(
  build: BuildCandidateResult,
  scope: BlocklyEditScope,
  bindings: ApplyBindings,
  replacements: TempIdReplacement,
): number {
  let createdCount = 0;

  for (const pending of build.pendingEnsures.variables) {
    if (pending.scope === 'global') {
      if (ensureGlobalVariable(pending, bindings, replacements)) {
        createdCount += 1;
      }
      continue;
    }

    if (scope.scope === 'object') {
      const project = bindings.getProject();
      const scene = project?.scenes.find((sceneItem) => sceneItem.id === scope.sceneId);
      const object = scene?.objects.find((objectItem) => objectItem.id === scope.objectId);
      if (!scene || !object) continue;

      if (object.componentId) {
        const component = (project?.components || []).find((item) => item.id === object.componentId);
        const existing = (component?.localVariables || []).find((variable) => normalize(variable.name) === normalize(pending.name));
        if (existing) {
          replacements[pending.tempId] = existing.id;
          continue;
        }
      } else {
        const existing = (object.localVariables || []).find((variable) => normalize(variable.name) === normalize(pending.name));
        if (existing) {
          replacements[pending.tempId] = existing.id;
          continue;
        }
      }

      const id = crypto.randomUUID();
      bindings.addLocalVariable(scope.sceneId, scope.objectId, {
        id,
        name: pending.name,
        type: pending.variableType,
        defaultValue: pending.defaultValue,
        scope: 'local',
      });
      replacements[pending.tempId] = id;
      createdCount += 1;
      continue;
    }

    if (ensureLocalVariableForComponentScope(pending, scope, bindings, replacements)) {
      createdCount += 1;
    }
  }

  return createdCount;
}

export function applyOrchestratedCandidate(args: {
  orchestrated: OrchestratedCandidate;
  bindings: ApplyBindings;
}): ApplyCandidateResult {
  const { orchestrated, bindings } = args;
  const replacements: TempIdReplacement = {};
  let createdMessageCount = 0;
  let createdVariableCount = 0;
  let applied = false;

  runInHistoryTransaction('llm:apply-candidate', () => {
    createdMessageCount = ensureMessageIds(orchestrated.build, bindings, replacements);
    createdVariableCount = ensureVariableIds(orchestrated.build, orchestrated.scope, bindings, replacements);

    const resolvedXml = replaceTempIdsInXml(orchestrated.build.candidateXml, replacements);
    if (orchestrated.scope.scope === 'component') {
      bindings.updateComponent(orchestrated.scope.componentId, { blocklyXml: resolvedXml });
    } else {
      bindings.updateObject(orchestrated.scope.sceneId, orchestrated.scope.objectId, { blocklyXml: resolvedXml });
    }
    applied = true;
  });

  return {
    applied,
    message: applied ? 'Candidate applied.' : 'Candidate was not applied.',
    createdMessageCount,
    createdVariableCount,
  };
}
