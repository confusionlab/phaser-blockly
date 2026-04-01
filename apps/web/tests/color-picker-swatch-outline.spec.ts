import { expect, test, type Locator, type Page } from '@playwright/test';

import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function openSceneInspector(page: Page): Promise<void> {
  await bootstrapEditorProject(page, { projectName: `Swatch Outline ${Date.now()}` });
  await page.getByRole('radio', { name: /^scene$/i }).click();
  await expect(page.getByTitle('#87CEEB')).toBeVisible({ timeout: 10000 });
}

async function setSceneBackgroundColor(page: Page, currentHex: string, nextHex: string): Promise<Locator> {
  await page.getByTitle(currentHex).click();

  const hexInput = page.getByTestId('compact-color-picker-hex-input');
  await expect(hexInput).toBeVisible();
  await hexInput.fill(nextHex.replace('#', ''));
  await hexInput.press('Enter');
  await page.mouse.click(8, 8);
  await expect(hexInput).toHaveCount(0);

  const nextSwatch = page.getByTitle(nextHex.toUpperCase());
  await expect(nextSwatch).toBeVisible();
  return nextSwatch;
}

async function readOutlineState(button: Locator): Promise<string | null> {
  return button.locator('span').first().getAttribute('data-outline-visible');
}

async function setDarkMode(page: Page, isDarkMode: boolean): Promise<void> {
  await page.evaluate(async (nextIsDarkMode) => {
    const { useEditorStore } = await import('/src/store/editorStore.ts');
    useEditorStore.getState().setDarkMode(nextIsDarkMode);
  }, isDarkMode);

  if (isDarkMode) {
    await expect(page.locator('html')).toHaveClass(/dark/);
    return;
  }

  await expect(page.locator('html')).not.toHaveClass(/dark/);
}

test.describe('Color picker swatch outline', () => {
  test('only outlines swatches when they blend into the current surface across light and dark themes', async ({ page }) => {
    await openSceneInspector(page);

    const lightBlendSwatch = await setSceneBackgroundColor(page, '#87CEEB', '#FFFFFF');
    await expect.poll(async () => readOutlineState(lightBlendSwatch)).toBe('true');

    const lightContrastSwatch = await setSceneBackgroundColor(page, '#FFFFFF', '#2468AC');
    await expect.poll(async () => readOutlineState(lightContrastSwatch)).toBe('false');

    await setDarkMode(page, true);

    const darkBlendSwatch = await setSceneBackgroundColor(page, '#2468AC', '#101010');
    await expect.poll(async () => readOutlineState(darkBlendSwatch)).toBe('true');

    const darkContrastSwatch = await setSceneBackgroundColor(page, '#101010', '#F6D365');
    await expect.poll(async () => readOutlineState(darkContrastSwatch)).toBe('false');
  });
});
