import { expect, test } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function openEditorFromProjectList(page: import('@playwright/test').Page): Promise<void> {
  await bootstrapEditorProject(page, { projectName: `Stage Resize Test ${Date.now()}` });
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
});
