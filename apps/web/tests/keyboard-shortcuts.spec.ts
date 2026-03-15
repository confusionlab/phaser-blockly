import { expect, test, type Page } from '@playwright/test';

const APP_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:5173/';

async function openEditorFromProjectList(page: Page): Promise<void> {
  const projectsHeading = page.getByRole('heading', { name: /projects/i });
  const hasProjectList = await projectsHeading.isVisible().catch(() => false);
  if (!hasProjectList) return;

  await page.getByRole('button', { name: /^new$/i }).first().click();
  const nameInput = page.getByPlaceholder('My Awesome Game');
  await expect(nameInput).toBeVisible({ timeout: 5000 });
  await nameInput.fill(`Keyboard Test ${Date.now()}`);
  await page.getByRole('button', { name: /create/i }).last().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
}

test.describe('Keyboard shortcuts', () => {
  test('rename inputs suppress editor shortcuts and escape cancels rename', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);

    await page.locator('button[title="Add Object"]').click();
    await expect(page.getByText(/^Object 1$/)).toBeVisible();

    await page.getByText(/^Object 1$/).dblclick();
    const renameInput = page.getByDisplayValue('Object 1');
    await expect(renameInput).toBeVisible();

    await renameInput.fill('Renamed Object');
    await page.keyboard.press('ControlOrMeta+D');

    await expect(page.getByText(/^Object 2$/)).toHaveCount(0);

    await page.keyboard.press('Escape');

    await expect(page.getByText(/^Object 1$/)).toBeVisible();
    await expect(page.getByText(/^Renamed Object$/)).toHaveCount(0);
  });

  test('project name escape cancels without saving blur side effects', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);

    const projectNameButton = page.getByRole('button', { name: /keyboard test/i }).first();
    const originalName = await projectNameButton.textContent();
    expect(originalName).toBeTruthy();

    await projectNameButton.click();
    const renameInput = page.getByLabel('Project name');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('Should Not Save');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: originalName ?? '' }).first()).toBeVisible();
    await expect(page.getByText(/^Should Not Save$/)).toHaveCount(0);
  });
});
