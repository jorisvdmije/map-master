import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { createStaticServer } from './lib/static-server.mjs';
const site = resolve(import.meta.dirname, '..'), visual = process.argv.includes('--visual');
const names = process.argv.slice(2).filter(n => n !== '--visual'), browsers = { chromium, firefox, webkit };
const { basePath } = JSON.parse(readFileSync(resolve(site, 'dist/.build-info.json')));
const sourceMeta = JSON.parse(readFileSync(resolve(site, 'src/features/streets/observations-meta.json')));
const server = createStaticServer({ directory: resolve(site, 'dist'), basePath });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const name of names.length ? names : Object.keys(browsers)) {
    const browser = await browsers[name].launch({ headless: (process.env.GEO_DOCS_HEADED ?? process.env.GEO_COMPAT_HEADED) !== "1", ...(name === 'chromium' ? { args: ['--enable-unsafe-swiftshader'] } : {}) });
    const context = await browser.newContext({ viewport: { width: 1536, height: 1100 }, acceptDownloads: true }), page = await context.newPage(), errors = [];
    const evidence = resolve(site, `../artifacts/heatmaps/${name}${visual ? "-visual" : ""}`); mkdirSync(evidence, { recursive: true });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    if (!visual) await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0e8' } }] } }));
    const idle = () => page.locator('.st-map[data-idle="true"]').waitFor({ timeout: 60000 });
    const total = async () => +(await page.locator('.st-map').getAttribute('data-heat-total'));
    const exportHeat = async () => {
      await page.getByText('Exporteer selectie', { exact: true }).click();
      const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Concentraties GeoJSON', exact: true }).click();
      return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
    };
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}${basePath}/analysis/streets/`);
      await page.locator('[data-ready="true"]').waitFor({ timeout: 60000 }); await idle();
      // Failure of the optional concentration asset is recoverable and leaves streets usable.
      await page.route('**/data/amsterdam-street-heat.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
      await page.getByRole('button', { name: 'Concentraties', exact: true }).click();
      await page.getByText('Concentraties laden lukt nog niet', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Straten', exact: true }).isEnabled(), true);
      await page.unroute('**/data/amsterdam-street-heat.json'); errors.length = 0;
      await page.getByRole('button', { name: 'Probeer concentraties opnieuw', exact: true }).click();
      await page.locator('[data-heat-ready="true"]').waitFor({ timeout: 60000 }); await idle();
      assert.equal(await total(), sourceMeta.sources.find(s => s.key === 'reports').matched);
      assert.equal(await page.locator('.st-map canvas').count(), 1);
      await page.getByRole('button', { name: 'Hele selectie', exact: true }).click(); await idle();
      await page.locator('.st-map-frame').screenshot({ path: resolve(evidence, 'city-250m.png') });
      await page.getByRole('button', { name: 'Grotere kaart', exact: true }).click(); await idle();
      await page.getByRole('button', { name: 'Stadsdetail', exact: true }).click(); await idle();
      for (const radius of [100, 250, 500]) {
        await page.getByRole('button', { name: `${radius} m`, exact: true }).click(); await idle();
        assert.match(await page.locator('.st-heat-eyebrow').textContent(), new RegExp(`${radius} M`));
        await page.locator('.st-map-frame').screenshot({ path: resolve(evidence, `wide-${radius}m.png`) });
      }
      await page.getByRole('button', { name: 'Herstel weergave', exact: true }).click(); await idle();
      const beforeHex = await total();
      await page.getByRole('button', { name: 'Hexagonen', exact: true }).click(); await idle();
      assert.equal(await total(), beforeHex);
      for (const width of [100, 250, 500]) {
        await page.getByRole('button', { name: `${width} m`, exact: true }).click(); await idle();
        const hex = await exportHeat();
        assert.equal(hex.metadata.shape, 'hex'); assert.equal(hex.metadata.hexWidthMetres, width);
        assert.ok(hex.features.every(f => f.geometry.type === 'Polygon' && f.geometry.coordinates[0].length === 7));
        assert.equal(hex.features.reduce((s, f) => s + f.properties.count, 0), beforeHex);
        await page.locator('.st-map-frame').screenshot({ path: resolve(evidence, `hex-${width}m.png`) });
      }
      await page.getByRole('button', { name: '250 m', exact: true }).click(); await idle();
      const hexCity = await exportHeat();
      await page.getByLabel('Zoek straat of wegvak', { exact: true }).fill('Van Baerlestraat'); await idle();
      const hexStreet = await exportHeat(); assert.equal(hexStreet.metadata.reference, hexCity.metadata.reference);
      const hexCamera = await page.locator('.st-map').getAttribute('data-camera');
      await page.locator('.st-map-frame').scrollIntoViewIfNeeded();
      const hexBox = await page.locator('.st-map').boundingBox(), [hexLng, hexLat, hexZoom] = JSON.parse(hexCamera), hexWorld = 512 * 2 ** hexZoom;
      const projectHex = ([x, y]) => [(x + 180) / 360 * hexWorld, (1 - Math.log(Math.tan(Math.PI / 4 + y * Math.PI / 360)) / Math.PI) / 2 * hexWorld];
      const hexCenter = projectHex([hexLng, hexLat]);
      const hexTarget = hexStreet.features.map(f => {
        const ring = f.geometry.coordinates[0].slice(0, 6), center = ring.reduce((s, p) => [s[0] + p[0] / 6, s[1] + p[1] / 6], [0, 0]), point = projectHex(center);
        return { x: point[0] - hexCenter[0] + hexBox.width / 2, y: point[1] - hexCenter[1] + hexBox.height / 2 };
      }).find(p => p.x > 45 && p.x < hexBox.width - 45 && p.y > 90 && p.y < hexBox.height - 170);
      assert.ok(hexTarget, 'A real hexagon is visible');
      await page.mouse.click(hexBox.x + hexTarget.x, hexBox.y + hexTarget.y);
      await page.getByLabel('Geselecteerd bronvak', { exact: true }).waitFor(); await idle();
      assert.match(await page.getByLabel('Geselecteerd bronvak', { exact: true }).textContent(), /HEXAGON/);
      assert.equal(await page.locator('.st-map').getAttribute('data-camera'), hexCamera, 'Hexagon click preserves camera');
      await page.getByRole('button', { name: 'Sluit bronvak', exact: true }).click();

      await page.locator('.st-heat-table summary').click();
      await page.locator('.st-heat-table tbody button').first().click(); await page.getByLabel('Geselecteerd bronvak', { exact: true }).waitFor(); await idle();
      assert.equal(await page.locator('.st-map').getAttribute('data-camera'), hexCamera);
      await page.locator('.st-heat-table summary').click(); await page.getByRole('button', { name: 'Sluit bronvak', exact: true }).click();
      await page.getByLabel('Zoek straat of wegvak', { exact: true }).fill('');
      await page.getByRole('button', { name: 'Vloeiend', exact: true }).click(); await idle();
      const overview = await exportHeat(); assert.equal(overview.metadata.total, await total());
      assert.equal(overview.features.reduce((s, f) => s + f.properties.count, 0), overview.metadata.total);
      assert.equal(overview.metadata.cellMetres, 25); const globalReference = overview.metadata.reference;
      const expected = { trees: sourceMeta.sources.find(s => s.key === 'trees').matched, lights: sourceMeta.sources.find(s => s.key === 'lights').matched };
      for (const kind of ['trees', 'lights', 'faults', 'nuisance', 'maintenance']) {
        await page.getByLabel('Onderwerp concentraties', { exact: true }).selectOption(kind); await idle();
        assert.ok(await total() > 0, `${kind} has observations`); if (expected[kind]) assert.equal(await total(), expected[kind]);
        if (kind === 'trees' || kind === 'faults') await page.locator('.st-map-frame').screenshot({ path: resolve(evidence, `${kind}.png`) });
      }
      await page.getByLabel('Onderwerp concentraties', { exact: true }).selectOption('reports');
      await page.getByLabel('Zoek straat of wegvak', { exact: true }).fill('Van Baerlestraat'); await idle();
      const street = await exportHeat(); assert.ok(street.metadata.total > 0 && street.metadata.total < overview.metadata.total);
      assert.equal(street.metadata.reference, globalReference, 'Filtering streets retains the global color reference');
      const counts = JSON.parse(readFileSync(resolve(site, 'src/features/streets/observations.json'))).roads;
      const roads = JSON.parse(readFileSync(resolve(site, 'src/features/streets/roads.json'))).features.filter(f => f.properties.name === 'Van Baerlestraat');
      const expectedReports = roads.reduce((s, r) => s + counts[r.properties.id].reports.reduce((a, b) => a + b, 0), 0);
      assert.equal(street.metadata.total, expectedReports);
      await page.getByLabel('Periode meldingen', { exact: true }).selectOption('3'); await idle();
      const quarter = await exportHeat(); assert.equal(quarter.metadata.reference, globalReference); assert.ok(quarter.metadata.total <= street.metadata.total);
      assert.equal(quarter.metadata.months, 3);
      await page.getByLabel('Periode meldingen', { exact: true }).selectOption('12'); await idle();
      await page.getByRole('button', { name: 'Bekijk Van Baerlestraat', exact: true }).click();
      await page.getByRole('button', { name: 'Zoom naar straat', exact: true }).click(); await idle();
      await page.locator('.st-map-frame').scrollIntoViewIfNeeded();
      await page.locator('.st-map-frame').screenshot({ path: resolve(evidence, 'street-heat.png') });
      for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await idle(); }
      assert.equal(await page.locator('.st-map-frame').getAttribute('data-heat-detail'), 'points');
      assert.equal(await page.locator('.st-heat-detail-legend').isVisible(), true, 'Detail legend describes point size rather than heat color');
      await page.locator('.st-map-frame').screenshot({ path: resolve(evidence, 'close-source-cells.png') });
      const box = await page.locator('.st-map').boundingBox(), camera = await page.locator('.st-map').getAttribute('data-camera');
      const [lng, lat, zoom] = JSON.parse(camera), world = 512 * 2 ** zoom;
      const project = ([x, y]) => [(x + 180) / 360 * world, (1 - Math.log(Math.tan(Math.PI / 4 + y * Math.PI / 360)) / Math.PI) / 2 * world];
      const center = project([lng, lat]);
      const point = street.features.map(f => { const p = project(f.geometry.coordinates); return { x: p[0] - center[0] + box.width / 2, y: p[1] - center[1] + box.height / 2 }; }).find(p => p.x > 60 && p.x < box.width - 60 && p.y > 95 && p.y < box.height - 210);
      assert.ok(point, 'A real source grid cell is visible');
      await page.mouse.click(box.x + point.x, box.y + point.y);
      await page.getByLabel('Geselecteerd bronvak', { exact: true }).waitFor(); await idle();
      assert.equal(await page.locator('.st-map').getAttribute('data-camera'), camera, 'Cell selection preserves camera');
      await page.getByRole('button', { name: 'Sluit bronvak', exact: true }).click();
      await page.locator('.st-heat-table summary').click();
      await page.locator('.st-heat-table tbody button').first().focus(); await page.keyboard.press('Enter');
      await page.getByLabel('Geselecteerd bronvak', { exact: true }).waitFor(); await idle();
      assert.equal(await page.locator('.st-map').getAttribute('data-camera'), camera, 'Keyboard selection from cell table preserves camera');
      await page.locator('.st-heat-table summary').click();
      await page.getByRole('button', { name: 'Sluit bronvak', exact: true }).click();
      await page.getByLabel('Zoek straat of wegvak', { exact: true }).fill('no-match-heat-source'); await idle();
      assert.equal(await total(), 0); await page.getByRole('button', { name: 'Wis straatfilters', exact: true }).click(); await idle();
      await page.getByRole('button', { name: 'Compacte kaart', exact: true }).click(); await idle();
      await page.setViewportSize({ width: 390, height: 844 }); await idle();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No mobile overflow');
      await page.getByLabel('Onderwerp concentraties', { exact: true }).selectOption('trees'); await idle();
      await page.getByRole('button', { name: '100 m', exact: true }).click(); await idle();
      await page.locator('.st-map-frame').screenshot({ path: resolve(evidence, 'mobile-trees.png') });
      await page.getByRole('button', { name: 'Hexagonen', exact: true }).click(); await idle();
      await page.locator('.st-map-frame').screenshot({ path: resolve(evidence, 'mobile-hex.png') });
      await page.getByRole('button', { name: 'Vloeiend', exact: true }).click(); await idle();
      await page.screenshot({ path: resolve(evidence, 'mobile-page.png'), fullPage: true });
      await page.getByRole('button', { name: 'Filters', exact: true }).click(); await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button', { name: 'Filters', exact: true }).evaluate(el => el === document.activeElement), true);
      for (const width of [320, 768, 1090]) {
        await page.setViewportSize({ width, height: 900 }); await idle();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No ${width}px overflow`);
        const buttonEdges = await page.locator('.st-map-toolbar button:visible').evaluateAll(buttons => buttons.map(b => ({ left: b.getBoundingClientRect().left, right: b.getBoundingClientRect().right })));
        assert.ok(buttonEdges.every(b => b.left >= 0 && b.right <= width + 1), `Map toolbar stays usable at ${width}px`);
      }
      await page.getByRole('button', { name: 'Straten', exact: true }).click(); await idle();
      assert.equal(await page.locator('.st-heat-legend').count(), 0);
      if (!visual) assert.deepEqual(errors, [], 'No browser/map-expression errors'); else if (errors.length) console.log('External-map console messages:', errors.slice(0, 4));
      console.log(`✓ ${name}: heatmap lazy load/recovery, six subjects, linear source weights, 100/250/500m smoothing and hex grids, polygon exports and clicks, fixed reference, period/filter/export reconciliation, cell click without zoom, point transition, expanded and mobile layouts`);
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
