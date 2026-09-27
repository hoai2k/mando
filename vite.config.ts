import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
    // extra pages: the model workbench at /workbench/, and the weapon-removal
    // review bench at /mirror-bench/
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        workbench: resolve(__dirname, 'workbench/index.html'),
        mirrorBench: resolve(__dirname, 'mirror-bench/index.html'),
      },
    },
  },
});
