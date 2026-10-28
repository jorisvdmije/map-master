import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';
import { SnapIndex, snappingOptions } from '../dist/core/snapping.js';

const rows = [];
const project = ([x, y]) => ({ x: (x - 4) * 10000, y: (y - 52) * 10000 });
const unproject = ({ x, y }) => [4 + x / 10000, 52 + y / 10000];
const options = snappingOptions({ enabled: true, distance: 3 });
for (const count of [1000, 10000]) {
  const data = { type: 'FeatureCollection', features: Array.from({ length: count }, (_, id) => ({
    type: 'Feature', id, properties: { name: `marker-${id}` },
    geometry: { type: 'Point', coordinates: [4 + id % 100 * 0.001, 52 + Math.floor(id / 100) * 0.001] },
  })) };
  const times = { import: [], index: [], query: [], move: [] };
  for (let sample = -5; sample < 30; sample++) {
    const session = new DrawingSession(() => 'unused', 1);
    let start = performance.now(); session.importGeoJSON(data); const imported = performance.now() - start;
    start = performance.now(); const index = new SnapIndex(data, project); const built = performance.now() - start;
    start = performance.now(); const snap = index.query({ x: 1, y: 1 }, options, unproject); const query = performance.now() - start;
    assert.equal(snap.featureId, 0); assert.equal(snap.kind, 'vertex');
    session.select(0); start = performance.now(); session.translateSelection([0.0001, 0]); const move = performance.now() - start;
    session.undo(); assert.deepEqual(session.getSelected(), data.features[0]);
    if (sample >= 0) { times.import.push(imported); times.index.push(built); times.query.push(query); times.move.push(move); }
  }
  const stats = values => { values.sort((a, b) => a - b); return `${values[15].toFixed(3)} / ${values[28].toFixed(3)}`; };
  rows.push({ points: count, ...Object.fromEntries(Object.entries(times).map(([key, values]) => [`${key} median/p95 ms`, stats(values)])) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
