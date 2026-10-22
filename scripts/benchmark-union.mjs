import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';

const box = (x, y) => [[x, y], [x + 0.15, y], [x + 0.15, y + 0.15], [x, y + 0.15], [x, y]];
const rows = [];
const stats = (values) => { values.sort((a, b) => a - b); return `${values[15].toFixed(3)} / ${values[28].toFixed(3)}`; };
for (const layout of ['overlapping', 'disjoint']) {
  for (const count of [2, 25, 100, 400]) {
    const features = Array.from({ length: count }, (_, i) => ({ type: 'Feature', id: i, properties: { name: `parcel-${i}` },
      geometry: { type: 'Polygon', coordinates: [box(i % 20 * (layout === 'overlapping' ? 0.1 : 0.2), Math.floor(i / 20) * (layout === 'overlapping' ? 0.1 : 0.2))] },
    }));
    const previews = []; const commits = []; const undos = [];
    for (let iteration = -5; iteration < 30; iteration++) {
      const session = new DrawingSession(() => 'unused', 1);
      session.importGeoJSON({ type: 'FeatureCollection', features }); session.clearHistory(); session.selectMany(features.map((f) => f.id));
      const before = session.exportGeoJSON();
      let started = performance.now(); session.unionSelection(); const preview = performance.now() - started;
      assert.equal(session.state.canFinish, true);
      started = performance.now(); session.finishUnion(); const commit = performance.now() - started;
      const after = session.exportGeoJSON(); assert.equal(after.features.length, 1); assert.equal(after.features[0].id, 0);
      started = performance.now(); session.undo(); const undo = performance.now() - started;
      assert.deepEqual(session.exportGeoJSON(), before); session.redo(); assert.deepEqual(session.exportGeoJSON(), after);
      if (iteration >= 0) { previews.push(preview); commits.push(commit); undos.push(undo); }
    }
    rows.push({ layout, features: count, 'preview median/p95 ms': stats(previews), 'commit median/p95 ms': stats(commits), 'undo median/p95 ms': stats(undos) });
  }
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
