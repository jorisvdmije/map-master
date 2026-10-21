import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({ name: 'geo-test-consumer', private: true, type: 'module' }),
    );

    // prepack builds from scratch, so this tests the same artifact npm pack creates.
    const result = JSON.parse(
      run(process.execPath, [npm, 'pack', '--json', '--pack-destination', consumer], root),
    ) as { filename: string; files: { path: string }[] }[];
    const packed = result[0];
    if (!packed) throw new Error('npm pack did not produce an archive.');
    packedFiles = packed.files.map((file) => file.path);

    // Install the archive outside the repository: no workspace links or source aliases.
    run(process.execPath, [
      npm, 'install', join(consumer, packed.filename),
      '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
    ], consumer);
  });

  afterAll(() => {
    if (consumer) rmSync(consumer, { recursive: true, force: true });
  });

  it('ships JavaScript and declarations without development files', () => {
    expect(packedFiles).toEqual(expect.arrayContaining([
      'package.json', 'README.md', 'dist/index.js', 'dist/index.d.ts',
    ]));
    expect(packedFiles.some((file) => /^(src|tests|node_modules|\.github)\//u.test(file)))
      .toBe(false);
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
