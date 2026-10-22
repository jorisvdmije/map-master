import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';

// Fixed mixed lines/four-corner polygons. Excludes import, selection setup,
// export and rendering; includes ID allocation, validation, selection replacement,
// commit/history and returned event snapshots. Redo must reuse the allocated IDs.
const rows = [];
for (const [total, selected] of [[10, 5], [10000, 5], [10000, 500], [10000, 5000]]) {
  let allocated = 0;
  const session = new DrawingSession(() => `copy-${++allocated}`, 1);
  session.importGeoJSON({ type: 'FeatureCollection', features: Array.from({ length: total }, (_, id) => {
    const x = 4 + (id % 100) * 0.001; const y = 52 + Math.floor(id / 100) * 0.001;
    return { type: 'Feature', id, properties: { label: `shape-${id}` }, geometry: id % 2
      ? { type: 'LineString', coordinates: [[x, y], [x + 0.0004, y + 0.0004]] }
      : { type: 'Polygon', coordinates: [[[x, y], [x + 0.0004, y], [x + 0.0004, y + 0.0004], [x, y + 0.0004], [x, y]]] } };
  }) });
  session.clearHistory();
  const ids = Array.from({ length: selected }, (_, id) => id); const original = session.exportGeoJSON();
  const commits = []; const undos = []; const redos = [];
  for (let sample = -10; sample < 50; sample++) {
    session.selectMany(ids);
    let started = performance.now(); const event = session.duplicateSelection([0.001, -0.001]);
    const commit = performance.now() - started;
    started = performance.now(); session.undo(); const undo = performance.now() - started;
    const count = allocated;
    started = performance.now(); const replay = session.redo(); const redo = performance.now() - started;
    assert.equal(event.changes.length, selected); assert.deepEqual(replay.changes, event.changes); assert.equal(allocated, count);
    session.undo();
    if (sample >= 0) { commits.push(commit); undos.push(undo); redos.push(redo); }
  }
  assert.deepEqual(session.exportGeoJSON(), original);
  const stats = (samples) => {
    samples.sort((a, b) => a - b);
    return `${samples[25].toFixed(3)} / ${samples[47].toFixed(3)}`;
  };
  rows.push({ total, selected, 'duplicate median/p95 ms': stats(commits), 'undo median/p95 ms': stats(undos), 'redo median/p95 ms': stats(redos) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
