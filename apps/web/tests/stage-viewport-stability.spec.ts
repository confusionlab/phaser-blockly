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
  surfaceSize: {
    width: number;
    height: number;
  } | null;
  visibleRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  cameraViewportCenter: {
    x: number;
    y: number;
  } | null;
  cameraWorldView: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
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
  const zoom = after.editorViewport?.zoom ?? before.editorViewport?.zoom ?? 1;
  expect(Math.abs((after.cameraViewportCenter?.x ?? 0) - (before.cameraViewportCenter?.x ?? 0)) * zoom).toBeLessThan(1.2);
  expect(Math.abs((after.cameraViewportCenter?.y ?? 0) - (before.cameraViewportCenter?.y ?? 0)) * zoom).toBeLessThan(1.2);
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
  test('live editor surface stays centered and fully covers the host without seams', async ({ page }) => {
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
        coversLeft: canvasRect.left <= hostRect.left + 0.5,
        coversTop: canvasRect.top <= hostRect.top + 0.5,
        coversRight: canvasRect.right >= hostRect.right - 0.5,
        coversBottom: canvasRect.bottom >= hostRect.bottom - 0.5,
        centerXDelta: Math.abs(
          (canvasRect.left + canvasRect.right) / 2 - (hostRect.left + hostRect.right) / 2,
        ),
        centerYDelta: Math.abs(
          (canvasRect.top + canvasRect.bottom) / 2 - (hostRect.top + hostRect.bottom) / 2,
        ),
      };
    });

    expect(edgeDiffs).not.toBeNull();
    expect(edgeDiffs?.coversLeft).toBe(true);
    expect(edgeDiffs?.coversTop).toBe(true);
    expect(edgeDiffs?.coversRight).toBe(true);
    expect(edgeDiffs?.coversBottom).toBe(true);
    expect(edgeDiffs?.centerXDelta ?? 0).toBeLessThanOrEqual(0.5);
    expect(edgeDiffs?.centerYDelta ?? 0).toBeLessThanOrEqual(0.5);

    const snapshot = await getEditorSceneSnapshot(page);
    expect(snapshot.visibleRect).toEqual({
      x: Math.floor(((snapshot.surfaceSize?.width ?? 0) - snapshot.hostSize.width) / 2),
      y: Math.floor(((snapshot.surfaceSize?.height ?? 0) - snapshot.hostSize.height) / 2),
      width: snapshot.hostSize.width,
      height: snapshot.hostSize.height,
    });
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

  test('vertical stage resize preserves the editor center during drag and after commit', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Vertical Resize Stability ${Date.now()}`,
    });
    await waitForStageDebug(page);
    await setEditorViewport(page, { centerX: 581.75, centerY: 467.25, zoom: 1.5 });
    await waitForStageToSettle(page);

    const before = await getEditorSceneSnapshot(page);
    const beforeWorldCenter = await getWorldPointAtStageCenter(page);
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
    await page.mouse.move(pointerX, pointerY + 140, { steps: 12 });
    await expect(page.getByTestId('stage-frozen-frame')).toHaveCount(0);

    await expect.poll(async () => {
      const snapshot = await getEditorSceneSnapshot(page);
      return {
        hostHeightGrew: snapshot.hostSize.height - before.hostSize.height >= 40,
        worldHeightGrew: (snapshot.cameraWorldView?.height ?? 0) - (before.cameraWorldView?.height ?? 0) > 20,
      };
    }).toEqual({
      hostHeightGrew: true,
      worldHeightGrew: true,
    });

    const during = await getEditorSceneSnapshot(page);
    const duringWorldCenter = await getWorldPointAtStageCenter(page);
    expectCentersToMatch(before, during);
    expectWorldPointsToStayWithinScreenPixels(
      beforeWorldCenter,
      duringWorldCenter,
      during.editorViewport?.zoom ?? 1,
    );
    expect((during.hostSize.height ?? 0) - before.hostSize.height).toBeGreaterThanOrEqual(40);
    expect((during.cameraWorldView?.height ?? 0) - (before.cameraWorldView?.height ?? 0)).toBeGreaterThan(20);

    await page.mouse.up();
    await waitForStageToSettle(page);

    const after = await getEditorSceneSnapshot(page);
    const afterWorldCenter = await getWorldPointAtStageCenter(page);
    expectCentersToMatch(before, after);
    expectWorldPointsToStayWithinScreenPixels(
      beforeWorldCenter,
      afterWorldCenter,
      after.editorViewport?.zoom ?? 1,
    );
  });

  test('horizontal editor split resize preserves the editor center during drag and after commit', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Horizontal Resize Stability ${Date.now()}`,
    });
    await waitForStageDebug(page);
    await setEditorViewport(page, { centerX: 702.125, centerY: 352.875, zoom: 1.35 });
    await waitForStageToSettle(page);

    const before = await getEditorSceneSnapshot(page);
    const beforeWorldCenter = await getWorldPointAtStageCenter(page);
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
    await page.mouse.move(pointerX - 180, pointerY, { steps: 12 });
    await expect(page.getByTestId('stage-frozen-frame')).toHaveCount(0);

    await expect.poll(async () => {
      const snapshot = await getEditorSceneSnapshot(page);
      return {
        hostWidthGrew: snapshot.hostSize.width - before.hostSize.width >= 40,
        worldWidthGrew: (snapshot.cameraWorldView?.width ?? 0) - (before.cameraWorldView?.width ?? 0) > 20,
      };
    }).toEqual({
      hostWidthGrew: true,
      worldWidthGrew: true,
    });

    const during = await getEditorSceneSnapshot(page);
    const duringWorldCenter = await getWorldPointAtStageCenter(page);
    expectCentersToMatch(before, during);
    expectWorldPointsToStayWithinScreenPixels(
      beforeWorldCenter,
      duringWorldCenter,
      during.editorViewport?.zoom ?? 1,
    );
    expect((during.hostSize.width ?? 0) - before.hostSize.width).toBeGreaterThanOrEqual(40);
    expect((during.cameraWorldView?.width ?? 0) - (before.cameraWorldView?.width ?? 0)).toBeGreaterThan(20);

    await page.mouse.up();
    await waitForStageToSettle(page);

    const after = await getEditorSceneSnapshot(page);
    const afterWorldCenter = await getWorldPointAtStageCenter(page);
    expectCentersToMatch(before, after);
    expectWorldPointsToStayWithinScreenPixels(
      beforeWorldCenter,
      afterWorldCenter,
      after.editorViewport?.zoom ?? 1,
    );
  });
});
