import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('project open save control', () => {
  test('opening a clean project reaches saved without showing save or saving', async ({ page }) => {
    await page.addInitScript(() => {
      const timeline: Array<{
        href: string;
        label: string | null;
        text: string | null;
      }> = [];

      function record() {
        const button = Array.from(document.querySelectorAll('button')).find((node) => {
          const label = (node.getAttribute('aria-label') || '').trim();
          const text = (node.textContent || '').trim();
          return label === 'Save' || label === 'Saved' || label === 'Saving' || text === 'Save' || text === 'Saved';
        }) || null;

        timeline.push({
          href: location.href,
          label: button?.getAttribute('aria-label') ?? null,
          text: button?.textContent?.trim() ?? null,
        });
      }

      window.__pochaSaveTimeline = timeline;
      const observer = new MutationObserver(record);
      const start = () => {
        observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['aria-label', 'class'],
        });
        record();
      };

      if (document.documentElement) {
        start();
      } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
      }
    });

    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const project = await page.evaluate(async () => {
      const [{ createDefaultProject }, { db, saveProject }] = await Promise.all([
        import('/src/types/index.ts'),
        import('/src/db/database.ts'),
      ]);

      await db.projectRevisions.clear();
      await db.projects.clear();
      await db.assets.clear();
      await db.reusables.clear();

      const seededProject = createDefaultProject('Open Save Control Fixture');
      const savedProject = await saveProject(seededProject);

      return {
        id: savedProject.id,
        name: savedProject.name,
      };
    });

    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');
    await page.getByText(project.name).click();

    await expect(page).toHaveURL(new RegExp(`/project/${project.id}$`));
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 15_000 });

    const saveTimeline = await page.evaluate(() => {
      return (window as Window & {
        __pochaSaveTimeline?: Array<{ href: string; label: string | null; text: string | null }>;
      }).__pochaSaveTimeline ?? [];
    });

    const routeEntries = saveTimeline.filter((entry) => entry.href.endsWith(`/project/${project.id}`));
    const visibleStates = routeEntries
      .map((entry) => entry.label ?? entry.text)
      .filter((value): value is string => !!value);

    expect(visibleStates).toContain('Saved');
    expect(visibleStates).not.toContain('Save');
    expect(visibleStates).not.toContain('Saving');
  });
});
