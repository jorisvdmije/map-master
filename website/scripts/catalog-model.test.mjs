import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { defaultFilters, filterCatalog, readFilters, parseSaved, catalogCsv, metadataExport } from '../src/features/catalog/model.ts';
import { themes, availability } from '../src/features/catalog/types.ts';
import { searchPages } from '../src/features/search/queries.ts';
const catalog = JSON.parse(readFileSync(new URL('../.generated/data-catalog.json', import.meta.url)));
const entries = catalog.datasets;
const find = q => filterCatalog(entries, { ...defaultFilters, q });
test('catalog has distinct real source profiles and keeps external discovery separate from local files', () => {
  assert.ok(entries.length >= 30); assert.equal(new Set(entries.map(row => row.id)).size, entries.length);
  for (const row of entries) {
    assert.ok(row.title && row.summary && row.access && row.caveat && row.time);
    assert.ok(row.theme in themes); assert.ok(row.availability in availability);
    assert.equal(new URL(row.source.url).protocol, 'https:');
    assert.equal(row.availability === 'local', row.downloads.length > 0);
    if (row.availability === 'connected') assert.ok(row.usedIn.length);
  }
  assert.equal(entries.filter(row => row.availability === 'local').length, 4);
  assert.ok(find('luchtkwaliteit fijnstof').some(row => row.id === 'luchtmeetnet'));
  assert.ok(find('laadpaal').some(row => row.id === 'laadpunten'));
  assert.ok(find('WOZ').some(row => row.id === 'cbs-buurten'));
  assert.ok(find('speeltuin').some(row => row.id === 'sport'));
});
test('filters combine; unknown URL values fall back; saved IDs never load arbitrary records', () => {
  const filters = readFilters('?q=groen&theme=groen&availability=connected&coverage=amsterdam&provider=Gemeente%20Amsterdam', entries);
  const rows = filterCatalog(entries, filters); assert.ok(rows.length);
  assert.ok(rows.every(row => row.theme === 'groen' && row.availability === 'connected' && row.coverage === 'amsterdam'));
  assert.deepEqual(readFilters('?theme=oops&availability=fake&coverage=world&provider=unknown', entries), defaultFilters);
  assert.deepEqual(parseSaved('["bomen","bomen","missing",3,null]', entries), ['bomen']);
  assert.deepEqual(parseSaved('{bad', entries), []);
  assert.deepEqual(filterCatalog(entries, { ...defaultFilters, saved: true }, ['bomen']).map(row => row.id), ['bomen']);
  assert.equal(find('never-a-real-source-298743').length, 0);
});
test('every local download exists and has the exact advertised size and SHA; GeoJSON is a real collection', () => {
  for (const row of entries) for (const file of row.downloads) {
    const path = resolve(import.meta.dirname, '../public', file.path.slice(1));
    const bytes = readFileSync(path);
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
    if (file.format === 'GeoJSON') { const data = JSON.parse(bytes); assert.equal(data.type, 'FeatureCollection'); assert.equal(data.features.length, row.snapshot.count); }
  }
  const housing = entries.find(row => row.id === 'cbs-buurten');
  const csv = readFileSync(resolve(import.meta.dirname, '../public', housing.downloads.find(file => file.format === 'CSV').path.slice(1)), 'utf8');
  assert.equal(csv.charCodeAt(0), 0xfeff); assert.match(csv.split('\r\n')[0], /CBS/);
});
test('CSV and JSON export preserve source provenance and selected records without claiming to contain datasets', () => {
  const rows = find('fijnstof');
  const exported = metadataExport(catalog, rows, { ...defaultFilters, q: 'fijnstof' });
  assert.deepEqual(exported.datasets.map(row => row.id), rows.map(row => row.id));
  assert.equal(exported.filters.q, 'fijnstof'); assert.ok(exported.meaning.includes('geen volledige datasets'));
  assert.ok(catalogCsv(rows).includes('Luchtmeetnet'));
  assert.match(catalogCsv([{ ...rows[0], title: '=HYPERLINK("https://example.com")' }]), /'=/);
  const search = JSON.parse(readFileSync(new URL('../public/search.json', import.meta.url)));
  assert.ok(searchPages(search, 'databank').some(page => page.href === '/data/'));
  assert.ok(searchPages(search, 'fijnstof').some(page => page.href === '/data/luchtmeetnet/'));
});
