import { expect, test } from '@playwright/test';

async function readBackgroundChunkCount(page: import('@playwright/test').Page): Promise<number> {
  const rawValue = await page.getByTestId('background-editor-root').getAttribute('data-chunk-count');
  if (!rawValue) return 0;
  return Number.parseInt(rawValue, 10) || 0;
}

async function openEditorFromProjectList(page: import('@playwright/test').Page): Promise<void> {
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

test.describe('Background editor', () => {
  test('can draw and persist chunked background', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    await page.getByRole('tab', { name: /scene/i }).click();

    const drawButton = page.getByRole('button', { name: /draw/i }).first();
    await expect(drawButton).toBeVisible({ timeout: 10000 });
    await drawButton.click();

    const root = page.getByTestId('background-editor-root');
    await expect(root).toBeVisible();

    const canvas = page.getByTestId('background-editor-canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + 120, centerY + 20);
      await page.mouse.up();
    }

    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);

    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(root).toBeHidden();

    await page.getByRole('tab', { name: /scene/i }).click();
    const drawButtonAgain = page.getByRole('button', { name: /draw/i }).first();
    await expect(drawButtonAgain).toBeVisible({ timeout: 10000 });
    await drawButtonAgain.click();
    await expect(root).toBeVisible();
    await expect.poll(async () => readBackgroundChunkCount(page)).toBeGreaterThan(0);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /cancel/i }).first().click();
    await expect(root).toBeHidden();
  });

  test('cancel discards uncommitted edits', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    await page.getByRole('tab', { name: /scene/i }).click();

    const drawButton = page.getByRole('button', { name: /draw/i }).first();
    await expect(drawButton).toBeVisible({ timeout: 10000 });

    await drawButton.click();
    const root = page.getByTestId('background-editor-root');
    await expect(root).toBeVisible();

    const chunkCountBefore = await readBackgroundChunkCount(page);
    const canvas = page.getByTestId('background-editor-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      const startX = box.x + box.width * 0.25;
      const startY = box.y + box.height * 0.4;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 80, startY + 80);
      await page.mouse.up();
    }

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /cancel/i }).first().click();
    await expect(root).toBeHidden();

    await page.getByRole('tab', { name: /scene/i }).click();
    const drawButtonAgain = page.getByRole('button', { name: /draw/i }).first();
    await expect(drawButtonAgain).toBeVisible({ timeout: 10000 });
    await drawButtonAgain.click();
    await expect(root).toBeVisible();
    const chunkCountAfter = await readBackgroundChunkCount(page);
    expect(chunkCountAfter).toBe(chunkCountBefore);
    await page.getByRole('button', { name: /cancel/i }).first().click();
  });

  test('overlay undo and redo buttons mirror costume canvas controls', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    await page.getByRole('tab', { name: /scene/i }).click();

    const drawButton = page.getByRole('button', { name: /draw/i }).first();
    await expect(drawButton).toBeVisible({ timeout: 10000 });
    await drawButton.click();

    const root = page.getByTestId('background-editor-root');
    await expect(root).toBeVisible();

    const undoButton = page.getByRole('button', { name: /^undo$/i });
    const redoButton = page.getByRole('button', { name: /^redo$/i });
    await expect(undoButton).toBeDisabled();
    await expect(redoButton).toBeDisabled();

    const canvas = page.getByTestId('background-editor-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + 120, centerY + 20);
      await page.mouse.up();
    }

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
});
