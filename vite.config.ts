import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => ({
  root: 'examples/basic',
  build: { rollupOptions: { input: {
    playground: fileURLToPath(new URL('./examples/basic/index.html', import.meta.url)),
    guide: fileURLToPath(new URL('./examples/basic/guide.html', import.meta.url)),
  } } },
  // Live source updates in development; production demos consume the package build.
  resolve: command === 'serve'
    ? { alias: { '@jorisvdmije/map-master': fileURLToPath(new URL('./src/index.ts', import.meta.url)) } }
    : {},
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
