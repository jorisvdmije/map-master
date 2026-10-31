import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { SnapIndex, snappingOptions } from '../dist/core/snapping.js';

const options = snappingOptions({ enabled: true });
const project = ([x, y]) => ({ x: x * 10000, y: y * 10000 });
const unproject = ({ x, y }) => [x / 10000, y / 10000];
const rows = [];
for (const count of [10, 1000, 10000]) {
  // Fixed 50px squares spaced 100px apart in a 100-column grid.
  const collection = { type: 'FeatureCollection', features: Array.from({ length: count }, (_, id) => {
    const x = id % 100 / 100; const y = Math.floor(id / 100) / 100;
    return { type: 'Feature', id, properties: {}, geometry: { type: 'Polygon', coordinates: [
      [[x, y], [x + 0.005, y], [x + 0.005, y + 0.005], [x, y + 0.005], [x, y]],
    ] } };
  }) };
  const points = Array.from({ length: 1000 }, (_, i) => {
    const id = i * 7919 % count;
    return { x: id % 100 * 100 + 25, y: Math.floor(id / 100) * 100 + 5 };
  });
  const builds = []; const queries = []; const editQueries = [];
  for (let sample = -10; sample < 50; sample++) {
    const start = performance.now(); const index = new SnapIndex(collection, project);
    const buildMs = performance.now() - start;
    const queryStart = performance.now();
    let hits = 0;
    for (const point of points) if (index.query(point, options, unproject)?.kind === 'edge') hits++;
    const queryUs = (performance.now() - queryStart) * 1000 / points.length;
    assert.equal(hits, points.length);
    const editStart = performance.now();
    let editHits = 0;
    for (const point of points) if (index.query(point, options, unproject, 0)?.kind === 'edge') editHits++;
    const editQueryUs = (performance.now() - editStart) * 1000 / points.length;
    assert.equal(editHits, points.filter((_, i) => i * 7919 % count !== 0).length);
    if (sample >= 0) { builds.push(buildMs); queries.push(queryUs); editQueries.push(editQueryUs); }
  }
  builds.sort((a, b) => a - b); queries.sort((a, b) => a - b); editQueries.sort((a, b) => a - b);
  rows.push({ polygons: count, buildMedianMs: builds[25].toFixed(3), buildP95Ms: builds[47].toFixed(3),
    queryMedianUs: queries[25].toFixed(3), queryP95Us: queries[47].toFixed(3),
    editQueryMedianUs: editQueries[25].toFixed(3), editQueryP95Us: editQueries[47].toFixed(3) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
