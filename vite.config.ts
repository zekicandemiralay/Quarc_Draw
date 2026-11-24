import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, sourcemap: false },
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
});
