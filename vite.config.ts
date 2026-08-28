import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
    // second page: the model workbench at /workbench/
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        workbench: resolve(__dirname, 'workbench/index.html'),
      },
    },
  },
});
