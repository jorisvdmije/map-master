import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { firefox, webkit } from 'playwright';
import { checkWorkspace } from './workspace-acceptance.mjs';

for (const [browserName, browserType] of Object.entries({ firefox, webkit })) {
  test(`${browserName} launch failure retains a failed report instead of losing diagnostics`, async (t) => {
    t.mock.method(browserType, 'launch', async () => { throw new Error('Browser installation unavailable'); });
    const directory = await mkdtemp(join(tmpdir(), 'map-master-browser-report-'));
    const reportPath = join(directory, 'nested', 'report.json');
    try {
      await assert.rejects(checkWorkspace('http://127.0.0.1:1', { browserName, reportPath }), /Browser installation unavailable/u);
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      assert.equal(report.browserName, browserName);
      assert.equal(report.passed, false);
      assert.deepEqual(report.scenarios, []);
      assert.match(report.error, /Browser installation unavailable/u);
      assert.ok(report.finishedAt);
      assert.ok(report.excluded.some((reason) => reason.includes('touch')));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
