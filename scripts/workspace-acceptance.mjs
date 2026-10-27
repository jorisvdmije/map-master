/* global document, localStorage, Storage, DOMException */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { chromium } from 'playwright';

const key = 'geo-area-workspace:v1';
const sample = { type: 'FeatureCollection', features: [
  { type: 'Feature', id: 0, properties: { name: 'North route', nested: { retain: true } }, geometry: { type: 'LineString', coordinates: [[4.88, 52.36], [4.90, 52.38]] } },
  { type: 'Feature', id: '0', properties: { name: 'South route' }, geometry: { type: 'LineString', coordinates: [[4.88, 52.355], [4.90, 52.355]] } },
] };

export async function checkWorkspace(origin, { smoke = false } = {}) {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const errors = [];
  const external = [];
  let scenarios = 0;
  async function newContext() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(`${origin}/`)) await route.continue();
      else { external.push(url); await route.abort(); }
    });
    return context;
  }
  async function open(context) {
    const page = await context.newPage();
    page.on('pageerror', (error) => { errors.push(error.message); });
    page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', (request) => { errors.push(`Failed request: ${request.url()}`); });
    page.on('dialog', (dialog) => { void dialog.accept(); });
    await page.goto(`${origin}/?basemap=off`);
    await page.locator('#polygon').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#polygon').disabled);
    return page;
  }
  async function text(page, selector, expected) {
    await page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.textContent === expected, { selector, expected });
  }
  async function exportData(page) {
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export GeoJSON', exact: true }).click();
    const path = await (await downloaded).path();
    return JSON.parse(await readFile(path, 'utf8'));
  }
  async function upload(page, value, filename = 'data.geojson') {
    await page.locator('#import').setInputFiles({ name: filename, mimeType: 'application/geo+json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
    await page.waitForFunction(() => !document.querySelector('#import').disabled && document.querySelector('#import').value === '');
  }
  function passed(label) { scenarios++; process.stdout.write(`  ✓ ${label}\n`); }

  try {
    const context = await newContext();
    const page = await open(context);
    await text(page, '#count', '0');
    assert.equal(await page.locator('#undo').isDisabled(), true);
    await page.locator('#polygon').click();
    const canvas = page.locator('canvas');
    await canvas.click({ position: { x: 170, y: 180 } });
    assert.equal(await page.locator('#finish').isDisabled(), true);
    await canvas.click({ position: { x: 380, y: 190 } });
    await canvas.click({ position: { x: 300, y: 400 } });
    await page.locator('#finish').click();
    await text(page, '#count', '1');
    const drawn = await exportData(page);
    assert.equal(drawn.features[0].geometry.type, 'Polygon');
    await text(page, '#save-state', 'Unsaved changes');
    // Picking the actual filled polygon requires a working worker and rendered source.
    await canvas.click({ position: { x: 600, y: 500 } });
    for (let attempt = 0; attempt < 20; attempt++) {
      await canvas.click({ position: { x: 280, y: 260 } });
      try { await page.locator('#selection').waitFor({ state: 'visible', timeout: 250 }); break; }
      catch { if (attempt === 19) throw new Error('The rendered polygon could not be selected on the map.'); }
    }
    passed('draw, render, pick on the map and export the installed package’s geometry');
    if (smoke) {
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      process.stdout.write('Workspace development server: render/pick smoke passed.\n');
      return;
    }

    await page.locator('#features button').click();
    const safeName = '<img src=x onerror=alert(1)> Area A';
    await page.locator('#name').fill(safeName);
    await page.locator('#rename').click();
    assert.equal(await page.locator('#features img').count(), 0);
    const named = await exportData(page);
    assert.equal(named.features[0].properties.name, safeName);
    await page.locator('#undo').click();
    assert.deepEqual(await exportData(page), drawn);
    await page.locator('#redo').click();
    assert.deepEqual(await exportData(page), named);
    passed('rename is safe text, keeps IDs, and participates in Undo/Redo');

    await page.locator('#line').click();
    await canvas.click({ position: { x: 500, y: 200 } });
    assert.equal(await page.locator('#save').isDisabled(), true);
    assert.equal(await page.locator('#import').isDisabled(), true);
    await page.locator('#cancel').click();
    assert.deepEqual(await exportData(page), named);
    await page.locator('#features button').click();
    await page.locator('#edit').click();
    const bounds = await canvas.boundingBox();
    const drag = async () => {
      await page.mouse.move(bounds.x + 170, bounds.y + 180);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 140, bounds.y + 150, { steps: 8 });
      await page.mouse.up();
    };
    await drag();
    await page.locator('#cancel').click();
    assert.deepEqual(await exportData(page), named);
    await page.locator('#edit').click();
    await drag();
    await page.locator('#finish').click();
    const edited = await exportData(page);
    assert.notDeepEqual(edited.features[0].geometry, named.features[0].geometry);
    assert.equal(edited.features[0].id, named.features[0].id);
    await page.locator('#save').click();
    await text(page, '#save-state', 'All changes saved locally');
    await page.reload();
    await text(page, '#count', '1');
    assert.deepEqual(await exportData(page), edited);
    assert.equal(await page.locator('#undo').isDisabled(), true);
    passed('cancel discards drafts; applied edits survive save/reload without restoring old history');

    await page.locator('#features button').click(); await page.locator('#edit').click();
    await page.keyboard.press('Home');
    assert.equal(await page.locator('[data-geo-vertex-focus]').count(), 1);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape');
    assert.deepEqual(await exportData(page), edited);
    await page.locator('#edit').click(); await page.keyboard.press('Home');
    await page.keyboard.press('Space'); await page.keyboard.press('PageDown'); await page.keyboard.press('Shift+Space');
    await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Enter');
    const keyboardEdited = await exportData(page);
    assert.notDeepEqual(keyboardEdited.features[0].geometry, edited.features[0].geometry);
    assert.equal(await page.locator('[data-geo-vertex-focus]').count(), 0);
    await page.locator('#undo').click(); assert.deepEqual(await exportData(page), edited);
    assert.equal(await page.locator('#undo').isDisabled(), true);
    await page.locator('#redo').click(); assert.deepEqual(await exportData(page), keyboardEdited);
    await page.locator('#undo').click();
    passed('keyboard vertex focus, group movement, cancellation and one-step Undo/Redo');

    // Exercise browser-generated touch events against the installed package.
    const input = await context.newCDPSession(page);
    try {
      await input.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      const touchDrag = async () => {
        await page.keyboard.press('Home');
        const marker = await page.locator('[data-geo-vertex-keyboard-marker]').boundingBox();
        assert.ok(marker);
        const x = marker.x + marker.width / 2 + 18;
        const y = marker.y + marker.height / 2;
        await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
        await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x + 30, y: y + 20 }] });
        await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      await page.locator('#edit').click(); await touchDrag(); await page.locator('#cancel').click();
      assert.deepEqual(await exportData(page), edited);
      await page.locator('#edit').click(); await touchDrag(); await page.locator('#finish').click();
      const touchEdited = await exportData(page);
      assert.notDeepEqual(touchEdited.features[0].geometry, edited.features[0].geometry);
      await page.locator('#undo').click(); assert.deepEqual(await exportData(page), edited);
      assert.equal(await page.locator('#undo').isDisabled(), true);
      await page.locator('#redo').click(); assert.deepEqual(await exportData(page), touchEdited);
      await page.locator('#undo').click();
    } finally {
      await input.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await input.detach();
    }
    passed('touch vertex movement, cancellation and one-step Undo/Redo');

    const savedBeforeTheme = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.locator('#appearance').selectOption('ocean');
    await text(page, '#save-state', 'All changes saved locally');
    assert.equal(await page.locator('#save').isDisabled(), true);
    await page.locator('#features button').click(); await page.locator('#edit').click();
    const outline = page.locator('[data-geo-draft-border] [data-geo-border]');
    await outline.waitFor({ state: 'attached' });
    assert.equal(await outline.getAttribute('stroke'), '#0f766e');
    await page.locator('#appearance').selectOption('contrast');
    assert.equal(await outline.getAttribute('stroke'), '#b91c1c');
    assert.equal(await outline.getAttribute('stroke-width'), '5');
    await page.locator('#cancel').click(); await page.locator('#appearance').selectOption('default');
    assert.deepEqual(await exportData(page), edited);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), savedBeforeTheme);
    assert.equal(await page.locator('#undo').isDisabled(), true);
    passed('live appearance presets preserve saved geometry, drafts and history');

    await page.locator('#lock').click();
    assert.equal(await page.locator('#lock').textContent(), 'Unlock feature');
    for (const selector of ['#edit', '#delete', '#rename', '#name']) assert.equal(await page.locator(selector).isDisabled(), true);
    assert.match(await page.locator('#features').textContent(), /Locked/u);
    await canvas.focus(); await page.keyboard.press('Delete');
    await text(page, '#count', '1');
    assert.deepEqual(await exportData(page), edited);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), savedBeforeTheme);
    await text(page, '#save-state', 'All changes saved locally');
    await page.locator('#lock').click();
    assert.equal(await page.locator('#edit').isDisabled(), false);
    await page.locator('#lock').click(); await page.reload();
    await page.locator('#features button').click();
    assert.equal(await page.locator('#edit').isDisabled(), false);
    assert.equal(await page.locator('#lock').textContent(), 'Lock for this session');
    passed('session locks protect editing, names and keyboard deletion without changing saved data');

    await page.locator('#features button').click();
    await page.locator('#delete').click();
    await text(page, '#count', '0');
    await page.locator('#undo').click();
    await text(page, '#save-state', 'All changes saved locally');
    assert.deepEqual(await exportData(page), edited);
    await page.locator('#redo').click();
    await text(page, '#count', '0');
    await page.locator('#save').click();
    await page.reload();
    await text(page, '#count', '0');
    assert.deepEqual((await exportData(page)).features, []);
    passed('delete/Undo/Redo and saving an empty workspace');

    await page.locator('#marker').click();
    await page.keyboard.press('Escape');
    await text(page, '#count', '0');
    await page.locator('#marker').click();
    await canvas.click({ position: { x: 260, y: 220 } });
    await text(page, '#count', '1');
    const marker = await exportData(page);
    assert.equal(marker.features[0].geometry.type, 'Point');
    for (let attempt = 0; attempt < 20; attempt++) {
      await canvas.click({ position: { x: 260, y: 220 } });
      try { await page.locator('#selection').waitFor({ state: 'visible', timeout: 250 }); break; }
      catch { if (attempt === 19) throw new Error('The rendered marker could not be selected on the map.'); }
    }
    await page.locator('#name').fill('Meeting point'); await page.locator('#rename').click();
    await page.locator('#save').click(); const namedMarker = await exportData(page);
    await page.reload(); await text(page, '#count', '1');
    assert.deepEqual(await exportData(page), namedMarker);
    await page.locator('#features button').click();
    await page.locator('#edit').click(); await page.locator('#cancel').click();
    assert.deepEqual(await exportData(page), namedMarker);
    await page.locator('#delete').click(); await text(page, '#count', '0');
    await page.locator('#undo').click(); assert.deepEqual(await exportData(page), namedMarker);
    await page.locator('#redo').click(); await page.locator('#save').click();
    passed('markers: single-click placement, map picking, naming, save/reload, cancel and delete/Undo/Redo');

    await upload(page, sample);
    await text(page, '#count', '2');
    assert.deepEqual(await exportData(page), sample);
    await page.locator('#features button').first().click();
    await page.locator('#name').fill('Updated route'); await page.locator('#rename').click();
    const renamed = await exportData(page);
    assert.deepEqual(renamed.features[0].properties, { name: 'Updated route', nested: { retain: true } });
    assert.equal(renamed.features[0].id, 0); assert.equal(renamed.features[1].id, '0');
    await page.locator('#undo').click();
    await page.locator('#undo').click(); await text(page, '#count', '0');
    await page.locator('#redo').click(); assert.deepEqual(await exportData(page), sample);
    await upload(page, sample); assert.match(await page.locator('#notice').innerText(), /already exists/u);
    assert.deepEqual(await exportData(page), sample);
    await upload(page, '{broken'); assert.match(await page.locator('#notice').innerText(), /not valid JSON/u);
    assert.deepEqual(await exportData(page), sample);
    await upload(page, { type: 'FeatureCollection', features: [
      { ...sample.features[0], id: 'new' },
      { type: 'Feature', id: 'bad', properties: null, geometry: { type: 'MultiPoint', coordinates: [[4, 52]] } },
    ] });
    assert.match(await page.locator('#notice').innerText(), /Could not import/u);
    assert.deepEqual(await exportData(page), sample);
    passed('atomic import, typed identities, nested properties and actionable invalid-file errors');

    // Capture write failure in the real browser without losing the previous stored copy.
    const beforeFailure = await page.evaluate((key) => localStorage.getItem(key), key);
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
    await page.locator('#save').click();
    assert.match(await page.locator('#notice').innerText(), /Could not save/u);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), beforeFailure);
    assert.deepEqual(await exportData(page), sample);
    assert.equal(await page.locator('#save').isEnabled(), true);
    passed('storage quota errors preserve in-memory work and the old saved copy');
    await context.close();

    const corruptContext = await newContext();
    await corruptContext.addInitScript(({ key }) => { localStorage.setItem(key, '{damaged'); }, { key });
    const corrupt = await open(corruptContext);
    assert.match(await corrupt.locator('#notice').innerText(), /Could not restore/u);
    assert.equal(await corrupt.locator('#save').isDisabled(), true);
    const recovered = corrupt.waitForEvent('download');
    await corrupt.locator('#download-recovery').click();
    assert.equal(await readFile(await (await recovered).path(), 'utf8'), '{damaged');
    await corrupt.locator('#discard-recovery').click();
    await upload(corrupt, sample);
    await corrupt.locator('#save').click();
    await text(corrupt, '#save-state', 'All changes saved locally');
    passed('corrupt saved data remains downloadable until explicitly discarded');
    await corruptContext.close();

    const invalidContext = await newContext();
    await invalidContext.addInitScript(({ key }) => { localStorage.setItem(key, JSON.stringify({ format: 'geo-area-workspace', version: 1, data: null })); }, { key });
    const invalid = await open(invalidContext);
    assert.equal(await invalid.locator('#save').isDisabled(), true);
    assert.match(await invalid.locator('#notice').innerText(), /Could not restore/u);
    assert.equal(await invalid.locator('#recovery').isVisible(), true);
    passed('valid JSON with invalid saved geometry is protected too');
    await invalidContext.close();

    const tabs = await newContext();
    const first = await open(tabs); const second = await open(tabs);
    await upload(first, sample); await first.locator('#save').click();
    await upload(second, { ...sample, features: [sample.features[0]] });
    await second.locator('#save').click();
    assert.match(await second.locator('#notice').innerText(), /Another tab/u);
    assert.deepEqual(await second.evaluate((key) => JSON.parse(localStorage.getItem(key)).data, key), sample);
    assert.equal((await exportData(second)).features.length, 1);
    passed('a stale tab cannot overwrite a newer saved copy');
    await tabs.close();

    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(external, [], 'Tile-free acceptance must make no external requests');
    process.stdout.write(`Workspace acceptance: ${scenarios} scenarios passed against the isolated production build.\n`);
  } finally { await browser.close(); }
}
