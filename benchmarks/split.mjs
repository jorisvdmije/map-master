import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { splitPolygon } from '../dist/core/split-polygon.js';
const rows = [];
for (const corners of [10, 100, 1000]) {
  const ring = Array.from({ length: corners }, (_, i) => [4.895 + 0.01 * Math.cos(i * 2 * Math.PI / corners), 52.372 + 0.01 * Math.sin(i * 2 * Math.PI / corners)]);
  ring.push([...ring[0]]);
  const cut = [[4.875, 52.37373], [4.915, 52.37373]];
  const samples = [];
  for (let sample = -20; sample < 50; sample++) {
    const start = performance.now(); const result = splitPolygon(ring, cut); const elapsed = performance.now() - start;
    assert.equal(result.error, null); if (sample >= 0) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  rows.push({ corners, medianMs: samples[25].toFixed(3), p95Ms: samples[47].toFixed(3) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
