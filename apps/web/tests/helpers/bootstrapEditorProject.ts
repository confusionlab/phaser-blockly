import { type Page } from '@playwright/test';

const APP_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:5173/';

interface BootstrapEditorProjectOptions {
  projectName: string;
  addObject?: boolean;
}

export async function bootstrapEditorProject(
  page: Page,
  options: BootstrapEditorProjectOptions,
): Promise<void> {
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
