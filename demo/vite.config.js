import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import wasm from 'vite-plugin-wasm';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(__dirname),
  // Use relative base so it works under any Pages path (repo or subfolder)
  base: './',
  build: {
    // Allow override via env for GitHub Actions pages deployment
    outDir: process.env.DEMO_OUT_DIR
      ? resolve(__dirname, '..', process.env.DEMO_OUT_DIR)
      : resolve(__dirname, '../docs'), // Default to docs folder for GitHub Pages (branch)
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
  plugins: [wasm()],
  optimizeDeps: {
    exclude: ['@aid-on/nagare'], // Exclude from pre-bundling to ensure WASM works
  },
  server: {
    port: 3000,
    open: true,
  },
});
