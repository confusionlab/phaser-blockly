import { expect, test } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function waitForStageDebug(page: import('@playwright/test').Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean(window['__pochaStageDebug']))).toBe(true);
}

test.describe('stage zoom anchoring', () => {
  test('ctrl-wheel zoom keeps the world point under the cursor fixed', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Zoom Anchor ${Date.now()}`,
    });
    await waitForStageDebug(page);

    await page.evaluate(() => {
      window.__pochaStageDebug.setEditorViewport({
        centerX: 643.25,
        centerY: 418.5,
        zoom: 1.7,
      });
    });
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });

    const host = page.locator('[data-testid="stage-phaser-host"]');
    const hostBox = await host.boundingBox();
    expect(hostBox).not.toBeNull();
    if (!hostBox) {
      return;
    }

    const clientX = hostBox.x + hostBox.width * 0.35;
    const clientY = hostBox.y + hostBox.height * 0.4;
    const before = await page.evaluate(({ clientX, clientY }) => {
      const snapshot = window.__pochaStageDebug.getEditorSceneSnapshot();
      const world = window.__pochaStageDebug.getWorldPointAtClientPosition(clientX, clientY);
      return { snapshot, world };
    }, { clientX, clientY });

    await page.mouse.move(clientX, clientY);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });

    const after = await page.evaluate(({ clientX, clientY }) => {
      const snapshot = window.__pochaStageDebug.getEditorSceneSnapshot();
      const world = window.__pochaStageDebug.getWorldPointAtClientPosition(clientX, clientY);
      return { snapshot, world };
    }, { clientX, clientY });

    expect(after.snapshot?.editorViewport?.zoom).toBeGreaterThan(before.snapshot?.editorViewport?.zoom ?? 0);
    const zoomForScreenDrift = Math.max(
      before.snapshot?.editorViewport?.zoom ?? 1,
      after.snapshot?.editorViewport?.zoom ?? 1,
    );
    expect(Math.abs((after.world?.x ?? 0) - (before.world?.x ?? 0)) * zoomForScreenDrift).toBeLessThan(0.6);
    expect(Math.abs((after.world?.y ?? 0) - (before.world?.y ?? 0)) * zoomForScreenDrift).toBeLessThan(0.6);
  });
});
