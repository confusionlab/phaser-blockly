import { expect, test } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function openEditorFromProjectList(page: import('@playwright/test').Page): Promise<void> {
  await bootstrapEditorProject(page, { projectName: `Stage Resize Test ${Date.now()}` });
}

async function waitForStageDebug(page: import('@playwright/test').Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean(window['__pochaStageDebug']))).toBe(true);
}

test.describe('Stage resize', () => {
  test.describe('Frozen frame fidelity', () => {
    test.use({
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: 2,
    });

    test('overscanned frozen frame uses a higher internal pixel density than its CSS size', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await openEditorFromProjectList(page);

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

      await expect.poll(async () => {
        return page.evaluate(() => {
          const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
          if (!(frozen instanceof HTMLCanvasElement)) {
            return null;
          }

          const rect = frozen.getBoundingClientRect();
          return {
            pixelWidth: frozen.width,
            cssWidth: rect.width,
            pixelHeight: frozen.height,
            cssHeight: rect.height,
          };
        });
      }).toMatchObject({
        pixelWidth: expect.any(Number),
        cssWidth: expect.any(Number),
        pixelHeight: expect.any(Number),
        cssHeight: expect.any(Number),
      });

      const fidelitySnapshot = await page.evaluate(() => {
        const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
        if (!(frozen instanceof HTMLCanvasElement)) {
          return null;
        }
        const rect = frozen.getBoundingClientRect();
        return {
          widthRatio: frozen.width / Math.max(1, rect.width),
          heightRatio: frozen.height / Math.max(1, rect.height),
        };
      });

      expect(fidelitySnapshot).not.toBeNull();
      expect(fidelitySnapshot?.widthRatio ?? 0).toBeGreaterThan(1.5);
      expect(fidelitySnapshot?.heightRatio ?? 0).toBeGreaterThan(1.5);

      await page.mouse.up();
      await expect(page.getByTestId('stage-frozen-frame')).toBeHidden();
    });
  });

  test('bottom panel split drag does not freeze or resize the stage', async ({ page }) => {
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
        visibility: window.getComputedStyle(canvas).visibility,
      };
    });

    const divider = page.getByTestId('stage-panel-horizontal-divider');
    const dividerBox = await divider.boundingBox();
    expect(dividerBox).not.toBeNull();

    if (!dividerBox || !initialMetrics) {
      return;
    }

    const pointerX = dividerBox.x + dividerBox.width / 2;
    const pointerY = dividerBox.y + dividerBox.height / 2;
    await page.mouse.move(pointerX, pointerY);
    await page.mouse.down();
    await page.mouse.move(pointerX + 140, pointerY, { steps: 12 });

    await expect(page.getByTestId('stage-frozen-frame')).toHaveCount(0);

    const dragState = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="stage-phaser-host"] canvas');
      const divider = document.querySelector('[data-testid="stage-panel-horizontal-divider"]');
      if (!(canvas instanceof HTMLCanvasElement) || !(divider instanceof HTMLElement)) {
        return null;
      }

      return {
        width: canvas.width,
        height: canvas.height,
        visibility: window.getComputedStyle(canvas).visibility,
        dividerDragging: divider.getAttribute('data-dragging'),
      };
    });

    expect(dragState).not.toBeNull();
    expect(dragState?.width).toBe(initialMetrics.width);
    expect(dragState?.height).toBe(initialMetrics.height);
    expect(dragState?.visibility).toBe('visible');
    expect(dragState?.dividerDragging).toBe('true');

    await page.mouse.up();
    await expect(page.getByTestId('stage-frozen-frame')).toHaveCount(0);

    const finalMetrics = await canvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      return {
        width: canvas.width,
        height: canvas.height,
        visibility: window.getComputedStyle(canvas).visibility,
      };
    });

    expect(finalMetrics.width).toBe(initialMetrics.width);
    expect(finalMetrics.height).toBe(initialMetrics.height);
    expect(finalMetrics.visibility).toBe('visible');
  });

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

  test('horizontal resize drag overscan reveals newly exposed object content', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Resize Overscan ${Date.now()}`,
      addObject: true,
    });

    await waitForStageDebug(page);

    const initialHostBox = await page.getByTestId('stage-phaser-host').boundingBox();
    expect(initialHostBox).not.toBeNull();
    if (!initialHostBox) {
      return;
    }

    const centerX = 400;
    const centerY = 300;
    const objectX = (initialHostBox.width / 2) + 120;
    const objectY = 0;

    await page.evaluate(async ({ objectX, objectY, centerX, centerY }) => {
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      const projectState = useProjectStore.getState();
      const project = projectState.project;
      const sceneId = project?.scenes[0]?.id;
      const objectId = project?.scenes[0]?.objects[0]?.id;
      if (!sceneId || !objectId) {
        throw new Error('Resize overscan object is unavailable.');
      }

      projectState.updateObject(sceneId, objectId, { x: objectX, y: objectY });
      window.__pochaStageDebug.setEditorViewport({ centerX, centerY, zoom: 1 });
    }, { objectX, objectY, centerX, centerY });

    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });

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
    await page.mouse.move(pointerX + 220, pointerY, { steps: 10 });
    await expect(page.getByTestId('stage-frozen-frame')).toBeVisible();

    await expect.poll(async () => {
      return page.evaluate(({ objectX, objectY }) => {
        const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
        if (!(frozen instanceof HTMLCanvasElement)) {
          return null;
        }

        const ctx = frozen.getContext('2d');
        if (!ctx) {
          return null;
        }

        const frozenRect = frozen.getBoundingClientRect();
        const frozenCenterX = frozenRect.left + frozenRect.width / 2;
        const frozenCenterY = frozenRect.top + frozenRect.height / 2;
        const objectClientX = frozenCenterX + objectX;
        const objectClientY = frozenCenterY - objectY;
        const localX = ((objectClientX - frozenRect.left) / frozenRect.width) * frozen.width;
        const localY = ((objectClientY - frozenRect.top) / frozenRect.height) * frozen.height;
        const sampleOffsets = [-6, 0, 6];
        const backgroundPixel = '135,206,235,255';

        for (const offsetY of sampleOffsets) {
          for (const offsetX of sampleOffsets) {
            const pixel = ctx.getImageData(
              Math.max(0, Math.min(frozen.width - 1, Math.floor(localX + offsetX))),
              Math.max(0, Math.min(frozen.height - 1, Math.floor(localY + offsetY))),
              1,
              1,
            ).data;

            if (Array.from(pixel).join(',') !== backgroundPixel) {
              return true;
            }
          }
        }

        return false;
      }, { objectX, objectY });
    }).toBe(true);

    await page.mouse.up();
  });

  test('horizontal resize drag keeps tiled background visible in the frozen frame', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Resize Background ${Date.now()}`,
    });

    await waitForStageDebug(page);

    await page.evaluate(async () => {
      const [
        { useProjectStore },
        { buildTiledBackgroundConfig },
        { decodeBackgroundChunkImage },
      ] = await Promise.all([
        import('/src/store/projectStore.ts'),
        import('/src/lib/background/chunkStore.ts'),
        import('/src/lib/background/chunkImageCache.ts'),
      ]);

      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to create a background chunk canvas.');
      }
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const chunkSource = canvas.toDataURL('image/png');
      await decodeBackgroundChunkImage(chunkSource);

      const projectState = useProjectStore.getState();
      const project = projectState.project;
      const sceneId = project?.scenes[0]?.id;
      if (!sceneId) {
        throw new Error('Resize background scene is unavailable.');
      }

      const background = buildTiledBackgroundConfig(
        { '0,0': chunkSource },
        { chunkSize: 64, baseColor: '#000000' },
      );
      projectState.updateScene(sceneId, { background });
      window.__pochaStageDebug.setEditorViewport({ centerX: 432, centerY: 268, zoom: 0.5 });
    });

    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });

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
    await page.mouse.move(pointerX + 220, pointerY, { steps: 10 });
    await expect(page.getByTestId('stage-frozen-frame')).toBeVisible();

    await expect.poll(async () => {
      return page.evaluate(() => {
        const frozen = document.querySelector('[data-testid="stage-frozen-frame"]');
        if (!(frozen instanceof HTMLCanvasElement)) {
          return null;
        }

        const ctx = frozen.getContext('2d');
        if (!ctx) {
          return null;
        }

        const centerX = Math.floor(frozen.width / 2);
        const centerY = Math.floor(frozen.height / 2);
        const pixel = ctx.getImageData(centerX, centerY, 1, 1).data;
        return {
          r: pixel[0],
          g: pixel[1],
          b: pixel[2],
        };
      });
    }).toMatchObject({
      r: 255,
      g: 0,
      b: 0,
    });

    await page.mouse.up();
  });
});
