import { expect, test } from '@playwright/test';

function parseChunkCountLabel(text: string | null): number {
  if (!text) return 0;
  const match = text.match(/Chunks:\s*(\d+)\s*\/\s*\d+/i);
  if (!match) return 0;
  return Number.parseInt(match[1], 10) || 0;
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

    const chunkCount = page.getByTestId('background-editor-chunk-count');
    await expect(chunkCount).toContainText(/Chunks:\s*[1-9]\d*\s*\/\s*\d+/i);

    await page.getByRole('button', { name: /done/i }).first().click();
    await expect(root).toBeHidden();

    await page.getByRole('tab', { name: /scene/i }).click();
    const drawButtonAgain = page.getByRole('button', { name: /draw/i }).first();
    await expect(drawButtonAgain).toBeVisible({ timeout: 10000 });
    await drawButtonAgain.click();
    await expect(root).toBeVisible();
    await expect(page.getByTestId('background-editor-chunk-count')).toContainText(/Chunks:\s*[1-9]\d*\s*\/\s*\d+/i);
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

    const chunkCountBefore = parseChunkCountLabel(await page.getByTestId('background-editor-chunk-count').textContent());
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
    const chunkCountAfter = parseChunkCountLabel(await page.getByTestId('background-editor-chunk-count').textContent());
    expect(chunkCountAfter).toBe(chunkCountBefore);
    await page.getByRole('button', { name: /cancel/i }).first().click();
  });
});
