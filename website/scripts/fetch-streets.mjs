/** Rebuild the local, complete NWB municipality snapshot; no credentials required. */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { booleanIntersects } from '@turf/boolean-intersects';
const endpoint = 'https://api.pdok.nl/rws/nationaal-wegenbestand-wegen/ogc/v1/collections/wegvakken/items';
const wards = JSON.parse(readFileSync(new URL('../src/features/bnb/wards.json', import.meta.url)));
const boxes = wards.features.map(w => {
  const points = w.geometry.coordinates.flat(w.geometry.type === 'MultiPolygon' ? 2 : 1);
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
});
let url = `${endpoint}?f=json&gme_naam=Amsterdam&limit=1000`;
const features = [], seen = new Set();
let pages = 0;
while (url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (!Array.isArray(data.features)) throw new Error('Invalid source');
  for (const f of data.features) {
    if (f.properties.gme_id !== 363 || f.properties.gme_naam !== 'Amsterdam') throw new Error('Municipality filter was not applied');
    const id = String(f.properties.wvk_id);
    if (seen.has(id)) throw new Error(`Duplicate ${id}`);
    seen.add(id);
    const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    const coordinates = lines.map(line => line.map(p => p.map(c => +c.toFixed(6))));
    const line = coordinates.reduce((a, b) => a.length > b.length ? a : b);
    const midpoint = line[Math.floor(line.length / 2)];
    const point = { type: 'Feature', geometry: { type: 'Point', coordinates: midpoint }, properties: {} };
    const index = wards.features.findIndex((w, i) => midpoint[0] >= boxes[i][0] && midpoint[0] <= boxes[i][2] && midpoint[1] >= boxes[i][1] && midpoint[1] <= boxes[i][3] && booleanIntersects(point, w));
    features.push({ type: 'Feature', id, properties: { id, name: f.properties.stt_naam?.trim() || f.properties.wegnummer || 'Naamloos wegvak', ward: index < 0 ? 'outside' : wards.features[index].properties.code, length: Math.round(f.properties.st_lengthshape), kind: f.properties.bst_code || 'ONB' }, geometry: { type: 'MultiLineString', coordinates } });
  }
  pages++;
  console.log(`NWB page ${pages}: ${features.length} road segments`);
  url = data.links.find(link => link.rel === 'next')?.href;
}
features.sort((a, b) => a.properties.id.localeCompare(b.properties.id));
writeFileSync(new URL('../src/features/streets/roads.json', import.meta.url), JSON.stringify({ type: 'FeatureCollection', features }));
const metadata = { source: endpoint, query: 'gme_naam=Amsterdam', retrieved: new Date().toISOString().slice(0, 10), pages, count: features.length, namedStreets: new Set(features.filter(f => f.properties.name !== 'Naamloos wegvak').map(f => f.properties.name)).size, outsideWards: features.filter(f => f.properties.ward === 'outside').length };
writeFileSync(new URL('../src/features/streets/snapshot.json', import.meta.url), JSON.stringify(metadata, null, 2) + '\n');
console.log(metadata, resolve('src/features/streets/roads.json'));
