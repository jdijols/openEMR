/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const openemrBase = env.VITE_OPENEMR_BASE_URL ?? 'https://oe.108-61-145-220.nip.io'

  return {
    // Dev: served at `/` on localhost:5174.
    // Prod: shipped into the agentforge module at
    //   interface/modules/custom_modules/oe-module-agentforge/public/dashboard/
    // OpenEMR's Apache serves the static files from there. Same-origin as
    // OpenEMR, so browser sends the existing PHP session on FHIR requests.
    base:
      command === 'build'
        ? '/interface/modules/custom_modules/oe-module-agentforge/public/dashboard/'
        : '/',
    // Production build: emit deterministic filenames (no content hash) so the
    // PHP loader can reference them directly without rebuilding the loader on
    // every deploy. The CUI follows this pattern (`agentforge-cui.js`).
    build:
      command === 'build'
        ? {
            outDir: fileURLToPath(
              new URL(
                '../interface/modules/custom_modules/oe-module-agentforge/public/dashboard/',
                import.meta.url,
              ),
            ),
            emptyOutDir: true,
            rollupOptions: {
              output: {
                entryFileNames: 'agentforge-dashboard.js',
                chunkFileNames: 'agentforge-dashboard-[name].js',
                assetFileNames: 'agentforge-dashboard-[name][extname]',
              },
            },
          }
        : undefined,
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5174,
      proxy: {
        '/oauth2/token': {
          target: openemrBase,
          changeOrigin: true,
          secure: false,
        },
        '/apis': {
          target: openemrBase,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      globals: true,
    },
  }
})
