import { expect, test } from '@playwright/test';

test.describe('runtime typed variables', () => {
  test('coerces typed values and defaults robustly at runtime', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const results = await page.evaluate(async () => {
      const { RuntimeEngine } = await import('/src/phaser/RuntimeEngine.ts');

      const fakeScene = {
        input: {
          keyboard: {
            on: () => undefined,
          },
        },
        matter: {
          world: {
            on: () => undefined,
          },
        },
      };

      const runtime = new RuntimeEngine(fakeScene as never, 800, 600);
      const spriteId = 'test-sprite';
      runtime.localVariables.set(spriteId, new Map());

      runtime.setVariableLookup((varId: string) => {
        switch (varId) {
          case 'global-bool':
            return { name: 'Flag', type: 'boolean', scope: 'global', defaultValue: 'false' };
          case 'global-float':
            return { name: 'Speed', type: 'float', scope: 'global', defaultValue: 'Infinity' };
          case 'global-int':
            return { name: 'Count', type: 'integer', scope: 'global', defaultValue: '12.9' };
          case 'local-bool':
            return { name: 'Local flag', type: 'boolean', scope: 'local', defaultValue: 'true' };
          default:
            return undefined;
        }
      });

      const defaults = {
        globalBool: runtime.getTypedVariable('global-bool'),
        globalFloat: runtime.getTypedVariable('global-float'),
        globalInt: runtime.getTypedVariable('global-int'),
        localBool: runtime.getTypedVariable('local-bool', spriteId),
      };

      runtime.setTypedVariable('global-bool', 'false');
      runtime.setTypedVariable('global-float', 'Infinity');
      runtime.setTypedVariable('global-int', '7.9');
      runtime.setTypedVariable('local-bool', '0', spriteId);

      const stored = {
        globalBool: runtime.getTypedVariable('global-bool'),
        globalFloat: runtime.getTypedVariable('global-float'),
        globalInt: runtime.getTypedVariable('global-int'),
        localBool: runtime.getTypedVariable('local-bool', spriteId),
      };

      runtime.globalVariables.set('global-bool', 'false' as never);
      runtime.localVariables.get(spriteId)?.set('local-bool', 'false' as never);

      const repairedReads = {
        globalBool: runtime.getTypedVariable('global-bool'),
        localBool: runtime.getTypedVariable('local-bool', spriteId),
      };

      return { defaults, stored, repairedReads };
    });

    expect(results.defaults).toEqual({
      globalBool: false,
      globalFloat: 0,
      globalInt: 12,
      localBool: true,
    });

    expect(results.stored).toEqual({
      globalBool: false,
      globalFloat: 0,
      globalInt: 7,
      localBool: false,
    });

    expect(results.repairedReads).toEqual({
      globalBool: false,
      localBool: false,
    });
  });
});
