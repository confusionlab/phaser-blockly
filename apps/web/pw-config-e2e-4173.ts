import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  webServer: {
    command:
      'VITE_E2E_AUTH_BYPASS=1 VITE_E2E_AUTH_BYPASS_USER_ID=playwright-test-user VITE_CLERK_PUBLISHABLE_KEY_DEV=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k VITE_CLERK_PUBLISHABLE_KEY_PROD=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k pnpm dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
