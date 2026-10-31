import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { SnapIndex, snappingOptions } from '../dist/core/snapping.js';
import { translationAnchor, translateFeatures } from '../dist/core/translation.js';

// Fixed geographic grid with a linear screen projection. Measures the added
// anchor/index/query path separately from existing commit/history benchmarks.
// Browser/WebGL, SVG layout, export, topology validation and source uploads excluded.
const project = ([x, y]) => ({ x: x * 10000, y: y * 10000 });
const unproject = ({ x, y }) => [x / 10000, y / 10000];
const options = snappingOptions({ enabled: true, distance: 8 });
const stats = values => {
  values.sort((a, b) => a - b);
  return `${values[Math.floor(values.length / 2)].toFixed(3)} / ${values[Math.floor(values.length * 0.95)].toFixed(3)}`;
};
const rows = [];
for (const [total, selected] of [[1000, 5], [10000, 5], [10000, 500]]) {
  const collection = { type: 'FeatureCollection', features: Array.from({ length: total }, (_, id) => {
    const x = 4 + (id % 100) * 0.002; const y = 52 + Math.floor(id / 100) * 0.002;
    return { type: 'Feature', id, properties: null, geometry: { type: 'LineString', coordinates: [[x, y], [x + 0.0005, y + 0.0005]] } };
  }) };
  const originals = collection.features.slice(0, selected);
  const excluded = new Set(originals.map(f => f.id));
  const anchor = translationAnchor(originals[0], project(originals[0].geometry.coordinates[0]), project);
  assert.deepEqual(anchor, originals[0].geometry.coordinates[0]);
  const builds = []; let index;
  for (let i = 0; i < 10; i++) { const start = performance.now(); index = new SnapIndex(collection, project); builds.push(performance.now() - start); }
  const queries = []; const previews = [];
  for (let i = -100; i < 1000; i++) {
    const target = collection.features[selected + ((i + 100) % (total - selected))].geometry.coordinates[0];
    const point = project(target); point.x += 3; point.y += 2;
    const start = performance.now(); const snap = index.query(point, options, unproject, excluded);
    const query = performance.now() - start;
    assert.equal(snap.kind, 'vertex'); assert.ok(!excluded.has(snap.featureId));
    const delta = [snap.coordinate[0] - anchor[0], snap.coordinate[1] - anchor[1]];
    const previewStart = performance.now(); const preview = translateFeatures(originals, delta);
    const elapsed = performance.now() - previewStart;
    assert.deepEqual(preview[0].geometry.coordinates[0], snap.coordinate);
    if (i >= 0) { queries.push(query); previews.push(query + elapsed); }
  }
  rows.push({ total, selected, 'index median/p95 ms': stats(builds), 'query median/p95 ms': stats(queries), 'query + translation median/p95 ms': stats(previews) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
