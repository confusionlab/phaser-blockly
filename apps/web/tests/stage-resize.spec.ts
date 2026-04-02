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

  test('growing the stage keeps the frozen frame visible until the resized live canvas is ready', async ({ page }) => {
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

    const frozenFrameSnapshot = await page.evaluate(() => {
      const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
      if (!(frozen instanceof HTMLCanvasElement)) {
        return null;
      }

      return {
        tagName: frozen.tagName,
        width: frozen.width,
        height: frozen.height,
        visibility: window.getComputedStyle(frozen).visibility,
        position: window.getComputedStyle(frozen).position,
        transform: window.getComputedStyle(frozen).transform,
      };
    });
    expect(frozenFrameSnapshot).not.toBeNull();
    expect(frozenFrameSnapshot?.tagName).toBe('CANVAS');
    expect(frozenFrameSnapshot?.width).toBeGreaterThan(0);
    expect(frozenFrameSnapshot?.height).toBeGreaterThan(0);
    expect(frozenFrameSnapshot?.visibility).toBe('visible');
    expect(frozenFrameSnapshot?.position).toBe('absolute');
    expect(frozenFrameSnapshot?.transform).not.toBe('none');

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
