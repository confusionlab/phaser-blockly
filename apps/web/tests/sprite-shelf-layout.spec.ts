import { expect, test, type Page } from '@playwright/test';

const APP_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:5173/';

async function bootstrapProjectWithSingleObject(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await page.waitForLoadState('networkidle');

  await page.evaluate(async () => {
    const [{ saveProject }, { useProjectStore }, { useEditorStore }] = await Promise.all([
      import('/src/db/database.ts'),
      import('/src/store/projectStore.ts'),
      import('/src/store/editorStore.ts'),
    ]);

    useProjectStore.getState().newProject(`Shelf Layout ${Date.now()}`);
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
    projectState.addObject(sceneId, 'Object 1');

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
}

test('sprite shelf fills its container and stays non-scrollable until content overflows', async ({ page }) => {
  await bootstrapProjectWithSingleObject(page);

  const metrics = await page.evaluate(() => {
    const surface = document.querySelector('[data-editor-shortcut-surface="scene-objects"]') as HTMLElement | null;
    const viewport = document.querySelector(
      '[data-testid="sprite-shelf-scroll-area"] [data-slot="scroll-area-viewport"]',
    ) as HTMLElement | null;

    if (!surface || !viewport) {
      throw new Error('Failed to find the sprite shelf scroll surface');
    }

    return {
      surfaceHeight: surface.getBoundingClientRect().height,
      viewportHeight: viewport.getBoundingClientRect().height,
      clientHeight: viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
    };
  });

  expect(Math.abs(metrics.surfaceHeight - metrics.viewportHeight)).toBeLessThan(2);
  expect(metrics.scrollHeight - metrics.clientHeight).toBeLessThanOrEqual(1);
});
