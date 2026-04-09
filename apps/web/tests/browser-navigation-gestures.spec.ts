import { expect, test } from '@playwright/test';
import { bootstrapEditorProject } from './helpers/bootstrapEditorProject';

test.describe('browser navigation gestures', () => {
  test('reference-counts the horizontal browser navigation lock', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const styles = await page.evaluate(async () => {
      const { acquireHorizontalBrowserNavigationLock } = await import('/src/lib/browserNavigationGestures.ts');

      document.documentElement.style.overscrollBehaviorX = 'contain';
      document.body.style.overscrollBehaviorX = 'auto';

      const releaseFirst = acquireHorizontalBrowserNavigationLock();
      const afterFirstAcquire = {
        body: document.body.style.overscrollBehaviorX,
        html: document.documentElement.style.overscrollBehaviorX,
      };

      const releaseSecond = acquireHorizontalBrowserNavigationLock();
      const afterSecondAcquire = {
        body: document.body.style.overscrollBehaviorX,
        html: document.documentElement.style.overscrollBehaviorX,
      };

      releaseFirst();
      const afterFirstRelease = {
        body: document.body.style.overscrollBehaviorX,
        html: document.documentElement.style.overscrollBehaviorX,
      };

      releaseSecond();
      const afterSecondRelease = {
        body: document.body.style.overscrollBehaviorX,
        html: document.documentElement.style.overscrollBehaviorX,
      };

      return {
        afterFirstAcquire,
        afterSecondAcquire,
        afterFirstRelease,
        afterSecondRelease,
      };
    });

    expect(styles.afterFirstAcquire).toEqual({ html: 'none', body: 'none' });
    expect(styles.afterSecondAcquire).toEqual({ html: 'none', body: 'none' });
    expect(styles.afterFirstRelease).toEqual({ html: 'none', body: 'none' });
    expect(styles.afterSecondRelease).toEqual({ html: 'contain', body: 'auto' });
  });

  test('recognizes whether an event target is inside a protected pan surface', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const containment = await page.evaluate(async () => {
      const { isTargetWithinProtectedSurface } = await import('/src/lib/browserNavigationGestures.ts');

      const surface = document.createElement('div');
      const nested = document.createElement('button');
      const outside = document.createElement('div');
      surface.appendChild(nested);
      document.body.appendChild(surface);
      document.body.appendChild(outside);

      const result = {
        nested: isTargetWithinProtectedSurface(surface, nested),
        self: isTargetWithinProtectedSurface(surface, surface),
        outside: isTargetWithinProtectedSurface(surface, outside),
        missing: isTargetWithinProtectedSurface(surface, null),
      };

      surface.remove();
      outside.remove();
      return result;
    });

    expect(containment).toEqual({
      nested: true,
      self: true,
      outside: false,
      missing: false,
    });
  });

  test('locks horizontal browser navigation while the stage editor surface is mounted', async ({ page }) => {
    await bootstrapEditorProject(page, {
      projectName: `Navigation Lock ${Date.now()}`,
      addObject: true,
    });

    await expect(page.getByTestId('stage-phaser-host')).toBeVisible();

    const styles = await page.evaluate(() => ({
      body: document.body.style.overscrollBehaviorX,
      html: document.documentElement.style.overscrollBehaviorX,
    }));

    expect(styles).toEqual({ html: 'none', body: 'none' });
  });
});
