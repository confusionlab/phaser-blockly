import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import path from 'path'

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
) as { version: string }
const isDesktopBuild = process.env.VITE_DESKTOP_BUILD === '1'

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
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@convex-generated': path.resolve(__dirname, '../../convex/_generated'),
      '@assistant-core': path.resolve(__dirname, '../../packages/assistant-core/src'),
    },
  },
})
