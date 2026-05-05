import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Ship into the OpenEMR module so `panel.php` can load stable script/CSS names. */
const modulePublicCui = path.resolve(
  __dirname,
  '../../interface/modules/custom_modules/oe-module-agentforge/public/cui',
);

export default defineConfig(({ command }) => ({
  plugins: [react()],
  /* In production the CUI is served by OpenEMR at `<webroot>/interface/.../public/cui/`,
     so any URLs emitted into the bundle (chunked JS, woff2 font files referenced
     from CSS @font-face) must carry that prefix — otherwise they 404 at root.
     Dev (`vite serve`) keeps `/` so http://localhost:5173/ still works. */
  base: command === 'build'
    ? '/interface/modules/custom_modules/oe-module-agentforge/public/cui/'
    : '/',
  build: {
    outDir: modulePublicCui,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'agentforge-cui.js',
        chunkFileNames: 'agentforge-cui-[name].js',
        assetFileNames: 'agentforge-cui-[name][extname]',
      },
    },
  },
}));
