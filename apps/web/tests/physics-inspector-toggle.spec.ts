import { expect, test, type Page } from '@playwright/test';

const APP_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:5173/';

async function bootstrapProject(page: Page, options: { projectName: string; makeComponent?: boolean }): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForLoadState('networkidle');

  await page.evaluate(async ({ projectName, makeComponent }) => {
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

    const sceneId = project.scenes[0]?.id ?? null;
    if (!sceneId) {
      throw new Error('Failed to find the initial scene');
    }

    const createdObject = projectState.addObject(sceneId, 'Object 1');
    useEditorStore.getState().selectScene(sceneId, { recordHistory: false });
    useEditorStore.getState().selectObject(createdObject.id, { recordHistory: false });

    if (makeComponent) {
      const createdComponent = projectState.makeComponent(sceneId, createdObject.id);
      if (!createdComponent) {
        throw new Error('Failed to create component from object');
      }
      useEditorStore.getState().selectComponent(createdComponent.id, { recordHistory: false });
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

async function readFirstComponentPhysicsEnabled(page: Page): Promise<boolean | null> {
  return page.evaluate(async () => {
    const { useProjectStore } = await import('/src/store/projectStore.ts');
    return useProjectStore.getState().project?.components?.[0]?.physics?.enabled ?? null;
  });
}

test.describe('Physics inspector toggle behavior', () => {
  test('component-backed objects can toggle physics from the object inspector', async ({ page }) => {
    await bootstrapProject(page, {
      projectName: `Object Physics Toggle ${Date.now()}`,
      makeComponent: true,
    });

    await page.getByRole('radio', { name: /^objects?$/i }).click();
    await page.getByRole('tree', { name: /scene hierarchy/i }).getByText(/^Object 1$/).click();

    const inspector = page.locator('.inspector-panel');
    const physicsToggle = inspector.getByLabel(/^physics$/i);

    await expect(inspector.getByText(/^Body Type$/)).toBeHidden();

    await physicsToggle.click();
    await expect(inspector.getByText(/^Body Type$/)).toBeVisible();
    await expect.poll(async () => readFirstComponentPhysicsEnabled(page)).toBe(true);

    await physicsToggle.click();
    await expect(inspector.getByText(/^Body Type$/)).toBeHidden();
    await expect.poll(async () => readFirstComponentPhysicsEnabled(page)).toBe(false);
  });

  test('component inspector hides advanced physics controls while physics is off', async ({ page }) => {
    await bootstrapProject(page, {
      projectName: `Component Physics Toggle ${Date.now()}`,
      makeComponent: true,
    });

    await page.getByRole('radio', { name: /^components?$/i }).click();
    await page.getByText(/^Object 1$/).click();

    const inspector = page.locator('.inspector-panel');
    const physicsToggle = inspector.getByLabel(/^physics$/i);

    await expect(inspector.getByText(/^Body Type$/)).toBeHidden();

    await physicsToggle.click();
    await expect(inspector.getByText(/^Body Type$/)).toBeVisible();

    await physicsToggle.click();
    await expect(inspector.getByText(/^Body Type$/)).toBeHidden();
  });
});
