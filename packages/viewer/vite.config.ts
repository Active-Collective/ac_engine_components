import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: resolve(__dirname, 'public'),
  assetsInclude: ['**/*.wasm'],
  resolve: {
    alias: {
      three: resolve(__dirname, '../../node_modules/three'),
    },
  },
  optimizeDeps: {
    dedupe: ['three'],
  },
});
