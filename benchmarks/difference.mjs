import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';

const box = (x, y, width, height = width) => [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]];
const polygon = (id, ring) => ({ type: 'Feature', id, properties: { name: `parcel-${id}` }, geometry: { type: 'Polygon', coordinates: [ring] } });
const rows = [];
const stats = (values) => { values.sort((a, b) => a - b); return `${values[15].toFixed(3)} / ${values[28].toFixed(3)}`; };
for (const layout of ['holes', 'strips']) {
  for (const count of [1, 25, 100, 400]) {
    const target = polygon('target', box(-1, -1, 42, 6));
    const cutters = Array.from({ length: count }, (_, i) => polygon(i, layout === 'holes'
      ? box(i % 20 * 0.2, Math.floor(i / 20) * 0.2, 0.1) : box(i * 0.1, -2, 0.05, 8)));
    const features = [target, ...cutters]; const previews = []; const commits = []; const undos = [];
    for (let iteration = -5; iteration < 30; iteration++) {
      const session = new DrawingSession(() => { throw new Error('Unexpected ID allocation'); }, 1);
      session.importGeoJSON({ type: 'FeatureCollection', features }); session.clearHistory(); session.selectMany(features.map((f) => f.id));
      const before = session.exportGeoJSON();
      let started = performance.now(); session.differenceSelection(); const preview = performance.now() - started;
      assert.equal(session.state.canFinish, true);
      started = performance.now(); const event = session.finishDifference(); const commit = performance.now() - started;
      assert.equal(event.changes.length, 1);
      const after = session.exportGeoJSON(); assert.equal(after.features.length, features.length);
      assert.deepEqual(after.features.slice(1), before.features.slice(1));
      assert.equal(after.features[0].geometry.type, layout === 'holes' ? 'Polygon' : 'MultiPolygon');
      assert.equal(after.features[0].geometry.coordinates.length, count + 1);
      started = performance.now(); session.undo(); const undo = performance.now() - started;
      assert.deepEqual(session.exportGeoJSON(), before); session.redo(); assert.deepEqual(session.exportGeoJSON(), after);
      if (iteration >= 0) { previews.push(preview); commits.push(commit); undos.push(undo); }
    }
    rows.push({ layout, cutters: count, 'preview median/p95 ms': stats(previews), 'commit median/p95 ms': stats(commits), 'undo median/p95 ms': stats(undos) });
  }
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
