import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022', chunkSizeWarningLimit: 1500, sourcemap: false,
  },
  // The app calls the Quarc server with relative paths (/api/...). In development and in the end-to-end tests the
  // server runs on its own port, so Vite forwards those calls (QUARC_API_PROXY, default the local dev server).
  server: { port: 5173, host: true, proxy: { '/api': process.env.QUARC_API_PROXY || 'http://localhost:3009' } },
  preview: { port: 4173, host: true, proxy: { '/api': process.env.QUARC_API_PROXY || 'http://localhost:3009' } },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
});
