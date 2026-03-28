import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('project route loading', () => {
  test('opening a dashboard project navigates first and then hydrates inside the project route', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const project = await page.evaluate(async () => {
      const [{ createDefaultGameObject, createDefaultProject }, { db, saveProject }] = await Promise.all([
        import('/src/types/index.ts'),
        import('/src/db/database.ts'),
      ]);

      await db.projectRevisions.clear();
      await db.projects.clear();
      await db.assets.clear();
      await db.reusables.clear();

      const seededProject = createDefaultProject('Route Loading Fixture');
      const scene = seededProject.scenes[0]!;
      scene.objects = Array.from({ length: 24 }, (_, index) => {
        const object = createDefaultGameObject(`Actor ${index + 1}`);
        object.x = index * 12;
        object.y = index * -8;
        return object;
      });

      const savedProject = await saveProject(seededProject);
      return {
        id: savedProject.id,
        name: savedProject.name,
      };
    });

    await page.goto(APP_URL);
    await expect(page.getByText(project.name)).toBeVisible();

    await page.getByText(project.name).click();

    await expect(page).toHaveURL(new RegExp(`/project/${project.id}$`));
    await expect(page.getByRole('heading', { name: 'Loading' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue(project.name, { timeout: 15_000 });
  });
});
