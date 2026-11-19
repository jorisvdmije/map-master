import { mkdir, rename, writeFile, readFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';

const { sourceCatalog } = await tsImport('../src/data/catalog.ts', import.meta.url);
const { fetchSourceLive } = await tsImport('../src/data/source-loader.ts', import.meta.url);
const base = JSON.parse(await readFile(new URL('../public/data/amsterdam-development.json', import.meta.url), 'utf8'));
const knownCodes = base.areas.map((area) => area.code);
const destination = new URL('../public/data/catalog/', import.meta.url);
await mkdir(destination, { recursive: true });
const requested = process.argv.slice(2);
const selected = requested.length ? sourceCatalog.filter((source) => requested.includes(source.id)) : sourceCatalog;
if (!selected.length || requested.some((id) => !sourceCatalog.some((source) => source.id === id))) throw new Error('Unknown catalog source id');
// Sequential source groups keep load on the official API bounded; indicator requests inside a group run together.
for (const source of selected) {
  const bundle = await fetchSourceLive(source, { knownCodes });
  if (bundle.areas.length !== 518) throw new Error('Unexpected neighborhood coverage');
  const target = new URL(`${source.id}.json`, destination);
  const temporary = new URL(`${source.id}.json.tmp`, destination);
  await writeFile(temporary, `${JSON.stringify(bundle)}\n`);
  await rename(temporary, target);
  console.log(`${source.title}: ${bundle.variables.length} variables, ${bundle.areas.length} neighborhoods, ${bundle.years.join(', ')}, SHA256 ${bundle.sha256}`);
}
