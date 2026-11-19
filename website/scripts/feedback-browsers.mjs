import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { createStaticServer } from './lib/static-server.mjs';
const site = resolve(import.meta.dirname, '..');
const { basePath } = JSON.parse(readFileSync(resolve(site, 'dist/.build-info.json')));
const server = createStaticServer({ directory: resolve(site, 'dist'), basePath });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, url = path => `${origin}${basePath}${path}`;
const applications = ['/area-report/', '/data/', '/playground/', '/analysis/', '/analysis/bnb/', '/analysis/streets/', '/analysis/housing/', '/analysis/reachability/'];
const results = [];
try {
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit']) {
    const browser = await { chromium, firefox, webkit }[name].launch({ headless: (process.env.GEO_DOCS_HEADED ?? process.env.GEO_COMPAT_HEADED) !== '1', ...(name === 'chromium' ? { args: ['--enable-unsafe-swiftshader'] } : {}) });
    let page;
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
      await context.addInitScript(() => localStorage.setItem('map-master-analysis-intro-v1', 'seen'));
      await context.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
      page = await context.newPage(); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const openWorkspace = async path => {
        await page.goto(url(path));
        const menu = page.locator('.workspace-switcher').first(); await menu.locator('summary').click();
        for (const href of applications) assert.equal(await menu.locator(`a[href="${basePath}${href}"]`).count(), 1);
        assert.equal(await menu.locator('a[aria-current=page]').getAttribute('href'), `${basePath}${path}`);
        await menu.locator('summary').click();
      };
      // Every server/hydrated shell offers every application at phone width.
      for (const path of applications) await openWorkspace(path);
      await page.goto(url('/analysis/housing/')); await page.locator('[data-housing][data-ready=true]').waitFor({ timeout: 60_000 });
      const search = page.getByLabel('Zoek buurt', { exact: true });
      await search.fill('Concertgebouw');
      await page.getByRole('button', { name: 'Deel weergave', exact: true }).click();
      const shared = page.url(); assert.ok(shared.includes('view='));
      await search.fill('Centrum'); await page.getByRole('button', { name: 'Deel weergave', exact: true }).click();
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('[aria-label="Zoek buurt"]').value === 'Concertgebouw');
      await page.goForward(); await page.waitForFunction(() => document.querySelector('[aria-label="Zoek buurt"]').value === 'Centrum');
      await page.goto(shared); await page.locator('[data-housing][data-ready=true]').waitFor(); assert.equal(await search.inputValue(), 'Concertgebouw');
      await page.locator('.hs-neighborhoods tbody button').first().click();
      const pinned = page.getByRole('button', { name: 'Geselecteerde buurt vastzetten', exact: true });
      await pinned.click(); assert.equal(await page.locator('.hs-compare tbody tr').count(), 25); assert.equal(await pinned.isDisabled(), true);
      await page.getByRole('button', { name: /uit vergelijking verwijderen/ }).click(); assert.equal(await pinned.isEnabled(), true);
      const [metadata] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /CSV-metadata/ }).click()]);
      const exported = JSON.parse(readFileSync(await metadata.path(), 'utf8')); assert.equal(exported.filters.query, 'Concertgebouw'); assert.equal(exported.sources.sha256.length, 64); assert.ok(exported.neighborhoodCodes.length > 0);
      // Named snapshots survive reload and open through the existing replace guard.
      await page.goto(url('/playground/')); await page.locator('.pg-workbench').waitFor({ timeout: 60_000 });
      await page.getByRole('button', { name: /Or explore the sample project/ }).click();
      const projects = page.locator('.pg-local-projects'); await projects.locator('summary').click();
      await projects.getByRole('button', { name: 'Save named copy', exact: true }).click(); await projects.locator('li').waitFor();
      await projects.getByRole('button', { name: 'Duplicate', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.pg-local-projects li').length === 2);
      await page.locator('.pg-save-state').getByText('Saved locally', { exact: true }).waitFor();
      await page.reload(); await page.locator('.pg-workbench').waitFor(); await projects.locator('summary').click();
      assert.equal(await projects.locator('li').count(), 2);
      await projects.getByRole('button', { name: 'Open', exact: true }).first().click();
      await page.getByRole('dialog').getByRole('button', { name: 'Open project', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Project name"]').value.endsWith(' copy'));
      assert.equal(await page.locator('.pg-workbench').getAttribute('data-feature-count'), '6');
      // Parsed static snapshots are reused on internal navigation. CPU slowdown is
      // an emulated desktop condition and is never labelled a real phone result.
      let cpu;
      if (name === 'chromium') { cpu = await context.newCDPSession(page); await cpu.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
      let requests = 0;
      page.on('request', request => { if (/amsterdam-(roads|street-observations)\.[a-f0-9]{16}\./.test(request.url())) requests++; });
      const start = performance.now(); await page.goto(url('/analysis/streets/'));
      await page.locator('[data-streets][data-ready=true]').waitFor({ timeout: 120_000 });
      const loadMs = performance.now() - start, firstRequests = requests;
      if (name === "chromium") assert.ok(loadMs <= 20_000, `4x CPU mobile-width load budget: ${loadMs} ms`);
      await page.locator('.workspace-switcher summary').click(); await page.locator('.workspace-switcher a').filter({ hasText: /^Wonen$/ }).click(); await page.locator('[data-housing][data-ready=true]').waitFor({ timeout: 60_000 });
      await page.locator('.workspace-switcher summary').click(); await page.locator('.workspace-switcher a').filter({ hasText: /^Straatkwaliteit$/ }).click(); await page.locator('[data-streets][data-ready=true]').waitFor({ timeout: 120_000 });
      assert.equal(requests, firstRequests, 'Returning reuses parsed street data');
      assert.ok(firstRequests <= 2);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (cpu) { await cpu.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await cpu.detach(); }
      assert.deepEqual(errors, []);
      results.push({ browser: name, passed: true, streetLoadMs: loadMs, streetRequestsOnReturn: requests - firstRequests, cpuSlowdown: name === 'chromium' ? 4 : 1, loadBudgetMs: name === 'chromium' ? 20_000 : null, viewport: '390x844', physicalDevice: false });
      await context.close();
      console.log(`✓ ${name}: workspace navigation, view links/history, comparison, CSV provenance, local copies and cached mobile-width return`);
    } catch (error) {
      const evidence = resolve(site, '../artifacts/feedback-remaining'); mkdirSync(evidence, { recursive: true });
      if (page && !page.isClosed()) { writeFileSync(resolve(evidence, `${name}-failure.txt`), await page.locator('body').innerText()); await page.screenshot({ path: resolve(evidence, `${name}-failure.png`) }); }
      throw error;
    } finally { await browser.close(); }
  }
} finally {
  mkdirSync(resolve(site, '../artifacts/feedback-remaining'), { recursive: true });
  writeFileSync(resolve(site, '../artifacts/feedback-remaining/browser-verification.json'), JSON.stringify({ passed: results.length > 0 && results.every(row => row.passed), results }, null, 2));
  await new Promise(resolve => server.close(resolve));
}
