import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const destination = new URL('../public/data/', import.meta.url);
await mkdir(destination, { recursive: true });
// Copies are committed with the standalone application. A deployment needs no website checkout.
// Refresh deliberately, after website/scripts/fetch-development.mjs has validated the official sources.
const pairs = [
  ['snapshot.json', 'amsterdam-development.json'],
  ['geometry.json', 'amsterdam-development-geometry.json'],
];
for (const [source, target] of pairs) {
  const from = new URL(`../../website/src/features/development/${source}`, import.meta.url);
  const to = new URL(target, destination);
  const json = JSON.parse(await readFile(from, 'utf8'));
  if (source === 'snapshot.json' && (!json.meta?.sha256 || json.areas?.length < 500)) throw new Error('Incomplete validated source snapshot');
  if (source === 'geometry.json' && (json.type !== 'FeatureCollection' || json.features?.length < 500)) throw new Error('Incomplete validated source geometry');
  await copyFile(from, to);
  console.log(`Prepared ${fileURLToPath(to)}`);
}
