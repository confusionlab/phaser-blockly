import { expect, test, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

type EditorViewportSnapshot = {
  mode: 'camera-masked' | 'camera-viewport' | 'editor';
  editorViewport: {
    centerX: number;
    centerY: number;
    zoom: number;
  } | null;
  hostSize: {
    width: number;
    height: number;
  };
  cameraViewportCenter: {
    x: number;
    y: number;
  } | null;
};

async function waitForStageDebug(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean(window['__pochaStageDebug']))).toBe(true);
}

async function setEditorViewport(
  page: Page,
  viewport: { centerX: number; centerY: number; zoom: number },
): Promise<void> {
  await page.evaluate((nextViewport) => {
    const debug = window['__pochaStageDebug'];
    if (!debug) {
      throw new Error('Stage debug bridge is unavailable.');
    }
    debug.setEditorViewport(nextViewport);
  }, viewport);
}

async function getEditorSceneSnapshot(page: Page): Promise<EditorViewportSnapshot> {
  return await page.evaluate(() => {
    const debug = window['__pochaStageDebug'];
    if (!debug) {
      throw new Error('Stage debug bridge is unavailable.');
    }
    const snapshot = debug.getEditorSceneSnapshot();
    if (!snapshot) {
      throw new Error('Editor scene snapshot is unavailable.');
    }
    return snapshot;
  });
}

async function getWorldPointAtStageCenter(page: Page): Promise<{ x: number; y: number }> {
  return await page.evaluate(() => {
    const debug = window['__pochaStageDebug'];
    const canvas = document.querySelector('[data-testid="stage-phaser-host"] canvas');
    if (!debug || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Stage center world-point probe is unavailable.');
    }

    const rect = canvas.getBoundingClientRect();
    const worldPoint = debug.getWorldPointAtClientPosition(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );

    if (!worldPoint) {
      throw new Error('Stage center world-point probe returned null.');
    }

    return worldPoint;
  });
}

async function waitForStageToSettle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

function expectCentersToMatch(before: EditorViewportSnapshot, after: EditorViewportSnapshot): void {
  expect(after.editorViewport?.centerX).toBeCloseTo(before.editorViewport?.centerX ?? 0, 8);
  expect(after.editorViewport?.centerY).toBeCloseTo(before.editorViewport?.centerY ?? 0, 8);
  expect(after.editorViewport?.zoom).toBeCloseTo(before.editorViewport?.zoom ?? 0, 8);
  expect(after.cameraViewportCenter?.x).toBeCloseTo(before.cameraViewportCenter?.x ?? 0, 6);
  expect(after.cameraViewportCenter?.y).toBeCloseTo(before.cameraViewportCenter?.y ?? 0, 6);
}

function expectWorldPointsToStayWithinScreenPixels(
  before: { x: number; y: number },
  after: { x: number; y: number },
  zoom: number,
  maxScreenPixelDrift = 1.2,
): void {
  expect(Math.abs(after.x - before.x) * zoom).toBeLessThan(maxScreenPixelDrift);
  expect(Math.abs(after.y - before.y) * zoom).toBeLessThan(maxScreenPixelDrift);
}

test.describe('stage viewport stability', () => {
  test('live editor canvas fills the host without right or bottom seams', async ({ page }) => {
    await page.setViewportSize({ width: 1377, height: 913 });
    await bootstrapEditorProject(page, {
      projectName: `Stage Host Fill ${Date.now()}`,
    });
    await waitForStageDebug(page);
    await waitForStageToSettle(page);

    const edgeDiffs = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="stage-phaser-host"]');
      const canvas = document.querySelector('[data-testid="stage-phaser-host"] canvas');
      if (!(host instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
        return null;
      }

      const hostRect = host.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return {
        left: Math.abs(canvasRect.left - hostRect.left),
        top: Math.abs(canvasRect.top - hostRect.top),
        right: Math.abs(hostRect.right - canvasRect.right),
        bottom: Math.abs(hostRect.bottom - canvasRect.bottom),
      };
    });

    expect(edgeDiffs).not.toBeNull();
    expect(edgeDiffs?.left ?? 0).toBeLessThanOrEqual(0.5);
    expect(edgeDiffs?.top ?? 0).toBeLessThanOrEqual(0.5);
    expect(edgeDiffs?.right ?? 0).toBeLessThanOrEqual(0.5);
    expect(edgeDiffs?.bottom ?? 0).toBeLessThanOrEqual(0.5);
  });

  test('fullscreen preserves the world point at the stage center', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Fullscreen Stability ${Date.now()}`,
    });
    await waitForStageDebug(page);
    await setEditorViewport(page, { centerX: 643.25, centerY: 418.5, zoom: 1.7 });
    await waitForStageToSettle(page);

    const before = await getEditorSceneSnapshot(page);
    const beforeWorldCenter = await getWorldPointAtStageCenter(page);
    expect(before.mode).toBe('editor');

    await page.getByRole('button', { name: 'Fullscreen stage' }).click();
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
    await waitForStageToSettle(page);

    const fullscreen = await getEditorSceneSnapshot(page);
    const fullscreenWorldCenter = await getWorldPointAtStageCenter(page);
    expectCentersToMatch(before, fullscreen);
    expectWorldPointsToStayWithinScreenPixels(
      beforeWorldCenter,
      fullscreenWorldCenter,
      fullscreen.editorViewport?.zoom ?? 1,
    );

    await page.getByRole('button', { name: 'Exit fullscreen' }).click();
    await expect(page.getByRole('button', { name: 'Fullscreen stage' })).toBeVisible();
    await waitForStageToSettle(page);

    const restored = await getEditorSceneSnapshot(page);
    const restoredWorldCenter = await getWorldPointAtStageCenter(page);
    expectCentersToMatch(before, restored);
    expectWorldPointsToStayWithinScreenPixels(
      beforeWorldCenter,
      restoredWorldCenter,
      restored.editorViewport?.zoom ?? 1,
    );
  });

  test('vertical stage resize commit preserves the editor center', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Vertical Resize Stability ${Date.now()}`,
    });
    await waitForStageDebug(page);
    await setEditorViewport(page, { centerX: 581.75, centerY: 467.25, zoom: 1.5 });
    await waitForStageToSettle(page);

    const before = await getEditorSceneSnapshot(page);
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
    await page.mouse.up();
    await expect(page.getByTestId('stage-frozen-frame')).toBeHidden();
    await waitForStageToSettle(page);

    const after = await getEditorSceneSnapshot(page);
    expectCentersToMatch(before, after);
  });

  test('horizontal editor split resize commit preserves the editor center', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Horizontal Resize Stability ${Date.now()}`,
    });
    await waitForStageDebug(page);
    await setEditorViewport(page, { centerX: 702.125, centerY: 352.875, zoom: 1.35 });
    await waitForStageToSettle(page);

    const before = await getEditorSceneSnapshot(page);
    const divider = page.getByTestId('editor-layout-divider');
    const dividerBox = await divider.boundingBox();
    expect(dividerBox).not.toBeNull();
    if (!dividerBox) {
      return;
    }

    const pointerX = dividerBox.x + dividerBox.width / 2;
    const pointerY = dividerBox.y + dividerBox.height / 2;
    await page.mouse.move(pointerX, pointerY);
    await page.mouse.down();
    await page.mouse.move(pointerX + 180, pointerY, { steps: 12 });
    await expect(page.getByTestId('stage-frozen-frame')).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId('stage-frozen-frame')).toBeHidden();
    await waitForStageToSettle(page);

    const after = await getEditorSceneSnapshot(page);
    expectCentersToMatch(before, after);
  });
});
