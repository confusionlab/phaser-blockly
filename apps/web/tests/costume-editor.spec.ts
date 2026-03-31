import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

const COSTUME_EDITOR_TEST_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

async function openEditorFromProjectList(page: Page): Promise<void> {
  await bootstrapEditorProject(page, { projectName: `Costume Test ${Date.now()}` });
}

async function openCostumeEditor(page: Page): Promise<void> {
  await openEditorFromProjectList(page);

  await page.getByRole('button', { name: /add object/i }).click();
  const costumeTab = page.getByRole('radio', { name: /^costume$/i });
  await expect(costumeTab).toBeVisible({ timeout: 10000 });
  await costumeTab.click();

  await expect(page.getByTestId('layer-add-button')).toBeVisible({ timeout: 10000 });
  await waitForCostumeCanvasReady(page);
}

async function addVectorLayer(page: Page): Promise<void> {
  await page.getByTestId('layer-add-button').click();
  await page.getByRole('menuitem', { name: /^vector$/i }).click();
}

async function addBitmapLayer(page: Page): Promise<void> {
  await page.getByTestId('layer-add-button').click();
  await page.getByRole('menuitem', { name: /^pixel$/i }).click();
}

async function getCostumeCanvasBox(page: Page) {
  const canvasSurface = page.getByTestId('costume-canvas-surface');
  await expect(canvasSurface).toBeVisible();
  const box = await canvasSurface.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error('Costume canvas surface is missing a bounding box.');
  }
  return box;
}

async function drawAcrossCostumeCanvas(page: Page, startXFactor: number, startYFactor: number, endXFactor: number, endYFactor: number) {
  const box = await getCostumeCanvasBox(page);
  const startX = box.x + box.width * startXFactor;
  const startY = box.y + box.height * startYFactor;
  const endX = box.x + box.width * endXFactor;
  const endY = box.y + box.height * endYFactor;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();
}

async function selectBitmapBrushKind(page: Page, label: 'Hard' | 'Soft' | 'Crayon') {
  await page.getByRole('button', { name: /^(Hard|Soft|Crayon)$/i }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${label}$`, 'i') }).click();
}

async function setBrushColorOpacity(page: Page, opacityPercent: number): Promise<void> {
  const colorButton = page.getByTestId('costume-toolbar-properties').getByRole('button', { name: /^color$/i });
  await colorButton.click();
  const slider = page.getByTestId('compact-color-picker-opacity').getByRole('slider');
  await expect(slider).toBeVisible();
  await slider.focus();

  const targetOpacity = Math.max(0, Math.min(100, Math.round(opacityPercent)));
  if (targetOpacity <= 50) {
    await slider.press('Home');
    for (let index = 0; index < targetOpacity; index += 1) {
      await slider.press('ArrowRight');
    }
  } else {
    await slider.press('End');
    for (let index = targetOpacity; index < 100; index += 1) {
      await slider.press('ArrowLeft');
    }
  }
  await expect(slider).toHaveAttribute('aria-valuenow', String(targetOpacity));
  await colorButton.click();
}

async function clickCostumeCanvas(page: Page, xFactor: number, yFactor: number) {
  const box = await getCostumeCanvasBox(page);
  const targetX = box.x + box.width * xFactor;
  const targetY = box.y + box.height * yFactor;
  await page.mouse.move(targetX, targetY);
  await page.mouse.down();
  await page.mouse.up();
}

async function expectLayerThumbnail(button: Locator): Promise<void> {
  const thumbnailImage = button.getByTestId('costume-layer-thumbnail').locator('img');
  await expect.poll(async () => {
    if (await thumbnailImage.count() === 0) {
      return '';
    }
    return await thumbnailImage.first().getAttribute('src');
  }, { timeout: 10000 }).toMatch(/^data:image\/png;base64,/);
}

async function startLayerThumbnailVisibilityObserver(button: Locator, observerKey: string): Promise<void> {
  await button.evaluate((element, key) => {
    const thumbnail = element.querySelector('[data-testid="costume-layer-thumbnail"]');
    if (!(thumbnail instanceof HTMLElement)) {
      throw new Error('Layer thumbnail container not found.');
    }

    const store = ((window as any).__costumeLayerThumbnailObservers ??= {});
    const entry: { observer?: MutationObserver; sawMissing: boolean } = {
      sawMissing: !thumbnail.querySelector('img'),
    };
    const observer = new MutationObserver(() => {
      entry.sawMissing = entry.sawMissing || !thumbnail.querySelector('img');
    });
    observer.observe(thumbnail, {
      childList: true,
      subtree: true,
    });
    entry.observer = observer;
    store[key] = entry;
  }, observerKey);
}

async function stopLayerThumbnailVisibilityObserver(button: Locator, observerKey: string): Promise<boolean> {
  return await button.evaluate((element, key) => {
    const store = (window as any).__costumeLayerThumbnailObservers ?? {};
    const entry = store[key] as { observer?: MutationObserver; sawMissing?: boolean } | undefined;
    entry?.observer?.disconnect();
    delete store[key];

    const thumbnail = element.querySelector('[data-testid="costume-layer-thumbnail"]');
    const isMissingNow = thumbnail instanceof HTMLElement
      ? !thumbnail.querySelector('img')
      : true;
    return Boolean(entry?.sawMissing) || isMissingNow;
  }, observerKey);
}

async function readLayerPanelWidth(page: Page): Promise<number> {
  return await page.getByTestId('layer-panel').evaluate((element) => {
    return Math.round((element as HTMLElement).getBoundingClientRect().width);
  });
}

async function readActiveCostumeLayerOpacity(page: Page): Promise<number | null> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project as {
      scenes?: Array<{
        objects?: Array<{
          currentCostumeIndex?: number;
          costumes?: Array<{
            document?: {
              activeLayerId?: string;
              layers?: Array<{ id: string; opacity?: number }>;
            };
          }>;
        }>;
      }>;
    } | null;

    const object = project?.scenes?.[0]?.objects?.[0];
    const costume = object?.costumes?.[object?.currentCostumeIndex ?? 0];
    const activeLayerId = costume?.document?.activeLayerId;
    const activeLayer = costume?.document?.layers?.find((layer) => layer.id === activeLayerId);
    return typeof activeLayer?.opacity === 'number' ? activeLayer.opacity : null;
  });
}

async function setActiveLayerOpacity(page: Page, opacityPercent: number): Promise<void> {
  await page.locator('[data-testid="layer-row"][aria-pressed="true"]').click({ button: 'right' });
  const slider = page.getByLabel('Layer opacity');
  await expect(slider).toBeVisible();
  await slider.evaluate((input, nextValue) => {
    const slider = input as HTMLInputElement;
    slider.value = String(nextValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }, opacityPercent);
  await page.keyboard.press('Escape');
}

async function startLayerSelectionObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const readButtons = () => Array.from(
      document.querySelectorAll('[data-testid="layer-row"][aria-pressed]'),
    ).map((button) => ({
      label: button.getAttribute('aria-label') ?? button.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      pressed: button.getAttribute('aria-pressed') === 'true',
    }));

    const previousObserver = (window as typeof window & {
      __costumeLayerSelectionObserver?: MutationObserver;
    }).__costumeLayerSelectionObserver;
    previousObserver?.disconnect();

    (window as typeof window & {
      __costumeLayerSelectionTimeline?: Array<Array<{ label: string; pressed: boolean }>>;
    }).__costumeLayerSelectionTimeline = [readButtons()];

    const observer = new MutationObserver(() => {
      (window as typeof window & {
        __costumeLayerSelectionTimeline?: Array<Array<{ label: string; pressed: boolean }>>;
      }).__costumeLayerSelectionTimeline?.push(readButtons());
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-pressed'],
    });
    (window as typeof window & {
      __costumeLayerSelectionObserver?: MutationObserver;
    }).__costumeLayerSelectionObserver = observer;
  });
}

async function stopLayerSelectionObserver(page: Page) {
  return await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __costumeLayerSelectionObserver?: MutationObserver;
      __costumeLayerSelectionTimeline?: Array<Array<{ label: string; pressed: boolean }>>;
    };
    runtimeWindow.__costumeLayerSelectionObserver?.disconnect();
    delete runtimeWindow.__costumeLayerSelectionObserver;
    return runtimeWindow.__costumeLayerSelectionTimeline ?? [];
  });
}

async function waitForCostumeCanvasReady(page: Page): Promise<void> {
  const activeLayerVisual = page.getByTestId('costume-active-layer-visual');
  await expect(activeLayerVisual).toBeVisible({ timeout: 10000 });
  await expect(activeLayerVisual).toHaveAttribute('data-host-ready', 'true', { timeout: 10000 });
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const host = document.querySelector('[data-testid="costume-active-layer-host"]');
      if (!(host instanceof HTMLElement)) {
        return false;
      }

      const fabricCanvas = host.querySelector('canvas');
      return fabricCanvas instanceof HTMLCanvasElement && fabricCanvas.width > 0 && fabricCanvas.height > 0;
    });
  }, { timeout: 10000 }).toBe(true);
}

async function roundTripThroughCodeTab(page: Page): Promise<void> {
  await page.getByRole('radio', { name: /^code$/i }).click();
  await page.getByRole('radio', { name: /^costume$/i }).click();
  await waitForCostumeCanvasReady(page);
}

async function readCheckerboardInkSamples(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('[data-testid="costume-canvas-surface"] canvas')) as HTMLCanvasElement[];
    let opaqueSamples = 0;

    for (const canvas of canvases) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        continue;
      }

      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 3; index < data.length; index += 4 * 97) {
        if ((data[index] ?? 0) > 0) {
          opaqueSamples += 1;
        }
      }
    }

    return opaqueSamples;
  });
}

async function readHostedLayerInkSamples(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hostedCanvas = document.querySelector('[data-testid="costume-active-layer-host"] .lower-canvas');
    if (!(hostedCanvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const ctx = hostedCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    const { data } = ctx.getImageData(0, 0, hostedCanvas.width, hostedCanvas.height);
    let opaqueSamples = 0;
    for (let index = 3; index < data.length; index += 4 * 193) {
      if ((data[index] ?? 0) > 0) {
        opaqueSamples += 1;
      }
    }

    return opaqueSamples;
  });
}

async function readHostedLayerMaxAlpha(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hostedCanvas = document.querySelector('[data-testid="costume-active-layer-host"] .lower-canvas');
    if (!(hostedCanvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const ctx = hostedCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    const { data } = ctx.getImageData(0, 0, hostedCanvas.width, hostedCanvas.height);
    let maxAlpha = 0;
    for (let index = 3; index < data.length; index += 4) {
      const alpha = data[index] ?? 0;
      if (alpha > maxAlpha) {
        maxAlpha = alpha;
      }
    }

    return maxAlpha;
  });
}

async function readPreviewLayerMaxAlpha(page: Page): Promise<number> {
  return page.evaluate(() => {
    const previewCanvas = document.querySelector('[data-testid="costume-active-layer-host"] .upper-canvas');
    if (!(previewCanvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    const { data } = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    let maxAlpha = 0;
    for (let index = 3; index < data.length; index += 4) {
      const alpha = data[index] ?? 0;
      if (alpha > maxAlpha) {
        maxAlpha = alpha;
      }
    }

    return maxAlpha;
  });
}

async function observeVisibleHostedLayerInkTimeline(page: Page, frameCount = 36): Promise<number[]> {
  return await page.evaluate((frames) => {
    return new Promise<number[]>((resolve) => {
      const lowerCanvas = document.querySelector('[data-testid="costume-active-layer-host"] .lower-canvas');
      const upperCanvas = document.querySelector('[data-testid="costume-active-layer-host"] .upper-canvas');
      if (!(lowerCanvas instanceof HTMLCanvasElement)) {
        resolve([]);
        return;
      }

      const sampleCanvas = (canvas: HTMLCanvasElement | null): number => {
        if (!canvas) {
          return 0;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return 0;
        }

        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let opaqueSamples = 0;
        for (let index = 3; index < data.length; index += 4 * 193) {
          if ((data[index] ?? 0) > 0) {
            opaqueSamples += 1;
          }
        }
        return opaqueSamples;
      };

      const timeline: number[] = [];
      const captureFrame = () => {
        const lowerHidden = lowerCanvas.style.opacity === '0';
        const visibleCanvas = lowerHidden && upperCanvas instanceof HTMLCanvasElement
          ? upperCanvas
          : lowerCanvas;
        timeline.push(sampleCanvas(visibleCanvas));
        if (timeline.length >= frames) {
          resolve(timeline);
          return;
        }
        window.requestAnimationFrame(captureFrame);
      };

      window.requestAnimationFrame(captureFrame);
    });
  }, frameCount);
}

async function readCurrentCostumeDocumentSignature(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const scene = project?.scenes?.[0];
    const object = scene?.objects?.[0];
    const currentCostumeIndex = object?.currentCostumeIndex ?? 0;
    const document = object?.costumes?.[currentCostumeIndex]?.document;
    return document ? JSON.stringify(document) : null;
  });
}

test.describe('Costume editor tools', () => {
  test('vector layers render shapes and reload cleanly after a tab round-trip', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await expect(page.getByRole('button', { name: /^layer 2/i })).toBeVisible({ timeout: 10000 });
    await waitForCostumeCanvasReady(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();

    const beforeSamples = await readCheckerboardInkSamples(page);

    await drawAcrossCostumeCanvas(page, 0.18, 0.18, 0.42, 0.38);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);

    await roundTripThroughCodeTab(page);

    await expect(page.getByRole('button', { name: /^layer 2/i })).toBeVisible({ timeout: 10000 });
    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
  });

  test('bitmap tools paint on the active layer and survive a tab round-trip', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^brush$/i }).click();

    const beforeSamples = await readCheckerboardInkSamples(page);

    await drawAcrossCostumeCanvas(page, 0.22, 0.22, 0.40, 0.40);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);

    await roundTripThroughCodeTab(page);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('hard bitmap brush preview honors stroke opacity before commit', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await page.getByRole('button', { name: /new blank costume/i }).click();
    await addBitmapLayer(page);
    await waitForCostumeCanvasReady(page);

    await page.getByRole('button', { name: /^brush$/i }).click();
    await selectBitmapBrushKind(page, 'Hard');
    await setBrushColorOpacity(page, 35);

    const box = await getCostumeCanvasBox(page);
    const startX = box.x + box.width * 0.24;
    const startY = box.y + box.height * 0.28;
    const endX = box.x + box.width * 0.56;
    const endY = box.y + box.height * 0.28;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 12 });

    await expect.poll(async () => readPreviewLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(70);
    const previewAlpha = await readPreviewLayerMaxAlpha(page);
    expect(previewAlpha).toBeLessThan(110);

    await page.mouse.up();
  });

  test('bitmap textured brush commits on mouse-up and survives a tab round-trip', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^brush$/i }).click();
    await selectBitmapBrushKind(page, 'Crayon');

    const beforeSamples = await readCheckerboardInkSamples(page);

    await drawAcrossCostumeCanvas(page, 0.22, 0.22, 0.40, 0.40);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);

    await roundTripThroughCodeTab(page);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('hard bitmap brush commit preserves stroke opacity', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await page.getByRole('button', { name: /new blank costume/i }).click();
    await addBitmapLayer(page);
    await waitForCostumeCanvasReady(page);

    await page.getByRole('button', { name: /^brush$/i }).click();
    await selectBitmapBrushKind(page, 'Hard');
    await setBrushColorOpacity(page, 35);

    await drawAcrossCostumeCanvas(page, 0.24, 0.3, 0.54, 0.3);

    await expect.poll(async () => readHostedLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(70);
    const alphaAfterCommit = await readHostedLayerMaxAlpha(page);
    expect(alphaAfterCommit).toBeGreaterThan(70);
    expect(alphaAfterCommit).toBeLessThan(110);

    await roundTripThroughCodeTab(page);

    await expect.poll(async () => readHostedLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(70);
    const alphaAfterRoundTrip = await readHostedLayerMaxAlpha(page);
    expect(Math.abs(alphaAfterRoundTrip - alphaAfterCommit)).toBeLessThanOrEqual(6);

    await drawAcrossCostumeCanvas(page, 0.24, 0.3, 0.54, 0.3);
    await expect.poll(async () => readHostedLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(alphaAfterCommit + 30);
    const alphaAfterSecondStroke = await readHostedLayerMaxAlpha(page);
    expect(alphaAfterSecondStroke).toBeGreaterThan(alphaAfterCommit + 30);
  });

  test('soft bitmap brush uses opacity per stroke instead of flow accumulation', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);
    await page.getByRole('button', { name: /new blank costume/i }).click();
    await addBitmapLayer(page);
    await waitForCostumeCanvasReady(page);

    await page.getByRole('button', { name: /^brush$/i }).click();
    await selectBitmapBrushKind(page, 'Soft');
    await setBrushColorOpacity(page, 35);

    await drawAcrossCostumeCanvas(page, 0.24, 0.36, 0.54, 0.36);

    await expect.poll(async () => readHostedLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(70);
    const alphaAfterFirstStroke = await readHostedLayerMaxAlpha(page);
    expect(alphaAfterFirstStroke).toBeGreaterThan(70);
    expect(alphaAfterFirstStroke).toBeLessThan(110);

    await drawAcrossCostumeCanvas(page, 0.24, 0.36, 0.54, 0.36);

    await expect.poll(async () => readHostedLayerMaxAlpha(page), { timeout: 10000 }).toBeGreaterThan(alphaAfterFirstStroke + 30);
    const alphaAfterSecondStroke = await readHostedLayerMaxAlpha(page);
    expect(alphaAfterSecondStroke).toBeGreaterThan(alphaAfterFirstStroke + 30);
  });

  test('bitmap shapes commit on the active layer and survive a tab round-trip', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();

    const beforeSamples = await readCheckerboardInkSamples(page);

    await drawAcrossCostumeCanvas(page, 0.22, 0.22, 0.44, 0.42);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);

    await roundTripThroughCodeTab(page);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('rapid bitmap eraser strokes preserve committed layer state across a tab round-trip', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.16, 0.16, 0.60, 0.60);
    const beforeEraseSamples = await readCheckerboardInkSamples(page);
    expect(beforeEraseSamples).toBeGreaterThan(0);

    await page.getByRole('button', { name: /^eraser$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.20, 0.20, 0.56, 0.20);
    await drawAcrossCostumeCanvas(page, 0.20, 0.30, 0.56, 0.30);
    await drawAcrossCostumeCanvas(page, 0.20, 0.40, 0.56, 0.40);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeLessThan(beforeEraseSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);

    await roundTripThroughCodeTab(page);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeLessThan(beforeEraseSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('eraser commit does not flash back to the stale hosted layer image', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.16, 0.16, 0.60, 0.60);
    const beforeEraseSamples = await readHostedLayerInkSamples(page);
    expect(beforeEraseSamples).toBeGreaterThan(0);

    await page.getByRole('button', { name: /^eraser$/i }).click();
    const timelinePromise = observeVisibleHostedLayerInkTimeline(page);
    await drawAcrossCostumeCanvas(page, 0.20, 0.30, 0.56, 0.30);
    const timeline = await timelinePromise;

    const finalHostedSamples = await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeLessThan(beforeEraseSamples).then(async () => {
      return await readHostedLayerInkSamples(page);
    });

    expect(timeline.length).toBeGreaterThan(0);
    const settleThreshold = finalHostedSamples + 2;
    const reboundThreshold = finalHostedSamples + Math.max(6, Math.floor((beforeEraseSamples - finalHostedSamples) * 0.45));
    const firstSettledIndex = timeline.findIndex((value) => value <= settleThreshold);
    const reboundDetected = firstSettledIndex >= 0
      && timeline.slice(firstSettledIndex + 1).some((value) => value >= reboundThreshold);

    expect(reboundDetected).toBe(false);
  });

  test('rapid bitmap stroke undo and redo keep editor and persisted costume state aligned', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const undoButton = page.getByRole('button', { name: /^undo$/i });
    const redoButton = page.getByRole('button', { name: /^redo$/i });

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.16, 0.16, 0.64, 0.64);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
    await expect(undoButton).toBeEnabled({ timeout: 10000 });
    const baseSamples = await readCheckerboardInkSamples(page);
    await expect.poll(async () => !!(await readCurrentCostumeDocumentSignature(page)), { timeout: 10000 }).toBe(true);
    const baseDocumentSignature = await readCurrentCostumeDocumentSignature(page);
    expect(baseDocumentSignature).toBeTruthy();

    await page.getByRole('button', { name: /^eraser$/i }).click();
    for (const yFactor of [0.24, 0.34, 0.44, 0.54]) {
      await drawAcrossCostumeCanvas(page, 0.20, yFactor, 0.60, yFactor);
    }

    let undoCount = 0;
    for (let index = 0; index < 10; index += 1) {
      const currentSignature = await readCurrentCostumeDocumentSignature(page);
      const currentSamples = await readCheckerboardInkSamples(page);
      if (currentSignature === baseDocumentSignature && currentSamples === baseSamples) {
        break;
      }
      if (!await undoButton.isEnabled()) {
        break;
      }
      await undoButton.click();
      undoCount += 1;
      await expect.poll(async () => {
        const nextSignature = await readCurrentCostumeDocumentSignature(page);
        const nextSamples = await readCheckerboardInkSamples(page);
        return nextSignature !== currentSignature || nextSamples !== currentSamples;
      }, { timeout: 10000 }).toBe(true);
    }
    expect(undoCount).toBeGreaterThan(0);

    await expect.poll(async () => readCurrentCostumeDocumentSignature(page), { timeout: 10000 }).toBe(baseDocumentSignature);
    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBe(baseSamples);

    let redoCount = 0;
    for (let index = 0; index < undoCount; index += 1) {
      await expect(redoButton).toBeEnabled({ timeout: 10000 });
      const currentSignature = await readCurrentCostumeDocumentSignature(page);
      const currentSamples = await readCheckerboardInkSamples(page);
      await redoButton.click();
      redoCount += 1;
      await expect.poll(async () => {
        const nextSignature = await readCurrentCostumeDocumentSignature(page);
        const nextSamples = await readCheckerboardInkSamples(page);
        return nextSignature !== currentSignature || nextSamples !== currentSamples;
      }, { timeout: 10000 }).toBe(true);
    }
    expect(redoCount).toBe(undoCount);

    await expect.poll(async () => (await readCurrentCostumeDocumentSignature(page)) !== baseDocumentSignature, { timeout: 10000 }).toBe(true);
    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeLessThan(baseSamples);
    await expect(redoButton).toBeDisabled({ timeout: 10000 });
  });

  test('active hosted layer stays visible after switching away from and back to the costume tab', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^brush$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.18, 0.18, 0.36, 0.34);

    await addVectorLayer(page);
    const vectorLayerButton = page.getByRole('button', { name: /^layer 2 vector$/i });
    const bitmapLayerButton = page.getByRole('button', { name: /^layer 1 bitmap$/i });
    await expect(vectorLayerButton).toBeVisible({ timeout: 10000 });
    await waitForCostumeCanvasReady(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.54, 0.28, 0.80, 0.54);

    await bitmapLayerButton.click();
    await waitForCostumeCanvasReady(page);
    await vectorLayerButton.click();
    await waitForCostumeCanvasReady(page);

    const hostedSamplesBefore = await readHostedLayerInkSamples(page);
    expect(hostedSamplesBefore).toBeGreaterThan(0);

    await roundTripThroughCodeTab(page);

    await expect(vectorLayerButton).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0);
  });

  test('bitmap select stays on the explicit layer and does not auto-switch from canvas clicks', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await expect(page.getByRole('button', { name: /box select/i })).toHaveCount(0);

    await addVectorLayer(page);
    await expect(page.getByRole('button', { name: /^layer 2/i })).toBeVisible({ timeout: 10000 });
    await waitForCostumeCanvasReady(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.56, 0.30, 0.80, 0.58);

    const layer2Button = page.getByRole('button', { name: /^layer 2 vector$/i });
    const layer1Button = page.getByRole('button', { name: /^layer 1 bitmap$/i });
    await expect(layer2Button).toHaveAttribute('aria-pressed', 'true');

    await layer1Button.click();
    await waitForCostumeCanvasReady(page);
    await page.getByRole('button', { name: /^select$/i }).click();
    await expect(layer1Button).toHaveAttribute('aria-pressed', 'true');
    await expect(layer2Button).toHaveAttribute('aria-pressed', 'false');

    await clickCostumeCanvas(page, 0.68, 0.44);

    await expect(layer1Button).toHaveAttribute('aria-pressed', 'true');
    await expect(layer2Button).toHaveAttribute('aria-pressed', 'false');
  });

  test('layer panel renders thumbnails for bitmap and vector layers', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const bitmapLayerButton = page.getByRole('button', { name: /^layer 1 bitmap$/i });
    await page.getByRole('button', { name: /^brush$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.18, 0.18, 0.36, 0.34);
    await expectLayerThumbnail(bitmapLayerButton);

    await addVectorLayer(page);
    const vectorLayerButton = page.getByRole('button', { name: /^layer 2 vector$/i });
    await expect(vectorLayerButton).toBeVisible({ timeout: 10000 });
    await waitForCostumeCanvasReady(page);
    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.54, 0.28, 0.80, 0.54);
    await expectLayerThumbnail(vectorLayerButton);
  });

  test('layer thumbnail stays visible while a bitmap layer thumbnail refreshes', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const bitmapLayerButton = page.getByRole('button', { name: /^layer 1 bitmap$/i });
    await page.getByRole('button', { name: /^brush$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.18, 0.18, 0.36, 0.34);
    await expectLayerThumbnail(bitmapLayerButton);

    const observerKey = `bitmap-layer-thumbnail-${Date.now()}`;
    await startLayerThumbnailVisibilityObserver(bitmapLayerButton, observerKey);
    await drawAcrossCostumeCanvas(page, 0.38, 0.22, 0.60, 0.40);
    await expectLayerThumbnail(bitmapLayerButton);

    expect(await stopLayerThumbnailVisibilityObserver(bitmapLayerButton, observerKey)).toBe(false);
  });

  test('newly created layer becomes active without an intermediate old-selection frame', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await startLayerSelectionObserver(page);
    await addVectorLayer(page);

    const layer2Button = page.getByRole('button', { name: /^layer 2 vector$/i });
    const layer1Button = page.getByRole('button', { name: /^layer 1 bitmap$/i });
    await expect(layer2Button).toHaveAttribute('aria-pressed', 'true');
    await expect(layer1Button).toHaveAttribute('aria-pressed', 'false');

    const timeline = await stopLayerSelectionObserver(page);
    const invalidSnapshot = timeline.find((snapshot) => {
      const layer1 = snapshot.find((entry) => /^layer 1 bitmap$/i.test(entry.label));
      const layer2 = snapshot.find((entry) => /^layer 2 vector$/i.test(entry.label));
      return !!layer2 && (layer2.pressed !== true || layer1?.pressed === true);
    });

    expect(invalidSnapshot).toBeUndefined();
  });

  test('shared layer hover keeps visibility toggle and inline rename interactive', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const layerRow = page.locator('[data-testid="layer-row"]').first();
    await page.getByTestId('layer-add-button').hover();

    const visibilityButton = layerRow.getByRole('button', { name: /^hide layer$/i });
    await expect(visibilityButton).toBeVisible();
    await visibilityButton.click();
    await expect(layerRow.getByRole('button', { name: /^show layer$/i })).toBeVisible();

    await layerRow.getByText(/^Layer 1$/i).dblclick();
    const renameInput = layerRow.locator('input');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('Sketch Layer');
    await renameInput.press('Enter');

    await expect(layerRow).toHaveAttribute('data-layer-name', 'Sketch Layer');
    await expect(page.getByRole('button', { name: /^sketch layer bitmap$/i })).toBeVisible();
  });

  test('leaving the layer rail dismisses hover unless the context menu is open', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const layerRow = page.locator('[data-testid="layer-row"]').first();
    const canvasSurface = page.getByTestId('costume-canvas-surface');

    await page.getByTestId('layer-add-button').hover();
    await expect.poll(async () => readLayerPanelWidth(page)).toBeGreaterThan(200);

    await canvasSurface.hover();
    await expect.poll(async () => readLayerPanelWidth(page)).toBeLessThan(120);

    await page.getByTestId('layer-add-button').hover();
    await layerRow.click({ button: 'right' });
    const opacitySlider = page.getByLabel('Layer opacity');
    await expect(opacitySlider).toBeVisible();
    await opacitySlider.hover();
    await expect.poll(async () => readLayerPanelWidth(page)).toBeGreaterThan(200);

    await page.keyboard.press('Escape');
    await canvasSurface.hover();
    await expect.poll(async () => readLayerPanelWidth(page)).toBeLessThan(120);
  });

  test('layer opacity slider commits endpoint values on release', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await setActiveLayerOpacity(page, 60);
    await expect.poll(async () => readActiveCostumeLayerOpacity(page)).toBe(0.6);

    await setActiveLayerOpacity(page, 100);
    await expect.poll(async () => readActiveCostumeLayerOpacity(page)).toBe(1);

    await setActiveLayerOpacity(page, 35);
    await expect.poll(async () => readActiveCostumeLayerOpacity(page)).toBe(0.35);

    await setActiveLayerOpacity(page, 0);
    await expect.poll(async () => readActiveCostumeLayerOpacity(page)).toBe(0);
  });
});
