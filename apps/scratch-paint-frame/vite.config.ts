import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: path.resolve(__dirname, '../web/public/scratch-paint-frame'),
  },
});
