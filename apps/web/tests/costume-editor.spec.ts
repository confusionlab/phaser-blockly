import { createHash } from 'node:crypto';
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
  const activeLayerRow = page.locator('[data-testid="layer-row"][aria-pressed="true"]').first();
  await activeLayerRow.click({ button: 'right' });
  const slider = page.getByLabel('Layer opacity');
  await expect(slider).toBeVisible();
  const value = Number(await slider.inputValue());
  await page.keyboard.press('Escape');
  if (!Number.isFinite(value)) {
    return null;
  }
  return value / 100;
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
  const codeTab = page.getByRole('radio', { name: /^code$/i });
  const costumeTab = page.getByRole('radio', { name: /^costume$/i });
  await codeTab.click();
  await expect(codeTab).toBeChecked({ timeout: 10000 });
  await costumeTab.click();
  await expect(costumeTab).toBeChecked({ timeout: 10000 });
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

async function readHostedLayerInkSamplesDense(page: Page): Promise<number> {
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
    for (let index = 3; index < data.length; index += 4 * 31) {
      if ((data[index] ?? 0) > 0) {
        opaqueSamples += 1;
      }
    }
    return opaqueSamples;
  });
}

async function readHostedLayerCanvasHash(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hostedCanvas = document.querySelector('[data-testid="costume-active-layer-host"] .lower-canvas');
    if (!(hostedCanvas instanceof HTMLCanvasElement)) {
      return '';
    }

    const ctx = hostedCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return '';
    }

    const { data } = ctx.getImageData(0, 0, hostedCanvas.width, hostedCanvas.height);
    let hash = 0x811c9dc5;
    for (let index = 0; index < data.length; index += 4) {
      hash ^= data[index] ?? 0;
      hash = Math.imul(hash, 0x01000193);
      hash ^= data[index + 1] ?? 0;
      hash = Math.imul(hash, 0x01000193);
      hash ^= data[index + 2] ?? 0;
      hash = Math.imul(hash, 0x01000193);
      hash ^= data[index + 3] ?? 0;
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
  });
}

function expectSampleCountWithinTolerance(actual: number, expected: number, tolerance: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
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

async function readStageCenterPresenceSamples(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const stageCanvas = document.querySelector('[data-testid="stage-phaser-host"] canvas');
    if (!(stageCanvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const ctx = stageCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    const backgroundProbe = ctx.getImageData(0, 0, Math.max(8, Math.floor(stageCanvas.width * 0.08)), Math.max(8, Math.floor(stageCanvas.height * 0.08))).data;
    let backgroundRed = 0;
    let backgroundGreen = 0;
    let backgroundBlue = 0;
    let backgroundCount = 0;
    for (let index = 0; index < backgroundProbe.length; index += 4 * 11) {
      backgroundRed += backgroundProbe[index] ?? 0;
      backgroundGreen += backgroundProbe[index + 1] ?? 0;
      backgroundBlue += backgroundProbe[index + 2] ?? 0;
      backgroundCount += 1;
    }
    const avgBackground = {
      red: backgroundCount > 0 ? backgroundRed / backgroundCount : 0,
      green: backgroundCount > 0 ? backgroundGreen / backgroundCount : 0,
      blue: backgroundCount > 0 ? backgroundBlue / backgroundCount : 0,
    };

    const { data } = ctx.getImageData(0, 0, stageCanvas.width, stageCanvas.height);
    let presenceSamples = 0;

    for (let index = 0; index < data.length; index += 4 * 29) {
      const alpha = data[index + 3] ?? 0;
      if (alpha <= 0) {
        continue;
      }
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      const distance = Math.sqrt(
        (red - avgBackground.red) ** 2 +
        (green - avgBackground.green) ** 2 +
        (blue - avgBackground.blue) ** 2,
      );
      if (distance > 24) {
        presenceSamples += 1;
      }
    }

    return presenceSamples;
  });
}

async function readSpriteShelfPreviewVisibleSamples(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const previewCanvas = document.querySelector('[data-testid="sprite-shelf-scroll-area"] [aria-label$="preview"]');
    if (!(previewCanvas instanceof HTMLCanvasElement)) {
      return 0;
    }

    const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return 0;
    }

    const { data } = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    let visibleSamples = 0;
    for (let index = 0; index < data.length; index += 4 * 3) {
      if ((data[index + 3] ?? 0) > 0) {
        visibleSamples += 1;
      }
    }
    return visibleSamples;
  });
}

async function captureStagePreviewHash(page: Page): Promise<string> {
  const stageHost = page.getByTestId('stage-phaser-host');
  await expect(stageHost).toBeVisible({ timeout: 10000 });
  const screenshot = await stageHost.screenshot();
  return createHash('sha1').update(screenshot).digest('hex');
}

async function captureSpriteShelfPreviewHash(page: Page): Promise<string> {
  const preview = page.locator('[data-testid="sprite-shelf-scroll-area"] [aria-label$="preview"]').first();
  await expect(preview).toBeVisible({ timeout: 10000 });
  const screenshot = await preview.screenshot();
  return createHash('sha1').update(screenshot).digest('hex');
}

async function observeStageAndSpriteShelfPresenceTimeline(
  page: Page,
  frameCount = 36,
): Promise<{ stage: number[]; shelf: number[] }> {
  return await page.evaluate((frames) => {
    return new Promise<{ stage: number[]; shelf: number[] }>((resolve) => {
      const stageCanvas = document.querySelector('[data-testid="stage-phaser-host"] canvas');
      const shelfCanvas = document.querySelector('[data-testid="sprite-shelf-scroll-area"] [aria-label$="preview"]');
      if (!(stageCanvas instanceof HTMLCanvasElement) || !(shelfCanvas instanceof HTMLCanvasElement)) {
        resolve({ stage: [], shelf: [] });
        return;
      }

      const sampleStagePresence = (canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return 0;
        }
        const backgroundProbe = ctx.getImageData(0, 0, Math.max(8, Math.floor(canvas.width * 0.08)), Math.max(8, Math.floor(canvas.height * 0.08))).data;
        let backgroundRed = 0;
        let backgroundGreen = 0;
        let backgroundBlue = 0;
        let backgroundCount = 0;
        for (let index = 0; index < backgroundProbe.length; index += 4 * 11) {
          backgroundRed += backgroundProbe[index] ?? 0;
          backgroundGreen += backgroundProbe[index + 1] ?? 0;
          backgroundBlue += backgroundProbe[index + 2] ?? 0;
          backgroundCount += 1;
        }
        const avgBackground = {
          red: backgroundCount > 0 ? backgroundRed / backgroundCount : 0,
          green: backgroundCount > 0 ? backgroundGreen / backgroundCount : 0,
          blue: backgroundCount > 0 ? backgroundBlue / backgroundCount : 0,
        };

        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let presenceSamples = 0;
        for (let index = 0; index < data.length; index += 4 * 29) {
          const alpha = data[index + 3] ?? 0;
          if (alpha <= 0) {
            continue;
          }
          const red = data[index] ?? 0;
          const green = data[index + 1] ?? 0;
          const blue = data[index + 2] ?? 0;
          const distance = Math.sqrt(
            (red - avgBackground.red) ** 2 +
            (green - avgBackground.green) ** 2 +
            (blue - avgBackground.blue) ** 2,
          );
          if (distance > 24) {
            presenceSamples += 1;
          }
        }
        return presenceSamples;
      };

      const sampleVisiblePixels = (
        canvas: HTMLCanvasElement,
        step = 17,
      ) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return 0;
        }

        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let visibleSamples = 0;
        for (let index = 0; index < data.length; index += 4 * step) {
          if ((data[index + 3] ?? 0) > 0) {
            visibleSamples += 1;
          }
        }
        return visibleSamples;
      };
      const timeline = {
        stage: [] as number[],
        shelf: [] as number[],
      };

      const captureFrame = () => {
        timeline.stage.push(sampleStagePresence(stageCanvas));
        timeline.shelf.push(sampleVisiblePixels(shelfCanvas, 3));
        if (timeline.stage.length >= frames) {
          resolve(timeline);
          return;
        }
        window.requestAnimationFrame(captureFrame);
      };

      window.requestAnimationFrame(captureFrame);
    });
  }, frameCount);
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

  test('multi-layer composed edits keep stage and sprite shelf previews fresh', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await addVectorLayer(page);
    await expect(page.getByRole('button', { name: /^layer 2/i })).toBeVisible({ timeout: 10000 });
    await waitForCostumeCanvasReady(page);

    const beforeStageHash = await captureStagePreviewHash(page);
    const beforeShelfHash = await captureSpriteShelfPreviewHash(page);
    const beforeCanvasSamples = await readCheckerboardInkSamples(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.18, 0.18, 0.74, 0.62);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeCanvasSamples);
    await expect.poll(async () => captureSpriteShelfPreviewHash(page), { timeout: 1000 }).not.toBe(beforeShelfHash);
    await expect.poll(async () => captureStagePreviewHash(page), { timeout: 1000 }).not.toBe(beforeStageHash);
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
    const baseHostedSamples = await readHostedLayerInkSamples(page);

    await page.getByRole('button', { name: /^eraser$/i }).click();
    for (const yFactor of [0.24, 0.34, 0.44, 0.54]) {
      await drawAcrossCostumeCanvas(page, 0.20, yFactor, 0.60, yFactor);
    }
    const erasedSamples = await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeLessThan(baseSamples).then(async () => {
      return await readCheckerboardInkSamples(page);
    });
    const erasedHostedSamples = await readHostedLayerInkSamples(page);

    let undoCount = 0;
    for (let index = 0; index < 10; index += 1) {
      const currentSamples = await readCheckerboardInkSamples(page);
      const currentHostedSamples = await readHostedLayerInkSamples(page);
      if (currentSamples === baseSamples && currentHostedSamples === baseHostedSamples) {
        break;
      }
      if (!await undoButton.isEnabled()) {
        break;
      }
      await undoButton.click();
      undoCount += 1;
      await expect.poll(async () => {
        const nextSamples = await readCheckerboardInkSamples(page);
        const nextHostedSamples = await readHostedLayerInkSamples(page);
        return nextSamples !== currentSamples || nextHostedSamples !== currentHostedSamples;
      }, { timeout: 10000 }).toBe(true);
    }
    expect(undoCount).toBeGreaterThan(0);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBe(baseSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBe(baseHostedSamples);

    await roundTripThroughCodeTab(page);
    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBe(baseSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBe(baseHostedSamples);

    let redoCount = 0;
    for (let index = 0; index < undoCount; index += 1) {
      await expect(redoButton).toBeEnabled({ timeout: 10000 });
      const currentSamples = await readCheckerboardInkSamples(page);
      const currentHostedSamples = await readHostedLayerInkSamples(page);
      await redoButton.click();
      redoCount += 1;
      await expect.poll(async () => {
        const nextSamples = await readCheckerboardInkSamples(page);
        const nextHostedSamples = await readHostedLayerInkSamples(page);
        return nextSamples !== currentSamples || nextHostedSamples !== currentHostedSamples;
      }, { timeout: 10000 }).toBe(true);
    }
    expect(redoCount).toBe(undoCount);

    const redoneSamples = await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeLessThan(baseSamples).then(async () => {
      return await readCheckerboardInkSamples(page);
    });
    const redoneHostedSamples = await readHostedLayerInkSamples(page);
    expectSampleCountWithinTolerance(redoneSamples, erasedSamples, 24);
    expectSampleCountWithinTolerance(redoneHostedSamples, erasedHostedSamples, 4);

    await roundTripThroughCodeTab(page);
    const reloadedRedoneSamples = await readCheckerboardInkSamples(page);
    const reloadedRedoneHostedSamples = await readHostedLayerInkSamples(page);
    expectSampleCountWithinTolerance(reloadedRedoneSamples, erasedSamples, 24);
    expectSampleCountWithinTolerance(reloadedRedoneHostedSamples, erasedHostedSamples, 4);
    await expect(redoButton).toBeDisabled({ timeout: 10000 });
  });

  test('fill followed by rapid bitmap strokes undoes cleanly back to the fill state', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const undoButton = page.getByRole('button', { name: /^undo$/i });
    const redoButton = page.getByRole('button', { name: /^redo$/i });

    await page.getByRole('button', { name: /^fill$/i }).last().click();
    await clickCostumeCanvas(page, 0.5, 0.5);

    const fillSamples = await expect.poll(async () => readHostedLayerInkSamplesDense(page), { timeout: 10000 }).toBeGreaterThan(0).then(async () => {
      return await readHostedLayerInkSamplesDense(page);
    });
    const fillHostedSamples = await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBeGreaterThan(0).then(async () => {
      return await readHostedLayerInkSamples(page);
    });

    await page.getByRole('button', { name: /^eraser$/i }).click();
    for (const yFactor of [0.18, 0.28, 0.38, 0.48, 0.58, 0.68]) {
      await drawAcrossCostumeCanvas(page, 0.14, yFactor, 0.86, yFactor);
    }

    const erasedSamples = await expect.poll(async () => readHostedLayerInkSamplesDense(page), { timeout: 10000 }).toBeLessThan(fillSamples).then(async () => {
      return await readHostedLayerInkSamplesDense(page);
    });
    expect(erasedSamples).toBeLessThan(fillSamples);

    let undoCount = 0;
    for (let index = 0; index < 6; index += 1) {
      if (!await undoButton.isEnabled()) {
        break;
      }
      await undoButton.click();
      undoCount += 1;
      await page.waitForTimeout(100);
    }
    expect(undoCount).toBeGreaterThan(0);

    await expect.poll(async () => readHostedLayerInkSamplesDense(page), { timeout: 10000 }).toBe(fillSamples);
    await expect.poll(async () => readHostedLayerInkSamples(page), { timeout: 10000 }).toBe(fillHostedSamples);

    let redoCount = 0;
    for (let index = 0; index < undoCount; index += 1) {
      await expect(redoButton).toBeEnabled({ timeout: 10000 });
      await redoButton.click();
      redoCount += 1;
      await page.waitForTimeout(100);
    }
    expect(redoCount).toBe(undoCount);

    await expect.poll(async () => readHostedLayerInkSamplesDense(page), { timeout: 10000 }).toBeLessThan(fillSamples);
  });

  test('fill followed by successive bitmap shape commits undoes through each intermediate state in order', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    const undoButton = page.getByRole('button', { name: /^undo$/i });
    const redoButton = page.getByRole('button', { name: /^redo$/i });

    await page.getByRole('button', { name: /^fill$/i }).last().click();
    await clickCostumeCanvas(page, 0.5, 0.5);

    await expect
      .poll(async () => readHostedLayerInkSamplesDense(page), { timeout: 10000 })
      .toBeGreaterThan(0);
    const fillHash = await readHostedLayerCanvasHash(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();

    await drawAcrossCostumeCanvas(page, 0.14, 0.22, 0.86, 0.22);
    const strokeOneHash = await expect
      .poll(async () => readHostedLayerCanvasHash(page), { timeout: 10000 })
      .not.toBe(fillHash)
      .then(async () => readHostedLayerCanvasHash(page));

    await drawAcrossCostumeCanvas(page, 0.14, 0.40, 0.86, 0.40);
    const strokeTwoHash = await expect
      .poll(async () => readHostedLayerCanvasHash(page), { timeout: 10000 })
      .not.toBe(strokeOneHash)
      .then(async () => readHostedLayerCanvasHash(page));

    await drawAcrossCostumeCanvas(page, 0.14, 0.58, 0.86, 0.58);
    const strokeThreeHash = await expect
      .poll(async () => readHostedLayerCanvasHash(page), { timeout: 10000 })
      .not.toBe(strokeTwoHash)
      .then(async () => readHostedLayerCanvasHash(page));

    await expect(undoButton).toBeEnabled({ timeout: 10000 });
    await undoButton.click();
    await expect.poll(async () => readHostedLayerCanvasHash(page), { timeout: 10000 }).toBe(strokeTwoHash);

    await expect(undoButton).toBeEnabled({ timeout: 10000 });
    await undoButton.click();
    await expect.poll(async () => readHostedLayerCanvasHash(page), { timeout: 10000 }).toBe(strokeOneHash);

    await expect(undoButton).toBeEnabled({ timeout: 10000 });
    await undoButton.click();
    await expect.poll(async () => readHostedLayerCanvasHash(page), { timeout: 10000 }).toBe(fillHash);

    await expect(redoButton).toBeEnabled({ timeout: 10000 });
    await redoButton.click();
    await expect.poll(async () => readHostedLayerCanvasHash(page), { timeout: 10000 }).toBe(strokeOneHash);

    await expect(redoButton).toBeEnabled({ timeout: 10000 });
    await redoButton.click();
    await expect.poll(async () => readHostedLayerCanvasHash(page), { timeout: 10000 }).toBe(strokeTwoHash);

    await expect(redoButton).toBeEnabled({ timeout: 10000 });
    await redoButton.click();
    await expect.poll(async () => readHostedLayerCanvasHash(page), { timeout: 10000 }).toBe(strokeThreeHash);
  });

  test('sprite shelf preview stays visible during rapid bitmap eraser commits', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await drawAcrossCostumeCanvas(page, 0.16, 0.16, 0.84, 0.84);

    await expect.poll(async () => readSpriteShelfPreviewVisibleSamples(page), { timeout: 10000 }).toBeGreaterThan(0);

    await readStageCenterPresenceSamples(page);
    const shelfBaseline = await readSpriteShelfPreviewVisibleSamples(page);

    await page.getByRole('button', { name: /^eraser$/i }).click();
    const timelinePromise = observeStageAndSpriteShelfPresenceTimeline(page);
    await drawAcrossCostumeCanvas(page, 0.22, 0.32, 0.72, 0.32);
    const timeline = await timelinePromise;

    const shelfFinal = await expect.poll(async () => readSpriteShelfPreviewVisibleSamples(page), { timeout: 10000 }).toBeGreaterThan(0).then(async () => {
      return await readSpriteShelfPreviewVisibleSamples(page);
    });

    expect(shelfBaseline).toBeGreaterThan(0);
    expect(timeline.shelf.length).toBeGreaterThan(0);

    const minShelfThreshold = Math.max(1, Math.floor(Math.min(shelfBaseline, shelfFinal) * 0.35));

    expect(timeline.shelf.some((value) => value < minShelfThreshold)).toBe(false);
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
