import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import process from 'node:process';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-alignment-benchmark', server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'benchmark-page', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><body style="margin:0"><div id="map" style="position:relative;width:800px;height:600px"></div></body></html>');
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
    const rows = []; const frame = () => new Promise(resolve => globalThis.requestAnimationFrame(resolve));
    for (const total of [100, 1000, 10_000]) {
      const editor = new GeometryEditor(map, { alignmentGuides: { enabled: true } });
      const at = (x, y) => map.unproject([x, y]).toArray();
      editor.importGeoJSON({ type: 'FeatureCollection', features: Array.from({ length: total }, (_, i) => {
        const x = 20 + (i * 37 % 740); const y = 20 + (i * 53 % 540);
        return { type: 'Feature', id: i, properties: {}, geometry: { type: 'Polygon',
          coordinates: [[at(x, y), at(x + 12, y + 2), at(x + 10, y + 12), at(x - 2, y + 10), at(x, y)]] } };
      }) });
      await new Promise(resolve => map.once('idle', resolve));
      editor.draw('LineString'); const canvas = map.getCanvas(); const bounds = canvas.getBoundingClientRect();
      const samples = []; let acquired = 0; let maxInspected = 0; let coldMs = 0;
      for (let i = -10; i < 50; i++) {
        await frame();
        const start = globalThis.performance.now();
        canvas.dispatchEvent(new globalThis.MouseEvent('mousemove', { bubbles: true, clientX: bounds.x + 200 + ((i + 10) * 47 % 350), clientY: bounds.y + 150 + ((i + 10) * 71 % 250) }));
        await frame();
        const elapsed = globalThis.performance.now() - start;
        const result = editor.getAlignment(); acquired += Number(result !== null); maxInspected = Math.max(maxInspected, result?.examinedCandidates ?? 0);
        if (i === -10) coldMs = elapsed;
        if (i >= 0) samples.push(elapsed);
      }
      samples.sort((a, b) => a - b);
      rows.push({ features: total, vertices: total * 4, coldMs, medianMs: samples[25], p95Ms: samples[47], acquired, maxInspected });
      editor.destroy();
    }
    map.remove(); return rows;
  });
  for (const row of rows) { assert.ok(row.acquired > 0); assert.ok(row.maxInspected <= 96); }
  log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}; Chromium ${browser.version()}`);
  table(rows);
} finally { await browser?.close(); await server.close(); }
