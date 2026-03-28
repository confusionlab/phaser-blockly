import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('project explorer ordering', () => {
  test('shows most recently edited projects first', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    await page.evaluate(async () => {
      const [{ createDefaultProject }, { db, saveProject }] = await Promise.all([
        import('/src/types/index.ts'),
        import('/src/db/database.ts'),
      ]);

      await db.projectRevisions.clear();
      await db.projects.clear();
      await db.assets.clear();
      await db.reusables.clear();
      await db.projectExplorerState.clear();

      const fixtures = [
        { name: 'Older Project', updatedAt: '2026-01-01T00:00:00.000Z' },
        { name: 'Newest Project', updatedAt: '2026-01-03T00:00:00.000Z' },
        { name: 'Middle Project', updatedAt: '2026-01-02T00:00:00.000Z' },
      ];

      for (const fixture of fixtures) {
        const project = createDefaultProject(fixture.name);
        project.updatedAt = new Date(fixture.updatedAt);
        await saveProject(project);
      }
    });

    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const newestProject = page.getByText('Newest Project', { exact: true });
    const middleProject = page.getByText('Middle Project', { exact: true });
    const olderProject = page.getByText('Older Project', { exact: true });

    await expect(newestProject).toBeVisible();
    await expect(middleProject).toBeVisible();
    await expect(olderProject).toBeVisible();

    const newestBox = await newestProject.boundingBox();
    const middleBox = await middleProject.boundingBox();
    const olderBox = await olderProject.boundingBox();

    expect(newestBox).not.toBeNull();
    expect(middleBox).not.toBeNull();
    expect(olderBox).not.toBeNull();

    if (!newestBox || !middleBox || !olderBox) {
      throw new Error('Expected seeded project rows to have layout boxes.');
    }

    expect(newestBox.y).toBeLessThan(middleBox.y);
    expect(middleBox.y).toBeLessThan(olderBox.y);
  });
});
