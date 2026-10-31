import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';

const rows = [];
for (const corners of [10, 100, 1000]) {
  for (const selected of [...new Set([1, 2, Math.min(100, corners)])]) {
    const session = new DrawingSession(() => 'polygon');
    session.start('Polygon');
    for (let index = 0; index < corners; index++) {
      const angle = index * 2 * Math.PI / corners;
      session.add([4.895 + 0.01 * Math.cos(angle), 52.372 + 0.01 * Math.sin(angle)]);
    }
    assert.ok(session.finish()); session.select('polygon'); session.editSelected();
    const baseline = session.getDraft();
    const samples = [];
    for (let sample = -20; sample < 50; sample++) {
      // Shift one contiguous arc from a fixed baseline. Includes constructing the
      // batch, atomic coordinate/selection updates and exactly one topology check.
      const start = performance.now();
      session.moveVertices(baseline.slice(0, selected).map((p, index) => ({ index, coordinate: [p[0] + (sample % 2 === 0 ? 0.000001 : 0), p[1]] })));
      const elapsed = performance.now() - start;
      assert.equal(session.state.canFinish, true);
      assert.equal(session.state.selectedVertexIndices.length, selected);
      if (sample >= 0) samples.push(elapsed);
    }
    assert.deepEqual(session.getDraft(), baseline);
    samples.sort((a, b) => a - b);
    rows.push({ corners, selected, medianMs: samples[25].toFixed(3), p95Ms: samples[47].toFixed(3) });
  }
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
