import { expect, test, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

type StageMetrics = {
  hostWidth: number;
  hostHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  canvasCssWidth: number;
  canvasCssHeight: number;
  coversHostLeft: boolean;
  coversHostTop: boolean;
  coversHostRight: boolean;
  coversHostBottom: boolean;
  canvasVisibility: string;
  surfaceResizeCount: number;
  tiledBackgroundRenderCount: number;
  frozenFrameCount: number;
};

type StageWorldViewSnapshot = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

async function openEditorFromProjectList(page: Page): Promise<void> {
  await bootstrapEditorProject(page, { projectName: `Stage Resize Test ${Date.now()}` });
}

async function waitForStageDebug(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean(window['__pochaStageDebug']))).toBe(true);
}

async function waitForStageHost(page: Page): Promise<void> {
  const host = page.getByTestId('stage-phaser-host');
  await expect(host).toBeVisible({ timeout: 10000 });
  await expect(host.locator('canvas').first()).toBeVisible({ timeout: 10000 });
}

async function waitForStageToSettle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

async function waitForTiledBackgroundToSettle(page: Page): Promise<void> {
  await expect.poll(async () => {
    const before = await getStageMetrics(page);
    if (!before || before.tiledBackgroundRenderCount <= 0) {
      return false;
    }

    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(resolve, 80);
          });
        });
      });
    });

    const after = await getStageMetrics(page);
    return !!after && after.tiledBackgroundRenderCount === before.tiledBackgroundRenderCount;
  }).toBe(true);
}

async function getStageMetrics(page: Page): Promise<StageMetrics | null> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="stage-phaser-host"]');
    const canvas = document.querySelector('[data-testid="stage-phaser-host"] canvas');
    const debug = window['__pochaStageDebug'];
    if (!(host instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    const hostRect = host.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const snapshot = debug?.getEditorSceneSnapshot?.() ?? null;
    return {
      hostWidth: Math.max(1, Math.round(hostRect.width)),
      hostHeight: Math.max(1, Math.round(hostRect.height)),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      canvasCssWidth: Math.max(1, Math.round(canvasRect.width)),
      canvasCssHeight: Math.max(1, Math.round(canvasRect.height)),
      coversHostLeft: canvasRect.left <= hostRect.left + 0.5,
      coversHostTop: canvasRect.top <= hostRect.top + 0.5,
      coversHostRight: canvasRect.right >= hostRect.right - 0.5,
      coversHostBottom: canvasRect.bottom >= hostRect.bottom - 0.5,
      canvasVisibility: window.getComputedStyle(canvas).visibility,
      surfaceResizeCount: snapshot?.surfaceResizeCount ?? -1,
      tiledBackgroundRenderCount: snapshot?.tiledBackgroundRenderCount ?? -1,
      frozenFrameCount: document.querySelectorAll('[data-testid="stage-frozen-frame"]').length,
    };
  });
}

async function enableDenseTiledBackground(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const [{ useProjectStore }, { useEditorStore }, { decodeBackgroundChunkImage }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
      import('/src/lib/background/chunkImageCache.ts'),
    ]);

    const sceneId = useEditorStore.getState().selectedSceneId;
    if (!sceneId) {
      throw new Error('No selected scene to update.');
    }

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = 64;
    tileCanvas.height = 64;
    const ctx = tileCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create background tile canvas.');
    }

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(32, 0, 32, 32);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(0, 32, 32, 32);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(32, 32, 32, 32);
    const tileDataUrl = tileCanvas.toDataURL('image/png');
    await decodeBackgroundChunkImage(tileDataUrl);

    const chunks: Record<string, string> = {};
    for (let cx = -6; cx <= 6; cx += 1) {
      for (let cy = -6; cy <= 6; cy += 1) {
        chunks[`${cx},${cy}`] = tileDataUrl;
      }
    }

    useProjectStore.getState().updateScene(sceneId, {
      background: {
        type: 'tiled',
        value: '#87CEEB',
        chunkSize: 256,
        chunks,
      },
    });
  });
}

async function getCameraWorldView(page: Page): Promise<StageWorldViewSnapshot> {
  return page.evaluate(() => {
    const debug = window['__pochaStageDebug'];
    if (!debug) {
      throw new Error('Stage debug bridge is unavailable.');
    }

    const snapshot = debug.getEditorSceneSnapshot();
    if (!snapshot?.cameraWorldView) {
      throw new Error('Camera world-view snapshot is unavailable.');
    }

    return {
      centerX: snapshot.cameraViewportCenter?.x ?? 0,
      centerY: snapshot.cameraViewportCenter?.y ?? 0,
      width: snapshot.cameraWorldView.width,
      height: snapshot.cameraWorldView.height,
    };
  });
}

test.describe('Stage resize', () => {
  test('stage canvas covers the full host even when panel layout lands on fractional pixels', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);

    const host = page.getByTestId('stage-phaser-host');
    await expect(host).toBeVisible({ timeout: 10000 });
    const canvas = host.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    const readCanvasHostGap = async () => {
      return await page.evaluate(() => {
        const host = document.querySelector('[data-testid="stage-phaser-host"]');
        const canvas = host?.querySelector('canvas');
        if (!(host instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
          return null;
        }

        const hostRect = host.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        return {
          leftGap: canvasRect.left - hostRect.left,
          topGap: canvasRect.top - hostRect.top,
          rightGap: hostRect.right - canvasRect.right,
          bottomGap: hostRect.bottom - canvasRect.bottom,
        };
      });
    };

    const hasVisibleGap = async () => {
      const gap = await readCanvasHostGap();
      if (!gap) {
        return true;
      }
      const tolerance = 0.05;
      return (
        gap.leftGap > tolerance ||
        gap.topGap > tolerance ||
        gap.rightGap > tolerance ||
        gap.bottomGap > tolerance
      );
    };

    await expect.poll(hasVisibleGap, { timeout: 10000 }).toBe(false);

    const verticalDivider = page.getByTestId('stage-panel-vertical-divider');
    const verticalDividerBox = await verticalDivider.boundingBox();
    expect(verticalDividerBox).not.toBeNull();
    if (!verticalDividerBox) {
      return;
    }

    const verticalPointerX = verticalDividerBox.x + verticalDividerBox.width / 2;
    const verticalPointerY = verticalDividerBox.y + verticalDividerBox.height / 2;
    await page.mouse.move(verticalPointerX, verticalPointerY);
    await page.mouse.down();
    await page.mouse.move(verticalPointerX, verticalPointerY - 120, { steps: 10 });
    await page.mouse.up();

    await expect.poll(hasVisibleGap, { timeout: 10000 }).toBe(false);

    const horizontalDivider = page.getByTestId('editor-layout-divider');
    const horizontalDividerBox = await horizontalDivider.boundingBox();
    expect(horizontalDividerBox).not.toBeNull();
    if (!horizontalDividerBox) {
      return;
    }

    const horizontalPointerX = horizontalDividerBox.x + horizontalDividerBox.width / 2;
    const horizontalPointerY = horizontalDividerBox.y + horizontalDividerBox.height / 2;
    await page.mouse.move(horizontalPointerX, horizontalPointerY);
    await page.mouse.down();
    await page.mouse.move(horizontalPointerX + 160, horizontalPointerY, { steps: 10 });
    await page.mouse.up();

    await expect.poll(hasVisibleGap, { timeout: 10000 }).toBe(false);
  });

  test('bottom panel split drag does not resize the stage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    await waitForStageHost(page);
    await waitForStageToSettle(page);

    const initialMetrics = await getStageMetrics(page);
    expect(initialMetrics).not.toBeNull();
    if (!initialMetrics) {
      return;
    }

    const divider = page.getByTestId('stage-panel-horizontal-divider');
    const dividerBox = await divider.boundingBox();
    expect(dividerBox).not.toBeNull();
    if (!dividerBox) {
      return;
    }

    const pointerX = dividerBox.x + dividerBox.width / 2;
    const pointerY = dividerBox.y + dividerBox.height / 2;
    await page.mouse.move(pointerX, pointerY);
    await page.mouse.down();
    await page.mouse.move(pointerX + 140, pointerY, { steps: 12 });

    const dragMetrics = await getStageMetrics(page);
    expect(dragMetrics).not.toBeNull();
    expect(dragMetrics?.hostWidth).toBe(initialMetrics.hostWidth);
    expect(dragMetrics?.hostHeight).toBe(initialMetrics.hostHeight);
    expect(dragMetrics?.canvasWidth).toBe(initialMetrics.canvasWidth);
    expect(dragMetrics?.canvasHeight).toBe(initialMetrics.canvasHeight);
    expect(dragMetrics?.canvasCssWidth).toBe(initialMetrics.canvasCssWidth);
    expect(dragMetrics?.canvasCssHeight).toBe(initialMetrics.canvasCssHeight);
    expect(dragMetrics?.canvasVisibility).toBe('visible');
    expect(dragMetrics?.coversHostLeft).toBe(true);
    expect(dragMetrics?.coversHostTop).toBe(true);
    expect(dragMetrics?.coversHostRight).toBe(true);
    expect(dragMetrics?.coversHostBottom).toBe(true);
    expect(dragMetrics?.surfaceResizeCount).toBe(initialMetrics.surfaceResizeCount);
    expect(dragMetrics?.frozenFrameCount).toBe(0);

    await page.mouse.up();

    const finalMetrics = await getStageMetrics(page);
    expect(finalMetrics).not.toBeNull();
    expect(finalMetrics?.hostWidth).toBe(initialMetrics.hostWidth);
    expect(finalMetrics?.hostHeight).toBe(initialMetrics.hostHeight);
    expect(finalMetrics?.canvasWidth).toBe(initialMetrics.canvasWidth);
    expect(finalMetrics?.canvasHeight).toBe(initialMetrics.canvasHeight);
    expect(finalMetrics?.canvasCssWidth).toBe(initialMetrics.canvasCssWidth);
    expect(finalMetrics?.canvasCssHeight).toBe(initialMetrics.canvasCssHeight);
    expect(finalMetrics?.canvasVisibility).toBe('visible');
    expect(finalMetrics?.coversHostLeft).toBe(true);
    expect(finalMetrics?.coversHostTop).toBe(true);
    expect(finalMetrics?.coversHostRight).toBe(true);
    expect(finalMetrics?.coversHostBottom).toBe(true);
    expect(finalMetrics?.surfaceResizeCount).toBe(initialMetrics.surfaceResizeCount);
    expect(finalMetrics?.frozenFrameCount).toBe(0);
  });

  test('vertical stage resize updates the live viewport continuously without reallocating the surface', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    await waitForStageHost(page);
    await waitForStageToSettle(page);

    const initialMetrics = await getStageMetrics(page);
    expect(initialMetrics).not.toBeNull();
    if (!initialMetrics) {
      return;
    }

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
    await page.mouse.move(pointerX, pointerY + 120, { steps: 10 });

    await expect.poll(async () => getStageMetrics(page)).toMatchObject({
      canvasVisibility: 'visible',
      frozenFrameCount: 0,
    });

    await expect.poll(async () => {
      const metrics = await getStageMetrics(page);
      if (!metrics) {
        return null;
      }

      return {
        widthStable: metrics.hostWidth === initialMetrics.hostWidth,
        heightGrew: metrics.hostHeight - initialMetrics.hostHeight >= 40,
        surfaceStable: metrics.surfaceResizeCount === initialMetrics.surfaceResizeCount,
        coversHost: metrics.coversHostLeft && metrics.coversHostTop && metrics.coversHostRight && metrics.coversHostBottom,
        canvasVisibility: metrics.canvasVisibility,
        frozenFrameCount: metrics.frozenFrameCount,
      };
    }).toEqual({
      widthStable: true,
      heightGrew: true,
      surfaceStable: true,
      coversHost: true,
      canvasVisibility: 'visible',
      frozenFrameCount: 0,
    });

    const resolvedDragMetrics = await getStageMetrics(page);
    expect(resolvedDragMetrics).not.toBeNull();
    expect((resolvedDragMetrics?.hostHeight ?? 0) - initialMetrics.hostHeight).toBeGreaterThanOrEqual(40);
    expect(resolvedDragMetrics?.canvasWidth).toBe(initialMetrics.canvasWidth);
    expect(resolvedDragMetrics?.canvasHeight).toBe(initialMetrics.canvasHeight);
    expect(resolvedDragMetrics?.coversHostLeft).toBe(true);
    expect(resolvedDragMetrics?.coversHostTop).toBe(true);
    expect(resolvedDragMetrics?.coversHostRight).toBe(true);
    expect(resolvedDragMetrics?.coversHostBottom).toBe(true);
    expect(resolvedDragMetrics?.surfaceResizeCount).toBe(initialMetrics.surfaceResizeCount);

    await page.mouse.up();
    await waitForStageToSettle(page);

    const finalMetrics = await getStageMetrics(page);
    expect(finalMetrics).not.toBeNull();
    expect(finalMetrics?.canvasVisibility).toBe('visible');
    expect(finalMetrics?.frozenFrameCount).toBe(0);
    expect(finalMetrics?.canvasWidth).toBe(initialMetrics.canvasWidth);
    expect(finalMetrics?.canvasHeight).toBe(initialMetrics.canvasHeight);
    expect(finalMetrics?.coversHostLeft).toBe(true);
    expect(finalMetrics?.coversHostTop).toBe(true);
    expect(finalMetrics?.coversHostRight).toBe(true);
    expect(finalMetrics?.coversHostBottom).toBe(true);
    expect(finalMetrics?.surfaceResizeCount).toBe(initialMetrics.surfaceResizeCount);
  });

  test('horizontal editor split resize updates the live viewport continuously without reallocating the surface', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    await waitForStageHost(page);
    await waitForStageToSettle(page);

    const initialMetrics = await getStageMetrics(page);
    expect(initialMetrics).not.toBeNull();
    if (!initialMetrics) {
      return;
    }

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

    await expect.poll(async () => {
      const metrics = await getStageMetrics(page);
      if (!metrics) {
        return null;
      }

      return {
        heightStable: metrics.hostHeight === initialMetrics.hostHeight,
        widthGrew: metrics.hostWidth - initialMetrics.hostWidth >= 40,
        surfaceStable: metrics.surfaceResizeCount === initialMetrics.surfaceResizeCount,
        coversHost: metrics.coversHostLeft && metrics.coversHostTop && metrics.coversHostRight && metrics.coversHostBottom,
        canvasVisibility: metrics.canvasVisibility,
        frozenFrameCount: metrics.frozenFrameCount,
      };
    }).toEqual({
      heightStable: true,
      widthGrew: true,
      surfaceStable: true,
      coversHost: true,
      canvasVisibility: 'visible',
      frozenFrameCount: 0,
    });

    const resolvedDragMetrics = await getStageMetrics(page);
    expect(resolvedDragMetrics).not.toBeNull();
    expect((resolvedDragMetrics?.hostWidth ?? 0) - initialMetrics.hostWidth).toBeGreaterThanOrEqual(40);
    expect(resolvedDragMetrics?.canvasWidth).toBe(initialMetrics.canvasWidth);
    expect(resolvedDragMetrics?.canvasHeight).toBe(initialMetrics.canvasHeight);
    expect(resolvedDragMetrics?.coversHostLeft).toBe(true);
    expect(resolvedDragMetrics?.coversHostTop).toBe(true);
    expect(resolvedDragMetrics?.coversHostRight).toBe(true);
    expect(resolvedDragMetrics?.coversHostBottom).toBe(true);
    expect(resolvedDragMetrics?.surfaceResizeCount).toBe(initialMetrics.surfaceResizeCount);

    await page.mouse.up();
    await waitForStageToSettle(page);

    const finalMetrics = await getStageMetrics(page);
    expect(finalMetrics).not.toBeNull();
    expect(finalMetrics?.canvasVisibility).toBe('visible');
    expect(finalMetrics?.frozenFrameCount).toBe(0);
    expect(finalMetrics?.canvasWidth).toBe(initialMetrics.canvasWidth);
    expect(finalMetrics?.canvasHeight).toBe(initialMetrics.canvasHeight);
    expect(finalMetrics?.coversHostLeft).toBe(true);
    expect(finalMetrics?.coversHostTop).toBe(true);
    expect(finalMetrics?.coversHostRight).toBe(true);
    expect(finalMetrics?.coversHostBottom).toBe(true);
    expect(finalMetrics?.surfaceResizeCount).toBe(initialMetrics.surfaceResizeCount);
  });

  test('growing the stage reveals more live world area while keeping the center fixed', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Live Growth ${Date.now()}`,
    });

    await waitForStageHost(page);
    await waitForStageDebug(page);
    await page.evaluate(() => {
      window.__pochaStageDebug.setEditorViewport({ centerX: 432, centerY: 268, zoom: 0.5 });
    });
    await waitForStageToSettle(page);

    const before = await getCameraWorldView(page);
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
    await page.mouse.move(pointerX - 220, pointerY, { steps: 12 });

    await expect.poll(async () => getStageMetrics(page)).toMatchObject({
      canvasVisibility: 'visible',
      frozenFrameCount: 0,
    });

    await expect.poll(async () => {
      const during = await getCameraWorldView(page);
      return {
        centerXStable: Math.abs(during.centerX - before.centerX) <= 1e-6,
        centerYStable: Math.abs(during.centerY - before.centerY) <= 1e-6,
        widthGrew: during.width > before.width + 150,
        heightStable: Math.abs(during.height - before.height) <= 0.01,
      };
    }).toEqual({
      centerXStable: true,
      centerYStable: true,
      widthGrew: true,
      heightStable: true,
    });

    const during = await getCameraWorldView(page);
    expect(during.centerX).toBeCloseTo(before.centerX, 6);
    expect(during.centerY).toBeCloseTo(before.centerY, 6);
    expect(during.width).toBeGreaterThan(before.width + 150);
    expect(during.height).toBeCloseTo(before.height, 2);

    await page.mouse.up();
    await waitForStageToSettle(page);

    const after = await getCameraWorldView(page);
    expect(after.centerX).toBeCloseTo(before.centerX, 6);
    expect(after.centerY).toBeCloseTo(before.centerY, 6);
    expect(after.width).toBeGreaterThan(before.width + 150);
  });

  test('tiled background stays on the cached live surface during stage resize drags', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Background Live Resize ${Date.now()}`,
    });

    await waitForStageHost(page);
    await waitForStageDebug(page);
    await enableDenseTiledBackground(page);
    await waitForStageToSettle(page);
    await waitForTiledBackgroundToSettle(page);

    const initialMetrics = await getStageMetrics(page);
    expect(initialMetrics).not.toBeNull();
    if (!initialMetrics) {
      return;
    }

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

    await expect.poll(async () => {
      const metrics = await getStageMetrics(page);
      if (!metrics) {
        return null;
      }

      return {
        widthGrew: metrics.hostWidth - initialMetrics.hostWidth >= 40,
        backgroundStable: metrics.tiledBackgroundRenderCount - initialMetrics.tiledBackgroundRenderCount <= 1,
        surfaceStable: metrics.surfaceResizeCount === initialMetrics.surfaceResizeCount,
      };
    }).toEqual({
      widthGrew: true,
      backgroundStable: true,
      surfaceStable: true,
    });

    await page.mouse.up();
  });
});
