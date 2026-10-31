import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';
import { translateFeatures } from '../dist/core/translation.js';

// Mixed two-point lines/four-corner polygons. Fixed selected sizes with a larger
// unrelated store expose accidental whole-store preview work. No renderer/export
// in timings; commit includes snapshots, validation, history, and event payload.
const rows = [];
for (const [total, selected] of [[10, 5], [10000, 5], [10000, 500], [10000, 5000]]) {
  const session = new DrawingSession(() => 'unused', 1);
  session.importGeoJSON({ type: 'FeatureCollection', features: Array.from({ length: total }, (_, id) => {
    const x = 4 + (id % 100) * 0.001; const y = 52 + Math.floor(id / 100) * 0.001;
    return { type: 'Feature', id, properties: { label: `shape-${id}` }, geometry: id % 2
      ? { type: 'LineString', coordinates: [[x, y], [x + 0.0004, y + 0.0004]] }
      : { type: 'Polygon', coordinates: [[[x, y], [x + 0.0004, y], [x + 0.0004, y + 0.0004], [x, y + 0.0004], [x, y]]] } };
  }) });
  session.clearHistory(); session.selectMany(Array.from({ length: selected }, (_, id) => id));
  const original = session.exportGeoJSON(); const baseline = session.getSelection();
  const previewSamples = []; const commitSamples = []; const undoSamples = [];
  for (let sample = -10; sample < 50; sample++) {
    let started = performance.now();
    for (let frame = 0; frame < 20; frame++) translateFeatures(baseline, [0.001 * frame, -0.001 * frame]);
    const preview = (performance.now() - started) / 20;
    started = performance.now(); const event = session.translateSelection([0.001, -0.001]);
    const commit = performance.now() - started;
    started = performance.now(); session.undo(); const undo = performance.now() - started;
    assert.equal(event.changes.length, selected);
    if (sample >= 0) { previewSamples.push(preview); commitSamples.push(commit); undoSamples.push(undo); }
  }
  assert.deepEqual(session.exportGeoJSON(), original);
  const stats = (samples) => {
    samples.sort((a, b) => a - b);
    return `${samples[25].toFixed(3)} / ${samples[47].toFixed(3)}`;
  };
  rows.push({ total, selected, 'preview median/p95 ms': stats(previewSamples),
    'commit median/p95 ms': stats(commitSamples), 'undo median/p95 ms': stats(undoSamples) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
