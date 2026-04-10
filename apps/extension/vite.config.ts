import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const watchMode = process.env.VITE_WATCH === 'true';
const extensionRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: !watchMode,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        sidepanel: `${extensionRoot}sidepanel.html`
      }
    }
  }
});
