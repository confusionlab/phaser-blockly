import { expect, test, type Page } from '@playwright/test';

const APP_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:5173/';

async function bootstrapEditorProject(page: Page, options: { projectName: string; addObject?: boolean }): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForLoadState('networkidle');

  await page.evaluate(async ({ projectName, addObject }) => {
    const [{ useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);

    useProjectStore.getState().newProject(projectName);
    const projectState = useProjectStore.getState();
    const project = projectState.project;
    if (!project) {
      throw new Error('Failed to create project');
    }

    const firstSceneId = project.scenes[0]?.id ?? null;
    useEditorStore.getState().selectScene(firstSceneId, { recordHistory: false });

    if (addObject && firstSceneId) {
      const createdObject = projectState.addObject(firstSceneId, 'Object 1');
      useEditorStore.getState().selectObject(createdObject.id, { recordHistory: false });
    }

    window.history.pushState({}, '', `/project/${project.id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, options);

  await page.waitForLoadState('networkidle');
}

test.describe('Keyboard shortcuts', () => {
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

  test('project name escape cancels without saving blur side effects', async ({ page }) => {
    const projectName = `Keyboard Test ${Date.now()}`;
    await bootstrapEditorProject(page, { projectName });

    const projectNameButton = page.getByRole('button', { name: projectName }).first();
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
