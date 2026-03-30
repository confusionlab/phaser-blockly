import { expect, test } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

test.describe('Keyboard shortcuts', () => {
  test('backquote uses the stage fullscreen overlay instead of the legacy stage shell', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Shortcut ${Date.now()}`,
    });

    const stagePanel = page.locator('[data-editor-panel="stage"]');
    await expect(stagePanel).toBeVisible();

    const panelBox = await stagePanel.boundingBox();
    expect(panelBox).not.toBeNull();
    if (!panelBox) {
      throw new Error('Stage panel bounding box was not available.');
    }

    await page.mouse.click(
      panelBox.x + panelBox.width / 2,
      panelBox.y + Math.min(panelBox.height / 2, 220),
    );
    await page.keyboard.press('Backquote');

    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
    await expect(page.getByText('Stage (Press ` or Esc to exit)')).toHaveCount(0);

    await page.keyboard.press('Backquote');

    await expect(page.getByRole('button', { name: 'Fullscreen stage' })).toBeVisible();
  });

  test('rename inputs suppress editor shortcuts and escape cancels rename', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Keyboard Test ${Date.now()}`,
      addObject: true,
    });

    await expect(page.getByText(/^Object 1$/)).toBeVisible();

    await page.getByText(/^Object 1$/).dblclick();
    const renameInput = page.locator('input[value="Object 1"]').first();
    await expect(renameInput).toBeVisible();

    await renameInput.fill('Renamed Object');
    await page.keyboard.press('ControlOrMeta+D');

    await expect(page.getByText(/^Object 2$/)).toHaveCount(0);

    await page.keyboard.press('Escape');

    await expect(page.getByText(/^Object 1$/)).toBeVisible();
    await expect(page.getByText(/^Renamed Object$/)).toHaveCount(0);
  });

  test('the stage keyboard surface restores scene-object shortcuts', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Stage Focus Shortcut ${Date.now()}`,
      addObject: true,
    });

    const projectNameInput = page.getByLabel('Project name');
    await expect(projectNameInput).toBeVisible();
    await projectNameInput.click();

    const stageShortcutSurface = page.locator('[data-editor-panel="stage"] [data-editor-shortcut-surface="scene-objects"]').first();
    await expect(stageShortcutSurface).toBeVisible();
    await stageShortcutSurface.focus();
    await page.keyboard.press('ControlOrMeta+D');

    await expect(page.getByText(/^Object 1 Copy$/)).toBeVisible();
  });

  test('clicking the object shelf restores copy, paste, and cut shortcuts', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Shelf Focus Shortcut ${Date.now()}`,
      addObject: true,
    });

    const projectNameInput = page.getByLabel('Project name');
    await expect(projectNameInput).toBeVisible();
    await projectNameInput.click();

    const objectRow = page.getByText(/^Object 1$/).first();
    await expect(objectRow).toBeVisible();
    await objectRow.click();

    await page.keyboard.press('ControlOrMeta+C');
    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.getByText(/^Object 1 Copy$/)).toBeVisible();

    await page.keyboard.press('ControlOrMeta+X');
    await expect(page.getByText(/^Object 1 Copy$/)).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.getByText(/^Object 1 Copy$/)).toBeVisible();
  });

  test('project name escape cancels without saving blur side effects', async ({ page }) => {
    const projectName = `Keyboard Test ${Date.now()}`;
    await bootstrapEditorProject(page, { projectName });

    const renameInput = page.getByLabel('Project name');
    await expect(renameInput).toBeVisible();
    const originalName = await renameInput.inputValue();
    expect(originalName).toBeTruthy();

    await renameInput.fill('Should Not Save');
    await page.keyboard.press('Escape');

    await expect(renameInput).toHaveValue(originalName ?? '');
    await expect(page.getByText(/^Should Not Save$/)).toHaveCount(0);
  });
});
