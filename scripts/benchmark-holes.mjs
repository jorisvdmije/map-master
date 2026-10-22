import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';

// Fixed non-overlapping square holes. Measure complete core import and one-ring
// edits, including whole-polygon validation, copying and history. No renderer.
const box = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const rows = [];
for (const count of [1, 25, 100, 400]) {
  const input = { type: 'Feature', id: 0, properties: null, geometry: { type: 'Polygon', coordinates: [box(0, 0, 50),
    ...Array.from({ length: count }, (_, i) => box(1 + i % 20 * 2, 1 + Math.floor(i / 20) * 2, 1)),
  ] } };
  const imports = []; const edits = [];
  for (let iteration = -5; iteration < 30; iteration++) {
    const session = new DrawingSession(() => 'unused', 1);
    let started = performance.now(); session.importGeoJSON(input); const imported = performance.now() - started;
    session.select(0); session.clearHistory(); const before = session.exportGeoJSON();
    session.editSelected(1);
    started = performance.now(); session.moveVertex(0, [1.1, 1]); session.finish(); const edited = performance.now() - started;
    assert.equal(session.state.mode, 'idle'); assert.equal(session.state.dataRevision, 2);
    session.undo(); assert.deepEqual(session.exportGeoJSON(), before);
    if (iteration >= 0) { imports.push(imported); edits.push(edited); }
  }
  const stats = (values) => { values.sort((a, b) => a - b); return `${values[15].toFixed(3)} / ${values[28].toFixed(3)}`; };
  rows.push({ holes: count, 'import median/p95 ms': stats(imports), 'move/save median/p95 ms': stats(edits) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
