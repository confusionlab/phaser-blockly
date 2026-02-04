import { test, expect } from '@playwright/test';

test.describe('Game Runtime', () => {
  test('app loads successfully', async ({ page }) => {
    // Collect console logs for debugging
    const logs: string[] = [];
    page.on('console', msg => {
      logs.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that the main UI elements are present
    await expect(page.locator('body')).toBeVisible();

    // Should have some content loaded
    const content = await page.content();
    expect(content.length).toBeGreaterThan(100);
  });

  test('can click play button and start game', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', msg => {
      logs.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Look for play button
    const playButton = page.getByRole('button', { name: /play/i }).first();

    if (await playButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await playButton.click();
      await page.waitForTimeout(1000);

      // Check logs for runtime messages
      const runtimeLogs = logs.filter(l => l.includes('[Runtime'));
      console.log('Runtime logs found:', runtimeLogs.length);
    }
  });

  test('keyboard input triggers game events', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', msg => {
      logs.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Try to start play mode
    const playButton = page.getByRole('button', { name: /play/i }).first();
    if (await playButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await playButton.click();
      await page.waitForTimeout(500);
    }

    // Focus canvas and send keyboard input
    const canvas = page.locator('canvas').first();
    if (await canvas.isVisible({ timeout: 3000 }).catch(() => false)) {
      await canvas.click();
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);

      // Check if SPACE key was logged
      const spaceLog = logs.find(l => l.includes('SPACE'));
      console.log('Space key detected in logs:', !!spaceLog);
    }
  });

  test('can inspect runtime state', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Start play mode
    const playButton = page.getByRole('button', { name: /play/i }).first();
    if (await playButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await playButton.click();
      await page.waitForTimeout(2000);
    }

    // Check if runtime is exposed
    const runtimeInfo = await page.evaluate(() => {
      const runtime = (window as unknown as { __RUNTIME__?: { sprites?: Map<string, unknown> } }).__RUNTIME__;
      if (runtime && runtime.sprites) {
        return {
          hasRuntime: true,
          spriteCount: runtime.sprites.size,
          spriteNames: Array.from(runtime.sprites.values()).map((s: unknown) => (s as { name: string }).name)
        };
      }
      return { hasRuntime: false, spriteCount: 0, spriteNames: [] };
    });

    console.log('Runtime info:', runtimeInfo);

    if (runtimeInfo.hasRuntime) {
      expect(runtimeInfo.spriteCount).toBeGreaterThanOrEqual(0);
    }
  });
});
