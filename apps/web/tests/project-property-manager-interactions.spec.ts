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

async function getTypographySnapshot(locator: Locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      lineHeight: styles.lineHeight,
    };
  });
}

function getPropertyManagerRow(dialog: Locator, label: string) {
  return dialog.locator('[data-property-manager-row="true"]').filter({ hasText: label }).first();
}

async function getClosestPropertyManagerRowHeight(locator: Locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate((element) => {
    const row = element.closest('[data-property-manager-row="true"]');
    if (!(row instanceof HTMLElement)) {
      throw new Error('Expected element to be inside a property manager row.');
    }
    return row.getBoundingClientRect().height;
  });
}

test.describe('Project property manager interactions', () => {
  test('app shell globally prevents native context menus', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Context Menu Suppression ${Date.now()}`,
      addObject: true,
    });

    const prevented = await page.locator('.app-shell').evaluate((element) => {
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });

    expect(prevented).toBe(true);
  });

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

    const messageName = getPropertyManagerRow(messagesDialog, 'game over').getByText('game over', { exact: true });
    const messageLabelTypography = await getTypographySnapshot(messageName);
    const messageRowHeightBeforeRename = await getClosestPropertyManagerRowHeight(messageName);
    await expect(messagesDialog.getByRole('textbox', { name: 'Rename game over' })).toHaveCount(0);

    await messageName.dblclick();
    const renameInput = messagesDialog.getByRole('textbox', { name: 'Rename game over' });
    await expect(renameInput).toBeVisible();
    await expectUserSelect(renameInput, 'text');
    const renameTypography = await getTypographySnapshot(renameInput);
    const messageRowHeightDuringRename = await getClosestPropertyManagerRowHeight(renameInput);
    expect(renameTypography).toEqual(messageLabelTypography);
    expect(messageRowHeightDuringRename).toBe(messageRowHeightBeforeRename);
    await renameInput.fill('round win');
    await renameInput.press('Enter');

    await expect(messagesDialog.getByText('round win', { exact: true })).toBeVisible();
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
        cardinality: 'array',
        defaultValue: [1, 2],
        scope: 'local',
      });
    });

    await openPropertyManager(page, 'Edit Variables');
    const variablesDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Variables' }),
    });
    await expect(variablesDialog).toBeVisible();
    await expectUserSelect(variablesDialog.getByRole('heading', { name: 'Variables' }), 'none');

    await expect(variablesDialog).not.toContainText('Double-click to rename');
    await expect(variablesDialog).not.toContainText('The game starts with these items in order.');
    await expect(variablesDialog.getByRole('button', { name: 'Delete score' })).toHaveCount(0);

    const variableRow = getPropertyManagerRow(variablesDialog, 'score');
    const variableName = variableRow.getByText('score', { exact: true });
    const variableLabelTypography = await getTypographySnapshot(variableName);
    const variableRowHeightBeforeRename = await getClosestPropertyManagerRowHeight(variableName);
    await expect(variablesDialog.getByRole('textbox', { name: 'Rename score' })).toHaveCount(0);

    await variableName.dblclick();
    const renameInput = variablesDialog.getByRole('textbox', { name: 'Rename score' });
    await expect(renameInput).toBeVisible();
    await expectUserSelect(renameInput, 'text');
    const renameTypography = await getTypographySnapshot(renameInput);
    const variableRowHeightDuringRename = await getClosestPropertyManagerRowHeight(renameInput);
    expect(renameTypography).toEqual(variableLabelTypography);
    expect(variableRowHeightDuringRename).toBe(variableRowHeightBeforeRename);
    await renameInput.fill('points');
    await renameInput.press('Enter');

    await expect(variablesDialog.getByText('points', { exact: true })).toBeVisible();

    const renamedRow = getPropertyManagerRow(variablesDialog, 'points');
    await renamedRow.click({ button: 'right' });
    await expect(page.getByRole('button', { name: 'Rename Variable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Variable' })).toBeVisible();

    await page.getByRole('button', { name: 'Rename Variable' }).click();
    const renameFromContextMenu = variablesDialog.getByRole('textbox', { name: 'Rename points' });
    await expect(renameFromContextMenu).toBeVisible();
    await renameFromContextMenu.press('Escape');
    await expect(variablesDialog.getByText('points', { exact: true })).toBeVisible();

    await renamedRow.click({ button: 'right' });
    await page.getByRole('button', { name: 'Delete Variable' }).click();
    await expect(page.getByRole('heading', { name: 'Delete Variable' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(variablesDialog.getByText('points', { exact: true })).toHaveCount(0);
  });
});
