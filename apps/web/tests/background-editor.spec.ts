import { expect, test, type Page } from '@playwright/test';

const BACKGROUND_EDITOR_TEST_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

async function readBackgroundChunkCount(page: Page): Promise<number> {
  const rawValue = await page.getByTestId('background-editor-root').getAttribute('data-chunk-count');
  if (!rawValue) return 0;
  return Number.parseInt(rawValue, 10) || 0;
}

async function readPersistedDarkPixelCount(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const background = project?.scenes[0]?.background;
    if (!background || background.type !== 'tiled' || !background.chunks) {
      return 0;
    }

    const decodeImage = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to decode background chunk image.'));
      image.src = dataUrl;
    });

    let darkPixels = 0;
    for (const dataUrl of Object.values(background.chunks)) {
      if (!dataUrl) {
        continue;
      }

      const image = await decodeImage(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        continue;
      }

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3] ?? 0;
        if (alpha === 0) {
          continue;
        }

        const red = data[index] ?? 0;
        const green = data[index + 1] ?? 0;
        const blue = data[index + 2] ?? 0;
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        if (luminance < 64) {
          darkPixels += 1;
        }
      }
    }

    return darkPixels;
  });
}

async function readBackgroundDocumentSummary(page: Page): Promise<{
  activeLayerId: string | null;
  chunkCount: number;
  layerKinds: string[];
  layerNames: string[];
}> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const project = useProjectStore.getState().project;
    const background = project?.scenes[0]?.background;
    return {
      activeLayerId: background?.document?.activeLayerId ?? null,
      chunkCount: Object.keys(background?.chunks ?? {}).length,
      layerKinds: (background?.document?.layers ?? []).map((layer: { kind: string }) => layer.kind),
      layerNames: (background?.document?.layers ?? []).map((layer: { name: string }) => layer.name),
    };
  });
}

function backgroundLayerRow(page: Page, index: number) {
  return page.locator('[data-testid="layer-row"]').nth(index);
}

async function openEditorFromProjectList(page: Page): Promise<void> {
  const projectsHeading = page.getByRole('heading', { name: /projects/i });
  const hasProjectList = await projectsHeading.isVisible().catch(() => false);
  if (!hasProjectList) return;

  await page.getByRole('button', { name: /^new$/i }).first().click();
  const nameInput = page.getByPlaceholder('My Awesome Game');
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await nameInput.fill(`Background Test ${Date.now()}`);
  await page.getByRole('button', { name: /create/i }).last().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
}

async function openBackgroundEditor(page: Page) {
  const sceneRadio = page.getByRole('radio', { name: /^scene$/i });
  await expect(sceneRadio).toBeVisible({ timeout: 10000 });
  await sceneRadio.click();

  const drawButton = page.getByTitle('Draw background').first();
  await expect(drawButton).toBeVisible({ timeout: 10000 });
  await drawButton.click();
  const root = page.getByTestId('background-editor-root');
  await expect(root).toBeVisible();
  const canvas = page.getByTestId('background-editor-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error('Background editor canvas is missing a bounding box.');
  }
  return { root, canvas, box };
}

test.describe('Background editor', () => {
  test('can draw and persist chunked background', async ({ page }) => {
    await page.goto(BACKGROUND_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    const { root, box } = await openBackgroundEditor(page);

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY + 20);
    await page.mouse.up();

    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);

    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(root).toBeHidden();

    const reopened = await openBackgroundEditor(page);
    await expect(reopened.root).toBeVisible();
    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /cancel/i }).first().click();
    await expect(reopened.root).toBeHidden();
  });

  test('cancel discards uncommitted edits', async ({ page }) => {
    await page.goto(BACKGROUND_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    const { root, box } = await openBackgroundEditor(page);

    const chunkCountBefore = await readBackgroundChunkCount(page);
    const startX = box.x + box.width * 0.25;
    const startY = box.y + box.height * 0.4;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 80);
    await page.mouse.up();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /cancel/i }).first().click();
    await expect(root).toBeHidden();

    const reopened = await openBackgroundEditor(page);
    await expect(reopened.root).toBeVisible();
    const chunkCountAfter = await readBackgroundChunkCount(page);
    expect(chunkCountAfter).toBe(chunkCountBefore);
    await page.getByRole('button', { name: /cancel/i }).first().click();
  });

  test('overlay undo and redo buttons mirror costume canvas controls', async ({ page }) => {
    await page.goto(BACKGROUND_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    const { box } = await openBackgroundEditor(page);

    const undoButton = page.getByRole('button', { name: /^undo$/i });
    const redoButton = page.getByRole('button', { name: /^redo$/i });
    await expect(undoButton).toBeDisabled();
    await expect(redoButton).toBeDisabled();

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY + 20);
    await page.mouse.up();

    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);
    await expect(undoButton).toBeEnabled();
    await expect(redoButton).toBeDisabled();

    await undoButton.click();
    await expect.poll(async () => readBackgroundChunkCount(page)).toBe(0);
    await expect(redoButton).toBeEnabled();

    await redoButton.click();
    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /cancel/i }).first().click();
  });

  test('keeps explicit bitmap and vector layers in the saved background document', async ({ page }) => {
    await page.goto(BACKGROUND_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    const { canvas, box } = await openBackgroundEditor(page);

    const startX = box.x + box.width * 0.28;
    const startY = box.y + box.height * 0.42;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 90, startY + 35);
    await page.mouse.up();
    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);

    await page.getByRole('button', { name: /^vector$/i }).click();
    const vectorLayerButton = backgroundLayerRow(page, 0);
    await expect(vectorLayerButton).toHaveAttribute('data-layer-kind', 'vector');
    await expect(vectorLayerButton).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: /^rectangle$/i }).click();
    await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.34);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.73, box.y + box.height * 0.5);
    await page.mouse.up();

    await canvas.click({ position: { x: Math.round(box.width * 0.62), y: Math.round(box.height * 0.41) } });
    await expect(vectorLayerButton).toHaveAttribute('aria-pressed', 'true');
    const bitmapLayerButton = backgroundLayerRow(page, 1);
    await expect(bitmapLayerButton).toHaveAttribute('data-layer-kind', 'bitmap');
    await bitmapLayerButton.click();
    await expect(bitmapLayerButton).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(page.getByTestId('background-editor-root')).toBeHidden();

    const summary = await readBackgroundDocumentSummary(page);
    expect(summary.layerKinds).toEqual(['bitmap', 'vector']);
    expect(summary.layerNames).toEqual(['Layer 1', 'Layer 2']);
    expect(summary.activeLayerId).not.toBeNull();
    expect(summary.chunkCount).toBeGreaterThan(0);

    const reopened = await openBackgroundEditor(page);
    await expect(page.locator('[data-testid="layer-row"][data-layer-kind="bitmap"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="layer-row"][data-layer-kind="vector"]')).toHaveCount(1);
    await page.getByRole('button', { name: /cancel/i }).first().click();
    await expect(reopened.root).toBeHidden();
  });
});

test.describe('Background editor high-DPI selection rendering', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  test('committing a floating selection preserves persisted background scale', async ({ page }) => {
    await page.goto(BACKGROUND_EDITOR_TEST_URL);
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);

    const { box } = await openBackgroundEditor(page);
    const startX = box.x + box.width * 0.45;
    const startY = box.y + box.height * 0.45;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + box.width * 0.08, startY + box.height * 0.06);
    await page.mouse.up();

    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);
    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(page.getByTestId('background-editor-root')).toBeHidden();

    const baselineDarkPixels = await readPersistedDarkPixelCount(page);
    expect(baselineDarkPixels).toBeGreaterThan(0);

    const reopened = await openBackgroundEditor(page);
    await reopened.canvas.click();
    await page.keyboard.press('v');
    await page.mouse.move(reopened.box.x + reopened.box.width * 0.35, reopened.box.y + reopened.box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(reopened.box.x + reopened.box.width * 0.65, reopened.box.y + reopened.box.height * 0.65);
    await page.mouse.up();

    await expect(reopened.root.getByText('Selection')).toBeVisible();
    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(page.getByTestId('background-editor-root')).toBeHidden();

    const nextDarkPixels = await readPersistedDarkPixelCount(page);
    expect(nextDarkPixels).toBeGreaterThan(0);
    expect(nextDarkPixels).toBeGreaterThan(Math.floor(baselineDarkPixels * 0.75));
    expect(nextDarkPixels).toBeLessThan(Math.ceil(baselineDarkPixels * 1.25));
  });
});
