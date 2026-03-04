import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function resolveElectronBinary() {
  try {
    const electronBinaryPath = require('electron');
    if (typeof electronBinaryPath === 'string' && electronBinaryPath && existsSync(electronBinaryPath)) {
      return electronBinaryPath;
    }
    return null;
  } catch {
    return null;
  }
}

function installElectronBinary() {
  const electronPackageJson = require.resolve('electron/package.json');
  const electronDir = path.dirname(electronPackageJson);
  const installScriptPath = path.join(electronDir, 'install.js');

  const result = spawnSync(process.execPath, [installScriptPath], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`electron install script failed with exit code ${result.status ?? 'unknown'}`);
  }
}

if (!resolveElectronBinary()) {
  console.log('[ensure-electron] Electron binary missing. Installing...');
  installElectronBinary();
}

const electronPath = resolveElectronBinary();
if (!electronPath) {
  throw new Error('Electron binary is still unavailable after install.');
}

console.log(`[ensure-electron] OK: ${electronPath}`);
