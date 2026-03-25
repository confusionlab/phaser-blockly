import { expect, test, type Page } from '@playwright/test';

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

  await expect(page.getByText('Layers')).toBeVisible({ timeout: 10000 });
  await waitForCostumeCanvasReady(page);
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

test.describe('Costume editor tools', () => {
  test('vector layers render shapes and reload cleanly after a tab round-trip', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await page.getByRole('button', { name: /^vector$/i }).click();
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

    await roundTripThroughCodeTab(page);

    await expect.poll(async () => readCheckerboardInkSamples(page), { timeout: 10000 }).toBeGreaterThan(beforeSamples);
  });

  test('bitmap select stays on the explicit layer and does not auto-switch from canvas clicks', async ({ page }) => {
    await page.goto(COSTUME_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openCostumeEditor(page);

    await expect(page.getByRole('button', { name: /box select/i })).toHaveCount(0);

    await page.getByRole('button', { name: /^vector$/i }).click();
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
});
