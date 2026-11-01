import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => ({
  root: 'examples/basic',
  plugins: [{
    name: 'map-master-brand',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // The canonical logo lives outside the demo's dev-server root.
        // Embed the same asset in development and production HTML.
        const logo = readFileSync(new URL('./assets/icon.svg', import.meta.url), 'utf8');
        return html.replaceAll('../../assets/icon.svg', `data:image/svg+xml,${encodeURIComponent(logo)}`);
      },
    },
  }],
  // The demo bundles MapLibre GL JS (about 1.3 MB minified).
  build: { chunkSizeWarningLimit: 1500, rollupOptions: { input: {
    playground: fileURLToPath(new URL('./examples/basic/index.html', import.meta.url)),
    mapbox: fileURLToPath(new URL('./examples/basic/mapbox.html', import.meta.url)),
    guide: fileURLToPath(new URL('./examples/basic/guide.html', import.meta.url)),
  } } },
  // Live source updates in development; production demos consume the package build.
  resolve: command === 'serve'
    ? { alias: [
      { find: '@jorisvdmije/map-master/mapbox', replacement: fileURLToPath(new URL('./src/mapbox/index.ts', import.meta.url)) },
      { find: '@jorisvdmije/map-master', replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
    ] }
    : {},
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
