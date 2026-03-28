import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import path from 'path'

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
) as { version: string }
const isDesktopBuild = process.env.VITE_DESKTOP_BUILD === '1'
const hmrHost = process.env.VITE_HMR_HOST?.trim() || '127.0.0.1'

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
    // pin HMR to the actual loopback server instead of the proxied page origin.
    hmr: {
      host: hmrHost,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@convex-generated': path.resolve(__dirname, '../../convex/_generated'),
    },
  },
})
