import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { validatePolygon } from '../dist/core/polygon.js';

// Fixed simple rings: no early exit, so every nonadjacent edge pair is checked.
// This measures one complete draft validation, not a browser interaction.
const rows = [];
for (const vertices of [10, 100, 1000]) {
  const ring = Array.from({ length: vertices }, (_, index) => {
    const angle = index / vertices * Math.PI * 2;
    return [4.895 + 0.01 * Math.cos(angle), 52.372 + 0.01 * Math.sin(angle)];
  });
  assert.equal(validatePolygon(ring), null);
  for (let warmup = 0; warmup < 20; warmup++) validatePolygon(ring);
  const samples = [];
  const batch = vertices === 10 ? 100 : vertices === 100 ? 10 : 1;
  for (let sample = 0; sample < 50; sample++) {
    const start = performance.now();
    for (let iteration = 0; iteration < batch; iteration++) validatePolygon(ring);
    samples.push((performance.now() - start) / batch);
  }
  samples.sort((a, b) => a - b);
  rows.push({ vertices, medianMs: samples[25].toFixed(3), p95Ms: samples[47].toFixed(3) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
