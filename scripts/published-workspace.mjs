import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['check', 'dev'].includes(mode) || process.argv.length !== 3) throw new Error('Use check or dev.');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:workspace:published or npm run dev:workspace:published.');
if (process.env.GEO_RELEASE_ARCHIVE) throw new Error('Published verification cannot use GEO_RELEASE_ARCHIVE. Use the candidate workspace command instead.');

// This pin is independent of the checkout version: an unpublished candidate must
// never silently become the target of the published-consumer check.
const release = JSON.parse(readFileSync(join(root, 'examples/workspace/published-release.json'), 'utf8'));
const reports = join(root, 'artifacts/published-workspace');
mkdirSync(reports, { recursive: true });
const output = mkdtempSync(join(reports, 'run-'));
const report = { mode, startedAt: new Date().toISOString(), node: process.version, release, checksPassed: false };
let child;
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child?.kill('SIGTERM');
};

try {
  process.stdout.write(`Downloading published ${release.name}@${release.version}…\n`);
  const [packed] = JSON.parse(execFileSync(process.execPath, [npm, 'pack',
    `${release.name}@${release.version}`, '--json', '--ignore-scripts',
    '--registry', release.registry, '--pack-destination', output,
  ], { cwd: output, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'inherit'] }));
  if (!packed || packed.name !== release.name || packed.version !== release.version
    || packed.integrity !== release.integrity || basename(packed.filename) !== packed.filename) {
    throw new Error('Registry package identity or integrity differs from the pinned release.');
  }
  const archive = join(output, packed.filename);
  const bytes = readFileSync(archive);
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (integrity !== release.integrity) throw new Error('Downloaded archive bytes differ from the pinned release.');
  report.archive = { filename: packed.filename, sha256: createHash('sha256').update(bytes).digest('hex'), integrity };
  writeFileSync(join(output, 'pack.json'), `${JSON.stringify(packed, null, 2)}\n`);
  process.stdout.write(`Verified published archive; evidence: ${output}\n`);
  child = spawn(process.execPath, [join(root, 'scripts/workspace.mjs'), mode], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, GEO_RELEASE_ARCHIVE: archive, GEO_BETA_REPORT_DIR: output },
  });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (mode === 'dev' && signal) { report.stoppedBy = signal; resolve(); }
      else if (code === 0) resolve();
      else reject(new Error(`Published workspace ${mode} failed (${signal ?? code}).`));
    });
  });
  if (mode === 'check') {
    const budgets = JSON.parse(readFileSync(join(output, 'beta-budgets.json'), 'utf8'));
    if (!budgets.passed || budgets.errors.length || budgets.environment.archiveSha256 !== report.archive.sha256) {
      throw new Error('Missing passing budget evidence for the published archive.');
    }
    report.checksPassed = true;
  }
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  writeFileSync(join(output, 'verification.json'), `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  process.stdout.write(`Published workspace report: ${join(output, 'verification.json')}\n`);
  if (report.error) process.stderr.write(`${report.error}\n`);
}
