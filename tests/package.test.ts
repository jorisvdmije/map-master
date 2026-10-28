import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
let consumer: string;
let packedFiles: string[];

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 45_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('packed package', () => {
  beforeAll(() => {
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error('Run package tests through npm test.');

    consumer = mkdtempSync(join(tmpdir(), 'geo-consumer-'));
    cpSync(join(root, 'tests/fixtures/consumer'), consumer, { recursive: true });
    // Reuse the standalone application's pinned dependency graph. A fresh
    // repository npm ci caches its tarballs, but not registry metadata needed
    // by an unlocked npm install to resolve peer dependency ranges offline.
    for (const file of ['package.json', 'package-lock.json']) {
      cpSync(join(root, 'examples/workspace', file), join(consumer, file));
    }

    // Release preparation supplies one archive to both this suite and the workspace.
    // A dry-run on that local tarball inspects its contents without rebuilding it.
    const archive = process.env.GEO_RELEASE_ARCHIVE;
    const result = JSON.parse(
      run(process.execPath, [npm, 'pack', '--json', ...(archive
        ? [resolve(root, archive), '--dry-run', '--ignore-scripts', '--offline']
        : ['--pack-destination', consumer])], root),
    ) as { filename: string; files: { path: string }[] }[];
    const packed = result[0];
    if (!packed) throw new Error('npm pack did not produce an archive.');
    packedFiles = packed.files.map((file) => file.path);

    // Install only runtime dependencies outside the repository. Consumer tooling
    // must not mask a missing runtime dependency in the archive.
    mkdirSync(join(consumer, 'vendor'));
    cpSync(archive ? resolve(root, archive) : join(consumer, packed.filename),
      join(consumer, 'vendor/map-master.tgz'));
    run(process.execPath, [
      npm, 'ci', '--offline', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
    ], consumer);
  });

  afterAll(() => {
    if (consumer) rmSync(consumer, { recursive: true, force: true });
  });

  it('ships JavaScript and declarations without development files', () => {
    expect(packedFiles).toEqual(expect.arrayContaining([
      'package.json', 'README.md', 'CHANGELOG.md', 'docs/migration.md',
      'LICENSE', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md',
      'dist/index.js', 'dist/index.d.ts',
    ]));
    expect(packedFiles.some((file) => /^(src|tests|node_modules|\.github)\//u.test(file)))
      .toBe(false);
  });

  it('ships the agreed package identity, license and support routes', () => {
    const manifest = JSON.parse(readFileSync(
      join(consumer, 'node_modules/@jorisvdmije/map-master/package.json'), 'utf8',
    )) as { name: string; version: string; license: string; author: { url: string };
      repository: { url: string }; bugs: { url: string }; publishConfig: { tag: string; access: string } };
    expect(manifest.name).toBe('@jorisvdmije/map-master');
    const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
    expect(manifest.version).toBe(source.version);
    expect(manifest.license).toBe('MIT');
    expect(manifest.author.url).toBe('https://github.com/jorisvdmije');
    expect(manifest.repository.url).toBe('git+https://github.com/jorisvdmije/map-master.git');
    expect(manifest.bugs.url).toBe('https://github.com/jorisvdmije/map-master/issues');
    expect(manifest.publishConfig).toMatchObject({ tag: 'beta', access: 'public' });
    const security = readFileSync(join(consumer, 'node_modules/@jorisvdmije/map-master/SECURITY.md'), 'utf8');
    expect(security).toContain('https://github.com/jorisvdmije/map-master/security/advisories/new');
  });

  it('imports through the public ESM entry point without browser globals', () => {
    expect(() => run(process.execPath, ['index.mjs'], consumer)).not.toThrow();
  });

  it.each([
    ['NodeNext', 'NodeNext'],
    ['ESNext', 'Bundler'],
  ])('resolves declarations with module %s and resolution %s', (module, resolution) => {
    expect(() => run(process.execPath, [
      tsc, '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--lib', 'ES2022,DOM',
      '--module', module, '--moduleResolution', resolution, 'index.ts',
    ], consumer)).not.toThrow();
  });
});
