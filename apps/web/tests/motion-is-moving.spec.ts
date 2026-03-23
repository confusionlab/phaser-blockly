import { expect, test } from '@playwright/test';
import { getAssistantBlockCatalog } from '../../../packages/ui-shared/src/assistantBlocks';

function installToolboxTestGlobals(): void {
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
}

test.describe('motion is moving block', () => {
  test('is registered in both the toolbox and assistant catalog', async () => {
    installToolboxTestGlobals();
    const { getToolboxRegisteredBlockTypes } = await import('../src/components/blockly/toolbox');
    const toolboxTypes = getToolboxRegisteredBlockTypes();
    const catalogTypes = getAssistantBlockCatalog().map((entry) => entry.type);

    expect(toolboxTypes).toContain('motion_is_moving');
    expect(catalogTypes).toContain('motion_is_moving');
  });

  test('generates a runtime movement check', async () => {
    installToolboxTestGlobals();
    const Blockly = await import('blockly');
    const { javascriptGenerator } = await import('blockly/javascript');
    await import('../src/components/blockly/toolbox');
    const { registerCodeGenerators } = await import('../src/phaser/CodeGenerator');

    registerCodeGenerators();

    const workspace = new Blockly.Workspace();
    Blockly.Events.disable();
    try {
      const moving = workspace.newBlock('motion_is_moving');
      javascriptGenerator.init(workspace);
      const code = javascriptGenerator.blockToCode(moving);
      expect(code).toEqual(['sprite.isMoving()', expect.any(Number)]);
      javascriptGenerator.finish('');
      workspace.dispose();
    } finally {
      Blockly.Events.enable();
    }
  });
});
