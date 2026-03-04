import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AssistantProviderMode, ProviderCredentials, ProviderStatus } from '../shared/provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYCHAIN_SERVICE = 'PochaCodingAssistant';
const BYOK_ACCOUNT = 'openrouter-byok';
const CODEX_ACCOUNT = 'codex-oauth-token';
const PROVIDER_MODE_FILE = 'assistant-provider-mode.json';
const FALLBACK_SECRET_FILE = 'assistant-secrets.json';

let mainWindow: BrowserWindow | null = null;
type KeytarClient = {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
};

let keytarClient: KeytarClient | null | undefined;

async function getKeytarClient() {
  if (keytarClient !== undefined) return keytarClient;
  try {
    const imported = await import('keytar');
    const candidate = (imported.default ?? imported) as unknown as KeytarClient;
    keytarClient = candidate;
    return keytarClient;
  } catch {
    keytarClient = null;
    return null;
  }
}

async function fallbackSecretFilePath(): Promise<string> {
  return path.join(app.getPath('userData'), FALLBACK_SECRET_FILE);
}

async function readFallbackSecrets(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(await fallbackSecretFilePath(), 'utf8');
    const parsed = JSON.parse(content) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeFallbackSecrets(secrets: Record<string, string>): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(await fallbackSecretFilePath(), JSON.stringify(secrets), 'utf8');
}

async function getSecret(account: string): Promise<string | null> {
  const client = await getKeytarClient();
  if (client) {
    return client.getPassword(KEYCHAIN_SERVICE, account);
  }
  const fallback = await readFallbackSecrets();
  return fallback[account] || null;
}

async function setSecret(account: string, value: string): Promise<void> {
  const client = await getKeytarClient();
  if (client) {
    await client.setPassword(KEYCHAIN_SERVICE, account, value);
    return;
  }
  const fallback = await readFallbackSecrets();
  fallback[account] = value;
  await writeFallbackSecrets(fallback);
}

async function deleteSecret(account: string): Promise<void> {
  const client = await getKeytarClient();
  if (client) {
    await client.deletePassword(KEYCHAIN_SERVICE, account);
    return;
  }
  const fallback = await readFallbackSecrets();
  delete fallback[account];
  await writeFallbackSecrets(fallback);
}

function getProviderModePath(): string {
  return path.join(app.getPath('userData'), PROVIDER_MODE_FILE);
}

async function readProviderMode(): Promise<AssistantProviderMode> {
  try {
    const content = await fs.readFile(getProviderModePath(), 'utf8');
    const parsed = JSON.parse(content) as { mode?: AssistantProviderMode };
    if (parsed.mode === 'managed' || parsed.mode === 'byok' || parsed.mode === 'codex_oauth') {
      return parsed.mode;
    }
    return 'managed';
  } catch {
    return 'managed';
  }
}

async function writeProviderMode(mode: AssistantProviderMode): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(getProviderModePath(), JSON.stringify({ mode }), 'utf8');
}

async function getProviderStatus(): Promise<ProviderStatus> {
  const mode = await readProviderMode();
  const byok = await getSecret(BYOK_ACCOUNT);
  const codex = await getSecret(CODEX_ACCOUNT);
  return {
    mode,
    hasByokKey: !!byok,
    hasCodexToken: !!codex,
    codexAvailable: true,
  };
}

function normalizeBearerToken(value: string): string {
  return value.replace(/^bearer\s+/i, '').trim();
}

function extractCodexToken(raw: string): string {
  const trimmed = normalizeBearerToken(raw.trim());
  if (!trimmed) return '';

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const candidates = ['access_token', 'token', 'id_token', 'authToken'];
      for (const key of candidates) {
        const value = parsed[key];
        if (typeof value === 'string' && value.trim()) {
          return normalizeBearerToken(value);
        }
      }
    } catch {
      // fall through to URL/raw token parsing
    }
  }

  try {
    const url = new URL(trimmed);
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const hashParams = new URLSearchParams(hash);
    const tokenCandidate =
      url.searchParams.get('access_token')
      || hashParams.get('access_token')
      || url.searchParams.get('token')
      || hashParams.get('token')
      || url.searchParams.get('id_token')
      || hashParams.get('id_token');
    if (typeof tokenCandidate === 'string' && tokenCandidate.trim()) {
      return normalizeBearerToken(tokenCandidate);
    }
  } catch {
    // treat as raw token
  }

  return trimmed;
}

async function getProviderCredentials(): Promise<ProviderCredentials> {
  const [openRouterApiKey, codexToken] = await Promise.all([
    getSecret(BYOK_ACCOUNT),
    getSecret(CODEX_ACCOUNT),
  ]);
  return {
    openRouterApiKey,
    codexToken,
  };
}

function getProdWebEntry(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web-dist', 'index.html');
  }
  return path.resolve(__dirname, '../../../web/dist/index.html');
}

function createMainWindow(): BrowserWindow {
  const preloadJsPath = path.join(__dirname, '../preload/index.js');
  const preloadMjsPath = path.join(__dirname, '../preload/index.mjs');
  const preloadPath = existsSync(preloadJsPath) ? preloadJsPath : preloadMjsPath;

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: 'PochaCoding',
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(getProdWebEntry());
  }

  return window;
}

function setupOAuthDeepLink(): void {
  if (!app.isDefaultProtocolClient('pochacoding')) {
    app.setAsDefaultProtocolClient('pochacoding');
  }

  app.on('open-url', (event, url) => {
    event.preventDefault();
    mainWindow?.webContents.send('assistant:oauth-callback', { url });
  });
}

function setupIpcHandlers(): void {
  ipcMain.handle('assistant:provider:get-status', async () => {
    return getProviderStatus();
  });

  ipcMain.handle('assistant:provider:get-credentials', async () => {
    return getProviderCredentials();
  });

  ipcMain.handle('assistant:provider:set-mode', async (_event, mode: AssistantProviderMode) => {
    if (mode !== 'managed' && mode !== 'byok' && mode !== 'codex_oauth') {
      throw new Error(`Invalid provider mode: ${String(mode)}`);
    }
    await writeProviderMode(mode);
    return getProviderStatus();
  });

  ipcMain.handle('assistant:provider:set-byok-key', async (_event, key: string) => {
    if (!key.trim()) {
      await deleteSecret(BYOK_ACCOUNT);
    } else {
      await setSecret(BYOK_ACCOUNT, key.trim());
    }
    return getProviderStatus();
  });

  ipcMain.handle('assistant:provider:set-codex-token', async (_event, token: string) => {
    if (!token.trim()) {
      await deleteSecret(CODEX_ACCOUNT);
    } else {
      const normalized = extractCodexToken(token);
      if (!normalized) {
        throw new Error('No usable token found in provided Codex OAuth input.');
      }
      await setSecret(CODEX_ACCOUNT, normalized);
    }
    return getProviderStatus();
  });

  ipcMain.handle('assistant:provider:logout-codex', async () => {
    await deleteSecret(CODEX_ACCOUNT);
    return getProviderStatus();
  });
}

app.whenReady().then(() => {
  setupOAuthDeepLink();
  setupIpcHandlers();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
