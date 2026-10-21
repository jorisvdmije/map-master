import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => ({
  root: 'examples/basic',
  // Live source updates in development; production demos consume the package build.
  resolve: command === 'serve'
    ? { alias: { '@geo/editor': fileURLToPath(new URL('./src/index.ts', import.meta.url)) } }
    : {},
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
