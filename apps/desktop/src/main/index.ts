import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CodexAppServerClient } from './codexAppServer';
import type {
  AssistantProviderMode,
  CodexAssistantTurnRequest,
  ProviderStatus,
} from '../shared/provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_MODE_FILE_PREFIX = 'assistant-provider-mode';
const CODEX_AUTH_LINK_FILE = 'assistant-codex-auth-link.json';
const DEFAULT_PACKAGED_WEB_URL = 'https://code.confusionlab.com';
const PACKAGED_WEB_CACHE_RESET_MARKER_PREFIX = 'packaged-web-cache-reset';
const APP_NAME = 'PochaCoding';
const BRANCH_NAME = (process.env.DESKTOP_APP_BRANCH || '').trim();
const APP_TITLE = BRANCH_NAME ? `${BRANCH_NAME} - ${APP_NAME}` : APP_NAME;

let mainWindow: BrowserWindow | null = null;

const codexClient = new CodexAppServerClient(
  {
    name: 'pochacoding-desktop',
    title: APP_TITLE,
    version: app.getVersion(),
  },
  (event) => {
    mainWindow?.webContents.send('assistant:provider:event', event);
  },
);

function assertValidUserId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Missing authenticated user id for provider scope.');
  }
  return value.trim();
}

function sanitizeUserIdForPath(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getProviderModePath(userId: string): string {
  return path.join(app.getPath('userData'), `${PROVIDER_MODE_FILE_PREFIX}:${sanitizeUserIdForPath(userId)}.json`);
}

async function readProviderMode(userId: string): Promise<AssistantProviderMode> {
  try {
    const content = await fs.readFile(getProviderModePath(userId), 'utf8');
    const parsed = JSON.parse(content) as { mode?: AssistantProviderMode };
    if (parsed.mode === 'managed' || parsed.mode === 'codex_oauth') {
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
  const codexStatus = await codexClient.getStatus();
  const linkedCodexUserId = await readCodexLinkedUserId();
  const codexLinkedToAnotherUser =
    codexStatus.hasToken
    && !!linkedCodexUserId
    && linkedCodexUserId !== userId;
  const hasCodexToken = codexStatus.hasToken && linkedCodexUserId === userId;

  return {
    mode,
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

function getPackagedWebUrl(): string {
  const override = process.env.POCHACODING_DESKTOP_PROD_WEB_URL?.trim();
  return override && override.length > 0 ? override : DEFAULT_PACKAGED_WEB_URL;
}

function getPackagedWebCacheResetMarkerPath(): string {
  return path.join(
    app.getPath('userData'),
    `${PACKAGED_WEB_CACHE_RESET_MARKER_PREFIX}-${app.getVersion()}.json`,
  );
}

async function maybeResetPackagedWebCache(): Promise<void> {
  if (!app.isPackaged) {
    return;
  }

  const markerPath = getPackagedWebCacheResetMarkerPath();
  if (existsSync(markerPath)) {
    return;
  }

  const targetUrl = getPackagedWebUrl();
  let origin: string | null = null;
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    origin = null;
  }

  try {
    await BrowserWindow.getAllWindows()[0]?.webContents.session.clearCache();
  } catch {
    // ignore, we'll use defaultSession fallback below
  }

  try {
    await session.defaultSession.clearCache();
  } catch (error) {
    console.warn('[Desktop] Failed clearing HTTP cache:', error);
  }

  if (origin) {
    try {
      await session.defaultSession.clearStorageData({
        origin,
        storages: ['serviceworkers', 'cachestorage'],
      });
    } catch (error) {
      console.warn('[Desktop] Failed clearing origin storage cache:', error);
    }
  }

  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(markerPath, JSON.stringify({ resetAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (error) {
    console.warn('[Desktop] Failed writing packaged cache reset marker:', error);
  }
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
    title: APP_TITLE,
  });

  const overrideDevUrl = process.env.POCHACODING_DESKTOP_WEB_URL?.trim();
  const devUrl = process.env.ELECTRON_RENDERER_URL?.trim();
  const fallbackDevUrl = 'http://localhost:5173';
  if (!app.isPackaged) {
    // Allow forcing Electron dev to a hosted HTTPS app domain for Clerk prod-origin checks.
    void window.loadURL(overrideDevUrl || devUrl || fallbackDevUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    const packagedWebUrl = getPackagedWebUrl();
    if (/^https?:\/\//i.test(packagedWebUrl)) {
      void window.loadURL(packagedWebUrl).catch((error) => {
        console.error('[Desktop] Failed to load packaged remote URL:', error);
        const safeMessage = String(error instanceof Error ? error.message : error).replace(/</g, '&lt;');
        void window.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(
            `<html><body style="font-family:system-ui;padding:24px;">
              <h2>Failed to load app</h2>
              <p>Could not load <code>${packagedWebUrl}</code>.</p>
              <pre>${safeMessage}</pre>
            </body></html>`,
          )}`,
        );
      });
    } else {
      void window.loadFile(getProdWebEntry());
    }
  }

  return window;
}

function setupIpcHandlers(): void {
  ipcMain.handle('assistant:provider:get-status', async (_event, rawUserId: unknown) => {
    const userId = assertValidUserId(rawUserId);
    return getProviderStatus(userId);
  });

  ipcMain.handle('assistant:provider:set-mode', async (_event, mode: AssistantProviderMode, rawUserId: unknown) => {
    const userId = assertValidUserId(rawUserId);
    if (mode !== 'managed' && mode !== 'codex_oauth') {
      throw new Error(`Invalid provider mode: ${String(mode)}`);
    }
    await writeProviderMode(userId, mode);
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

app.whenReady().then(async () => {
  if (BRANCH_NAME) {
    app.setName(`${APP_NAME} (${BRANCH_NAME})`);
  }
  await maybeResetPackagedWebCache();
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
