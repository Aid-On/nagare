import { defineConfig } from 'vite';
import { resolve } from 'path';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],
  
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Nagare',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'js'}`,
    },
    
    rollupOptions: {
      external: [
        '@cloudflare/workers-types',
        'rxjs',
      ],
      
      output: {
        globals: {
          '@cloudflare/workers-types': 'CloudflareWorkersTypes',
        },
        // Avoid warning: entry uses named and default exports together
        exports: 'named',
      },
    },
    
    target: 'esnext',
    minify: 'terser',
    sourcemap: true,
    
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true,
      },
    },
  },
  
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  
  optimizeDeps: {
    exclude: ['@aid-on/nagare'],
  },
  
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    env: {
      VITEST: 'true',
      NODE_ENV: 'test',
    },
    define: {
      'process.env.VITEST': '"true"',
      'process.env.NODE_ENV': '"test"',
    },
  },
});
