import { expect, test } from '@playwright/test';

async function openEditorFromProjectList(page: import('@playwright/test').Page): Promise<void> {
  const projectsHeading = page.getByRole('heading', { name: /projects/i });
  const hasProjectList = await projectsHeading.isVisible().catch(() => false);
  if (!hasProjectList) return;

  await page.getByRole('button', { name: /^new$/i }).first().click();
  const nameInput = page.getByPlaceholder('My Awesome Game');
  await expect(nameInput).toBeVisible({ timeout: 8000 });
  await nameInput.fill(`Assistant Test ${Date.now()}`);
  await page.getByRole('button', { name: /create/i }).last().click();
  await page.waitForLoadState('networkidle');
}

async function openAssistant(page: import('@playwright/test').Page): Promise<void> {
  const globalAssistantButton = page.locator('button[title="Open assistant"]').first();
  if (await globalAssistantButton.isVisible().catch(() => false)) {
    await globalAssistantButton.click();
    await expect(page.getByText('Credits')).toBeVisible();
    return;
  }

  const addObjectButton = page.getByRole('button', { name: /add object/i }).first();
  if (await addObjectButton.isVisible().catch(() => false)) {
    await addObjectButton.click();
  }

  const codeTab = page.getByRole('tab', { name: /^code$/i });
  if (await codeTab.isVisible().catch(() => false)) {
    await codeTab.click();
  }

  const blocklyAssistantButton = page.locator('button[title="Open Blockly assistant"]').first();
  await expect(blocklyAssistantButton).toBeVisible({ timeout: 10000 });
  await blocklyAssistantButton.click();
}

test.describe('Assistant Managed UI', () => {
  test('global assistant shows managed-only controls', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    await openAssistant(page);

    await expect(page.getByText('Provider mode')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /login with chatgpt/i })).toHaveCount(0);
    await expect(page.getByText('Credits')).toBeVisible();
    await expect(page.getByRole('button', { name: /clear chat/i })).toBeVisible();
  });

  test('blockly assistant shows managed-only controls', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    const addObjectButton = page.getByRole('button', { name: /add object/i }).first();
    if (await addObjectButton.isVisible().catch(() => false)) {
      await addObjectButton.click();
    }
    const codeTab = page.getByRole('tab', { name: /^code$/i });
    if (await codeTab.isVisible().catch(() => false)) {
      await codeTab.click();
    }
    const blocklyAssistantButton = page.locator('button[title="Open Blockly assistant"]').first();
    if (await blocklyAssistantButton.isVisible().catch(() => false)) {
      await blocklyAssistantButton.click();
    } else {
      await openAssistant(page);
    }

    await expect(page.getByText('Provider mode')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /login with chatgpt/i })).toHaveCount(0);
    await expect(page.getByText('Credits')).toBeVisible();
  });
});
