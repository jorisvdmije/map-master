import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { arch, cpus, platform } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { vertexHandles, pickDirectVertexHandle } from '../dist/maplibre/vertex-handles.js';

// Fixed projection isolates handle generation and nearest-hit acquisition. Browser
// tests cover actual camera projection, capture, movement and map gesture conflicts.
const projection = {
  project: ([x, y]) => ({ x: (x - 4) * 1000, y: (y - 52) * 1000 }),
  unproject: ([x, y]) => ({ wrap: () => ({ lng: 4 + x / 1000, lat: 52 + y / 1000 }) }),
};
const rows = [];
for (const vertices of [100, 1000, 10000]) {
  const coordinates = Array.from({ length: vertices }, (_, index) => [4 + index / vertices, 52 + (index % 2) / 1000]);
  for (const radius of [12, 22]) {
    const samples = [];
    for (let sample = -20; sample < 100; sample++) {
      const index = sample % 2 === 0 ? vertices - 1 : 0;
      const projected = projection.project(coordinates[index]);
      const start = performance.now();
      const handles = vertexHandles(projection, coordinates, false);
      const hit = pickDirectVertexHandle(projection, handles, projected, radius);
      const elapsed = performance.now() - start;
      assert.equal(hit?.kind, 'vertex'); assert.equal(hit?.index, index);
      if (sample >= 0) samples.push(elapsed);
    }
    samples.sort((a, b) => a - b);
    rows.push({ vertices, input: radius === 22 ? 'touch' : 'pen', medianMs: samples[49].toFixed(3), p95Ms: samples[94].toFixed(3) });
  }
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
