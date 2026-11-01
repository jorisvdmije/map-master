import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';
const rows = [];
const stats = (values) => { values.sort((a, b) => a - b); return `${values[15].toFixed(3)} / ${values[28].toFixed(3)}`; };
for (const corners of [10, 100, 1000]) {
  const ring = Array.from({ length: corners }, (_, i) => [4.895 + 0.01 * Math.cos(i * 2 * Math.PI / corners), 52.372 + 0.01 * Math.sin(i * 2 * Math.PI / corners)]);
  const from = ring[0]; const to = ring[corners / 2]; ring.push([...from]);
  for (const kind of ['LineString', 'Polygon']) {
    const routes = []; const appends = []; const commits = []; const undos = [];
    for (let iteration = -5; iteration < 30; iteration++) {
      const session = new DrawingSession(() => 'created', 1);
      session.importGeoJSON({ type: 'Feature', id: 'source', properties: null, geometry: { type: 'Polygon', coordinates: [ring] } });
      session.clearHistory(); const before = session.exportGeoJSON(); session.start(kind);
      let started = performance.now(); const route = session.getBoundaryTrace({ featureId: 'source' }, from, to); const preview = performance.now() - started;
      assert.equal(route.length, corners / 2 + 1);
      started = performance.now(); assert.equal(session.traceBoundary({ featureId: 'source' }, from, to), true); const append = performance.now() - started;
      assert.equal(session.state.canFinish, true);
      started = performance.now(); const feature = session.finish(); const commit = performance.now() - started;
      assert.equal(feature.geometry.type, kind); const after = session.exportGeoJSON(); assert.deepEqual(after.features[0], before.features[0]);
      started = performance.now(); session.undo(); const undo = performance.now() - started;
      assert.deepEqual(session.exportGeoJSON(), before); session.redo(); assert.deepEqual(session.exportGeoJSON(), after);
      if (iteration >= 0) { routes.push(preview); appends.push(append); commits.push(commit); undos.push(undo); }
    }
    rows.push({ corners, kind, 'route median/p95 ms': stats(routes), 'append + validation median/p95 ms': stats(appends), 'commit median/p95 ms': stats(commits), 'undo median/p95 ms': stats(undos) });
  }
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
