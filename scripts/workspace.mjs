import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] ?? 'check';
if (!['check', 'dev', 'lock'].includes(mode)) throw new Error('Use check, dev or lock.');
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
  process.stdout.write('Building and packing @geo/editor for a separate application…\n');
  const packed = JSON.parse(run(['pack', '--json', '--pack-destination', workspace], root))[0];
  cpSync(join(workspace, packed.filename), join(workspace, 'vendor/geo-editor.tgz'));
  // All third-party versions come from the example lockfile; only the local tarball changes.
  // npm ci in the repository has already cached the same pinned tooling and MapLibre versions.
  process.stdout.write(run([mode === 'lock' ? 'install' : 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']));
  if (mode === 'lock') {
    const lock = JSON.parse(readFileSync(join(workspace, 'package-lock.json'), 'utf8'));
    // This is the artifact under test, rebuilt from the current checkout on every run.
    delete lock.packages['node_modules/@geo/editor'].integrity;
    writeFileSync(join(root, 'examples/workspace/package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    process.stdout.write('Updated standalone application lockfile.\n');
  } else if (mode === 'dev') {
    process.stdout.write(`Installed consumer: ${workspace}\nEdits belong in examples/workspace; restart this command to repack.\n`);
    child = spawn(process.execPath, [npm, 'run', 'dev'], { cwd: workspace, stdio: 'inherit' });
    const stop = () => { child.kill('SIGTERM'); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code && !signal ? reject(new Error(`App exited with ${code}`)) : resolve());
    });
  } else {
    process.stdout.write(run(['run', 'build']));
    const { createServer, preview } = await import('vite');
    server = await preview({ root: workspace, configFile: false, preview: { host: '127.0.0.1', port: 0, open: false } });
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No preview server address.');
    const { checkWorkspace } = await import('./workspace-acceptance.mjs');
    await checkWorkspace(`http://127.0.0.1:${address.port}`);
    devServer = await createServer({ root: workspace, configFile: false, server: { host: '127.0.0.1', port: 0, open: false } });
    await devServer.listen();
    const devAddress = devServer.httpServer.address();
    if (!devAddress || typeof devAddress === 'string') throw new Error('No development server address.');
    await checkWorkspace(`http://127.0.0.1:${devAddress.port}`, { smoke: true });
  }
} finally {
  child?.kill('SIGTERM');
  if (devServer) await devServer.close();
  if (server) await new Promise((resolve, reject) => { server.httpServer.close((error) => error ? reject(error) : resolve()); });
  rmSync(workspace, { recursive: true, force: true });
}
