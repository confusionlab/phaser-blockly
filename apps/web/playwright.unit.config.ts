import { defineConfig } from '@playwright/test';

const UNIT_BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL?.trim() || 'http://127.0.0.1:4173';
process.env.PLAYWRIGHT_TEST_BASE_URL = UNIT_BASE_URL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'line',
  use: {
    baseURL: UNIT_BASE_URL,
  },
  webServer: {
    command:
      `VITE_E2E_AUTH_BYPASS=1 `
      + `VITE_E2E_AUTH_BYPASS_USER_ID=playwright-test-user `
      + `VITE_CLERK_PUBLISHABLE_KEY_DEV=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k `
      + `VITE_CLERK_PUBLISHABLE_KEY_PROD=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k `
      + `pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort`,
    url: UNIT_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
