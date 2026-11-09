import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export function verifySourceManifest(directory, manifest) {
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Invalid source candidate manifest');
  for (const file of manifest.files) {
    const path = resolve(directory, file.path), local = relative(directory, path);
    if (!local || isAbsolute(local) || local.startsWith('..') || !lstatSync(path).isFile() || hash(path) !== file.sha256) throw new Error(`Source candidate changed: ${file.path}`);
  }
  return manifest;
}
export function captureSource(directory, output) {
  mkdirSync(output, { recursive: true });
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
  const paths = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].filter(path => existsSync(join(directory, path)) && lstatSync(join(directory, path)).isFile()).sort();
  const manifest = { version: 1, capturedAt: new Date().toISOString(), checkoutCommit: git(['rev-parse', 'HEAD']).trim(), checkoutDirty: !!git(['status', '--porcelain']).trim(), publicationPerformed: false, files: paths.map(path => ({ path, sha256: hash(join(directory, path)) })) };
  verifySourceManifest(directory, manifest);
  const temporary = mkdtempSync(join(tmpdir(), 'map-master-source-tree-'));
  for (const file of paths) { const target = join(temporary, file); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(directory, file), target); }
  const manifestPath = join(temporary, 'candidate-source.json'); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  verifySourceManifest(temporary, manifest);
  const archive = join(output, 'source.tgz');
  execFileSync('tar', ['-czf', archive, '-C', temporary, '.']);
  writeFileSync(join(output, 'candidate-source.json'), readFileSync(manifestPath));
  const report = { archive, sha256: hash(archive), files: paths.length, manifest };
  writeFileSync(join(output, 'source-verification.json'), JSON.stringify({ ...report, manifest: undefined }, null, 2) + '\n');
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] ?? join(root, 'artifacts/source-candidate'));
  const report = captureSource(root, output);
  process.stdout.write(JSON.stringify({ archive: report.archive, sha256: report.sha256, files: report.files }, null, 2) + '\n');
}
