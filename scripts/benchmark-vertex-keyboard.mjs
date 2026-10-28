import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import process from 'node:process';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-keyboard-benchmark', server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'benchmark-page', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><body style="margin:0"><div id="map" style="width:800px;height:600px"></div></body></html>');
    });
  } }],
});
let browser;
try {
  await server.listen(); browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(server.resolvedUrls.local[0]);
  const rows = await page.evaluate(async () => {
    const { Map, setWorkerUrl } = await import('/node_modules/maplibre-gl/dist/maplibre-gl.mjs');
    const { GeometryEditor } = await import('/src/index.ts');
    setWorkerUrl('/node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs');
    const map = new Map({ container: 'map', center: [4, 52], zoom: 13, fadeDuration: 0,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] } });
    await new Promise(resolve => map.once('load', resolve));
    const rows = [];
    const press = (target, key) => {
      target.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      target.dispatchEvent(new globalThis.KeyboardEvent('keyup', { key, bubbles: true }));
    };
    const stats = values => { values.sort((a, b) => a - b); return `${values[15].toFixed(3)} / ${values[28].toFixed(3)}`; };
    for (const count of [100, 1000, 10000]) {
      const editor = new GeometryEditor(map);
      editor.importGeoJSON({ type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString',
        coordinates: Array.from({ length: count }, (_, i) => [4 + i / count * 0.01, 52 + i / count * 0.01]) } });
      editor.select('line'); editor.editSelected(); press(map.getCanvas(), 'Home');
      const control = globalThis.document.querySelector('[data-geo-vertex-focus]');
      const navigation = []; const movement = [];
      for (let i = -5; i < 30; i++) {
        let start = globalThis.performance.now(); press(control, i % 2 === 0 ? 'Home' : 'End'); const focus = globalThis.performance.now() - start;
        start = globalThis.performance.now(); press(control, i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft'); const nudge = globalThis.performance.now() - start;
        if (i >= 0) { navigation.push(focus); movement.push(nudge); }
        await new Promise(resolve => globalThis.requestAnimationFrame(resolve));
      }
      rows.push({ vertices: count, controls: globalThis.document.querySelectorAll('[data-geo-vertex-keyboard] button').length,
        'navigation median/p95 ms': stats(navigation), 'nudge median/p95 ms': stats(movement) });
      editor.cancel(); editor.destroy();
      if (globalThis.document.querySelector('[data-geo-vertex-keyboard]')) throw new Error('Leaked keyboard controls');
    }
    map.remove(); return rows;
  });
  for (const row of rows) assert.equal(row.controls, 1);
  log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}; Chromium ${browser.version()}`); table(rows);
} finally { await browser?.close(); await server.close(); }
