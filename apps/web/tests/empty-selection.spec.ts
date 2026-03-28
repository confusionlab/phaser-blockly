import { expect, test, type Locator, type Page } from '@playwright/test';

const APP_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:5173/';

async function bootstrapEditorProject(page: Page, options: { projectName: string; addObject?: boolean }): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForLoadState('networkidle');

  await page.evaluate(async ({ projectName, addObject }) => {
    const [{ saveProject }, { useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/db/database.ts'),
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
      projectState.updateObject(firstSceneId, createdObject.id, {
        x: -260,
        y: -160,
      });
      useEditorStore.getState().selectObject(createdObject.id, { recordHistory: false });
    }

    const latestProject = useProjectStore.getState().project;
    if (!latestProject) {
      throw new Error('Failed to read the latest project before persistence.');
    }
    await saveProject(latestProject);

    window.history.pushState({}, '', `/project/${project.id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, options);

  await page.waitForLoadState('networkidle');
}

async function readSelection(page: Page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import('/src/store/editorStore.ts');
    const state = useEditorStore.getState();
    return {
      selectedSceneId: state.selectedSceneId,
      selectedFolderId: state.selectedFolderId,
      selectedObjectId: state.selectedObjectId,
      selectedObjectIds: state.selectedObjectIds,
      selectedComponentId: state.selectedComponentId,
      activeObjectTab: state.activeObjectTab,
    };
  });
}

async function clickNearBottomRight(locator: Locator, inset = 16): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Target element is not visible');
  }

  await locator.page().mouse.click(
    box.x + Math.max(inset, box.width - inset),
    box.y + Math.max(inset, box.height - inset),
  );
}

test.describe('Empty selection interactions', () => {
  test('empty object shelf offers a create object button', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Empty Shelf Create ${Date.now()}`,
    });

    const createObjectButton = page.getByRole('button', { name: '+ Create an object' });
    await expect(createObjectButton).toBeVisible();

    await createObjectButton.click();

    await expect(page.getByText(/^Object 1$/)).toBeVisible();
    await expect.poll(async () => (await readSelection(page)).selectedObjectId).toBeTruthy();
    await expect(createObjectButton).toHaveCount(0);
  });

  test('clicking empty shelf space or empty stage space clears object selection', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Empty Selection ${Date.now()}`,
      addObject: true,
    });

    const stageCanvas = page.locator('[data-editor-panel="stage"] canvas').first();
    await expect(stageCanvas).toBeVisible();

    await page.getByText(/^Object 1$/).click();
    await expect.poll(async () => (await readSelection(page)).selectedObjectId).toBeTruthy();

    const shelfScrollArea = page.getByTestId('sprite-shelf-scroll-area');
    await clickNearBottomRight(shelfScrollArea);

    await expect.poll(async () => (await readSelection(page)).selectedObjectId).toBe(null);
    expect(await readSelection(page)).toMatchObject({
      selectedFolderId: null,
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedComponentId: null,
      activeObjectTab: 'code',
    });
    await expect(page.getByText('Select an object')).toHaveCount(2);
    await expect(page.getByRole('tab', { name: 'Code' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Costumes' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Sounds' })).toHaveCount(0);
    await expect(page.getByTestId('object-editor-fullscreen-toggle')).toHaveCount(0);

    await page.getByText(/^Object 1$/).click();
    await expect.poll(async () => (await readSelection(page)).selectedObjectId).toBeTruthy();

    await clickNearBottomRight(stageCanvas);

    await expect.poll(async () => (await readSelection(page)).selectedObjectId).toBe(null);
    expect(await readSelection(page)).toMatchObject({
      selectedFolderId: null,
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedComponentId: null,
      activeObjectTab: 'code',
    });
    await expect(page.getByText('Select an object')).toHaveCount(2);
    await expect(page.getByTestId('object-editor-fullscreen-toggle')).toHaveCount(0);
  });
});
