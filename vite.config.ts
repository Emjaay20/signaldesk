import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'web'),
  esbuild: {
    jsx: 'automatic',
  },
  build: {
    outDir: resolve(__dirname, 'public'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:3010',
      '/health': 'http://localhost:3010',
      '/healthz': 'http://localhost:3010',
      '/readyz': 'http://localhost:3010',
      '/metrics': 'http://localhost:3010',
    },
  },
});
