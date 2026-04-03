import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { assistantStatementUsesNextConnection, getAssistantBlockCatalogEntry } from './assistantBlocks';
import { normalizeBlocklyXml, validateBlocklyXmlStructure } from './blocklyXml';

export interface AssistantBlockTreeNode {
  path: string;
  type: string;
  fields: Record<string, string>;
  values: Record<string, AssistantBlockTreeNode>;
  statements: Record<string, AssistantBlockTreeNode[]>;
  next: AssistantBlockTreeNode | null;
}

export interface AssistantBlockTree {
  formatVersion: 1;
  roots: AssistantBlockTreeNode[];
}

export interface AssistantBlockPatchNode {
  type: string;
  fields?: Record<string, string | number | boolean>;
  values?: Record<string, AssistantBlockPatchNode>;
  statements?: Record<string, AssistantBlockPatchNode[]>;
  next?: AssistantBlockPatchNode | null;
}

export type AssistantBlockTreeEditOperation =
  | {
      kind: 'insert_after';
      path: string;
      block: AssistantBlockPatchNode;
    }
  | {
      kind: 'replace_block';
      path: string;
      block: AssistantBlockPatchNode;
    }
  | {
      kind: 'delete_block';
      path: string;
    }
  | {
      kind: 'set_field';
      path: string;
      fieldName: string;
      value: string | number | boolean;
    }
  | {
      kind: 'insert_into_statement';
      path: string;
      statementName: string;
      block: AssistantBlockPatchNode;
      index?: number;
    };

type ParsedPathStep =
  | { kind: 'value'; name: string }
  | { kind: 'statement'; name: string; index: number }
  | { kind: 'next' };

interface ParsedBlockPath {
  rootIndex: number;
  steps: ParsedPathStep[];
}

type BlockReference =
  | {
      kind: 'root';
      root: Element;
      index: number;
      block: Element;
    }
  | {
      kind: 'container';
      container: Element;
      block: Element;
    };

function getElementChildren(element: Element | null | undefined): Element[] {
  if (!element) return [];
  return Array.from(element.childNodes ?? []).filter((child): child is Element => child.nodeType === 1);
}

function getFirstChildBlock(container: Element | null | undefined): Element | null {
  return (
    getElementChildren(container).find((child) => child.tagName === 'block' || child.tagName === 'shadow') ?? null
  );
}

function getDirectChildByTagName(
  element: Element,
  tagName: 'field' | 'value' | 'statement' | 'next',
  name?: string,
): Element | null {
  return (
    getElementChildren(element).find(
      (child) => child.tagName === tagName && (name === undefined || child.getAttribute('name') === name),
    ) ?? null
  );
}

function getOrCreateContainer(
  document: Document,
  block: Element,
  tagName: 'field' | 'value' | 'statement' | 'next',
  name?: string,
): Element {
  const existing = getDirectChildByTagName(block, tagName, name);
  if (existing) return existing;
  const created = document.createElement(tagName);
  if (name !== undefined) {
    created.setAttribute('name', name);
  }
  block.appendChild(created);
  return created;
}

function clearBlockChildren(container: Element) {
  const blockChildren = getElementChildren(container).filter((child) => child.tagName === 'block' || child.tagName === 'shadow');
  for (const child of blockChildren) {
    container.removeChild(child);
  }
}

function parseBlockElement(element: Element, path: string): AssistantBlockTreeNode {
  const blockType = element.getAttribute('type') || 'unknown_block';
  const fields: Record<string, string> = {};
  const values: Record<string, AssistantBlockTreeNode> = {};
  const statements: Record<string, AssistantBlockTreeNode[]> = {};
  let next: AssistantBlockTreeNode | null = null;

  for (const child of getElementChildren(element)) {
    const tagName = child.tagName;
    const name = child.getAttribute('name') ?? '';
    if (tagName === 'field') {
      if (name) {
        fields[name] = String(child.textContent ?? '').trim();
      }
      continue;
    }
    if (tagName === 'value') {
      const valueBlock = getFirstChildBlock(child);
      if (name && valueBlock) {
        values[name] = parseBlockElement(valueBlock, `${path}.values.${name}`);
      }
      continue;
    }
    if (tagName === 'statement') {
      const firstStatementBlock = getFirstChildBlock(child);
      if (!name || !firstStatementBlock) continue;
      const blocks: AssistantBlockTreeNode[] = [];
      let current: Element | null = firstStatementBlock;
      let index = 0;
      while (current) {
        blocks.push(parseBlockElement(current, `${path}.statements.${name}[${index}]`));
        current = getFirstChildBlock(getDirectChildByTagName(current, 'next'));
        index += 1;
      }
      statements[name] = blocks;
      continue;
    }
    if (tagName === 'next') {
      const nextBlock = getFirstChildBlock(child);
      if (nextBlock) {
        if (assistantStatementUsesNextConnection(blockType, 'NEXT') && !statements.NEXT) {
          const blocks: AssistantBlockTreeNode[] = [];
          let current: Element | null = nextBlock;
          let index = 0;
          while (current) {
            blocks.push(parseBlockElement(current, `${path}.statements.NEXT[${index}]`));
            current = getFirstChildBlock(getDirectChildByTagName(current, 'next'));
            index += 1;
          }
          statements.NEXT = blocks;
        } else {
          next = parseBlockElement(nextBlock, `${path}.next`);
        }
      }
    }
  }

  return {
    path,
    type: blockType,
    fields,
    values,
    statements,
    next,
  };
}

export function buildAssistantBlockTree(blocklyXml: string): AssistantBlockTree {
  const normalizedXml = normalizeBlocklyXml(blocklyXml);
  if (!normalizedXml.trim()) {
    return { formatVersion: 1, roots: [] };
  }

  const structureIssue = validateBlocklyXmlStructure(normalizedXml);
  if (structureIssue) {
    throw new Error(`Invalid Blockly XML: ${structureIssue}`);
  }

  const document = new DOMParser().parseFromString(normalizedXml, 'text/xml');
  const root = document.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'xml') {
    throw new Error('Invalid Blockly XML: expected <xml> root.');
  }

  const roots = getElementChildren(root)
    .filter((child) => child.tagName === 'block' || child.tagName === 'shadow')
    .map((child, index) => parseBlockElement(child, `roots[${index}]`));

  return {
    formatVersion: 1,
    roots,
  };
}

function stringifyValue(value: string | number | boolean): string {
  return typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
}

function validatePatchNode(node: AssistantBlockPatchNode, path: string): string[] {
  const issues: string[] = [];
  const type = node.type?.trim();
  if (!type) {
    return [`${path}.type must be a non-empty string.`];
  }

  const entry = getAssistantBlockCatalogEntry(type);
  if (!entry) {
    issues.push(`${path}.type "${type}" is not in the supported block catalog.`);
    return issues;
  }

  const fieldsRecord = node.fields ?? {};
  for (const fieldName of entry.fieldNames) {
    if (!(fieldName in fieldsRecord)) {
      issues.push(`${path}.fields.${fieldName} is required for block "${type}".`);
    }
  }

  for (const fieldName of Object.keys(node.fields ?? {})) {
    if (!entry.fieldNames.includes(fieldName)) {
      issues.push(`${path}.fields.${fieldName} is not valid for block "${type}".`);
    }
  }
  for (const valueName of Object.keys(node.values ?? {})) {
    if (!entry.inputNames.includes(valueName) && !(type === 'controls_if' && /^IF\d+$/.test(valueName))) {
      issues.push(`${path}.values.${valueName} is not valid for block "${type}".`);
    }
  }
  for (const statementName of Object.keys(node.statements ?? {})) {
    const allowedDynamic =
      (type === 'controls_if' && (statementName === 'ELSE' || /^DO\d+$/.test(statementName))) ||
      (type === 'control_random_choice' && /^DO\d+$/.test(statementName));
    if (!entry.statementInputNames.includes(statementName) && !allowedDynamic) {
      issues.push(`${path}.statements.${statementName} is not valid for block "${type}".`);
    }
  }

  for (const [valueName, valueNode] of Object.entries(node.values ?? {})) {
    issues.push(...validatePatchNode(valueNode, `${path}.values.${valueName}`));
  }
  for (const [statementName, statementNodes] of Object.entries(node.statements ?? {})) {
    statementNodes.forEach((statementNode, index) => {
      issues.push(...validatePatchNode(statementNode, `${path}.statements.${statementName}[${index}]`));
    });
  }
  if (entry?.kind === 'hat' && node.next) {
    issues.push(`${path}.next is not valid for block "${type}". Use statements.NEXT for hat block bodies.`);
  }
  if (node.next) {
    issues.push(...validatePatchNode(node.next, `${path}.next`));
  }

  return issues;
}

function compilePatchNode(document: Document, node: AssistantBlockPatchNode): Element {
  const issues = validatePatchNode(node, 'block');
  if (issues.length > 0) {
    throw new Error(`Invalid block patch: ${issues[0]}`);
  }

  const block = document.createElement('block');
  block.setAttribute('type', node.type);

  const entry = getAssistantBlockCatalogEntry(node.type);
  const orderedFieldNames = [
    ...(entry?.fieldNames ?? []).filter((fieldName) => fieldName in (node.fields ?? {})),
    ...Object.keys(node.fields ?? {}).filter((fieldName) => !(entry?.fieldNames ?? []).includes(fieldName)).sort(),
  ];

  for (const fieldName of orderedFieldNames) {
    const field = document.createElement('field');
    field.setAttribute('name', fieldName);
    field.appendChild(document.createTextNode(stringifyValue((node.fields ?? {})[fieldName]!)));
    block.appendChild(field);
  }

  const orderedValueNames = [
    ...(entry?.inputNames ?? []).filter((valueName) => valueName in (node.values ?? {})),
    ...Object.keys(node.values ?? {}).filter((valueName) => !(entry?.inputNames ?? []).includes(valueName)).sort(),
  ];
  for (const valueName of orderedValueNames) {
    const valueNode = document.createElement('value');
    valueNode.setAttribute('name', valueName);
    valueNode.appendChild(compilePatchNode(document, (node.values ?? {})[valueName]!));
    block.appendChild(valueNode);
  }

  const orderedStatementNames = [
    ...(entry?.statementInputNames ?? []).filter((statementName) => statementName in (node.statements ?? {})),
    ...Object.keys(node.statements ?? {})
      .filter((statementName) => !(entry?.statementInputNames ?? []).includes(statementName))
      .sort(),
  ];
  for (const statementName of orderedStatementNames) {
    const statementBlocks = (node.statements ?? {})[statementName] ?? [];
    if (assistantStatementUsesNextConnection(node.type, statementName)) {
      if (statementBlocks.length === 0) continue;
      const nextContainer = document.createElement('next');
      nextContainer.appendChild(compilePatchNode(document, statementBlocks[0]!));
      let current = getFirstChildBlock(nextContainer)!;
      for (const statementBlock of statementBlocks.slice(1)) {
        const nestedNextContainer = document.createElement('next');
        nestedNextContainer.appendChild(compilePatchNode(document, statementBlock));
        current.appendChild(nestedNextContainer);
        current = getFirstChildBlock(nestedNextContainer)!;
      }
      block.appendChild(nextContainer);
      continue;
    }
    const statementContainer = document.createElement('statement');
    statementContainer.setAttribute('name', statementName);
    if (statementBlocks.length > 0) {
      statementContainer.appendChild(compilePatchNode(document, statementBlocks[0]!));
      let current = getFirstChildBlock(statementContainer)!;
      for (const statementBlock of statementBlocks.slice(1)) {
        const nextContainer = document.createElement('next');
        nextContainer.appendChild(compilePatchNode(document, statementBlock));
        current.appendChild(nextContainer);
        current = getFirstChildBlock(nextContainer)!;
      }
    }
    block.appendChild(statementContainer);
  }

  if (node.next) {
    const nextContainer = document.createElement('next');
    nextContainer.appendChild(compilePatchNode(document, node.next));
    block.appendChild(nextContainer);
  }

  return block;
}

function parseBlockPath(path: string): ParsedBlockPath {
  const rootMatch = /^roots\[(\d+)\]/.exec(path.trim());
  if (!rootMatch) {
    throw new Error(`Invalid block path "${path}". Expected roots[index].`);
  }

  const steps: ParsedPathStep[] = [];
  let rest = path.slice(rootMatch[0].length);
  while (rest.length > 0) {
    if (rest.startsWith('.next')) {
      steps.push({ kind: 'next' });
      rest = rest.slice('.next'.length);
      continue;
    }

    const valueMatch = /^\.values\.([A-Za-z0-9_]+)/.exec(rest);
    if (valueMatch) {
      steps.push({ kind: 'value', name: valueMatch[1]! });
      rest = rest.slice(valueMatch[0].length);
      continue;
    }

    const statementMatch = /^\.statements\.([A-Za-z0-9_]+)\[(\d+)\]/.exec(rest);
    if (statementMatch) {
      steps.push({
        kind: 'statement',
        name: statementMatch[1]!,
        index: Number(statementMatch[2]),
      });
      rest = rest.slice(statementMatch[0].length);
      continue;
    }

    throw new Error(`Invalid block path "${path}". Could not parse "${rest}".`);
  }

  return {
    rootIndex: Number(rootMatch[1]),
    steps,
  };
}

function getRootBlocks(root: Element): Element[] {
  return getElementChildren(root).filter((child) => child.tagName === 'block' || child.tagName === 'shadow');
}

function resolveBlockReference(root: Element, path: string): BlockReference {
  const parsed = parseBlockPath(path);
  const rootBlocks = getRootBlocks(root);
  const initialBlock = rootBlocks[parsed.rootIndex];
  if (!initialBlock) {
    throw new Error(`Block path "${path}" points to missing root index ${parsed.rootIndex}.`);
  }

  let currentRef: BlockReference = {
    kind: 'root',
    root,
    index: parsed.rootIndex,
    block: initialBlock,
  };

  for (const step of parsed.steps) {
    if (step.kind === 'next') {
      const container = getDirectChildByTagName(currentRef.block, 'next');
      const nextBlock = getFirstChildBlock(container);
      if (!container || !nextBlock) {
        throw new Error(`Block path "${path}" points to a missing next block.`);
      }
      currentRef = {
        kind: 'container',
        container,
        block: nextBlock,
      };
      continue;
    }

    if (step.kind === 'value') {
      const container = getDirectChildByTagName(currentRef.block, 'value', step.name);
      const valueBlock = getFirstChildBlock(container);
      if (!container || !valueBlock) {
        throw new Error(`Block path "${path}" points to missing value input "${step.name}".`);
      }
      currentRef = {
        kind: 'container',
        container,
        block: valueBlock,
      };
      continue;
    }

    const blockType = currentRef.block.getAttribute('type') || '';
    const usesNextConnection = assistantStatementUsesNextConnection(blockType, step.name);
    const container: Element | null = usesNextConnection
      ? getDirectChildByTagName(currentRef.block, 'next')
      : getDirectChildByTagName(currentRef.block, 'statement', step.name);
    let statementBlock = getFirstChildBlock(container);
    if (!container || !statementBlock) {
      throw new Error(`Block path "${path}" points to missing statement input "${step.name}".`);
    }
    let statementRef: BlockReference = {
      kind: 'container',
      container,
      block: statementBlock,
    };
    for (let index = 0; index < step.index; index += 1) {
      const nextContainer = getDirectChildByTagName(statementRef.block, 'next');
      const nextStatementBlock = getFirstChildBlock(nextContainer);
      if (!nextContainer || !nextStatementBlock) {
        throw new Error(`Block path "${path}" points past the end of statement "${step.name}".`);
      }
      statementRef = {
        kind: 'container',
        container: nextContainer,
        block: nextStatementBlock,
      };
    }
    currentRef = statementRef;
  }

  return currentRef;
}

function setReferenceBlock(ref: BlockReference, nextBlock: Element | null) {
  if (ref.kind === 'root') {
    const roots = getRootBlocks(ref.root);
    const current = roots[ref.index];
    if (!current) {
      throw new Error(`Missing root block at index ${ref.index}.`);
    }
    if (nextBlock) {
      ref.root.replaceChild(nextBlock, current);
    } else {
      ref.root.removeChild(current);
    }
    return;
  }

  clearBlockChildren(ref.container);
  if (nextBlock) {
    ref.container.appendChild(nextBlock);
  }
}

function detachNextBlock(block: Element): Element | null {
  const nextContainer = getDirectChildByTagName(block, 'next');
  const nextBlock = getFirstChildBlock(nextContainer);
  if (!nextContainer || !nextBlock) {
    return null;
  }
  nextContainer.removeChild(nextBlock);
  if (!getFirstChildBlock(nextContainer)) {
    block.removeChild(nextContainer);
  }
  return nextBlock;
}

function setImmediateNextBlock(document: Document, block: Element, nextBlock: Element | null) {
  const nextContainer = getDirectChildByTagName(block, 'next');
  if (!nextBlock) {
    if (nextContainer) {
      clearBlockChildren(nextContainer);
      block.removeChild(nextContainer);
    }
    return;
  }

  const ensured = nextContainer ?? getOrCreateContainer(document, block, 'next');
  clearBlockChildren(ensured);
  ensured.appendChild(nextBlock);
}

export function applyAssistantBlockTreeEdits(
  blocklyXml: string,
  operations: readonly AssistantBlockTreeEditOperation[],
): string {
  const normalizedXml = normalizeBlocklyXml(blocklyXml);
  const structureIssue = validateBlocklyXmlStructure(normalizedXml);
  if (structureIssue) {
    throw new Error(`Invalid Blockly XML: ${structureIssue}`);
  }

  const document = new DOMParser().parseFromString(normalizedXml, 'text/xml');
  const root = document.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'xml') {
    throw new Error('Invalid Blockly XML: expected <xml> root.');
  }

  for (const operation of operations) {
    if (operation.kind === 'set_field') {
      const ref = resolveBlockReference(root, operation.path);
      const field = getOrCreateContainer(document, ref.block, 'field', operation.fieldName);
      while (field.firstChild) {
        field.removeChild(field.firstChild);
      }
      field.appendChild(document.createTextNode(stringifyValue(operation.value)));
      continue;
    }

    if (operation.kind === 'insert_after') {
      const ref = resolveBlockReference(root, operation.path);
      const insertedBlock = compilePatchNode(document, operation.block);
      const displacedNextBlock = detachNextBlock(ref.block);
      if (displacedNextBlock) {
        setImmediateNextBlock(document, insertedBlock, displacedNextBlock);
      }
      setImmediateNextBlock(document, ref.block, insertedBlock);
      continue;
    }

    if (operation.kind === 'replace_block') {
      const ref = resolveBlockReference(root, operation.path);
      const replacement = compilePatchNode(document, operation.block);
      const displacedNextBlock = detachNextBlock(ref.block);
      if (displacedNextBlock) {
        setImmediateNextBlock(document, replacement, displacedNextBlock);
      }
      setReferenceBlock(ref, replacement);
      continue;
    }

    if (operation.kind === 'delete_block') {
      const ref = resolveBlockReference(root, operation.path);
      const displacedNextBlock = detachNextBlock(ref.block);
      setReferenceBlock(ref, displacedNextBlock);
      continue;
    }

    if (operation.kind === 'insert_into_statement') {
      const ref = resolveBlockReference(root, operation.path);
      const statementContainer = getOrCreateContainer(document, ref.block, 'statement', operation.statementName);
      const firstStatementBlock = getFirstChildBlock(statementContainer);
      if (!firstStatementBlock) {
        statementContainer.appendChild(compilePatchNode(document, operation.block));
        continue;
      }

      const requestedIndex = typeof operation.index === 'number' ? operation.index : Number.MAX_SAFE_INTEGER;
      if (requestedIndex <= 0) {
        const replacement = compilePatchNode(document, operation.block);
        setImmediateNextBlock(document, replacement, firstStatementBlock);
        clearBlockChildren(statementContainer);
        statementContainer.appendChild(replacement);
        continue;
      }

      let current = firstStatementBlock;
      let currentIndex = 0;
      while (currentIndex < requestedIndex - 1) {
        const nextContainer = getDirectChildByTagName(current, 'next');
        const nextBlock = getFirstChildBlock(nextContainer);
        if (!nextContainer || !nextBlock) {
          break;
        }
        current = nextBlock;
        currentIndex += 1;
      }

      const insertedBlock = compilePatchNode(document, operation.block);
      const displacedNextBlock = detachNextBlock(current);
      if (displacedNextBlock) {
        setImmediateNextBlock(document, insertedBlock, displacedNextBlock);
      }
      setImmediateNextBlock(document, current, insertedBlock);
    }
  }

  return normalizeBlocklyXml(new XMLSerializer().serializeToString(document));
}
