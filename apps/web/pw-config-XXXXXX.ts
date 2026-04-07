import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '/Users/kihaahn/code/0040-pochacoding/apps/web/tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
});
