import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { createServer, preview } from 'vite';
import { checkWorkspace } from './workspace-acceptance.mjs';

export async function checkCompatibility(workspace, reportDirectory, browserNames = [], root) {
  const browsers = browserNames.length ? browserNames : ['chromium', 'firefox', 'webkit'];
  if (new Set(browsers).size !== browsers.length || browsers.some((name) => !['chromium', 'firefox', 'webkit'].includes(name))) {
    throw new Error('Choose distinct browsers: chromium, firefox, webkit.');
  }
  const headless = process.env.GEO_COMPAT_HEADED !== '1';
  mkdirSync(reportDirectory, { recursive: true });
  const output = mkdtempSync(join(reportDirectory, 'compatibility-'));
  const report = {
    startedAt: new Date().toISOString(), passed: false, browsers, headless,
    environment: { platform: process.platform, architecture: process.arch, osRelease: release(), node: process.version,
      checkoutCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      checkoutDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
      playwright: JSON.parse(readFileSync(join(root, 'node_modules/playwright/package.json'), 'utf8')).version,
      maplibre: JSON.parse(readFileSync(join(workspace, 'node_modules/maplibre-gl/package.json'), 'utf8')).version,
      library: JSON.parse(readFileSync(join(workspace, 'node_modules/@jorisvdmije/map-master/package.json'), 'utf8')).version,
      archiveSha256: createHash('sha256').update(readFileSync(join(workspace, 'vendor/map-master.tgz'))).digest('hex'),
    },
    excluded: ['Chromium CDP performance and heap budgets', 'Shipping Safari/Firefox qualification', 'Physical touch/pen devices'],
    results: [],
  };
  let production;
  let development;
  try {
    execFileSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], { cwd: workspace, stdio: 'inherit', timeout: 120_000 });
    production = await preview({ root: workspace, configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
    development = await createServer({ root: workspace, configFile: false, server: { host: '127.0.0.1', port: 0, open: false } });
    await development.listen();
    for (const browserName of browsers) {
      for (const [phase, server] of [['production', production], ['development', development]]) {
        const reportPath = join(output, `${browserName}-${phase}.json`);
        const address = server.httpServer.address();
        if (!address || typeof address === 'string') throw new Error('No compatibility server address.');
        process.stdout.write(`Workspace compatibility: ${browserName} / ${phase}\n`);
        try {
          await checkWorkspace(`http://127.0.0.1:${address.port}`, { browserName, headless, smoke: phase === 'development', reportPath });
          report.results.push({ browserName, phase, passed: true });
        } catch (error) {
          report.results.push({ browserName, phase, passed: false, error: error.message });
          process.stderr.write(`${browserName} / ${phase}: ${error.message}\n`);
        }
      }
    }
    report.passed = report.results.length === browsers.length * 2 && report.results.every((result) => result.passed);
    if (!report.passed) throw new Error('Workspace compatibility failed; inspect the per-browser reports.');
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    writeFileSync(join(output, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);
    // The published launcher checks the summary against the exact downloaded archive.
    writeFileSync(join(reportDirectory, 'workspace-compatibility.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Compatibility evidence: ${output}\n`);
    await development?.close();
    if (production) await new Promise((resolve, reject) => production.httpServer.close((error) => error ? reject(error) : resolve()));
  }
}
