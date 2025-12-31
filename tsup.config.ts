import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  external: ['@cloudflare/workers-types'],
  treeshake: true,
  minify: false,
  esbuildOptions(options) {
    // Support for multiple environments
    options.conditions = ['worker', 'browser', 'node'];
  },
});