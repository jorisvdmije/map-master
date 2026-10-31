// Run named benchmarks against the current build: npm run benchmark -- snapping union
// Without arguments, list the available benchmarks. Use `all` to run every one.
import { spawnSync } from 'node:child_process';
import { error, log } from 'node:console';
import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const available = readdirSync(directory)
  .filter((file) => file.endsWith('.mjs') && file !== 'run.mjs')
  .map((file) => basename(file, '.mjs'))
  .sort();

const requested = process.argv.slice(2);
if (requested.length === 0) {
  log('Usage: npm run benchmark -- <name...> | all\n');
  log(`Available benchmarks:\n  ${available.join('\n  ')}`);
  process.exit(0);
}

const names = requested.includes('all') ? available : requested;
const unknown = names.filter((name) => !available.includes(name));
if (unknown.length > 0) {
  error(`Unknown benchmark: ${unknown.join(', ')}. Run without arguments to list them.`);
  process.exit(1);
}

for (const name of names) {
  log(`\n# ${name}`);
  const result = spawnSync(process.execPath, [join(directory, `${name}.mjs`)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
