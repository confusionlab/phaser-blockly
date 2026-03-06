import { expect, test } from '@playwright/test';
import {
  compileAssistantBlockProgram,
  getAssistantBlockCatalog,
  searchAssistantBlocks,
  validateAssistantBlockProgram,
} from '../../../packages/ui-shared/src/assistantBlocks';

test.describe('assistant block catalog', () => {
  test('stays in sync with the registered toolbox block types', async () => {
    const globals = globalThis as {
      __APP_VERSION__?: string;
      localStorage?: { getItem: (key: string) => string | null };
      document?: { documentElement: { classList: { toggle: (className: string, enabled?: boolean) => void } } };
      window?: { matchMedia: (query: string) => { matches: boolean } };
    };
    globals.__APP_VERSION__ = 'test';
    globals.localStorage = { getItem: () => null };
    globals.document = {
      documentElement: {
        classList: {
          toggle: () => undefined,
        },
      },
    };
    globals.window = {
      matchMedia: () => ({ matches: false }),
    };
    const { getToolboxRegisteredBlockTypes } = await import('../src/components/blockly/toolbox');
    const catalogTypes = getAssistantBlockCatalog()
      .map((entry) => entry.type)
      .sort((a, b) => a.localeCompare(b));
    const toolboxTypes = getToolboxRegisteredBlockTypes();

    expect(catalogTypes).toEqual(toolboxTypes);
  });

  test('searches blocks by behavior keywords without full toolbox dump in the tool result', () => {
    const results = searchAssistantBlocks({ query: 'size' }).map((entry) => entry.type);

    expect(results).toContain('looks_change_size');
    expect(results).toContain('looks_set_size');
  });

  test('compiles typed block programs into Blockly XML', () => {
    const xml = compileAssistantBlockProgram({
      formatVersion: 1,
      blocks: [
        {
          type: 'event_game_start',
          statements: {
            NEXT: [
              {
                type: 'looks_change_size',
                values: {
                  SIZE: {
                    type: 'math_number',
                    fields: {
                      NUM: 10,
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    });

    expect(xml).toContain('<block type="event_game_start">');
    expect(xml).toContain('<statement name="NEXT">');
    expect(xml).toContain('<block type="looks_change_size">');
    expect(xml).toContain('<block type="math_number">');
  });

  test('rejects block programs with unsupported connection names', () => {
    const issues = validateAssistantBlockProgram({
      formatVersion: 1,
      blocks: [
        {
          type: 'looks_change_size',
          values: {
            WRONG: {
              type: 'math_number',
              fields: {
                NUM: 10,
              },
            },
          },
        },
      ],
    });

    expect(issues).toContain('blocks[0].values.WRONG is not valid for block "looks_change_size".');
  });
});
