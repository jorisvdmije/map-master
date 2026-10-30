import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = JSON.parse(readFileSync(join(root, 'examples/workspace/published-release.json'), 'utf8'));

function failedRun(packResult, { override = false, unavailable = false } = {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'published-workspace-test-'));
  let evidence;
  try {
    const npm = join(temporary, 'npm.cjs');
    writeFileSync(npm, `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const args = process.argv.slice(2);
      assert.equal(args[0], 'pack');
      assert.equal(args[1], ${JSON.stringify(`${release.name}@${release.version}`)});
      assert.equal(args[args.indexOf('--registry') + 1], ${JSON.stringify(release.registry)});
      if (${unavailable}) { process.stderr.write('Registry unavailable'); process.exit(1); }
      const result = ${JSON.stringify(packResult)};
      fs.writeFileSync(path.join(args[args.indexOf('--pack-destination') + 1], result.filename), 'tampered bytes');
      process.stdout.write(JSON.stringify([result]));
    `);
    const result = spawnSync(process.execPath, [join(root, 'scripts/published-workspace.mjs'), 'check'], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, npm_execpath: npm, GEO_RELEASE_ARCHIVE: override ? '/not-a-published-archive.tgz' : '' },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    const reportPath = result.stdout.match(/Published workspace report: (.+)\n/u)?.[1];
    if (override) assert.equal(reportPath, undefined, 'Reject an override before downloading or creating evidence.');
    else {
      assert.ok(reportPath);
      evidence = dirname(reportPath);
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      assert.equal(report.checksPassed, false);
      assert.ok(report.error);
      assert.equal(report.archive, undefined, 'Unverified bytes must never reach the consumer.');
    }
    return result;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    if (evidence) rmSync(evidence, { recursive: true, force: true });
  }
}

const packed = { ...release, filename: 'map-master.tgz' };
test('published checks reject candidate archive overrides before downloading', () => {
  assert.match(failedRun(packed, { override: true }).stderr, /cannot use GEO_RELEASE_ARCHIVE/u);
});
test('published checks reject a different registry version', () => {
  assert.match(failedRun({ ...packed, version: '0.0.0' }).stderr, /identity or integrity differs/u);
});
test('published checks verify bytes even when registry metadata matches', () => {
  assert.match(failedRun(packed).stderr, /archive bytes differ/u);
});
test('registry failure fails verification without falling back to the checkout', () => {
  assert.match(failedRun(packed, { unavailable: true }).stderr, /Registry unavailable/u);
});
