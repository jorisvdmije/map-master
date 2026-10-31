import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] ?? 'check';
if (!['check', 'budgets', 'dev', 'lock', 'compatibility'].includes(mode)) throw new Error('Use check, budgets, dev, lock or compatibility.');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script through npm run dev:workspace or npm run test:workspace.');
const workspace = mkdtempSync(join(tmpdir(), 'geo-area-workspace-'));
let child;
let server;
let devServer;

function run(args, cwd = workspace) {
  return execFileSync(process.execPath, [npm, ...args], {
    cwd, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'inherit'],
  });
}

try {
  cpSync(join(root, 'examples/workspace'), workspace, {
    recursive: true,
    filter: (source) => !/(?:^|\/)(?:node_modules|dist|vendor)(?:\/|$)/u.test(source),
  });
  mkdirSync(join(workspace, 'vendor'));
  let archive = process.env.GEO_RELEASE_ARCHIVE;
  if (archive) {
    archive = resolve(root, archive);
    process.stdout.write(`Installing prepared archive: ${archive}\n`);
  } else {
    process.stdout.write('Building and packing @jorisvdmije/map-master for a separate application…\n');
    const packed = JSON.parse(run(['pack', '--json', '--pack-destination', workspace], root))[0];
    archive = join(workspace, packed.filename);
  }
  cpSync(archive, join(workspace, 'vendor/map-master.tgz'));
  if (mode === 'lock') {
    // npm install otherwise reuses stale version/license metadata for a local
    // file dependency whose path stays the same while its archive changes.
    const lock = JSON.parse(readFileSync(join(workspace, 'package-lock.json'), 'utf8'));
    delete lock.packages['node_modules/@jorisvdmije/map-master'];
    writeFileSync(join(workspace, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  }
  // All third-party versions come from the example lockfile; only the local tarball changes.
  // npm ci in the repository has already cached the same pinned tooling and MapLibre versions.
  process.stdout.write(run([mode === 'lock' ? 'install' : 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']));
  if (mode === 'lock') {
    const lock = JSON.parse(readFileSync(join(workspace, 'package-lock.json'), 'utf8'));
    // This is the artifact under test, rebuilt from the current checkout on every run.
    delete lock.packages['node_modules/@jorisvdmije/map-master'].integrity;
    writeFileSync(join(root, 'examples/workspace/package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    process.stdout.write('Updated standalone application lockfile.\n');
  } else if (mode === 'dev') {
    process.stdout.write(`Installed consumer: ${workspace}\nEdits belong in examples/workspace; restart this command to reinstall the example.\n`);
    child = spawn(process.execPath, [npm, 'run', 'dev'], { cwd: workspace, stdio: 'inherit' });
    const stop = () => { child.kill('SIGTERM'); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code && !signal ? reject(new Error(`App exited with ${code}`)) : resolve());
    });
  } else if (mode === 'compatibility') {
    const { checkCompatibility } = await import('./workspace-compatibility.mjs');
    await checkCompatibility(workspace, process.env.GEO_BETA_REPORT_DIR
      ? resolve(root, process.env.GEO_BETA_REPORT_DIR) : join(root, 'artifacts/browser-compatibility'), process.argv.slice(3), root);
  } else {
    // Test-only second entry: same installed package and production bundler as the app.
    cpSync(join(root, 'tests/fixtures/budgets'), join(workspace, 'budgets'), { recursive: true });
    const tsconfig = JSON.parse(readFileSync(join(workspace, 'tsconfig.json'), 'utf8'));
    tsconfig.include.push('budgets/**/*.ts');
    writeFileSync(join(workspace, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
    writeFileSync(join(workspace, 'vite.config.ts'), `import { defineConfig } from 'vite';
export default defineConfig({ build: { rolldownOptions: { input: { workspace: 'index.html', budgets: 'budgets/index.html' } } } });
`);
    process.stdout.write(run(['run', 'build']));
    const { createServer, preview } = await import('vite');
    server = await preview({ root: workspace, configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No preview server address.');
    const { checkBudgets } = await import('./beta-budgets.mjs');
    await checkBudgets(`http://127.0.0.1:${address.port}`, process.env.GEO_BETA_REPORT_DIR
      ? resolve(root, process.env.GEO_BETA_REPORT_DIR) : join(root, 'artifacts'), {
      maplibre: JSON.parse(readFileSync(join(workspace, 'node_modules/maplibre-gl/package.json'), 'utf8')).version,
      playwright: JSON.parse(readFileSync(join(root, 'node_modules/playwright/package.json'), 'utf8')).version,
      archiveSha256: createHash('sha256').update(readFileSync(join(workspace, 'vendor/map-master.tgz'))).digest('hex'),
    });
    if (mode === 'check') {
      const { checkWorkspace } = await import('./workspace-acceptance.mjs');
      await checkWorkspace(`http://127.0.0.1:${address.port}`);
      devServer = await createServer({ root: workspace, configFile: false, server: { host: '127.0.0.1', port: 0, open: false } });
      await devServer.listen();
      const devAddress = devServer.httpServer.address();
      if (!devAddress || typeof devAddress === 'string') throw new Error('No development server address.');
      await checkWorkspace(`http://127.0.0.1:${devAddress.port}`, { smoke: true });
    }
  }
} finally {
  child?.kill('SIGTERM');
  if (devServer) await devServer.close();
  if (server) await new Promise((resolve, reject) => { server.httpServer.close((error) => error ? reject(error) : resolve()); });
  rmSync(workspace, { recursive: true, force: true });
}
