import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022', chunkSizeWarningLimit: 1500, sourcemap: false,
    rollupOptions: {
      output: {
        // pdf.js' worker is a module script, which a browser only runs when the server calls it JavaScript. A server that
        // does not know the ".mjs" extension (older nginx images, the local servers inside the Android and desktop apps)
        // sends a generic download, and every PDF then fails to open. So no asset keeps the ".mjs" name: same file, same
        // hash, named ".js", which every server knows (the same fix as in Quarc Reader).
        assetFileNames: (info) => {
          const name = (info.names && info.names[0]) || (info as { name?: string }).name || '';
          return /[.]mjs$/i.test(name) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  // The app calls the Quarc server with relative paths (/api/...). In development and in the end-to-end tests the
  // server runs on its own port, so Vite forwards those calls (QUARC_API_PROXY, default the local dev server).
  server: { port: 5173, host: true, proxy: { '/api': process.env.QUARC_API_PROXY || 'http://localhost:3009' } },
  preview: { port: 4173, host: true, proxy: { '/api': process.env.QUARC_API_PROXY || 'http://localhost:3009' } },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
});
