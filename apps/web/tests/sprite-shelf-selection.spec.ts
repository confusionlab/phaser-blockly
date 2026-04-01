import { expect, test, type Page } from '@playwright/test';

const APP_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:5173/';

async function bootstrapProjectWithAdjacentSelectedObjects(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForLoadState('networkidle');

  await page.evaluate(async () => {
    const [{ saveProject }, { useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/db/database.ts'),
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);

    useProjectStore.getState().newProject(`Shelf Selection ${Date.now()}`);
    const projectState = useProjectStore.getState();
    const project = projectState.project;
    if (!project) {
      throw new Error('Failed to create project');
    }

    const sceneId = project.scenes[0]?.id ?? null;
    if (!sceneId) {
      throw new Error('Failed to find the initial scene');
    }

    useEditorStore.getState().selectScene(sceneId, { recordHistory: false });

    const objectOne = projectState.addObject(sceneId, 'Object 1');
    const objectTwo = projectState.addObject(sceneId, 'Object 2');
    const objectThree = projectState.addObject(sceneId, 'Object 3');

    projectState.updateObject(sceneId, objectOne.id, { parentId: null, order: 0 });
    projectState.updateObject(sceneId, objectTwo.id, { parentId: null, order: 1 });
    projectState.updateObject(sceneId, objectThree.id, { parentId: null, order: 2 });

    useEditorStore.getState().selectObjects([objectOne.id, objectTwo.id], objectTwo.id, { recordHistory: false });

    const latestProject = useProjectStore.getState().project;
    if (!latestProject) {
      throw new Error('Failed to read the prepared project');
    }

    await saveProject(latestProject);

    window.history.pushState({}, '', `/project/${latestProject.id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/^Object 1$/)).toBeVisible();
  await expect(page.getByText(/^Object 2$/)).toBeVisible();
}

test('adjacent selected shelf rows allow the selection bridge to escape clipping', async ({ page }) => {
  await bootstrapProjectWithAdjacentSelectedObjects(page);

  const shelf = page.getByTestId('sprite-shelf-scroll-area');

  const firstRowOverflow = await shelf.getByText(/^Object 1$/).evaluate((element) => {
    const row = element.closest('[data-sprite-shelf-row="true"]') as HTMLElement | null;
    const outer = row?.parentElement as HTMLElement | null;
    const inner = row?.firstElementChild as HTMLElement | null;

    return {
      outer: outer ? getComputedStyle(outer).overflow : null,
      row: row ? getComputedStyle(row).overflow : null,
      inner: inner ? getComputedStyle(inner).overflow : null,
    };
  });

  const secondRowOverflow = await shelf.getByText(/^Object 2$/).evaluate((element) => {
    const row = element.closest('[data-sprite-shelf-row="true"]') as HTMLElement | null;
    const outer = row?.parentElement as HTMLElement | null;
    const inner = row?.firstElementChild as HTMLElement | null;

    return {
      outer: outer ? getComputedStyle(outer).overflow : null,
      row: row ? getComputedStyle(row).overflow : null,
      inner: inner ? getComputedStyle(inner).overflow : null,
    };
  });

  expect(firstRowOverflow).toEqual({
    outer: 'visible',
    row: 'visible',
    inner: 'visible',
  });

  expect(secondRowOverflow).toEqual({
    outer: 'hidden',
    row: 'hidden',
    inner: 'hidden',
  });
});
