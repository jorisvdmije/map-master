import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';
const rows = [];
const stats = (values) => { values.sort((a, b) => a - b); return `${values[15].toFixed(3)} / ${values[28].toFixed(3)}`; };
for (const [features, corners] of [[1, 10], [1, 100], [1, 1000], [100, 10]]) {
  const input = { type: 'FeatureCollection', features: Array.from({ length: features }, (_, id) => {
    const ring = Array.from({ length: corners }, (_, i) => [4.895 + (id % 10) * 0.01 + 0.002 * Math.cos(2 * Math.PI * i / corners), 52.372 + Math.floor(id / 10) * 0.01 + 0.002 * Math.sin(2 * Math.PI * i / corners)]);
    return { type: 'Feature', id, properties: { label: `parcel-${id}` }, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } };
  }) };
  const entry = []; const preview = []; const commit = []; const undo = [];
  for (let iteration = -5; iteration < 30; iteration++) {
    const session = new DrawingSession(() => { throw new Error('No ID allocation'); }, 1);
    session.importGeoJSON(input); session.clearHistory(); session.selectMany(input.features.map((f) => f.id)); const before = session.exportGeoJSON();
    let time = performance.now(); assert.equal(session.scaleSelection(), true); const entryTime = performance.now() - time;
    time = performance.now(); session.setScaleFactor(1.5); const previewTime = performance.now() - time;
    assert.equal(session.state.canFinish, true); const expected = session.getScalePreview();
    time = performance.now(); const event = session.finishScale(); const commitTime = performance.now() - time;
    assert.equal(event.changes.length, features); const after = session.exportGeoJSON(); assert.deepEqual(after, expected);
    time = performance.now(); session.undo(); const undoTime = performance.now() - time;
    assert.deepEqual(session.exportGeoJSON(), before); session.redo(); assert.deepEqual(session.exportGeoJSON(), after);
    if (iteration >= 0) { entry.push(entryTime); preview.push(previewTime); commit.push(commitTime); undo.push(undoTime); }
  }
  rows.push({ features, corners, 'entry median/p95 ms': stats(entry), 'preview median/p95 ms': stats(preview), 'commit median/p95 ms': stats(commit), 'undo median/p95 ms': stats(undo) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
