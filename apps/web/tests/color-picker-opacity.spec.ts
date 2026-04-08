import { expect, test, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function openCostumeEditor(page: Page): Promise<void> {
  await bootstrapEditorProject(page, {
    projectName: `Opacity Picker ${Date.now()}`,
    addObject: true,
  });

  await page.getByRole('radio', { name: /^costumes?$/i }).click();
  await expect(page.getByTestId('costume-toolbar-tools')).toBeVisible({ timeout: 10000 });
}

async function openBackgroundEditor(page: Page): Promise<void> {
  await bootstrapEditorProject(page, { projectName: `Background Opacity ${Date.now()}` });
  await page.getByRole('radio', { name: /^scenes?$/i }).click();
  await page.getByTitle('Draw background').first().click();
  await expect(page.getByTestId('background-editor-root')).toBeVisible({ timeout: 10000 });
}

test.describe('Color picker opacity placement', () => {
  test('does not show opacity for scene background color, but does for costume brush color', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Scene Opacity ${Date.now()}` });

    await page.getByRole('radio', { name: /^scenes?$/i }).click();
    await page.getByTitle('#87CEEB').click();
    await expect(page.getByTestId('compact-color-picker-opacity')).toHaveCount(0);

    await page.mouse.click(8, 8);

    await openCostumeEditor(page);
    await page.getByTestId('costume-toolbar-tools').getByRole('button', { name: /^brush$/i }).click();
    await page.getByTestId('costume-toolbar-properties').getByRole('button', { name: /^color$/i }).click();
    await expect(page.getByTestId('compact-color-picker-opacity')).toBeVisible();
  });

  test('shows opacity for background editor vector color controls', async ({ page }) => {
    await openBackgroundEditor(page);

    await page.getByTestId('layer-add-button').click();
    await page.getByRole('menuitem', { name: /^vector$/i }).click();

    await page.getByTestId('costume-toolbar-tools').getByRole('button', { name: /^rectangle$/i }).click();
    const propertyBar = page.getByTestId('costume-toolbar-properties');
    await expect(propertyBar).toBeVisible({ timeout: 10000 });

    await propertyBar.getByRole('button', { name: /^stroke$/i }).click();
    await expect(page.getByTestId('compact-color-picker-opacity')).toBeVisible();
  });

  test('renders a red X swatch state when opacity reaches zero', async ({ page }) => {
    await openCostumeEditor(page);

    await page.getByTestId('costume-toolbar-tools').getByRole('button', { name: /^brush$/i }).click();
    const colorButton = page.getByTestId('costume-toolbar-properties').getByRole('button', { name: /^color$/i });
    await colorButton.click();

    const slider = page.getByTestId('compact-color-picker-opacity').getByRole('slider');
    await expect(slider).toBeVisible();
    await slider.focus();
    await slider.press('Home');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');

    await colorButton.click();
    await expect(colorButton.locator('span').first()).toHaveAttribute('data-zero-opacity', 'true');
  });
});
