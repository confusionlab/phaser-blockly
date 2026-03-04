import * as Blockly from 'blockly';
import '@/components/blockly/toolbox';
import type { ComponentDefinition, Project, Variable } from '@/types';
import type { BlocklyEditScope, ProgramContext, ProgramReadSummary } from '@/lib/llm/types';

type TargetResolution = {
  xml: string;
  sounds: Array<{ id: string; name: string }>;
  localVariables: Variable[];
  selectedSceneId: string | null;
  isComponentInstanceSelection: boolean;
};

function countBlocks(xmlText: string): number {
  if (!xmlText.trim()) return 0;
  try {
    const xml = Blockly.utils.xml.textToDom(xmlText);
    return xml.getElementsByTagName('block').length;
  } catch {
    return 0;
  }
}

function getComponentLocalVariablesForObject(
  project: Project,
  componentId: string,
  objectId: string,
): Variable[] {
  const component = (project.components || []).find((item) => item.id === componentId);
  if (component?.localVariables?.length) {
    return component.localVariables;
  }

  for (const scene of project.scenes) {
    const instance = scene.objects.find((objectItem) => objectItem.id === objectId);
    if (instance?.localVariables?.length) {
      return instance.localVariables;
    }
  }

  for (const scene of project.scenes) {
    const instance = scene.objects.find((objectItem) => objectItem.componentId === componentId);
    if (instance?.localVariables?.length) {
      return instance.localVariables;
    }
  }

  return [];
}

function resolveTarget(project: Project, scope: BlocklyEditScope): TargetResolution | null {
  if (scope.scope === 'component') {
    const component = (project.components || []).find((item) => item.id === scope.componentId);
    if (!component) return null;
    return {
      xml: component.blocklyXml || '',
      sounds: (component.sounds || []).map((sound) => ({ id: sound.id, name: sound.name })),
      localVariables: component.localVariables || [],
      selectedSceneId: scope.selectedSceneId ?? null,
      isComponentInstanceSelection: false,
    };
  }

  const scene = project.scenes.find((sceneItem) => sceneItem.id === scope.sceneId);
  const object = scene?.objects.find((objectItem) => objectItem.id === scope.objectId);
  if (!scene || !object) return null;

  const component = object.componentId
    ? (project.components || []).find((item) => item.id === object.componentId)
    : null;
  const componentLocalVariables = object.componentId
    ? getComponentLocalVariablesForObject(project, object.componentId, object.id)
    : [];
  const localVariables = componentLocalVariables.length > 0 ? componentLocalVariables : (object.localVariables || []);

  return {
    xml: component?.blocklyXml ?? object.blocklyXml ?? '',
    sounds: (component?.sounds || object.sounds || []).map((sound) => ({ id: sound.id, name: sound.name })),
    localVariables,
    selectedSceneId: scene.id,
    isComponentInstanceSelection: !!object.componentId,
  };
}

function toUniqueEntities(items: Array<{ id: string; name: string }>): Array<{ id: string; label: string }> {
  const nameCounts = new Map<string, number>();
  for (const item of items) {
    nameCounts.set(item.name, (nameCounts.get(item.name) || 0) + 1);
  }

  const seenByName = new Map<string, number>();
  return items.map((item) => {
    const duplicateCount = nameCounts.get(item.name) || 0;
    if (duplicateCount <= 1) {
      return { id: item.id, label: item.name };
    }
    const index = (seenByName.get(item.name) || 0) + 1;
    seenByName.set(item.name, index);
    return { id: item.id, label: `${item.name} (${index})` };
  });
}

export function buildProgramContext(project: Project, scope: BlocklyEditScope): ProgramContext {
  const target = resolveTarget(project, scope);
  if (!target) {
    return {
      scope,
      targetXml: '',
      blockCount: 0,
      sceneObjects: [],
      scenes: [],
      messages: [],
      sounds: [],
      globalVariables: [],
      localVariables: [],
      componentTypes: [],
      isComponentInstanceSelection: false,
    };
  }

  const scene = target.selectedSceneId
    ? project.scenes.find((sceneItem) => sceneItem.id === target.selectedSceneId)
    : null;

  const sceneObjects = toUniqueEntities((scene?.objects || []).map((obj) => ({ id: obj.id, name: obj.name })));
  const scenes = toUniqueEntities(project.scenes.map((sceneItem) => ({ id: sceneItem.id, name: sceneItem.name })));
  const messages = toUniqueEntities((project.messages || []).map((message) => ({ id: message.id, name: message.name })));
  const componentTypes = toUniqueEntities((project.components || []).map((component) => ({
    id: component.id,
    name: component.name,
  })));

  return {
    scope,
    targetXml: target.xml,
    blockCount: countBlocks(target.xml),
    sceneObjects,
    scenes,
    messages,
    sounds: target.sounds.map((sound) => ({ id: sound.id, label: sound.name })),
    globalVariables: (project.globalVariables || []).map((variable) => ({
      id: variable.id,
      label: variable.name,
      variableType: variable.type,
    })),
    localVariables: (target.localVariables || []).map((variable) => ({
      id: variable.id,
      label: variable.name,
      variableType: variable.type,
    })),
    componentTypes,
    isComponentInstanceSelection: target.isComponentInstanceSelection,
  };
}

function getStatementChildCount(block: Blockly.Block, inputName: string): number {
  const firstChild = block.getInputTargetBlock(inputName);
  if (!firstChild) return 0;

  let count = 0;
  let cursor: Blockly.Block | null = firstChild;
  while (cursor) {
    count += 1;
    cursor = cursor.getNextBlock();
  }
  return count;
}

function getFlowActionCount(block: Blockly.Block): number {
  const statementInput = block.inputList.find(
    (input) => !!input.connection && input.connection.type === Blockly.NEXT_STATEMENT
  );
  if (!statementInput?.name) {
    return 0;
  }
  return getStatementChildCount(block, statementInput.name);
}

function isLikelyEventBlock(block: Blockly.Block): boolean {
  return block.type.startsWith('event_');
}

export function readProgramSummary(context: ProgramContext): ProgramReadSummary {
  const warnings: string[] = [];
  if (!context.targetXml.trim()) {
    return {
      summary: 'No blocks yet.',
      eventFlows: [],
      warnings,
    };
  }

  const workspace = new Blockly.Workspace();
  try {
    const xml = Blockly.utils.xml.textToDom(context.targetXml);
    Blockly.Xml.domToWorkspace(xml, workspace);
  } catch {
    workspace.dispose();
    return {
      summary: 'Program XML could not be parsed.',
      eventFlows: [],
      warnings: ['XML parsing failed.'],
    };
  }

  const topBlocks = workspace.getTopBlocks(true);
  const eventFlows = topBlocks
    .filter((block) => isLikelyEventBlock(block) || block.type === 'event_forever')
    .map((block) => ({
      eventType: block.type,
      eventBlockId: block.id,
      actionCount: getFlowActionCount(block),
    }));

  const summaryLines: string[] = [];
  summaryLines.push(`Top-level blocks: ${topBlocks.length}`);
  if (eventFlows.length > 0) {
    summaryLines.push(`Event flows: ${eventFlows.length}`);
    for (const flow of eventFlows.slice(0, 8)) {
      summaryLines.push(`- ${flow.eventType}: ${flow.actionCount} action(s)`);
    }
  } else {
    summaryLines.push('No event flows found.');
  }

  workspace.dispose();
  return {
    summary: summaryLines.join('\n'),
    eventFlows,
    warnings,
  };
}

export function getScopeLabel(project: Project, scope: BlocklyEditScope): string {
  if (scope.scope === 'component') {
    const component = (project.components || []).find((item) => item.id === scope.componentId);
    return component ? `component:${component.name}` : 'component:unknown';
  }

  const scene = project.scenes.find((sceneItem) => sceneItem.id === scope.sceneId);
  const object = scene?.objects.find((objectItem) => objectItem.id === scope.objectId);
  if (!scene || !object) return 'object:unknown';
  return `object:${scene.name}:${object.name}`;
}

export function getCurrentComponent(project: Project, scope: BlocklyEditScope): ComponentDefinition | null {
  if (scope.scope === 'component') {
    return (project.components || []).find((component) => component.id === scope.componentId) || null;
  }

  const scene = project.scenes.find((sceneItem) => sceneItem.id === scope.sceneId);
  const object = scene?.objects.find((objectItem) => objectItem.id === scope.objectId);
  if (!object?.componentId) return null;
  return (project.components || []).find((component) => component.id === object.componentId) || null;
}
