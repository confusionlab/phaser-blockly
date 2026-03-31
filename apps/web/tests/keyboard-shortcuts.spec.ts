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

    const projectNameDisplay = page.getByRole('button', { name: 'Project name' });
    await expect(projectNameDisplay).toBeVisible();
    await projectNameDisplay.click();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toBeVisible();

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

    const projectNameDisplay = page.getByRole('button', { name: 'Project name' });
    await expect(projectNameDisplay).toBeVisible();
    await projectNameDisplay.click();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toBeVisible();

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

    const projectNameDisplay = page.getByRole('button', { name: 'Project name' });
    await expect(projectNameDisplay).toHaveText(projectName);
    await projectNameDisplay.click();

    const renameInput = page.getByRole('textbox', { name: 'Project name' });
    await expect(renameInput).toBeVisible();
    const originalName = await renameInput.inputValue();
    expect(originalName).toBeTruthy();

    await renameInput.fill('Should Not Save');
    await page.keyboard.press('Escape');

    await expect(projectNameDisplay).toHaveText(originalName ?? '');
    await expect(page.getByText(/^Should Not Save$/)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveCount(0);
  });

  test('project name first click places the caret at the end', async ({ page }) => {
    const projectName = `Caret Placement ${Date.now()}`;
    await bootstrapEditorProject(page, { projectName });

    const projectNameDisplay = page.getByRole('button', { name: 'Project name' });
    await expect(projectNameDisplay).toHaveText(projectName);
    await projectNameDisplay.click({ position: { x: 6, y: 6 } });

    const renameInput = page.getByRole('textbox', { name: 'Project name' });
    await expect(renameInput).toBeVisible();

    const selection = await renameInput.evaluate((input) => ({
      end: input.selectionEnd,
      length: input.value.length,
      start: input.selectionStart,
    }));

    expect(selection.start).toBe(selection.length);
    expect(selection.end).toBe(selection.length);
  });

  test('project name edit enforces the max length before commit', async ({ page }) => {
    const projectName = `Project Limit ${Date.now()}`;
    await bootstrapEditorProject(page, { projectName });

    const projectNameDisplay = page.getByRole('button', { name: 'Project name' });
    await expect(projectNameDisplay).toHaveText(projectName);
    await projectNameDisplay.click();

    const renameInput = page.getByRole('textbox', { name: 'Project name' });
    await expect(renameInput).toBeVisible();

    const longName = 'x'.repeat(200);
    await renameInput.fill(longName);

    const value = await renameInput.inputValue();
    expect(value.length).toBe(120);

    await page.keyboard.press('Enter');
    await expect(projectNameDisplay).toHaveText('x'.repeat(120));
  });
});
