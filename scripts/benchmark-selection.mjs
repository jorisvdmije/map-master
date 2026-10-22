import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';

// Fixed two-vertex lines; fixture creation/export is outside the measurement.
// Select alternating IDs at opposite ends of insertion order, then read a snapshot.
const rows = [];
for (const features of [10, 1000, 10000]) {
  let id = 0;
  const session = new DrawingSession(() => String(++id));
  for (let index = 0; index < features; index++) {
    const offset = index / 1_000_000;
    session.start('LineString');
    session.add([4.895 + offset, 52.372]);
    session.add([4.896 + offset, 52.373]);
    session.finish();
  }
  const ids = ['1', String(features)];
  function batch() {
    for (let index = 0; index < 1000; index++) {
      session.select(ids[index % 2]);
      session.getSelected();
    }
  }
  for (let warmup = 0; warmup < 20; warmup++) batch();
  const samples = [];
  for (let sample = 0; sample < 50; sample++) {
    const start = performance.now();
    batch();
    samples.push((performance.now() - start) * 1000 / 1000);
  }
  assert.equal(session.getSelected().id, String(features));
  samples.sort((a, b) => a - b);
  rows.push({ features, medianMicroseconds: samples[25].toFixed(3), p95Microseconds: samples[47].toFixed(3) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
