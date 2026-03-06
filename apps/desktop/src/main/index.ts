import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGED_WEB_URL = 'https://code.confusionlab.com';
const PACKAGED_WEB_CACHE_RESET_MARKER_PREFIX = 'packaged-web-cache-reset';
const APP_NAME = 'PochaCoding';
const BRANCH_NAME = (process.env.DESKTOP_APP_BRANCH || '').trim();
const APP_TITLE = BRANCH_NAME ? `${BRANCH_NAME} - ${APP_NAME}` : APP_NAME;

let mainWindow: BrowserWindow | null = null;

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

app.whenReady().then(async () => {
  if (BRANCH_NAME) {
    app.setName(`${APP_NAME} (${BRANCH_NAME})`);
  }
  await maybeResetPackagedWebCache();
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
