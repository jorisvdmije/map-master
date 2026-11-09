import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { createStaticServer } from './lib/static-server.mjs';
const site = resolve(import.meta.dirname, '..'), output = resolve(site, '../artifacts/data-catalog');
mkdirSync(output, { recursive: true });
const { basePath } = JSON.parse(readFileSync(resolve(site, 'dist/.build-info.json')));
const catalog = JSON.parse(readFileSync(resolve(site, '.generated/data-catalog.json')));
const server = createStaticServer({ directory: resolve(site, 'dist'), basePath });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const root = `http://127.0.0.1:${server.address().port}${basePath}`, results = [];
try {
  // Validate every exported profile and its local downloads, not a hand-maintained page list.
  for (const entry of catalog.datasets) {
    const response = await fetch(`${root}/data/${entry.id}/`); assert.equal(response.status, 200);
    const html = await response.text(); assert.ok(html.includes(`data-dataset-detail="${entry.id}"`));
    for (const file of entry.downloads) {
      const response = await fetch(`${root}${file.path}`); assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    }
  }
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit']) {
    const browser = await { chromium, firefox, webkit }[name].launch();
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', request => requests.push(request.url()));
    try {
      await page.goto(`${root}/data/`); await page.locator('[data-catalog][data-ready=true]').waitFor(); await page.getByLabel('Zoek datasets', { exact: true }).fill('fijnstof');
      await page.locator('[data-dataset=\"luchtmeetnet\"]').waitFor(); assert.equal(await page.locator('.db-card').count(), 1);
      assert.equal(await page.locator('canvas').count(), 0); assert.ok(!requests.some(url => /amsterdam-(roads|housing|street-observations|street-heat)/.test(url)), 'Browsing metadata must not download full data');
      await page.getByRole('button', { name: /Bewaar Luchtkwaliteit/ }).click();
      await page.getByLabel('Zoek datasets', { exact: true }).fill('');
      await page.getByRole('button', { name: /Mijn bewaarde bronnen/ }).click();
      assert.equal(await page.locator('.db-card').count(), 1);
      await page.reload(); await page.locator('[data-catalog][data-ready=true]').waitFor(); await page.locator('[data-dataset=\"luchtmeetnet\"]').waitFor(); assert.equal(await page.locator('.db-card').count(), 1);
      await page.getByRole('button', { name: 'Tabelweergave', exact: true }).click(); assert.equal(await page.locator('.db-table tbody tr').count(), 1);
      await page.locator('.db-export summary').click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Bronprofielen JSON', exact: true }).click()]);
      const saved = JSON.parse(readFileSync(await download.path())); assert.equal(saved.datasets.length, 1); assert.equal(saved.datasets[0].id, 'luchtmeetnet');
      await page.getByRole('button', { name: 'Wis alle filters', exact: true }).click();
      assert.equal(await page.locator('.db-table tbody tr').count(), catalog.datasets.length);
      await page.getByLabel('Beschikbaarheid', { exact: true }).selectOption('local');
      assert.equal(await page.locator('.db-table tbody tr').count(), 4);
      await page.getByLabel('Thema', { exact: true }).selectOption('wonen');
      assert.equal(await page.locator('.db-table tbody tr').count(), 1);
      await page.goBack(); await page.waitForFunction(() => document.querySelectorAll('.db-table tbody tr').length === 4);
      await page.getByRole('link', { name: 'Wonen en buurtcijfers', exact: true }).click();
      await page.locator('[data-dataset-detail=cbs-buurten]').waitFor();
      const [geojson] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Buurtvlakken met alle kenmerken/ }).click()]);
      const data = JSON.parse(readFileSync(await geojson.path())); assert.equal(data.type, 'FeatureCollection'); assert.equal(data.features.length, 519); assert.ok(data.provenance.sha256);
      assert.equal(await page.getByRole('link', { name: 'Open woningkaart', exact: true }).getAttribute('href'), `${basePath}/analysis/housing/`);
      for (const width of [768, 390, 320]) {
        await page.setViewportSize({ width, height: 844 }); await page.goto(`${root}/data/?q=klimaat`); await page.locator('[data-catalog][data-ready=true]').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} at ${width}`);
        assert.ok(await page.locator('.db-card').count() > 0);
      }
      await page.getByLabel('Zoek datasets', { exact: true }).fill('no-source-matches-293874'); await page.getByRole('heading', { name: 'Geen bron gevonden', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Bekijk alle bronnen', exact: true }).click(); assert.equal(await page.locator('.db-card').count(), catalog.datasets.length);
      await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
      const memorySave = page.getByRole('button', { name: 'Bewaar Wonen en buurtcijfers in favorieten', exact: true });
      await memorySave.click();
      await page.getByText(/Browseropslag is niet beschikbaar/).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Verwijder Wonen en buurtcijfers uit favorieten', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.screenshot({ path: resolve(output, `${name}-mobile.png`), fullPage: false });
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: resolve(output, `${name}-desktop.png`), fullPage: false });
      assert.deepEqual(errors, []);
      results.push({ browser: name, passed: true, profiles: catalog.datasets.length });
      console.log(`✓ ${name}: catalog search/filter/history, saved sources and reload, table, metadata export, real GeoJSON download and mobile`);
    } catch (error) {
      writeFileSync(resolve(output, `${name}-failure.txt`), await page.locator('body').innerText());
      await page.screenshot({ path: resolve(output, `${name}-failure.png`) }); throw error;
    } finally { await context.close(); await browser.close(); }
  }
} finally {
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ passed: results.length === (process.argv.slice(2).length || 3) && results.every(row => row.passed), results }, null, 2));
  await new Promise(resolve => server.close(resolve));
}
