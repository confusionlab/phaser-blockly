import * as Blockly from 'blockly';
import type { Project, Variable, VariableCardinality, VariableType } from '@/types';
import type { ProjectReferenceOwnerTarget } from '@/lib/projectReferenceUsage';
import { parseBlocklyXmlRoot } from '@/lib/parseBlocklyXml';

export interface VariableKindDefinition {
  type: VariableType;
  cardinality: VariableCardinality;
}

export interface VariableTypeCompatibilityIssue {
  owner: ProjectReferenceOwnerTarget;
  title: string;
  subtitle: string | null;
  blockId: string;
  blockType: string;
  message: string;
}

export interface VariableTypeCompatibilityUsage {
  owner: ProjectReferenceOwnerTarget;
  title: string;
  subtitle: string | null;
  blockCount: number;
  issues: VariableTypeCompatibilityIssue[];
}

export interface VariableTypeChangeImpact {
  variableId: string;
  currentKind: VariableKindDefinition;
  nextKind: VariableKindDefinition;
  referenceCount: number;
  incompatibleBlockCount: number;
  usages: VariableTypeCompatibilityUsage[];
}

interface VariableOwnerContext {
  owner: ProjectReferenceOwnerTarget;
  title: string;
  subtitle: string | null;
  blocklyXml: string;
}

interface VariableDefinitionLike {
  id: string;
  type: VariableType;
  cardinality?: Variable['cardinality'];
}

function normalizeVariableKind(
  type: VariableType,
  cardinality: Variable['cardinality'],
): VariableKindDefinition {
  return {
    type,
    cardinality: cardinality === 'array' ? 'array' : 'single',
  };
}

function getScalarOutputCheck(type: VariableType): string {
  switch (type) {
    case 'boolean':
      return 'Boolean';
    case 'string':
      return 'String';
    case 'number':
      return 'Number';
  }
}

function getVariableOutputCheck(kind: VariableKindDefinition): string {
  return kind.cardinality === 'array' ? 'Array' : getScalarOutputCheck(kind.type);
}

function getVariableItemOutputCheck(kind: VariableKindDefinition): string {
  return getScalarOutputCheck(kind.type);
}

function getKindLabel(kind: VariableKindDefinition, itemOnly: boolean = false): string {
  const base = kind.type === 'string'
    ? 'Text'
    : kind.type === 'boolean'
      ? 'Boolean'
      : 'Number';
  if (itemOnly) {
    return base;
  }
  return kind.cardinality === 'array' ? `${base} Array` : base;
}

function isCheckCompatible(desiredCheck: string | null, candidateChecks: string[] | null | undefined): boolean {
  return !desiredCheck || !candidateChecks || candidateChecks.includes(desiredCheck);
}

function buildVariableDefinitionMap(project: Project): Map<string, VariableKindDefinition> {
  const definitions = new Map<string, VariableKindDefinition>();

  const addVariables = (variables: Variable[] | undefined) => {
    for (const variable of variables || []) {
      definitions.set(variable.id, normalizeVariableKind(variable.type, variable.cardinality));
    }
  };

  addVariables(project.globalVariables);
  for (const component of project.components || []) {
    addVariables(component.localVariables);
  }
  for (const scene of project.scenes) {
    for (const object of scene.objects) {
      addVariables(object.localVariables);
    }
  }

  return definitions;
}

function getVariableOwnerContexts(project: Project): VariableOwnerContext[] {
  const contexts: VariableOwnerContext[] = [];

  for (const component of project.components || []) {
    contexts.push({
      owner: { kind: 'component', componentId: component.id },
      title: component.name,
      subtitle: 'Reusable component',
      blocklyXml: component.blocklyXml || '',
    });
  }

  for (const scene of project.scenes) {
    for (const object of scene.objects) {
      if (object.componentId) {
        continue;
      }

      contexts.push({
        owner: { kind: 'object', sceneId: scene.id, objectId: object.id },
        title: object.name,
        subtitle: scene.name,
        blocklyXml: object.blocklyXml || '',
      });
    }
  }

  return contexts;
}

function getElementChildren(node: Element): Element[] {
  const candidateChildren = (node as Element & { children?: HTMLCollectionOf<Element> | Element[] }).children;
  if (candidateChildren) {
    return Array.from(candidateChildren);
  }

  return Array.from((node as Element & { childNodes?: ArrayLike<ChildNode> }).childNodes || []).filter(
    (child): child is Element => child.nodeType === 1,
  );
}

function getFieldValueFromElement(blockElement: Element, fieldName: string): string {
  const field = getElementChildren(blockElement).find(
    (child) => child.tagName === 'field' && child.getAttribute('name') === fieldName,
  );
  return (field?.textContent || '').trim();
}

function getInputBlockElementFromDom(blockElement: Element, inputName: string): Element | null {
  const inputNode = getElementChildren(blockElement).find(
    (child) => child.tagName === 'value' && child.getAttribute('name') === inputName,
  );
  if (!inputNode) {
    return null;
  }

  return getElementChildren(inputNode).find(
    (child) => child.tagName === 'block' || child.tagName === 'shadow',
  ) || null;
}

function getParentInputContext(blockElement: Element): { parentBlockType: string; inputName: string } | null {
  let current: Node | null = blockElement.parentNode;

  while (current) {
    if (current.nodeType === 1) {
      const currentElement = current as Element;
      if ((currentElement.tagName === 'value' || currentElement.tagName === 'statement') && currentElement.getAttribute('name')) {
        let candidateParent: Node | null = currentElement.parentNode;
        while (candidateParent) {
          if (candidateParent.nodeType === 1) {
            const parentElement = candidateParent as Element;
            if (parentElement.tagName === 'block' || parentElement.tagName === 'shadow') {
              return {
                parentBlockType: parentElement.getAttribute('type') || '',
                inputName: currentElement.getAttribute('name') || '',
              };
            }
          }
          candidateParent = candidateParent.parentNode;
        }
      }
    }

    current = current.parentNode;
  }

  return null;
}

const staticInputCheckCache = new Map<string, string[] | null>();
const staticOutputCheckCache = new Map<string, string[] | null>();

function readStaticBlockCheck(
  cache: Map<string, string[] | null>,
  cacheKey: string,
  readCheck: (block: Blockly.Block) => string[] | null,
): string[] | null {
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  let nextCheck: string[] | null = null;
  const workspace = new Blockly.Workspace();
  const eventsWereEnabled = Blockly.Events.isEnabled();

  try {
    const [blockType] = cacheKey.split('::');
    const block = workspace.newBlock(blockType);
    nextCheck = readCheck(block);
  } catch {
    nextCheck = null;
  } finally {
    try {
      Blockly.Events.disable();
      workspace.dispose();
    } catch {
      // Best-effort cleanup only.
    } finally {
      if (eventsWereEnabled) {
        Blockly.Events.enable();
      }
    }
  }

  cache.set(cacheKey, nextCheck);
  return nextCheck;
}

function getStaticInputChecks(blockType: string, inputName: string): string[] | null {
  return readStaticBlockCheck(
    staticInputCheckCache,
    `${blockType}::${inputName}`,
    (block) => block.getInput(inputName)?.connection?.getCheck() ?? null,
  );
}

function getStaticOutputChecks(blockType: string): string[] | null {
  return readStaticBlockCheck(
    staticOutputCheckCache,
    blockType,
    (block) => block.outputConnection?.getCheck() ?? null,
  );
}

function getDomBlockOutputChecks(
  blockElement: Element,
  resolveKind: (variableId: string) => VariableKindDefinition | null,
): string[] | null {
  const blockType = blockElement.getAttribute('type') || '';
  if (blockType === 'typed_variable_get' || blockType === 'typed_array_item_at') {
    const variableId = getFieldValueFromElement(blockElement, 'VAR');
    const kind = variableId ? resolveKind(variableId) : null;
    if (!kind) {
      return null;
    }
    const outputCheck = blockType === 'typed_array_item_at'
      ? getVariableItemOutputCheck(kind)
      : getVariableOutputCheck(kind);
    return outputCheck ? [outputCheck] : null;
  }

  return getStaticOutputChecks(blockType);
}

function buildDirectCompatibilityIssues(
  blockType: string,
  nextKind: VariableKindDefinition,
): string[] {
  switch (blockType) {
    case 'typed_variable_change':
      return nextKind.cardinality !== 'single' || nextKind.type !== 'number'
        ? ['This block only works with single number variables.']
        : [];
    case 'typed_array_length':
    case 'typed_array_item_at':
    case 'typed_array_contains':
    case 'typed_array_add':
    case 'typed_array_insert_at':
    case 'typed_array_set_at':
    case 'typed_array_remove_at':
    case 'typed_array_clear':
      return nextKind.cardinality !== 'array'
        ? ['This block only works with array variables.']
        : [];
    default:
      return [];
  }
}

function collectCompatibilityIssuesForOwner(
  blocklyXml: string,
  owner: ProjectReferenceOwnerTarget,
  title: string,
  subtitle: string | null,
  shouldInspectVariable: (variableId: string) => boolean,
  resolveKind: (variableId: string) => VariableKindDefinition | null,
): { issues: VariableTypeCompatibilityIssue[]; referenceCount: number } {
  const xml = parseBlocklyXmlRoot(blocklyXml);
  if (!xml) {
    return { issues: [], referenceCount: 0 };
  }

  const issues: VariableTypeCompatibilityIssue[] = [];
  let referenceCount = 0;
  const blocks = Array.from(xml.getElementsByTagName('*')).filter(
    (node): node is Element => node.tagName === 'block' || node.tagName === 'shadow',
  );

  for (const blockElement of blocks) {
    const variableId = getFieldValueFromElement(blockElement, 'VAR');
    if (!variableId || !shouldInspectVariable(variableId)) {
      continue;
    }
    referenceCount += 1;

    const kind = resolveKind(variableId);
    if (!kind) {
      continue;
    }

    const blockType = blockElement.getAttribute('type') || 'unknown';
    const messages = new Set<string>();

    for (const message of buildDirectCompatibilityIssues(blockType, kind)) {
      messages.add(message);
    }

    const valueBlock = getInputBlockElementFromDom(blockElement, 'VALUE');
    if (valueBlock) {
      let expectedCheck: string | null = null;
      let expectedLabel: string | null = null;

      if (blockType === 'typed_variable_set') {
        expectedCheck = getVariableOutputCheck(kind);
        expectedLabel = getKindLabel(kind);
      } else if (
        kind.cardinality === 'array' &&
        (blockType === 'typed_array_contains' ||
          blockType === 'typed_array_add' ||
          blockType === 'typed_array_insert_at' ||
          blockType === 'typed_array_set_at')
      ) {
        expectedCheck = getVariableItemOutputCheck(kind);
        expectedLabel = getKindLabel(kind, true);
      }

      if (expectedCheck) {
        const candidateChecks = getDomBlockOutputChecks(valueBlock, resolveKind);
        if (!isCheckCompatible(expectedCheck, candidateChecks)) {
          messages.add(`The connected value no longer matches ${expectedLabel}.`);
        }
      }
    }

    if (blockType === 'typed_variable_get' || blockType === 'typed_array_item_at') {
      const parentContext = getParentInputContext(blockElement);
      if (parentContext) {
        const parentChecks = getStaticInputChecks(parentContext.parentBlockType, parentContext.inputName);
        const nextOutputCheck = blockType === 'typed_array_item_at'
          ? getVariableItemOutputCheck(kind)
          : getVariableOutputCheck(kind);
        if (!isCheckCompatible(nextOutputCheck, parentChecks)) {
          messages.add(`This output no longer matches the connected input (now ${getKindLabel(kind, blockType === 'typed_array_item_at')}).`);
        }
      }
    }

    for (const message of messages) {
      issues.push({
        owner,
        title,
        subtitle,
        blockId: blockElement.getAttribute('id') || 'unknown',
        blockType,
        message,
      });
    }
  }

  return { issues, referenceCount };
}

function groupCompatibilityIssues(
  issues: VariableTypeCompatibilityIssue[],
): VariableTypeCompatibilityUsage[] {
  const usageMap = new Map<string, VariableTypeCompatibilityUsage>();

  for (const issue of issues) {
    const usageKey = issue.owner.kind === 'component'
      ? `component:${issue.owner.componentId}`
      : `object:${issue.owner.sceneId}:${issue.owner.objectId}`;

    const existing = usageMap.get(usageKey);
    if (existing) {
      existing.issues.push(issue);
      existing.blockCount = new Set(existing.issues.map((entry) => entry.blockId)).size;
      continue;
    }

    usageMap.set(usageKey, {
      owner: issue.owner,
      title: issue.title,
      subtitle: issue.subtitle,
      blockCount: 1,
      issues: [issue],
    });
  }

  return Array.from(usageMap.values());
}

function getOwnerBlockKey(issue: VariableTypeCompatibilityIssue): string {
  const ownerKey = issue.owner.kind === 'component'
    ? `component:${issue.owner.componentId}`
    : `object:${issue.owner.sceneId}:${issue.owner.objectId}`;
  return `${ownerKey}:${issue.blockId}`;
}

export function getVariableTypeChangeImpact(
  project: Project,
  variable: VariableDefinitionLike,
  nextKindInput: VariableKindDefinition,
): VariableTypeChangeImpact {
  const currentKind = normalizeVariableKind(variable.type, variable.cardinality);
  const nextKind = normalizeVariableKind(nextKindInput.type, nextKindInput.cardinality);
  const definitions = buildVariableDefinitionMap(project);
  const resolveKind = (variableId: string): VariableKindDefinition | null => {
    if (variableId === variable.id) {
      return nextKind;
    }
    return definitions.get(variableId) ?? null;
  };

  const ownerContexts = getVariableOwnerContexts(project);
  const ownerAnalyses = ownerContexts.map((context) =>
    collectCompatibilityIssuesForOwner(
      context.blocklyXml,
      context.owner,
      context.title,
      context.subtitle,
      (variableId) => variableId === variable.id,
      resolveKind,
    ),
  );
  const issues = ownerAnalyses.flatMap((analysis) => analysis.issues);
  const incompatibleBlockCount = new Set(issues.map(getOwnerBlockKey)).size;
  const referenceCount = ownerAnalyses.reduce((count, analysis) => count + analysis.referenceCount, 0);

  return {
    variableId: variable.id,
    currentKind,
    nextKind,
    referenceCount,
    incompatibleBlockCount,
    usages: groupCompatibilityIssues(issues),
  };
}

export function getVariableCompatibilityIssues(project: Project): VariableTypeCompatibilityIssue[] {
  const definitions = buildVariableDefinitionMap(project);
  const resolveKind = (variableId: string): VariableKindDefinition | null => definitions.get(variableId) ?? null;

  return getVariableOwnerContexts(project).flatMap((context) =>
    collectCompatibilityIssuesForOwner(
      context.blocklyXml,
      context.owner,
      context.title,
      context.subtitle,
      (variableId) => definitions.has(variableId),
      resolveKind,
    ).issues,
  );
}
