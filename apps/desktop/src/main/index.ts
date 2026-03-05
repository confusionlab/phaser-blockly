import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CodexAppServerClient } from './codexAppServer';
import type {
  AssistantProviderMode,
  CodexAssistantTurnRequest,
  ProviderCredentials,
  ProviderStatus,
} from '../shared/provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYCHAIN_SERVICE = 'PochaCodingAssistant';
const BYOK_ACCOUNT_PREFIX = 'openrouter-byok';
const PROVIDER_MODE_FILE_PREFIX = 'assistant-provider-mode';
const CODEX_AUTH_LINK_FILE = 'assistant-codex-auth-link.json';
const FALLBACK_SECRET_FILE = 'assistant-secrets.json';

let mainWindow: BrowserWindow | null = null;

type KeytarClient = {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
};

let keytarClient: KeytarClient | null | undefined;

const codexClient = new CodexAppServerClient(
  {
    name: 'pochacoding-desktop',
    title: 'PochaCoding',
    version: app.getVersion(),
  },
  (event) => {
    mainWindow?.webContents.send('assistant:provider:event', event);
  },
);

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

function assertValidUserId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Missing authenticated user id for provider scope.');
  }
  return value.trim();
}

function sanitizeUserIdForPath(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getScopedByokAccount(userId: string): string {
  return `${BYOK_ACCOUNT_PREFIX}:${userId}`;
}

function getProviderModePath(userId: string): string {
  return path.join(app.getPath('userData'), `${PROVIDER_MODE_FILE_PREFIX}:${sanitizeUserIdForPath(userId)}.json`);
}

async function readProviderMode(userId: string): Promise<AssistantProviderMode> {
  try {
    const content = await fs.readFile(getProviderModePath(userId), 'utf8');
    const parsed = JSON.parse(content) as { mode?: AssistantProviderMode };
    if (parsed.mode === 'managed' || parsed.mode === 'byok' || parsed.mode === 'codex_oauth') {
      return parsed.mode;
    }
    return 'managed';
  } catch {
    return 'managed';
  }
}

async function writeProviderMode(userId: string, mode: AssistantProviderMode): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(getProviderModePath(userId), JSON.stringify({ mode }), 'utf8');
}

async function readCodexLinkedUserId(): Promise<string | null> {
  try {
    const filePath = path.join(app.getPath('userData'), CODEX_AUTH_LINK_FILE);
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as { userId?: string | null };
    if (typeof parsed.userId === 'string' && parsed.userId.trim().length > 0) {
      return parsed.userId.trim();
    }
    return null;
  } catch {
    return null;
  }
}

async function writeCodexLinkedUserId(userId: string | null): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const filePath = path.join(app.getPath('userData'), CODEX_AUTH_LINK_FILE);
  await fs.writeFile(filePath, JSON.stringify({ userId }), 'utf8');
}

async function getProviderStatus(userId: string): Promise<ProviderStatus> {
  const mode = await readProviderMode(userId);
  const [byok, codexStatus] = await Promise.all([
    getSecret(getScopedByokAccount(userId)),
    codexClient.getStatus(),
  ]);
  const linkedCodexUserId = await readCodexLinkedUserId();
  const codexLinkedToAnotherUser =
    codexStatus.hasToken
    && !!linkedCodexUserId
    && linkedCodexUserId !== userId;
  const hasCodexToken = codexStatus.hasToken && linkedCodexUserId === userId;

  return {
    mode,
    hasByokKey: !!byok,
    hasCodexToken,
    codexAvailable: codexStatus.available && !codexLinkedToAnotherUser,
    codexAuthMethod: codexStatus.authMethod,
    codexEmail: hasCodexToken ? codexStatus.email : null,
    codexPlanType: hasCodexToken ? codexStatus.planType : null,
    codexLoginInProgress: codexStatus.loginInProgress,
    codexStatusMessage: codexLinkedToAnotherUser
      ? 'Codex auth on this device is linked to a different account. Re-authenticate for this account to use Codex.'
      : codexStatus.statusMessage,
  };
}

async function getProviderCredentials(userId: string): Promise<ProviderCredentials> {
  const linkedCodexUserId = await readCodexLinkedUserId();
  const [openRouterApiKey, codexToken] = await Promise.all([
    getSecret(getScopedByokAccount(userId)),
    linkedCodexUserId === userId ? codexClient.getAuthToken() : Promise.resolve(null),
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
  const desktopDist = path.resolve(__dirname, '../../../web/dist-desktop/index.html');
  if (existsSync(desktopDist)) {
    return desktopDist;
  }
  return path.resolve(__dirname, '../../../web/dist/index.html');
}

function createMainWindow(): BrowserWindow {
  const preloadCandidates = [
    path.join(__dirname, '../preload/index.cjs'),
    path.join(__dirname, '../preload/index.js'),
    path.join(__dirname, '../preload/index.mjs'),
  ];
  const preloadPath = preloadCandidates.find((candidate) => existsSync(candidate));
  if (!preloadPath) {
    throw new Error(`Preload bundle not found. Tried: ${preloadCandidates.join(', ')}`);
  }

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

function setupIpcHandlers(): void {
  ipcMain.handle('assistant:provider:get-status', async (_event, rawUserId: unknown) => {
    const userId = assertValidUserId(rawUserId);
    return getProviderStatus(userId);
  });

  ipcMain.handle('assistant:provider:get-credentials', async (_event, rawUserId: unknown) => {
    const userId = assertValidUserId(rawUserId);
    return getProviderCredentials(userId);
  });

  ipcMain.handle('assistant:provider:set-mode', async (_event, mode: AssistantProviderMode, rawUserId: unknown) => {
    const userId = assertValidUserId(rawUserId);
    if (mode !== 'managed' && mode !== 'byok' && mode !== 'codex_oauth') {
      throw new Error(`Invalid provider mode: ${String(mode)}`);
    }
    await writeProviderMode(userId, mode);
    return getProviderStatus(userId);
  });

  ipcMain.handle('assistant:provider:set-byok-key', async (_event, key: string, rawUserId: unknown) => {
    const userId = assertValidUserId(rawUserId);
    const byokAccount = getScopedByokAccount(userId);
    if (!key.trim()) {
      await deleteSecret(byokAccount);
    } else {
      await setSecret(byokAccount, key.trim());
    }
    return getProviderStatus(userId);
  });

  ipcMain.handle('assistant:provider:login-codex', async (_event, rawUserId: unknown) => {
    const userId = assertValidUserId(rawUserId);
    await codexClient.loginWithChatGpt();
    const codexStatus = await codexClient.getStatus();
    if (codexStatus.hasToken) {
      await writeCodexLinkedUserId(userId);
    }
    return getProviderStatus(userId);
  });

  ipcMain.handle('assistant:provider:logout-codex', async (_event, rawUserId: unknown) => {
    const userId = assertValidUserId(rawUserId);
    const linkedCodexUserId = await readCodexLinkedUserId();
    if (linkedCodexUserId && linkedCodexUserId !== userId) {
      throw new Error('codex_auth_linked_to_different_user');
    }
    await codexClient.logout();
    await writeCodexLinkedUserId(null);
    return getProviderStatus(userId);
  });

  ipcMain.handle('assistant:provider:assistant-turn', async (_event, request: CodexAssistantTurnRequest, rawUserId: unknown) => {
    const userId = assertValidUserId(rawUserId);
    const linkedCodexUserId = await readCodexLinkedUserId();
    if (linkedCodexUserId !== userId) {
      throw new Error('codex_oauth_missing_token');
    }
    return codexClient.runAssistantTurn(request);
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  codexClient.dispose();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
