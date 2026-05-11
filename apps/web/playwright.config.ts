import { defineConfig, devices } from '@playwright/test';

const webPort = process.env.E2E_WEB_PORT || '5173';
const scratchPaintFramePort = process.env.E2E_SCRATCH_PAINT_FRAME_PORT || '5175';
const webBaseUrl = `http://localhost:${webPort}`;
const scratchPaintFrameUrl = `http://localhost:${scratchPaintFramePort}/`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: webBaseUrl,
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command:
      `pnpm --dir ../.. exec concurrently -k -s first "pnpm --dir ../.. --filter @pochacoding/scratch-paint-frame exec vite --host 127.0.0.1 --port ${scratchPaintFramePort} --strictPort" "env VITE_APP_BRANCH=e2e VITE_SCRATCH_PAINT_FRAME_URL=${scratchPaintFrameUrl} VITE_E2E_AUTH_BYPASS=1 VITE_E2E_AUTH_BYPASS_USER_ID=playwright-test-user VITE_CLERK_PUBLISHABLE_KEY_DEV=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k VITE_CLERK_PUBLISHABLE_KEY_PROD=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k pnpm --dir ../.. --filter @pochacoding/web exec vite --host 127.0.0.1 --port ${webPort} --strictPort"`,
    url: webBaseUrl,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
