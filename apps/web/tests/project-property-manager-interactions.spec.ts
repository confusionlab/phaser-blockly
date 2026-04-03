import { expect, test, type Locator, type Page } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

async function openPropertyManager(page: Page, query: 'Edit Messages' | 'Edit Variables') {
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/store/editorStore.ts');
    useEditorStore.getState().setActiveObjectTab('code');
  });

  await expect(page.locator('[data-blockly-editor="true"][data-has-code-target="true"]')).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
    }));
  });

  const searchInput = page.getByPlaceholder('Search blocks and commands...');
  await expect(searchInput).toBeVisible();
  await searchInput.fill(query);
  await searchInput.press('Enter');
}

async function expectUserSelect(locator: Locator, expected: 'none' | 'text') {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveJSProperty('nodeType', 1);
  const userSelect = await locator.evaluate((element) => getComputedStyle(element).userSelect);
  expect(userSelect).toBe(expected);
}

test.describe('Project property manager interactions', () => {
  test('messages use double-click rename and right-click actions', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Message Manager Interactions ${Date.now()}`,
      addObject: true,
    });

    await page.evaluate(async () => {
      const { useProjectStore } = await import('/src/store/projectStore.ts');
      useProjectStore.getState().addMessage('game over');
    });

    await openPropertyManager(page, 'Edit Messages');
    const messagesDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Messages' }),
    });
    await expect(messagesDialog).toBeVisible();
    await expectUserSelect(messagesDialog.getByRole('heading', { name: 'Messages' }), 'none');

    const messageName = messagesDialog.getByText('game over', { exact: true });
    await expect(messagesDialog.getByRole('textbox', { name: 'Rename game over' })).toHaveCount(0);

    await messageName.dblclick();
    const renameInput = messagesDialog.getByRole('textbox', { name: 'Rename game over' });
    await expect(renameInput).toBeVisible();
    await expectUserSelect(renameInput, 'text');
    await renameInput.fill('round win');
    await renameInput.press('Enter');

    await expect(messagesDialog.getByText('round win', { exact: true })).toBeVisible();

    await messagesDialog.getByText('round win', { exact: true }).click({ button: 'right' });
    await expect(page.getByRole('button', { name: 'Rename Message' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Message' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete Message' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(messagesDialog.getByText('round win', { exact: true })).toHaveCount(0);
  });

  test('variables use double-click rename and right-click actions', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Variable Manager Interactions ${Date.now()}`,
      addObject: true,
    });

    await page.evaluate(async () => {
      const [{ useProjectStore }, { useEditorStore }] = await Promise.all([
        import('/src/store/projectStore.ts'),
        import('/src/store/editorStore.ts'),
      ]);
      const { selectedSceneId, selectedObjectId } = useEditorStore.getState();
      if (!selectedSceneId || !selectedObjectId) {
        throw new Error('Expected an object selection before adding a local variable.');
      }
      useProjectStore.getState().addLocalVariable(selectedSceneId, selectedObjectId, {
        id: crypto.randomUUID(),
        name: 'score',
        type: 'number',
        cardinality: 'single',
        defaultValue: 0,
        scope: 'local',
      });
    });

    await openPropertyManager(page, 'Edit Variables');
    const variablesDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Variables' }),
    });
    await expect(variablesDialog).toBeVisible();
    await expectUserSelect(variablesDialog.getByRole('heading', { name: 'Variables' }), 'none');

    const variableName = variablesDialog.getByText('score', { exact: true });
    await expect(variablesDialog.getByRole('textbox', { name: 'Rename score' })).toHaveCount(0);

    await variableName.dblclick();
    const renameInput = variablesDialog.getByRole('textbox', { name: 'Rename score' });
    await expect(renameInput).toBeVisible();
    await expectUserSelect(renameInput, 'text');
    await renameInput.fill('points');
    await renameInput.press('Enter');

    await expect(variablesDialog.getByText('points', { exact: true })).toBeVisible();

    await variablesDialog.getByText('points', { exact: true }).click({ button: 'right' });
    await expect(page.getByRole('button', { name: 'Rename Variable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Variable' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete Variable' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(variablesDialog.getByText('points', { exact: true })).toHaveCount(0);
  });
});
