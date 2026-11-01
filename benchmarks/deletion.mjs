import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';

function fixture(count) {
  let id = 0;
  const session = new DrawingSession(() => String(++id));
  for (let index = 0; index < count; index++) {
    const offset = index / 1_000_000;
    session.start('LineString');
    session.add([4.895 + offset, 52.372]);
    session.add([4.896 + offset, 52.373]);
    session.finish();
  }
  session.select(String(Math.ceil(count / 2)));
  return session;
}

// Include the full export needed by the renderer after a deletion. Fixture
// creation and selection are outside the timer; every run starts with fresh data.
const rows = [];
for (const features of [10, 1000, 10000]) {
  const samples = [];
  for (let sample = -10; sample < 50; sample++) {
    const session = fixture(features);
    const start = performance.now();
    const removed = session.deleteSelected();
    const remaining = session.exportGeoJSON();
    const elapsed = performance.now() - start;
    assert.equal(removed.id, String(Math.ceil(features / 2)));
    assert.equal(remaining.features.length, features - 1);
    if (sample >= 0) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  rows.push({ features, medianMs: samples[25].toFixed(3), p95Ms: samples[47].toFixed(3) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
