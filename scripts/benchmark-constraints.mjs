import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { constrainDrawingPoint } from '../dist/core/drawing-constraints.js';
import { DrawingSession } from '../dist/core/drawing-session.js';
const rows = [];
for (const vertices of [10, 1000, 100000]) {
  const session = new DrawingSession(() => 'line'); session.start('LineString');
  for (let i = 0; i < vertices; i++) session.add([4 + i * 0.000001, 52]);
  const times = []; let result;
  for (let iteration = -5; iteration < 30; iteration++) {
    const start = performance.now();
    for (let i = 0; i < 10000; i++) result = constrainDrawingPoint(session.getLastDrawPoint(), [5 + i * 0.000001, 52.2], 45);
    const elapsed = performance.now() - start;
    assert.ok(result); assert.equal(result[1], 52);
    if (iteration >= 0) times.push(elapsed);
  }
  times.sort((a, b) => a - b);
  rows.push({ vertices, '10000 resolutions median/p95 ms': `${times[15].toFixed(3)} / ${times[28].toFixed(3)}` });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
