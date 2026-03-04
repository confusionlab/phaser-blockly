import * as Blockly from 'blockly';
import '@/components/blockly/toolbox';
import type { BlockGraphInfo, CandidateDiff } from '@/lib/llm/types';

function toBlockGraph(workspace: Blockly.Workspace): Record<string, BlockGraphInfo> {
  const graph: Record<string, BlockGraphInfo> = {};
  const allBlocks = workspace.getAllBlocks(false);

  for (const block of allBlocks) {
    const fieldValues: Record<string, string> = {};
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        if (typeof field.name === 'string' && field.name.length > 0) {
          fieldValues[field.name] = String(field.getValue() ?? '');
        }
      }
    }

    const inputConnections: Record<string, string | null> = {};
    for (const input of block.inputList) {
      if (!input.name || !input.connection) continue;
      const target = input.connection.targetBlock();
      inputConnections[input.name] = target ? target.id : null;
    }

    graph[block.id] = {
      id: block.id,
      type: block.type,
      fieldValues,
      parentId: block.getParent()?.id || null,
      nextId: block.getNextBlock()?.id || null,
      inputConnections,
    };
  }

  return graph;
}

function safeLoadWorkspace(xmlText: string): Blockly.Workspace {
  const workspace = new Blockly.Workspace();
  if (!xmlText.trim()) return workspace;
  try {
    const xml = Blockly.utils.xml.textToDom(xmlText);
    Blockly.Xml.domToWorkspace(xml, workspace);
  } catch (error) {
    console.warn('[LLM] Failed to parse XML for diff', error);
  }
  return workspace;
}

function mapBlockTypeCounts(ids: string[], graph: Record<string, BlockGraphInfo>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of ids) {
    const block = graph[id];
    if (!block) continue;
    counts[block.type] = (counts[block.type] || 0) + 1;
  }
  return counts;
}

function shallowEqualMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function shallowEqualNullableMap(a: Record<string, string | null>, b: Record<string, string | null>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function createCandidateDiff(previousXml: string, candidateXml: string): CandidateDiff {
  const previousWorkspace = safeLoadWorkspace(previousXml);
  const candidateWorkspace = safeLoadWorkspace(candidateXml);

  const previousGraph = toBlockGraph(previousWorkspace);
  const candidateGraph = toBlockGraph(candidateWorkspace);

  previousWorkspace.dispose();
  candidateWorkspace.dispose();

  const previousIds = new Set(Object.keys(previousGraph));
  const candidateIds = new Set(Object.keys(candidateGraph));

  const addedIds = [...candidateIds].filter((id) => !previousIds.has(id));
  const removedIds = [...previousIds].filter((id) => !candidateIds.has(id));

  let changedFieldCount = 0;
  let changedConnectionCount = 0;

  const sharedIds = [...previousIds].filter((id) => candidateIds.has(id));
  for (const id of sharedIds) {
    const prev = previousGraph[id];
    const next = candidateGraph[id];
    if (!prev || !next) continue;

    if (!shallowEqualMap(prev.fieldValues, next.fieldValues)) {
      changedFieldCount += 1;
    }

    const parentChanged = prev.parentId !== next.parentId;
    const nextChanged = prev.nextId !== next.nextId;
    const inputsChanged = !shallowEqualNullableMap(prev.inputConnections, next.inputConnections);
    if (parentChanged || nextChanged || inputsChanged) {
      changedConnectionCount += 1;
    }
  }

  const addedBlockTypes = mapBlockTypeCounts(addedIds, candidateGraph);
  const removedBlockTypes = mapBlockTypeCounts(removedIds, previousGraph);

  const summaryLines: string[] = [
    `Added blocks: ${addedIds.length}`,
    `Removed blocks: ${removedIds.length}`,
    `Field updates: ${changedFieldCount}`,
    `Connection changes: ${changedConnectionCount}`,
  ];

  if (Object.keys(addedBlockTypes).length > 0) {
    const topAdds = Object.entries(addedBlockTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([type, count]) => `${type} x${count}`);
    summaryLines.push(`Top additions: ${topAdds.join(', ')}`);
  }

  if (Object.keys(removedBlockTypes).length > 0) {
    const topRemovals = Object.entries(removedBlockTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([type, count]) => `${type} x${count}`);
    summaryLines.push(`Top removals: ${topRemovals.join(', ')}`);
  }

  return {
    addedBlockCount: addedIds.length,
    removedBlockCount: removedIds.length,
    changedFieldCount,
    changedConnectionCount,
    addedBlockTypes,
    removedBlockTypes,
    summaryLines,
  };
}
