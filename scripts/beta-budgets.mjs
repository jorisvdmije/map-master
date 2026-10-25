/* global window, document, performance, requestAnimationFrame */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { dataset } from '../tests/fixtures/budgets/data.mjs';
import { policy, assessLatency, assessMemory } from './beta-budget-policy.mjs';

/** Public UI plus a production-built, installed-package lifecycle fixture. */
export async function checkBudgets(origin, outputDirectory, installed) {
  const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), environment: {
    node: process.version, os: platform(), architecture: arch(), cpu: cpus()[0]?.model,
    ...installed, renderer: 'headless Chromium, --enable-unsafe-swiftshader', viewport: { width: 1280, height: 900 },
  }, fixture: { features: 1000, points: 333, lines: 333, polygons: 334, coordinatePositions: 2765, maximumRingCorners: 100 },
  policy, latency: {}, memory: null, errors: [], passed: false };
  let browser;
  const data = dataset();
  const raw = Object.fromEntries(Object.keys(policy.latency).map(name => [name, []]));
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
    report.environment.browser = browser.version();
    const context = await browser.newContext({ viewport: report.environment.viewport, deviceScaleFactor: 1 });
    await context.route('**/*', async route => {
      if (route.request().url().startsWith(`${origin}/`)) await route.continue();
      else { report.errors.push(`External request: ${route.request().url()}`); await route.abort(); }
    });
    function watch(page) {
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('console', entry => { if (entry.type() === 'error') report.errors.push(entry.text()); });
      page.on('requestfailed', request => report.errors.push(`Request failed: ${request.url()}`));
      page.on('response', response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    }
    let workspace;
    for (let i = -policy.importWarmup; i < policy.importSamples; i++) {
      if (workspace) await workspace.close();
      workspace = await context.newPage(); watch(workspace);
      await workspace.goto(`${origin}/?basemap=off`);
      await workspace.waitForFunction(() => !document.querySelector('#import').disabled);
      await workspace.evaluate(() => {
        const input = document.querySelector('#import');
        input.addEventListener('change', () => {
          const start = performance.now(); window.budgetImportMs = null;
          const complete = () => {
            if (input.disabled || input.value !== '' || document.querySelector('#count').textContent !== '1000') {
              requestAnimationFrame(complete); return;
            }
            requestAnimationFrame(() => requestAnimationFrame(() => { window.budgetImportMs = performance.now() - start; }));
          };
          requestAnimationFrame(complete);
        }, { capture: true, once: true });
      });
      await workspace.locator('#import').setInputFiles({ name: 'beta-grid.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(data)) });
      await workspace.waitForFunction(() => typeof window.budgetImportMs === 'number', undefined, { timeout: 10000 });
      const ms = await workspace.evaluate(() => window.budgetImportMs);
      if (i >= 0) raw.workspaceImport.push(ms);
      assert.equal(await workspace.locator('#features button').count(), 1000);
    }
    await workspace.evaluate(() => {
      document.querySelector('#features').addEventListener('click', () => {
        const started = performance.now(); window.budgetSelectionMs = null;
        requestAnimationFrame(() => requestAnimationFrame(() => { window.budgetSelectionMs = performance.now() - started; }));
      }, true);
    });
    for (let i = -policy.warmup; i < policy.samples; i++) {
      const index = Math.abs(i % 2);
      await workspace.locator('#features button').nth(index).click();
      await workspace.waitForFunction(() => typeof window.budgetSelectionMs === 'number');
      assert.equal(await workspace.locator('#name').inputValue(), `Feature ${index}`);
      if (i >= 0) raw.workspaceSelection.push(await workspace.evaluate(() => window.budgetSelectionMs));
    }
    await workspace.close();
    process.stdout.write('  ✓ installed workspace: import and selection timings\n');

    const page = await context.newPage(); watch(page);
    await page.goto(`${origin}/budgets/`);
    await page.waitForFunction(() => !!window.budgetFixture);
    await page.evaluate(() => window.budgetFixture.mount());
    Object.assign(report.environment, await page.evaluate(() => window.budgetFixture.environment()));
    assert.equal(await page.evaluate(data => window.budgetFixture.load(data), data), 1000);
    await page.evaluate(() => window.budgetFixture.assertPicked());
    for (let i = -policy.warmup; i < policy.samples; i++) {
      const ms = await page.evaluate(id => window.budgetFixture.selection(id), Math.abs(i % 2));
      if (i >= 0) raw.selectionRender.push(ms);
    }
    const canvas = await page.locator('canvas').boundingBox(); assert.ok(canvas);
    const move = (x, y) => page.mouse.move(canvas.x + x, canvas.y + y);
    for (let i = -policy.warmup; i < policy.samples; i++) {
      const point = await page.evaluate(i => window.budgetFixture.prepareDrag(true, i), i);
      await move(point.x, point.y); await page.mouse.down();
      await page.evaluate(() => window.budgetFixture.arm());
      await move(point.x + 12, point.y + 6);
      const sample = await page.evaluate(() => window.budgetFixture.sample());
      assert.equal(sample.updated, true, 'Cold pointer must update the visible preview.');
      await page.mouse.up();
      const commit = await page.evaluate(() => window.budgetFixture.commit());
      if (i >= 0) { raw.coldPointerPreview.push(sample.ms); raw.commitRender.push(commit); }
    }
    const point = await page.evaluate(() => window.budgetFixture.prepareDrag(false, 0));
    await move(point.x, point.y); await page.mouse.down();
    for (let i = -policy.warmup; i < policy.samples; i++) {
      await page.evaluate(() => window.budgetFixture.arm());
      const delta = Math.abs(i % 2) ? 12 : 16;
      await move(point.x + delta, point.y + delta / 2);
      const sample = await page.evaluate(() => window.budgetFixture.sample());
      assert.equal(sample.updated, true, 'Warm pointer must update the visible preview.');
      if (i >= 0) raw.warmPointerPreview.push(sample.ms);
    }
    await page.mouse.up(); await page.evaluate(() => window.budgetFixture.unmount());
    process.stdout.write('  ✓ installed editor: selection, cold/warm vertex preview with snapping and commit timings\n');
    const client = await context.newCDPSession(page);
    const heapSample = async () => {
      await client.send('HeapProfiler.collectGarbage');
      const heap = await client.send('Runtime.getHeapUsage');
      const dom = await client.send('Memory.getDOMCounters');
      return { heap: heap.usedSize, nodes: dom.nodes, listeners: dom.jsEventListeners };
    };
    let baseline; const memory = [];
    for (let i = -policy.lifecycleWarmup; i < policy.lifecycleSamples; i++) {
      await page.evaluate(() => window.budgetFixture.mount());
      await page.evaluate(data => window.budgetFixture.load(data), data);
      await page.evaluate(() => window.budgetFixture.exercise());
      await page.evaluate(() => window.budgetFixture.unmount());
      const sample = await heapSample();
      if (i === -1) baseline = sample;
      if (i >= 0) memory.push(sample);
    }
    report.memory = assessMemory(baseline, memory);
    for (const [name, samples] of Object.entries(raw)) report.latency[name] = assessLatency(name, samples);
    report.passed = Object.values(report.latency).every(metric => metric.passed) && report.memory.passed && report.errors.length === 0;
    for (const [name, metric] of Object.entries(report.latency)) process.stdout.write(`  ${metric.passed ? '✓' : '✗'} ${name}: p95 ${metric.p95.toFixed(1)} ms / ${metric.budgetMs} ms\n`);
    process.stdout.write(`  ${report.memory.passed ? '✓' : '✗'} lifecycle memory: ${JSON.stringify(report.memory.observed)}\n`);
  } catch (error) {
    report.errors.push(error instanceof Error ? error.stack : String(error));
    report.rawLatency = raw;
  } finally {
    await browser?.close();
    await mkdir(outputDirectory, { recursive: true });
    const path = join(outputDirectory, 'beta-budgets.json');
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Beta budget report: ${path}\n`);
  }
  assert.equal(report.passed, true, `Beta budgets failed. Inspect the JSON report. ${report.errors.join('\n')}`);
}
