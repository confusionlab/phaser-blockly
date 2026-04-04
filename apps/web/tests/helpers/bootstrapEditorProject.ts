import { type Page } from '@playwright/test';

interface BootstrapEditorProjectOptions {
  projectName: string;
  addObject?: boolean;
  blocklyXml?: string;
}

export async function bootstrapEditorProject(
  page: Page,
  options: BootstrapEditorProjectOptions,
): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.evaluate(async ({ projectName, addObject, blocklyXml }) => {
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
      if (blocklyXml) {
        projectState.updateObject(firstSceneId, createdObject.id, { blocklyXml });
      }
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
