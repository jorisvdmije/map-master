import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { createStaticServer } from './lib/static-server.mjs';
const site = resolve(import.meta.dirname, '..'), output = resolve(site, '../artifacts/area-report');
mkdirSync(output, { recursive: true });
const { basePath } = JSON.parse(readFileSync(resolve(site, 'dist/.build-info.json')));
const snapshot = JSON.parse(readFileSync(resolve(site, 'src/features/housing/snapshot.json')));
const concert = snapshot.data.features.find(f => f.properties.name === 'Concertgebouwbuurt');
const weesp = snapshot.data.features.find(f => f.properties.name === 'Weesp-Zuid II');
const server = createStaticServer({ directory: resolve(site, 'dist'), basePath });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const root = `http://127.0.0.1:${server.address().port}${basePath}`, results = [];
const browsers = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];
try {
  const response = await fetch(`${root}/area-report/`); assert.equal(response.status, 200);
  const html = await response.text(); assert.ok(html.includes('data-area-report')); assert.ok(!html.includes('class="docs-shell'));
  for (const name of browsers) {
    const browser = await { chromium, firefox, webkit }[name].launch();
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [], calls = { trees: 0, noise: 0, reach: 0, address: 0 };
    let fail = false, delayNoise = false, releaseNoise, addressMode = 'success', failSnapshot = false;
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/data/amsterdam-housing.json', route => failSnapshot ? route.fulfill({ status: 503, body: 'Offline' }) : route.continue());
    await context.route('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free*', route => {
      calls.address++;
      if (addressMode === 'error') return route.fulfill({ status: 503, body: 'Offline' });
      const coordinates = addressMode === 'outside' ? 'POINT(0 0)' : 'POINT(4.87949023 52.35642539)';
      return route.fulfill({ json: { response: { docs: addressMode === 'empty' ? [] : [{ id: 'adr-test', type: 'adres', gemeentecode: '0363', weergavenaam: 'Concertgebouwplein 10, 1071LN Amsterdam', centroide_ll: coordinates }] } } });
    });
    await context.route('https://api.data.amsterdam.nl/v1/bomen/stamgegevens/*', route => {
      calls.trees++;
      return fail ? route.fulfill({ status: 503, body: 'Offline' }) : route.fulfill({ json: { _embedded: { stamgegevens: [] }, page: { totalElements: 0 }, _links: {} } });
    });
    await context.route('https://data.rivm.nl/geo/alo/wms*', async route => {
      calls.noise++;
      if (delayNoise) await new Promise(resolve => { releaseNoise = resolve; });
      await (fail ? route.fulfill({ status: 503, body: 'Offline' }) : route.fulfill({ json: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { GRAY_INDEX: 52.4 }, geometry: null }] } })).catch(() => {});
    });
    await context.route('https://valhalla1.openstreetmap.de/isochrone*', route => {
      calls.reach++;
      if (fail) return route.fulfill({ status: 429, body: 'Unavailable' });
      const request = JSON.parse(new URL(route.request().url()).searchParams.get('json'));
      assert.equal(request.costing, 'bicycle'); assert.deepEqual(request.contours, [{ time: 15 }]);
      const { lon: x, lat: y } = request.locations[0], d = .01;
      return route.fulfill({ json: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { metric: 'time', contour: 15 }, geometry: { type: 'Polygon', coordinates: [[[x-d,y-d],[x+d,y-d],[x+d,y+d],[x-d,y+d],[x-d,y-d]]] } }] } });
    });
    const ready = () => page.locator('[data-area-report][data-ready=true]').waitFor();
    const choose = value => page.getByLabel('Buurt', { exact: true }).selectOption(value);
    const heading = name => page.locator('.gr-heading h2').filter({ hasText: name }).waitFor();
    const save = async () => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Rapport JSON', exact: true }).click()]);
      return JSON.parse(readFileSync(await download.path()));
    };
    try {
      await page.goto(`${root}/data/`); await page.getByRole('link', { name: 'Maak een gebiedsrapport', exact: false }).click(); await ready();
      assert.equal(await page.locator('canvas').count(), 0); assert.deepEqual(calls, { trees: 0, noise: 0, reach: 0, address: 0 });
      await choose(concert.properties.code); await heading('Concertgebouwbuurt');
      assert.match(await page.locator('[data-metric=woz] strong').innerText(), /1\.348\.000/);
      assert.match(await page.locator('[data-metric=education]').innerText(), /Niet beschikbaar/);
      assert.equal(await page.locator('[data-metric]').count(), 25);
      let exported = await save(); assert.equal(exported.area.properties.code, concert.properties.code); assert.equal(exported.environment.noise.status, 'not-requested'); assert.equal(exported.point.kind, 'example');
      const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Buurtcijfers CSV', exact: true }).click()]);
      const table = readFileSync(await csv.path(), 'utf8'); assert.equal(table.split('\r\n').length, 26); assert.ok(table.includes('"2025";"2024"'));
      await page.getByRole('button', { name: 'Omgevingsbronnen ophalen', exact: true }).click();
      await page.getByRole('button', { name: 'Omgevingsbronnen vernieuwen', exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('.gr-environment > button').disabled);
      exported = await save(); assert.equal(exported.environment.trees.data.data.features.length, 0); assert.equal(exported.environment.noise.data.decibels, 52.4); assert.equal(exported.environment.reachability.data.request.minutes[0], 15); assert.equal(exported.environment.reachability.status, 'success');
      fail = true; await page.getByRole('button', { name: 'Omgevingsbronnen vernieuwen', exact: true }).click();
      await page.getByText(/Een of meer bronnen konden niet worden vernieuwd/).waitFor();
      await page.waitForFunction(() => !document.querySelector('.gr-environment > button').disabled);
      exported = await save(); assert.equal(exported.environment.trees.status, 'stale-after-error'); assert.equal(exported.environment.noise.data.decibels, 52.4);
      fail = false;
      await page.getByLabel('Zoek buurt', { exact: true }).fill('Weesp-Zuid II'); await choose(weesp.properties.code); await heading('Weesp-Zuid II');
      assert.equal(await page.locator('[data-environment=noise] strong').innerText(), 'Nog niet opgehaald', 'Another point cannot inherit the previous reading');
      await page.getByLabel('Zoek buurt', { exact: true }).fill('');
      await page.goBack(); await heading('Concertgebouwbuurt'); await page.goForward(); await heading('Weesp-Zuid II');
      // A delayed response for the previous point cannot leak into a new area.
      delayNoise = true;
      await Promise.all([page.waitForRequest('https://data.rivm.nl/geo/alo/wms*'), page.getByRole('button', { name: 'Omgevingsbronnen ophalen', exact: true }).click()]);
      await choose(concert.properties.code); await heading('Concertgebouwbuurt');
      releaseNoise?.(); delayNoise = false;
      assert.match(await page.locator('[data-environment=noise] strong').innerText(), /52/, 'Only the previous cached value for this exact point remains');
      // Search makes the user choose a concrete address before spatial joining.
      await page.getByLabel('Amsterdams adres', { exact: true }).fill('Concertgebouwplein 10');
      await page.getByRole('button', { name: 'Zoek adres', exact: true }).click();
      await page.getByRole('button', { name: 'Concertgebouwplein 10, 1071LN Amsterdam', exact: true }).click();
      await page.locator('.gr-point strong').filter({ hasText: 'Concertgebouwplein 10' }).waitFor();
      exported = await save(); assert.equal(exported.point.kind, 'address'); assert.deepEqual(exported.point.coordinates, [4.87949023,52.35642539]); assert.equal(exported.environment.noise.status, 'not-requested');
      const reachLink = await page.getByRole('link', { name: 'Verken bereik op de kaart', exact: false }).getAttribute('href'); assert.ok(reachLink.startsWith(`${basePath}/analysis/reachability/?lng=4.87949023`));
      await page.getByRole('button', { name: 'Deel rapport', exact: true }).click();
      const share = (await page.locator('.gr-heading + .gr-notice').innerText()).match(/https?:\/\/\S+/)[0];
      await page.goto(share); await ready(); await heading('Concertgebouwbuurt'); assert.equal(await page.locator('.gr-point strong').innerText(), 'Gedeeld locatiepunt');
      exported = await save(); assert.deepEqual(exported.point.coordinates, [4.87949023,52.35642539]);
      await page.getByRole('button', { name: 'Omgevingsbronnen ophalen', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.gr-environment > button').disabled);
      await page.screenshot({ path: resolve(output, `${name}-desktop.png`), fullPage: true });
      for (const width of [768, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}, width ${width}`);
      }
      await page.screenshot({ path: resolve(output, `${name}-mobile.png`), fullPage: true });
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.locator('.gr-picker').isVisible(), false); assert.equal(await page.locator('.gr-heading h2').isVisible(), true); assert.equal(await page.locator('.gr-method h3').isVisible(), true);
      await page.emulateMedia({ media: 'screen' });
      for (const mode of ['empty', 'error', 'outside']) {
        addressMode = mode; await page.getByLabel('Amsterdams adres', { exact: true }).fill(`Adres ${mode}`); await page.getByRole('button', { name: 'Zoek adres', exact: true }).click();
        if (mode === 'empty') await page.getByText('Geen adres gevonden. Voeg een huisnummer of postcode toe.', { exact: true }).waitFor();
        else if (mode === 'error') await page.getByRole('alert').filter({ hasText: 'Adreszoeken is niet gelukt' }).waitFor();
        else { await page.getByRole('button', { name: 'Concertgebouwplein 10, 1071LN Amsterdam', exact: true }).click(); await page.getByText(/Dit adres valt niet binnen/).waitFor(); }
        assert.equal(await page.locator('.gr-heading h2').innerText(), 'Concertgebouwbuurt');
      }
      await page.goto(`${root}/area-report/?buurt=bad`); await ready(); await page.getByRole('heading', { name: 'Deze buurt staat niet in de databank' }).waitFor();
      await page.goto(`${root}/area-report/?buurt=${concert.properties.code}&lng=0&lat=0`); await ready(); await heading('Concertgebouwbuurt'); assert.equal(await page.locator('.gr-point strong').innerText(), 'Voorbeeldpunt in deze buurt');
      fail = true; await page.getByRole('button', { name: 'Omgevingsbronnen ophalen', exact: true }).click(); await page.getByText(/Een of meer bronnen konden niet worden vernieuwd/).waitFor();
      await page.waitForFunction(() => !document.querySelector('.gr-environment > button').disabled);
      exported = await save(); assert.equal(exported.environment.noise.status, 'unavailable'); assert.equal(exported.environment.noise.data, null); assert.equal(exported.statistics.length, 25);
      failSnapshot = true; await page.reload(); await page.getByRole('heading', { name: 'Buurtgegevens niet beschikbaar' }).waitFor(); failSnapshot = false;
      await page.getByRole('button', { name: 'Opnieuw proberen', exact: true }).click(); await ready(); await heading('Concertgebouwbuurt');
      assert.deepEqual(errors, []);
      results.push({ browser: name, passed: true, mockedLiveSources: true, realSnapshot: true, basePath, calls });
      console.log(`✓ ${name}: neighborhood/address report, real CBS years, exports, live-source isolation/errors, sharing/history, mobile and print`);
    } catch (error) {
      writeFileSync(resolve(output, `${name}-failure.txt`), await page.locator('body').innerText());
      await page.screenshot({ path: resolve(output, `${name}-failure.png`) }); throw error;
    } finally { releaseNoise?.(); await context.close(); await browser.close(); }
  }
} finally {
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ passed: results.length === browsers.length && results.every(row => row.passed), results }, null, 2));
  await new Promise(resolve => server.close(resolve));
}
