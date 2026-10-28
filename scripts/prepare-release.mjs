import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run release:prepare.');
const releases = join(root, 'artifacts/releases');
mkdirSync(releases, { recursive: true });
// Never reuse an earlier report or overwrite an archive that someone is reviewing.
const output = mkdtempSync(join(releases, 'candidate-'));
const reportPath = join(output, 'verification.json');
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root, encoding: 'utf8', timeout: 120_000,
  stdio: ['ignore', 'pipe', 'inherit'], ...options,
});
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  checksPassed: false,
  publicationPerformed: false,
};

try {
  report.commit = run('git', ['rev-parse', 'HEAD']).trim();
  report.dirty = run('git', ['status', '--porcelain']).trim().length > 0;
  report.npm = run(process.execPath, [npm, '--version']).trim();
  const packed = JSON.parse(run(process.execPath, [
    npm, 'pack', '--json', '--pack-destination', output,
  ]))[0];
  if (!packed) throw new Error('npm pack did not produce an archive.');
  writeFileSync(join(output, 'pack.json'), `${JSON.stringify(packed, null, 2)}\n`);
  const archive = join(output, packed.filename);
  report.archive = { filename: packed.filename, name: packed.name, version: packed.version, sha256: hash(archive) };
  process.stdout.write(`Verifying a single candidate archive: ${archive}\n`);
  // Core and adapter tests still use the checkout/build; the package consumer and
  // production/development workspace checks install this exact archive.
  run(process.execPath, [npm, 'run', 'check'], {
    stdio: 'inherit', timeout: 15 * 60_000,
    env: { ...process.env, GEO_RELEASE_ARCHIVE: archive, GEO_BETA_REPORT_DIR: output },
  });
  const budgets = JSON.parse(readFileSync(join(output, 'beta-budgets.json'), 'utf8'));
  if (hash(archive) !== report.archive.sha256) throw new Error('Archive changed during verification.');
  if (!budgets.passed || budgets.errors.length > 0
    || budgets.environment.archiveSha256 !== report.archive.sha256) {
    throw new Error('Missing passing budget evidence for this archive.');
  }
  report.checksPassed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Release verification: ${reportPath}\n`);
  process.stdout.write(report.checksPassed
    ? 'Local checks passed. Public release prerequisites still require review; see docs/releases.md.\n'
    : `Candidate verification failed: ${report.error}\n`);
}
