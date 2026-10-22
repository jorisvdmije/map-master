import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';
import { SnapIndex, snappingOptions } from '../dist/core/snapping.js';

const box = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const rows = [];
const stats = (values) => { values.sort((a, b) => a - b); return `${values[15].toFixed(3)} / ${values[28].toFixed(3)}`; };
for (const count of [1, 25, 100, 400]) {
  const coordinates = Array.from({ length: count }, (_, i) => {
    const x = i % 20 * 2; const y = Math.floor(i / 20) * 2;
    return [box(x, y, 1.5), box(x + 0.5, y + 0.5, 0.5)];
  });
  const input = { type: 'Feature', id: 0, properties: null, geometry: { type: 'MultiPolygon', coordinates } };
  const imports = []; const edits = []; const snaps = [];
  for (let iteration = -5; iteration < 30; iteration++) {
    const session = new DrawingSession(() => 'unused', 1);
    let started = performance.now(); session.importGeoJSON(input); const imported = performance.now() - started;
    session.select(0); session.clearHistory(); const before = session.exportGeoJSON();
    const active = count - 1; session.editSelected(1, active);
    const [x, y] = coordinates[active][1][0];
    started = performance.now(); session.moveVertex(0, [x + 0.1, y]); session.finish(); const edited = performance.now() - started;
    assert.equal(session.state.mode, 'idle'); assert.equal(session.state.dataRevision, 2);
    session.undo(); assert.deepEqual(session.exportGeoJSON(), before);
    started = performance.now();
    const index = new SnapIndex(before, ([x, y]) => ({ x: x * 100, y: y * 100 }));
    const built = performance.now() - started;
    const snap = index.query({ x: x * 100, y: y * 100 }, snappingOptions({ enabled: true }), ({ x, y }) => [x / 100, y / 100]);
    assert.equal(snap?.partIndex, active); assert.equal(snap.ringIndex, 1);
    if (iteration >= 0) { imports.push(imported); edits.push(edited); snaps.push(built); }
  }
  rows.push({ parts: count, 'import median/p95 ms': stats(imports), 'edit median/p95 ms': stats(edits), 'snap index median/p95 ms': stats(snaps) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
