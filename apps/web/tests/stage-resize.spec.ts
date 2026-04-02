import { expect, test } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function openEditorFromProjectList(page: import('@playwright/test').Page): Promise<void> {
  await bootstrapEditorProject(page, { projectName: `Stage Resize Test ${Date.now()}` });
}

async function waitForStageDebug(page: import('@playwright/test').Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean(window['__pochaStageDebug']))).toBe(true);
}

test.describe('Stage resize', () => {
  test('freezes Phaser resizing until vertical drag release, then commits once', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);

    const host = page.getByTestId('stage-phaser-host');
    await expect(host).toBeVisible({ timeout: 10000 });
    const canvas = host.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    const initialMetrics = await canvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      return {
        width: canvas.width,
        height: canvas.height,
      };
    });
    expect(initialMetrics).not.toBeNull();

    const divider = page.getByTestId('stage-panel-vertical-divider');
    const dividerBox = await divider.boundingBox();
    expect(dividerBox).not.toBeNull();

    if (!dividerBox || !initialMetrics) {
      return;
    }

    const pointerX = dividerBox.x + dividerBox.width / 2;
    const pointerY = dividerBox.y + dividerBox.height / 2;
    await page.mouse.move(pointerX, pointerY);
    await page.mouse.down();
    await page.mouse.move(pointerX, pointerY - 120, { steps: 10 });
    await expect(page.getByTestId('stage-frozen-frame')).toBeVisible();

    const dragState = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="stage-phaser-host"] canvas');
      const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      return {
        width: canvas.width,
        height: canvas.height,
        visibility: window.getComputedStyle(canvas).visibility,
        frozenVisible: frozen instanceof HTMLElement
          ? window.getComputedStyle(frozen).visibility === 'visible'
          : false,
      };
    });
    expect(dragState).not.toBeNull();
    expect(dragState?.visibility).toBe('hidden');
    expect(dragState?.frozenVisible).toBe(true);

    const dragMetrics = await canvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      return {
        width: canvas.width,
        height: canvas.height,
      };
    });
    expect(dragMetrics.width).toBe(initialMetrics.width);

    await page.mouse.up();
    await expect(page.getByTestId('stage-frozen-frame')).toBeHidden();

    await expect.poll(async () => {
      return await canvas.evaluate((node, initial) => {
        const canvas = node as HTMLCanvasElement;
        const widthStable = Math.abs(canvas.width - initial.width) <= 4;
        const heightChanged = Math.abs(canvas.height - initial.height) >= 40;
        return widthStable && heightChanged;
      }, initialMetrics);
    }).toBe(true);
  });

  test('freezes Phaser resizing until editor split drag release, then commits once', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);

    const host = page.getByTestId('stage-phaser-host');
    await expect(host).toBeVisible({ timeout: 10000 });
    const canvas = host.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    const initialMetrics = await canvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      return {
        width: canvas.width,
        height: canvas.height,
      };
    });

    const divider = page.getByTestId('editor-layout-divider');
    const dividerBox = await divider.boundingBox();
    expect(dividerBox).not.toBeNull();

    if (!dividerBox || !initialMetrics) {
      return;
    }

    const pointerX = dividerBox.x + dividerBox.width / 2;
    const pointerY = dividerBox.y + dividerBox.height / 2;
    await page.mouse.move(pointerX, pointerY);
    await page.mouse.down();
    await page.mouse.move(pointerX + 160, pointerY, { steps: 10 });
    await expect(page.getByTestId('stage-frozen-frame')).toBeVisible();

    const dragState = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="stage-phaser-host"] canvas');
      const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      return {
        width: canvas.width,
        height: canvas.height,
        visibility: window.getComputedStyle(canvas).visibility,
        frozenVisible: frozen instanceof HTMLElement
          ? window.getComputedStyle(frozen).visibility === 'visible'
          : false,
      };
    });
    expect(dragState).not.toBeNull();
    expect(dragState?.visibility).toBe('hidden');
    expect(dragState?.frozenVisible).toBe(true);

    await expect.poll(async () => {
      return page.evaluate(() => {
        const host = document.querySelector('[data-testid="stage-phaser-host"]');
        const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
        if (!(host instanceof HTMLElement) || !(frozen instanceof HTMLCanvasElement)) {
          return null;
        }

        const hostRect = host.getBoundingClientRect();
        const frozenRect = frozen.getBoundingClientRect();
        return {
          wideEnough: frozenRect.width >= hostRect.width,
          centeredX: Math.abs((frozenRect.left + frozenRect.width / 2) - (hostRect.left + hostRect.width / 2)) <= 1,
        };
      });
    }).toEqual({
      wideEnough: true,
      centeredX: true,
    });

    const dragMetrics = await canvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      return {
        width: canvas.width,
        height: canvas.height,
      };
    });
    expect(dragMetrics.height).toBe(initialMetrics.height);

    await page.mouse.up();
    await expect(page.getByTestId('stage-frozen-frame')).toBeHidden();

    await expect.poll(async () => {
      return await canvas.evaluate((node, initial) => {
        const canvas = node as HTMLCanvasElement;
        const widthChanged = Math.abs(canvas.width - initial.width) >= 40;
        const heightStable = Math.abs(canvas.height - initial.height) <= 4;
        return widthChanged && heightStable;
      }, initialMetrics);
    }).toBe(true);
  });

  test('growing the stage keeps the frozen frame centered until the resized live canvas is ready', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    await waitForStageDebug(page);

    const divider = page.getByTestId('stage-panel-vertical-divider');
    const dividerBox = await divider.boundingBox();
    expect(dividerBox).not.toBeNull();

    if (!dividerBox) {
      return;
    }

    const pointerX = dividerBox.x + dividerBox.width / 2;
    const pointerY = dividerBox.y + dividerBox.height / 2;
    await page.mouse.move(pointerX, pointerY);
    await page.mouse.down();
    await page.mouse.move(pointerX, pointerY - 140, { steps: 12 });
    await expect(page.getByTestId('stage-frozen-frame')).toBeVisible();

    const initialFrozenFrameSnapshot = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="stage-phaser-host"]');
      const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
      if (!(host instanceof HTMLElement) || !(frozen instanceof HTMLCanvasElement)) {
        return null;
      }

      const hostRect = host.getBoundingClientRect();
      const frozenRect = frozen.getBoundingClientRect();

      return {
        tagName: frozen.tagName,
        width: frozen.width,
        height: frozen.height,
        visibility: window.getComputedStyle(frozen).visibility,
        position: window.getComputedStyle(frozen).position,
        transform: window.getComputedStyle(frozen).transform,
        hostCenterX: hostRect.left + hostRect.width / 2,
        hostCenterY: hostRect.top + hostRect.height / 2,
        frozenCenterX: frozenRect.left + frozenRect.width / 2,
        frozenCenterY: frozenRect.top + frozenRect.height / 2,
      };
    });
    expect(initialFrozenFrameSnapshot).not.toBeNull();
    expect(initialFrozenFrameSnapshot?.tagName).toBe('CANVAS');
    expect(initialFrozenFrameSnapshot?.width).toBeGreaterThan(0);
    expect(initialFrozenFrameSnapshot?.height).toBeGreaterThan(0);
    expect(initialFrozenFrameSnapshot?.visibility).toBe('visible');
    expect(initialFrozenFrameSnapshot?.position).toBe('absolute');
    expect(initialFrozenFrameSnapshot?.transform).not.toBe('none');
    expect(Math.abs((initialFrozenFrameSnapshot?.frozenCenterX ?? 0) - (initialFrozenFrameSnapshot?.hostCenterX ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((initialFrozenFrameSnapshot?.frozenCenterY ?? 0) - (initialFrozenFrameSnapshot?.hostCenterY ?? 0))).toBeLessThanOrEqual(1);

    await expect.poll(async () => {
      return page.evaluate(() => {
        const host = document.querySelector('[data-testid="stage-phaser-host"]');
        const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
        if (!(host instanceof HTMLElement) || !(frozen instanceof HTMLCanvasElement)) {
          return null;
        }

        const hostRect = host.getBoundingClientRect();
        const frozenRect = frozen.getBoundingClientRect();

        return {
          hostWidth: hostRect.width,
          hostHeight: hostRect.height,
          frozenWidth: frozenRect.width,
          frozenHeight: frozenRect.height,
          centeredX: Math.abs((frozenRect.left + frozenRect.width / 2) - (hostRect.left + hostRect.width / 2)) <= 1,
          centeredY: Math.abs((frozenRect.top + frozenRect.height / 2) - (hostRect.top + hostRect.height / 2)) <= 1,
        };
      });
    }).toMatchObject({
      centeredX: true,
      centeredY: true,
    });

    await expect.poll(async () => {
      return page.evaluate(() => {
        const host = document.querySelector('[data-testid="stage-phaser-host"]');
        const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
        if (!(host instanceof HTMLElement) || !(frozen instanceof HTMLCanvasElement)) {
          return null;
        }

        const hostRect = host.getBoundingClientRect();
        const frozenRect = frozen.getBoundingClientRect();
        const hostCenterX = hostRect.left + hostRect.width / 2;
        const hostCenterY = hostRect.top + hostRect.height / 2;
        const frozenCenterX = frozenRect.left + frozenRect.width / 2;
        const frozenCenterY = frozenRect.top + frozenRect.height / 2;

        return {
          tallEnough: frozenRect.height >= hostRect.height,
          centeredX: Math.abs(frozenCenterX - hostCenterX) <= 1,
          centeredY: Math.abs(frozenCenterY - hostCenterY) <= 1,
        };
      });
    }).toEqual({
      tallEnough: true,
      centeredX: true,
      centeredY: true,
    });

    const startFrame = await page.evaluate(() => {
      const debug = window['__pochaStageDebug'];
      const snapshot = debug?.getEditorSceneSnapshot();
      if (!snapshot) {
        throw new Error('Stage debug snapshot is unavailable.');
      }
      return snapshot.gameLoopFrame;
    });

    await page.mouse.up();

    const revealSamples = await page.evaluate(async () => {
      const debug = window['__pochaStageDebug'];
      if (!debug) {
        throw new Error('Stage debug bridge is unavailable.');
      }

      const readSample = () => {
        const snapshot = debug.getEditorSceneSnapshot();
        const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
        const frozenVisible = frozen instanceof HTMLElement
          ? window.getComputedStyle(frozen).visibility !== 'hidden'
          : false;

        return {
          hostSize: snapshot?.hostSize ?? null,
          gameLoopFrame: snapshot?.gameLoopFrame ?? 0,
          canvasState: snapshot?.canvasState ?? null,
          frozenVisible,
        };
      };

      const samples = [readSample()];
      for (let index = 0; index < 8; index += 1) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        samples.push(readSample());
      }
      return samples;
    });

    expect(revealSamples.length).toBeGreaterThan(0);
    for (const sample of revealSamples) {
      const revealedLiveCanvas = !sample.frozenVisible && sample.canvasState?.visibility === 'visible';
      if (!revealedLiveCanvas || !sample.hostSize || !sample.canvasState) {
        continue;
      }

      expect(sample.canvasState.width).toBe(sample.hostSize.width);
      expect(sample.canvasState.height).toBe(sample.hostSize.height);
      expect(sample.gameLoopFrame).toBeGreaterThan(startFrame);
    }

    await expect(page.getByTestId('stage-frozen-frame')).toBeHidden();
  });
});
