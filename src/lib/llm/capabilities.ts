import * as Blockly from 'blockly';
import '@/components/blockly/toolbox';
import { COMPONENT_ANY_PREFIX, OBJECT_SPECIAL_VALUES } from '@/lib/blocklyReferenceMaps';
import type { BlockCapability, BlocklyCapabilities } from '@/lib/llm/types';

const CAPABILITY_LIMITS = {
  maxOpsPerRequest: 12,
  maxActionDepth: 6,
  maxBlocksPerMutation: 80,
};

function getInputChecks(input: Blockly.Input): string[] {
  if (!input.connection) return [];
  const checks = input.connection.getCheck();
  if (!checks) return [];
  return checks;
}

function getInputKind(input: Blockly.Input): 'value' | 'statement' | 'dummy' {
  if (!input.connection) return 'dummy';
  if (input.connection.type === Blockly.INPUT_VALUE) return 'value';
  if (input.connection.type === Blockly.NEXT_STATEMENT) return 'statement';
  return 'dummy';
}

function inspectBlock(type: string, workspace: Blockly.Workspace): BlockCapability | null {
  try {
    const block = workspace.newBlock(type);
    block.initModel();

    const fields = block.inputList.flatMap((input) =>
      input.fieldRow
        .filter((field) => typeof field.name === 'string' && field.name.length > 0)
        .map((field) => ({
          name: field.name as string,
          value: String(field.getValue() ?? ''),
          kind: field.constructor.name,
        }))
    );

    const capability: BlockCapability = {
      type,
      isStatement: !!block.previousConnection || !!block.nextConnection,
      isValue: !!block.outputConnection,
      hasPreviousConnection: !!block.previousConnection,
      hasNextConnection: !!block.nextConnection,
      fields,
      inputs: block.inputList.map((input) => ({
        name: input.name || '',
        kind: getInputKind(input),
        checks: getInputChecks(input),
      })),
    };

    block.dispose(false);
    return capability;
  } catch (error) {
    console.warn(`[LLM] Failed to inspect block "${type}"`, error);
    return null;
  }
}

let cachedCapabilities: BlocklyCapabilities | null = null;

export function getBlocklyCapabilities(): BlocklyCapabilities {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  const workspace = new Blockly.Workspace();
  const blockTypes = Object.keys(Blockly.Blocks).sort((a, b) => a.localeCompare(b));
  const blocks: BlockCapability[] = [];

  for (const blockType of blockTypes) {
    const inspected = inspectBlock(blockType, workspace);
    if (inspected) {
      blocks.push(inspected);
    }
  }

  workspace.dispose();

  const byType: Record<string, BlockCapability> = {};
  for (const block of blocks) {
    byType[block.type] = block;
  }

  cachedCapabilities = {
    blocks,
    byType,
    specialTokens: {
      objectTargets: [...OBJECT_SPECIAL_VALUES],
      componentAnyPrefix: COMPONENT_ANY_PREFIX,
    },
    limits: CAPABILITY_LIMITS,
  };
  return cachedCapabilities;
}
