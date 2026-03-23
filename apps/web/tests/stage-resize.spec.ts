import { expect, test } from '@playwright/test';

async function openEditorFromProjectList(page: import('@playwright/test').Page): Promise<void> {
  const projectsHeading = page.getByRole('heading', { name: /projects/i });
  const hasProjectList = await projectsHeading.isVisible().catch(() => false);
  if (!hasProjectList) return;

  await page.getByRole('button', { name: /^new$/i }).first().click();
  const nameInput = page.getByPlaceholder('My Awesome Game');
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await nameInput.fill(`Stage Resize Test ${Date.now()}`);
  await page.getByRole('button', { name: /create/i }).last().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
}

test.describe('Stage resize', () => {
  test('keeps the Phaser editor canvas in sync with stage panel resizing', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);

    const host = page.getByTestId('stage-phaser-host');
    await expect(host).toBeVisible({ timeout: 10000 });
    const canvas = host.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    const initialMetrics = await canvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      return {
        width: canvas.width,
        height: canvas.height,
      };
    });
    expect(initialMetrics).not.toBeNull();

    const divider = page.getByTestId('stage-panel-vertical-divider');
    const dividerBox = await divider.boundingBox();
    expect(dividerBox).not.toBeNull();

    if (!dividerBox || !initialMetrics) {
      return;
    }

    const pointerX = dividerBox.x + dividerBox.width / 2;
    const pointerY = dividerBox.y + dividerBox.height / 2;
    await page.mouse.move(pointerX, pointerY);
    await page.mouse.down();
    await page.mouse.move(pointerX, pointerY - 120, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => {
      return await canvas.evaluate((node, initial) => {
        const canvas = node as HTMLCanvasElement;
        const widthStable = Math.abs(canvas.width - initial.width) <= 4;
        const heightChanged = Math.abs(canvas.height - initial.height) >= 40;
        return widthStable && heightChanged;
      }, initialMetrics);
    }).toBe(true);
  });
});
