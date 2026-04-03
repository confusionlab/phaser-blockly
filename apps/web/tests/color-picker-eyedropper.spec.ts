import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function installMockEyeDropper(page: Page, sRGBHex: string): Promise<void> {
  await page.addInitScript((nextColor) => {
    class MockEyeDropper {
      async open() {
        return { sRGBHex: nextColor };
      }
    }

    (
      window as typeof window & {
        EyeDropper?: typeof MockEyeDropper;
      }
    ).EyeDropper = MockEyeDropper;
  }, sRGBHex);
}

async function openCostumeEditor(page: Page): Promise<void> {
  await bootstrapEditorProject(page, {
    projectName: `Color Picker Test ${Date.now()}`,
    addObject: true,
  });

  const costumeTab = page.getByRole('radio', { name: /^costumes?$/i });
  await expect(costumeTab).toBeVisible({ timeout: 10000 });
  await costumeTab.click();
  await expect(page.getByTestId('costume-toolbar-tools')).toBeVisible({ timeout: 10000 });
}

async function readColorSwatch(button: Locator): Promise<string> {
  return await button.locator('span').first().evaluate((element) => {
    return window.getComputedStyle(element as HTMLElement).backgroundColor;
  });
}

async function readSceneBackgroundColor(page: Page): Promise<string | null> {
  return await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    const background = useProjectStore.getState().project?.scenes[0]?.background;
    if (!background || background.type === 'image') {
      return null;
    }

    return background.value;
  });
}

test.describe('Color picker eyedropper', () => {
  test('updates the scene background color from the eyedropper', async ({ page }) => {
    await installMockEyeDropper(page, '#123456');
    await bootstrapEditorProject(page, { projectName: `Scene Eyedropper ${Date.now()}` });

    await page.getByRole('radio', { name: /^scenes?$/i }).click();
    await page.getByTitle('#87CEEB').click();
    await page.getByRole('button', { name: /pick color from screen/i }).click();

    await expect.poll(async () => readSceneBackgroundColor(page)).toBe('#123456');
  });

  test('updates the costume toolbar color swatch from the eyedropper', async ({ page }) => {
    await installMockEyeDropper(page, '#2468ac');
    await openCostumeEditor(page);

    await page.getByTestId('costume-toolbar-tools').getByRole('button', { name: /^brush$/i }).click();
    const toolbar = page.getByTestId('costume-toolbar-properties');
    await expect(toolbar).toBeVisible({ timeout: 10000 });
    const colorButton = toolbar.getByRole('button', { name: /^color$/i });
    await expect(colorButton).toBeVisible();

    await colorButton.click();
    const hexInput = page.getByTestId('compact-color-picker-hex-input');
    await expect(hexInput).toBeVisible();
    await page.getByRole('button', { name: /pick color from screen/i }).click();

    await expect.poll(async () => readColorSwatch(colorButton)).toBe('rgb(36, 104, 172)');
    await expect(hexInput).toHaveValue('#2468AC');
  });

  test('allows typing or pasting a hex color into the compact picker', async ({ page }) => {
    await installMockEyeDropper(page, '#000000');
    await openCostumeEditor(page);

    await page.getByTestId('costume-toolbar-tools').getByRole('button', { name: /^brush$/i }).click();
    const toolbar = page.getByTestId('costume-toolbar-properties');
    await expect(toolbar).toBeVisible({ timeout: 10000 });
    const colorButton = toolbar.getByRole('button', { name: /^color$/i });
    await expect(colorButton).toBeVisible();

    await colorButton.click();
    const hexInput = page.getByTestId('compact-color-picker-hex-input');
    await expect(hexInput).toBeVisible();
    await expect(page.getByRole('button', { name: /pick color from screen/i })).toBeVisible();

    await hexInput.fill('13579b');
    await hexInput.press('Enter');

    await expect.poll(async () => readColorSwatch(colorButton)).toBe('rgb(19, 87, 155)');
    await expect(hexInput).toHaveValue('#13579B');
  });

  test('keeps the hue thumb at the end of the slider when set to 360', async ({ page }) => {
    await openCostumeEditor(page);

    await page.getByTestId('costume-toolbar-tools').getByRole('button', { name: /^brush$/i }).click();
    const toolbar = page.getByTestId('costume-toolbar-properties');
    await expect(toolbar).toBeVisible({ timeout: 10000 });

    await toolbar.getByRole('button', { name: /^color$/i }).click();

    const hueSlider = page.getByTestId('compact-color-picker-hue');
    const hueThumb = hueSlider.locator('[role="slider"]');
    await expect(hueThumb).toBeVisible();

    await hueThumb.focus();
    await hueThumb.press('End');

    await expect(hueThumb).toHaveAttribute('aria-valuenow', '360');
  });
});
