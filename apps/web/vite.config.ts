import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import path from 'path'

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
) as { version: string }
const isDesktopBuild = process.env.VITE_DESKTOP_BUILD === '1'

function readOptionalPort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const hmrHost = process.env.VITE_HMR_HOST?.trim() || 'localhost'
const hmrClientPort =
  readOptionalPort(process.env.VITE_HMR_CLIENT_PORT)
  ?? readOptionalPort(process.env.DESKTOP_WEB_PORT)
  ?? 5173

// https://vite.dev/config/
export default defineConfig({
  envDir: path.resolve(__dirname, '../../'),
  base: isDesktopBuild ? './' : '/',
  build: {
    outDir: isDesktopBuild ? 'dist-desktop' : 'dist',
  },
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  server: {
    // When the browser is opened through a localhost proxy/worktree wrapper,
    // pin HMR to the actual dev server instead of the proxied page origin.
    hmr: {
      host: hmrHost,
      clientPort: hmrClientPort,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@convex-generated': path.resolve(__dirname, '../../convex/_generated'),
    },
  },
})
