import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import process from 'node:process';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Isolated browser workload: source import, fixed local style, no external tiles.
const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-selection-benchmark', server: { host: '127.0.0.1', port: 0 },
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
  await server.listen();
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
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
    for (const [total, overlaps] of [[10, 10], [1000, 10], [10000, 10], [1000, 1000]]) {
      const editor = new GeometryEditor(map);
      editor.importGeoJSON({ type: 'FeatureCollection', features: Array.from({ length: total }, (_, i) => {
        const x = i < overlaps ? 4 : 10 + (i % 100) * 0.002;
        const y = i < overlaps ? 52 : 50 + Math.floor(i / 100) * 0.002;
        return { type: 'Feature', id: i, properties: { name: `Parcel ${i}` }, geometry: { type: 'Polygon',
          coordinates: [[[x-.001,y-.001],[x+.001,y-.001],[x+.001,y+.001],[x-.001,y+.001],[x-.001,y-.001]]] } };
      }) });
      const point = map.project([4,52]);
      const deadline = globalThis.performance.now() + 20000;
      while (editor.queryFeatures(point).length !== overlaps) {
        if (globalThis.performance.now() > deadline) throw new Error('Rendered fixture did not become ready');
        await new Promise(resolve => globalThis.requestAnimationFrame(resolve));
      }
      const samples = [];
      for (let sample = -10; sample < 50; sample++) {
        const start = globalThis.performance.now();
        for (let i = 0; i < 10; i++) editor.queryFeatures(point);
        if (sample >= 0) samples.push((globalThis.performance.now() - start) / 10);
      }
      samples.sort((a,b) => a-b);
      rows.push({ total, overlaps, hits: editor.queryFeatures(point).length, medianMs: samples[25], p95Ms: samples[47] });
      editor.destroy();
    }
    map.remove();
    return rows;
  });
  for (const row of rows) assert.equal(row.hits, row.overlaps);
  log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}; Chromium ${browser.version()}`);
  table(rows);
} finally { await browser?.close(); await server.close(); }
