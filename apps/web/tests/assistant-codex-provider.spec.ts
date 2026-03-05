import { expect, test } from '@playwright/test';

async function openEditorFromProjectList(page: import('@playwright/test').Page): Promise<void> {
  const projectsHeading = page.getByRole('heading', { name: /projects/i });
  const hasProjectList = await projectsHeading.isVisible().catch(() => false);
  if (!hasProjectList) return;

  await page.getByRole('button', { name: /^new$/i }).first().click();
  const nameInput = page.getByPlaceholder('My Awesome Game');
  await expect(nameInput).toBeVisible({ timeout: 8000 });
  await nameInput.fill(`Assistant Test ${Date.now()}`);
  await page.getByRole('button', { name: /create/i }).last().click();
  await page.waitForLoadState('networkidle');
}

async function openAssistant(page: import('@playwright/test').Page): Promise<void> {
  const assistantButton = page.locator('button[title="Open Blockly assistant"], button[title="Open assistant"]').first();
  await expect(assistantButton).toBeVisible({ timeout: 10000 });
  await assistantButton.click();
  await expect(page.getByText('Provider mode')).toBeVisible();
}

async function installDesktopAssistantMock(
  page: import('@playwright/test').Page,
  mode: 'chat-success' | 'error',
): Promise<void> {
  await page.addInitScript(({ scenario }) => {
    type ProviderMode = 'managed' | 'byok' | 'codex_oauth';
    type Listener = (event: { type: string; success?: boolean; message?: string | null }) => void;

    const listeners: Listener[] = [];
    const state = {
      mode: 'managed' as ProviderMode,
      hasByokKey: false,
      hasCodexToken: false,
      codexAvailable: true,
      codexAuthMethod: null as 'chatgpt' | 'api_key' | 'unknown' | null,
      codexEmail: null as string | null,
      codexPlanType: null as string | null,
      codexLoginInProgress: false,
      codexStatusMessage: null as string | null,
    };

    const emit = (event: { type: string; success?: boolean; message?: string | null }) => {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // Ignore listener failures in test mock.
        }
      }
    };

    const cloneState = () => ({ ...state });

    (window as Window & {
      desktopAssistant?: {
        provider: {
          status: () => Promise<typeof state>;
          setMode: (mode: ProviderMode) => Promise<typeof state>;
          setByokKey: (key: string) => Promise<typeof state>;
          loginCodex: () => Promise<typeof state>;
          logoutCodex: () => Promise<typeof state>;
          assistantTurn: (request: { userIntent: string }) => Promise<unknown>;
          getCredentials: () => Promise<{ openRouterApiKey: string | null; codexToken: string | null }>;
        };
        onProviderEvent: (listener: Listener) => () => void;
      };
    }).desktopAssistant = {
      provider: {
        status: async () => cloneState(),
        setMode: async (modeValue: ProviderMode) => {
          state.mode = modeValue;
          return cloneState();
        },
        setByokKey: async (key: string) => {
          state.hasByokKey = key.trim().length > 0;
          return cloneState();
        },
        loginCodex: async () => {
          state.codexLoginInProgress = true;
          emit({ type: 'codex-login-started', message: 'Opening ChatGPT login...' });
          state.hasCodexToken = true;
          state.codexLoginInProgress = false;
          state.codexAuthMethod = 'chatgpt';
          state.codexEmail = 'e2e@example.com';
          state.codexPlanType = 'pro';
          state.codexStatusMessage = 'ChatGPT login completed.';
          emit({ type: 'codex-login-completed', success: true, message: state.codexStatusMessage });
          return cloneState();
        },
        logoutCodex: async () => {
          state.hasCodexToken = false;
          state.codexAuthMethod = null;
          state.codexEmail = null;
          state.codexPlanType = null;
          state.codexStatusMessage = 'Logged out from ChatGPT.';
          emit({ type: 'codex-logout', success: true, message: state.codexStatusMessage });
          return cloneState();
        },
        assistantTurn: async (request: { userIntent: string }) => {
          if (scenario === 'error') {
            throw new Error("Codex exec failed (exit 1): invalid_json_schema: Missing 'answer'");
          }
          return {
            provider: 'codex',
            model: 'gpt-5.3-codex',
            mode: 'chat',
            answer: `Echo: ${request.userIntent}`,
            debugTrace: {
              transport: 'mock',
            },
          };
        },
        getCredentials: async () => ({
          openRouterApiKey: null,
          codexToken: state.hasCodexToken ? 'mock-codex-token' : null,
        }),
      },
      onProviderEvent: (listener: Listener) => {
        listeners.push(listener);
        return () => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      },
    };
  }, { scenario: mode });
}

test.describe('Blockly Assistant Codex provider flow', () => {
  test('supports login and chat send via codex provider path', async ({ page }) => {
    await installDesktopAssistantMock(page, 'chat-success');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    await openAssistant(page);

    await page.locator('select').first().selectOption('codex_oauth');
    await page.getByRole('button', { name: /login with chatgpt/i }).click();

    await expect(page.getByText(/Auth:\s*chatgpt/i)).toBeVisible();
    await expect(page.getByText(/e2e@example.com/i)).toBeVisible();
    await expect(page.getByText(/ChatGPT login completed\./i).first()).toBeVisible();

    const input = page.getByPlaceholder(/ask.*request edits/i);
    await input.fill('hello');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText('Echo: hello')).toBeVisible();
  });

  test('shows surfaced technical error for codex provider failure', async ({ page }) => {
    await installDesktopAssistantMock(page, 'error');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await openEditorFromProjectList(page);
    await openAssistant(page);

    await page.locator('select').first().selectOption('codex_oauth');
    await page.getByRole('button', { name: /login with chatgpt/i }).click();

    const input = page.getByPlaceholder(/ask.*request edits/i);
    await input.fill('hello');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText(/invalid_json_schema/i)).toBeVisible();
  });
});
