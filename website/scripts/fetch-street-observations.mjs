/** Download complete public pages, validate, match once to NWB, publish only after success. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { roadMatcher } from '../src/features/streets/spatial.ts';

const cachedOnly = process.argv.includes('--from-cache');
const previous = cachedOnly ? JSON.parse(readFileSync(new URL('../src/features/streets/observations-meta.json', import.meta.url))) : null;
const day = previous?.retrieved ?? new Date().toISOString().slice(0, 10), end = `${day.slice(0, 7)}-01`;
const start = `${Number(end.slice(0, 4)) - 1}${end.slice(4)}`;
const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1 + i, 1)).toISOString().slice(0, 7));
const cache = join(tmpdir(), `amsterdam-street-sources-${day}`); mkdirSync(cache, { recursive: true });
const source = JSON.parse(readFileSync(new URL('../src/features/streets/roads.json', import.meta.url)));
const match = roadMatcher(source.features);
const empty = () => ({ lights: 0, known: 0, faults: 0, trees: 0, reports: months.map(() => 0), nuisance: months.map(() => 0), maintenance: months.map(() => 0) });
const rows = Object.fromEntries(source.features.map(f => [f.properties.id, empty()]));
const definitions = [
  { key: 'lights', path: 'storingsmeldingen_ovl_en_klokken/openbare_verlichting', table: 'openbare_verlichting', id: 'objectId', doc: 'storingsmeldingen_ovl_en_klokken', params: {} },
  { key: 'trees', path: 'bomen/stamgegevens', table: 'stamgegevens', id: 'id', doc: 'bomen', params: {} },
  { key: 'reports', path: 'meldingen/meldingen', table: 'meldingen', id: 'id', doc: 'meldingen', params: { 'datumMelding[gte]': start, 'datumMelding[lt]': end } },
];
async function page(url) {
  const file = join(cache, createHash('sha256').update(url).digest('hex') + '.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file));
  if (cachedOnly) throw new Error(`Missing cached source page: ${url}. Re-run without --from-cache to download a new complete snapshot.`);
  let error;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'Accept-Crs': 'EPSG:4326' }, signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      if (!/4326/.test(res.headers.get('Content-Crs') ?? '')) throw new Error('API did not honor WGS84 coordinate request');
      const data = await res.json(); writeFileSync(file + '.tmp', JSON.stringify(data)); renameSync(file + '.tmp', file); return data;
    } catch (e) { error = e; if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); }
  }
  throw error;
}
const heatCells = new Map();
const roadIndex = new Map(source.features.map((f, i) => [f.properties.id, i]));
const metadata = [];
// Separate sources are independent; at most three page requests per source, nine in total.
await Promise.all(definitions.map(async def => {
  const base = `https://api.data.amsterdam.nl/v1/${def.path}`;
  const url = new URL(base); url.search = new URLSearchParams({ ...def.params, _pageSize: def.key === 'lights' ? '2000' : '10000', _count: 'true' }).toString();
  const first = await page(url.href), total = first.page.totalElements, pages = first.page.totalPages;
  if (!Number.isInteger(total) || !Number.isInteger(pages) || !total) throw new Error(`Missing source count: ${def.key}`);
  const audit = { key: def.key, url: base, documentation: `https://api.data.amsterdam.nl/v1/docs/datasets/${def.doc}.html`, query: def.params, retrieved: day, total, pages, matched: 0, unmatched: 0, ambiguous: 0, invalid: 0, excluded: 0, types: {}, minDate: null, maxDate: null, sha256: '' };
  const seen = new Set(), hashes = new Array(pages); let completed = 0;
  const consume = (data, index) => {
    const records = data._embedded?.[def.table]; if (!Array.isArray(records)) throw new Error('Invalid source page');
    hashes[index] = createHash('sha256').update(JSON.stringify(records)).digest('hex');
    for (const r of records) {
      const id = String(r[def.id]); if (seen.has(id)) throw new Error(`Duplicate source ID ${def.key} ${id}`); seen.add(id);
      if (def.key === 'lights') {
        const type = r.objecttypeOmschrijving ?? 'unknown'; audit.types[type] = (audit.types[type] ?? 0) + 1;
        // Count the source as LIGHTING OBJECTS, including its LSD category; never infer lamp counts.
        if (!['Gevel Armaturen', 'LSD Objecten', 'Grachtmast', 'Overspanning', 'Schijnwerpers'].includes(type)) { audit.excluded++; continue; }
      }
      if (def.key === 'reports') {
        if (!(r.datumMelding >= start && r.datumMelding < end)) throw new Error('Server ignored report date filter');
        audit.minDate = audit.minDate === null || r.datumMelding < audit.minDate ? r.datumMelding : audit.minDate;
        audit.maxDate = audit.maxDate === null || r.datumMelding > audit.maxDate ? r.datumMelding : audit.maxDate;
      }
      const coordinates = def.key === 'lights' ? [r.lengtegraad, r.breedtegraad] : def.key === 'trees' ? r.geometrie?.coordinates : [r.longitudeVisualisatie, r.latitudeVisualisatie];
      const m = match(coordinates ?? []); audit[m.status]++;
      if (m.status !== 'matched') continue;
      const target = rows[m.id];
      const gx = Math.floor((coordinates[0] - 4.9) * 67900 / 25), gy = Math.floor((coordinates[1] - 52.37) * 111200 / 25);
      const key = `${m.id}:${gx}:${gy}`;
      let cell = heatCells.get(key);
      if (!cell) { cell = [roadIndex.get(m.id), gx, gy, 0, 0, 0, new Map()]; heatCells.set(key, cell); }
      if (def.key === 'trees') cell[3]++;
      if (def.key === 'lights') { cell[4]++; if (r.storingstatus === 1) cell[5]++; }
      if (def.key === 'lights') { target.lights++; if (r.storingstatus === 0 || r.storingstatus === 1) { target.known++; target.faults += r.storingstatus; } }
      if (def.key === 'trees') target.trees++;
      if (def.key === 'reports') {
        const month = months.indexOf(r.datumMelding.slice(0, 7)); if (month < 0) throw new Error('Invalid report month');
        target.reports[month]++;
        const monthly = cell[6].get(month) ?? [0, 0, 0]; monthly[0]++;
        if (/^Overlast/.test(r.hoofdcategorie)) monthly[1]++;
        if (r.hoofdcategorie === 'Wegen, verkeer, straatmeubilair') monthly[2]++;
        cell[6].set(month, monthly);
        if (/^Overlast/.test(r.hoofdcategorie)) target.nuisance[month]++;
        if (r.hoofdcategorie === 'Wegen, verkeer, straatmeubilair') target.maintenance[month]++;
      }
    }
    completed++; if (completed % 10 === 0 || completed === pages) console.log(`${def.key}: ${completed}/${pages} pages, ${seen.size} unique records`);
  };
  consume(first, 0); let next = 2;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next <= pages) { const index = next++; const u = new URL(url); u.searchParams.set('page', String(index)); consume(await page(u.href), index - 1); }
  }));
  if (seen.size !== total) throw new Error(`Source changed during extraction: ${def.key} ${seen.size} != ${total}`);
  audit.sha256 = createHash('sha256').update(hashes.join('\n')).digest('hex'); metadata.push(audit);
}));
metadata.sort((a, b) => a.key.localeCompare(b.key));
const result = { schema: 1, retrieved: day, reportStart: start, reportEndExclusive: end, months, matchRadiusMetres: 30, ambiguityMetres: 3, countsSha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), geometrySha256: createHash('sha256').update(readFileSync(new URL('../src/features/streets/roads.json', import.meta.url))).digest('hex'), sources: metadata, roads: rows };
if (cachedOnly && result.countsSha256 !== previous.countsSha256) throw new Error('Cached source pages do not reproduce the active street snapshot');
const heat = { schema: 1, countsSha256: result.countsSha256, cellMetres: 25, origin: [4.9, 52.37], metresPerDegree: [67900, 111200],
  roadIds: source.features.map(f => f.properties.id),
  cells: [...heatCells.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map(c => [...c.slice(0, 6), [...c[6]].sort((a, b) => a[0] - b[0]).flatMap(([month, values]) => [month, ...values])]) };
const heatText = JSON.stringify(heat); result.heatSha256 = createHash('sha256').update(heatText).digest('hex');
const output = new URL('../src/features/streets/observations.json', import.meta.url);
writeFileSync(new URL('../src/features/streets/heat.json.tmp', import.meta.url), heatText);
renameSync(new URL('../src/features/streets/heat.json.tmp', import.meta.url), new URL('../src/features/streets/heat.json', import.meta.url));
writeFileSync(new URL('../src/features/streets/observations.json.tmp', import.meta.url), JSON.stringify(result));
renameSync(new URL('../src/features/streets/observations.json.tmp', import.meta.url), output);
const { roads: ignored, ...manifest } = result; void ignored;
manifest.observationsSha256 = createHash('sha256').update(JSON.stringify(result)).digest('hex');
writeFileSync(new URL('../src/features/streets/observations-meta.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ ...manifest, heatCells: heat.cells.length, heatBytes: heatText.length }, null, 2));
