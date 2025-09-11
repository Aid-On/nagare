import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(__dirname),
  // Use relative base so it works under any Pages path (repo or subfolder)
  base: './',
  build: {
    outDir: resolve(__dirname, '../docs'), // Output to docs folder for GitHub Pages
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@aid-on/nagare': resolve(__dirname, '../src/index.ts'),
    },
  },
  optimizeDeps: {
    exclude: ['@aid-on/nagare'], // Exclude from pre-bundling to ensure WASM works
  },
  server: {
    port: 3000,
    open: true,
  },
});
