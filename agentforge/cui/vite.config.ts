import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Ship into the OpenEMR module so `panel.php` can load stable script/CSS names. */
const modulePublicCui = path.resolve(
  __dirname,
  '../../interface/modules/custom_modules/oe-module-agentforge/public/cui',
);

export default defineConfig({
  plugins: [react()],
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
});
