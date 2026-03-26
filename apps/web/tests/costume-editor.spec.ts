import { expect, test, type Locator, type Page } from '@playwright/test';

const COSTUME_EDITOR_TEST_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

async function openEditorFromProjectList(page: Page): Promise<void> {
  const projectsHeading = page.getByRole('heading', { name: /projects/i });
  const hasProjectList = await projectsHeading.isVisible().catch(() => false);
  if (!hasProjectList) {
    return;
  }

  await page.getByRole('button', { name: /^new$/i }).first().click();
  const nameInput = page.getByPlaceholder('My Awesome Game');
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await nameInput.fill(`Costume Test ${Date.now()}`);
  await page.getByRole('button', { name: /create/i }).last().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
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
});
