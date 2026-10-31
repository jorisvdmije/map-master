import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';
const rows = [];
const stats = (values) => { values.sort((a, b) => a - b); return `${values[15].toFixed(3)} / ${values[28].toFixed(3)}`; };
for (const corners of [10, 100, 1000]) {
  for (const points of [3, 25]) {
    const ring = Array.from({ length: corners }, (_, i) => [4.895 + 0.01 * Math.cos(i * 2 * Math.PI / corners), 52.372 + 0.01 * Math.sin(i * 2 * Math.PI / corners)]);
    const a = ring[0]; const b = ring[corners / 5]; ring.push([...a]);
    const path = Array.from({ length: points }, (_, i) => {
      if (i === 0) return [...a]; if (i === points - 1) return [...b];
      const t = i / (points - 1); const inset = 0.001 * Math.sin(Math.PI * t);
      return [a[0] + t * (b[0] - a[0]) - inset, a[1] + t * (b[1] - a[1]) - inset];
    });
    const previews = []; const commits = []; const undos = [];
    for (let iteration = -5; iteration < 30; iteration++) {
      const session = new DrawingSession(() => { throw new Error('Unexpected ID allocation'); }, 1);
      session.importGeoJSON({ type: 'Feature', id: 'target', properties: { name: 'parcel' }, geometry: { type: 'Polygon', coordinates: [ring] } });
      session.clearHistory(); session.select('target'); const before = session.exportGeoJSON(); session.reshapeSelected();
      let started = performance.now(); session.setReshapePath(path); const preview = performance.now() - started;
      assert.equal(session.state.canFinish, true); const expected = session.getReshapePreview();
      started = performance.now(); const event = session.finishReshape(); const commit = performance.now() - started;
      assert.equal(event.changes.length, 1); const after = session.exportGeoJSON();
      assert.deepEqual(after.features, [{ ...before.features[0], geometry: expected }]);
      started = performance.now(); session.undo(); const undo = performance.now() - started;
      assert.deepEqual(session.exportGeoJSON(), before); session.redo(); assert.deepEqual(session.exportGeoJSON(), after);
      if (iteration >= 0) { previews.push(preview); commits.push(commit); undos.push(undo); }
    }
    rows.push({ corners, points, 'preview median/p95 ms': stats(previews), 'commit median/p95 ms': stats(commits), 'undo median/p95 ms': stats(undos) });
  }
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
