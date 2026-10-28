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
for (const layout of ['overlap', 'multipart']) {
  for (const count of [2, 25, 100, 400]) {
    const features = layout === 'overlap'
      ? Array.from({ length: count }, (_, i) => polygon(i, box(i * 0.001, 0, 2)))
      : [{ type: 'Feature', id: 0, properties: null, geometry: { type: 'MultiPolygon',
        coordinates: Array.from({ length: count }, (_, i) => [box(i % 20 * 0.2, Math.floor(i / 20) * 0.2, 0.1)]) } }, polygon(1, box(-1, -1, 6))];
    const previews = []; const commits = []; const undos = [];
    for (let iteration = -5; iteration < 30; iteration++) {
      const session = new DrawingSession(() => { throw new Error('Unexpected ID allocation'); }, 1);
      session.importGeoJSON({ type: 'FeatureCollection', features }); session.clearHistory(); session.selectMany(features.map((f) => f.id));
      const before = session.exportGeoJSON();
      let started = performance.now(); session.intersectionSelection(); const preview = performance.now() - started;
      assert.equal(session.state.canFinish, true);
      const expected = session.getIntersectionPreview().geometry; assert.ok(expected);
      assert.equal(expected.type, layout === 'overlap' ? 'Polygon' : 'MultiPolygon');
      assert.equal(expected.coordinates.length, layout === 'overlap' ? 1 : count);
      started = performance.now(); const event = session.finishIntersection(); const commit = performance.now() - started;
      assert.ok(event); const after = session.exportGeoJSON();
      assert.deepEqual(after.features, [{ ...before.features[0], geometry: expected }]);
      started = performance.now(); session.undo(); const undo = performance.now() - started;
      assert.deepEqual(session.exportGeoJSON(), before); session.redo(); assert.deepEqual(session.exportGeoJSON(), after);
      if (iteration >= 0) { previews.push(preview); commits.push(commit); undos.push(undo); }
    }
    rows.push({ layout, inputs: features.length, parts: layout === 'overlap' ? 1 : count,
      'preview median/p95 ms': stats(previews), 'commit median/p95 ms': stats(commits), 'undo median/p95 ms': stats(undos) });
  }
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
