import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: resolve(__dirname, 'public'),
  assetsInclude: ['**/*.wasm'],
  plugins: [
    {
      name: 'wasm-mime-fix',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
          }
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      three: resolve(__dirname, '../../node_modules/three'),
      '@thatopen/components': resolve(__dirname, '../../core/src'),
      '@thatopen/components-front': resolve(__dirname, '../../front/src'),
    },
  },
  optimizeDeps: {
    dedupe: ['three'],
  },
});
