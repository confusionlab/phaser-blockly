import { expect, test } from '@playwright/test';

import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

test.describe('Scene inspector background controls', () => {
  test('keeps the draw button and background color swatch vertically centered', async ({ page }) => {
    await bootstrapEditorProject(page, { projectName: `Scene Tabs Alignment ${Date.now()}` });
    await page.getByRole('radio', { name: /^scenes?$/i }).click();

    const drawButton = page.getByTitle('Draw background');
    const swatchButton = page.getByTitle('#87CEEB');

    await expect(drawButton).toBeVisible();
    await expect(swatchButton).toBeVisible();

    const [drawBox, swatchBox] = await Promise.all([
      drawButton.boundingBox(),
      swatchButton.boundingBox(),
    ]);

    expect(drawBox).not.toBeNull();
    expect(swatchBox).not.toBeNull();

    const drawCenterY = drawBox!.y + (drawBox!.height / 2);
    const swatchCenterY = swatchBox!.y + (swatchBox!.height / 2);

    expect(Math.abs(drawCenterY - swatchCenterY)).toBeLessThanOrEqual(1);
  });
});
