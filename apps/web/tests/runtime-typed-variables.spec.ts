import { expect, test } from '@playwright/test';

test.describe('runtime typed variables', () => {
  test('coerces typed values and defaults robustly at runtime', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const results = await page.evaluate(async () => {
      const { RuntimeEngine, clearSharedGlobalVariables } = await import('/src/phaser/RuntimeEngine.ts');
      clearSharedGlobalVariables();

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

  test('supports typed array variables robustly at runtime', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const results = await page.evaluate(async () => {
      const { RuntimeEngine, clearSharedGlobalVariables } = await import('/src/phaser/RuntimeEngine.ts');
      clearSharedGlobalVariables();

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
          case 'global-text-list':
            return {
              name: 'Labels',
              type: 'string',
              cardinality: 'array',
              scope: 'global',
              defaultValue: ['ready', 2, false],
            };
          case 'local-int-list':
            return {
              name: 'Scores',
              type: 'integer',
              cardinality: 'array',
              scope: 'local',
              defaultValue: ['1', 2.9, 'bad'],
            };
          default:
            return undefined;
        }
      });

      const defaults = {
        globalTextList: runtime.getTypedVariable('global-text-list'),
        globalTextLength: runtime.getTypedArrayLength('global-text-list'),
        localIntList: runtime.getTypedVariable('local-int-list', spriteId),
        localIntItem2: runtime.getTypedArrayItem('local-int-list', 2, spriteId),
        localIntItem99: runtime.getTypedArrayItem('local-int-list', 99, spriteId),
        localIntContains2: runtime.typedArrayContains('local-int-list', '2.7', spriteId),
        localIntContains8: runtime.typedArrayContains('local-int-list', 8, spriteId),
      };

      runtime.pushTypedArrayItem('local-int-list', '7.9', spriteId);
      runtime.insertTypedArrayItem('local-int-list', 2, '4.2', spriteId);
      runtime.setTypedArrayItem('local-int-list', 3, '9.8', spriteId);
      runtime.removeTypedArrayItem('local-int-list', 4, spriteId);
      runtime.setTypedVariable('global-text-list', ['A', 2, null]);

      const afterMutations = {
        globalTextList: runtime.getTypedVariable('global-text-list'),
        localIntList: runtime.getTypedVariable('local-int-list', spriteId),
        localIntLength: runtime.getTypedArrayLength('local-int-list', spriteId),
        localIntItem3: runtime.getTypedArrayItem('local-int-list', 3, spriteId),
        localIntContains9: runtime.typedArrayContains('local-int-list', '9.1', spriteId),
      };

      const localSnapshot = runtime.getTypedVariable('local-int-list', spriteId);
      if (Array.isArray(localSnapshot)) {
        localSnapshot.push(99);
      }

      const afterExternalMutationAttempt = runtime.getTypedVariable('local-int-list', spriteId);

      runtime.localVariables.get(spriteId)?.set('local-int-list', ['11', 'bad'] as never);
      const repairedRead = runtime.getTypedVariable('local-int-list', spriteId);

      runtime.clearTypedArray('local-int-list', spriteId);
      runtime.setTypedVariable('local-int-list', '12.8', spriteId);
      const afterClearAndSet = runtime.getTypedVariable('local-int-list', spriteId);

      return {
        defaults,
        afterMutations,
        afterExternalMutationAttempt,
        repairedRead,
        afterClearAndSet,
      };
    });

    expect(results.defaults).toEqual({
      globalTextList: ['ready', '2', 'false'],
      globalTextLength: 3,
      localIntList: [1, 2, 0],
      localIntItem2: 2,
      localIntItem99: 0,
      localIntContains2: true,
      localIntContains8: false,
    });

    expect(results.afterMutations).toEqual({
      globalTextList: ['A', '2', ''],
      localIntList: [1, 4, 9, 7],
      localIntLength: 4,
      localIntItem3: 9,
      localIntContains9: true,
    });

    expect(results.afterExternalMutationAttempt).toEqual([1, 4, 9, 7]);
    expect(results.repairedRead).toEqual([11, 0]);
    expect(results.afterClearAndSet).toEqual([12]);
  });
});
