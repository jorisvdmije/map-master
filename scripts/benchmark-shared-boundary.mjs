import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';
const rows = [];
const stats = (values) => { values.sort((a, b) => a - b); return `${values[15].toFixed(3)} / ${values[28].toFixed(3)}`; };
for (const sharedEdges of [10, 100, 1000]) {
  const path = Array.from({ length: sharedEdges + 1 }, (_, i) => [4.895, 52.370 + 0.01 * i / sharedEdges]);
  const start = path[0]; const end = path.at(-1);
  const input = { type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: null, geometry: { type: 'Polygon', coordinates: [[[4.885, start[1]], ...path, [4.885, end[1]], [4.885, start[1]]]] } },
    { type: 'Feature', id: '0', properties: { name: 'east' }, geometry: { type: 'Polygon', coordinates: [[start, [4.905, start[1]], [4.905, end[1]], ...path.slice().reverse()]] } },
  ] };
  const entries = []; const previews = []; const commits = []; const undos = [];
  for (let iteration = -5; iteration < 30; iteration++) {
    const session = new DrawingSession(() => { throw new Error('Must not allocate IDs'); }, 1);
    session.importGeoJSON(input); session.clearHistory(); session.selectMany([0, '0']); const before = session.exportGeoJSON();
    let started = performance.now(); assert.equal(session.editSharedBoundary(), true); const entry = performance.now() - started;
    started = performance.now(); session.moveVertex(sharedEdges / 2, [4.896, path[sharedEdges / 2][1]]); const preview = performance.now() - started;
    assert.equal(session.state.canFinish, true); const expected = session.getSharedBoundaryPreview();
    started = performance.now(); const event = session.finishSharedBoundary(); const commit = performance.now() - started;
    assert.equal(event.changes.length, 2); const after = session.exportGeoJSON(); assert.deepEqual(after, expected);
    started = performance.now(); session.undo(); const undo = performance.now() - started;
    assert.deepEqual(session.exportGeoJSON(), before); session.redo(); assert.deepEqual(session.exportGeoJSON(), after);
    if (iteration >= 0) { entries.push(entry); previews.push(preview); commits.push(commit); undos.push(undo); }
  }
  rows.push({ sharedEdges, 'entry median/p95 ms': stats(entries), 'move + validation median/p95 ms': stats(previews), 'commit median/p95 ms': stats(commits), 'undo median/p95 ms': stats(undos) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
