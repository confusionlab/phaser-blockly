import { expect, test, type Page } from '@playwright/test';

const APP_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:5173/';

async function bootstrapProjectWithLargeCollapsedFolder(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForLoadState('networkidle');

  await page.evaluate(async () => {
    const [{ saveProject }, { useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/db/database.ts'),
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);

    useProjectStore.getState().newProject(`Shelf Scroll ${Date.now()}`);
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

    const folderId = 'folder_scroll_repro';
    projectState.updateScene(sceneId, {
      objectFolders: [
        {
          id: folderId,
          name: 'Big Folder',
          parentId: null,
          order: 0,
        },
      ],
    });

    for (let index = 0; index < 35; index += 1) {
      const createdObject = projectState.addObject(sceneId, `Child ${index + 1}`);
      projectState.updateObject(sceneId, createdObject.id, {
        parentId: folderId,
        order: index,
      });
    }

    for (let index = 0; index < 5; index += 1) {
      const createdObject = projectState.addObject(sceneId, `Root ${index + 1}`);
      projectState.updateObject(sceneId, createdObject.id, {
        parentId: null,
        order: index + 1,
      });
    }

    useEditorStore.getState().setCollapsedFoldersForScene(sceneId, [folderId]);

    const latestProject = useProjectStore.getState().project;
    if (!latestProject) {
      throw new Error('Failed to read the prepared project');
    }

    await saveProject(latestProject);

    window.history.pushState({}, '', `/project/${latestProject.id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Toggle Big Folder' })).toBeVisible();
}

test('expanding a large folder keeps the sprite shelf scrollable', async ({ page }) => {
  await bootstrapProjectWithLargeCollapsedFolder(page);

  const viewport = page.locator('[data-testid="sprite-shelf-scroll-area"] [data-radix-scroll-area-viewport]');
  const readMetrics = async () => viewport.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    scrollTop: node.scrollTop,
    maxScrollTop: node.scrollHeight - node.clientHeight,
  }));

  const beforeExpand = await readMetrics();

  await page.getByRole('button', { name: 'Toggle Big Folder' }).click();

  await expect.poll(async () => (await readMetrics()).maxScrollTop).toBeGreaterThan(300);

  const afterExpand = await readMetrics();
  expect(Math.abs(afterExpand.clientHeight - beforeExpand.clientHeight)).toBeLessThan(16);

  await viewport.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });

  await expect.poll(async () => (await readMetrics()).scrollTop).toBeGreaterThan(300);
  await expect(page.getByText('Root 5')).toBeVisible();
});
