import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { lassoMatcher, prepareLasso } from '../dist/core/lasso.js';

// Fixed projected rectangles on a 40-column grid. Preparation and exact geometry
// matching are timed; map projection, rendering and fixture creation are excluded.
const geometries = Array.from({ length: 1000 }, (_, index) => {
  const x = index % 40 * 20; const y = Math.floor(index / 40) * 20;
  return { type: 'Polygon', coordinates: [[[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]]] };
});
const points = Array.from({ length: 128 }, (_, index) => {
  const angle = index / 128 * Math.PI * 2;
  return [400 + Math.cos(angle) * 100, 250 + Math.sin(angle) * 100];
});
const rows = [];
for (const match of ['intersects', 'contains']) {
  const samples = [];
  let selected = 0;
  for (let index = -5; index < 30; index++) {
    const start = performance.now();
    const result = prepareLasso(points); assert.equal(result.error, null);
    const accepts = lassoMatcher(result.ring, match);
    selected = geometries.filter(accepts).length;
    const duration = performance.now() - start;
    if (index >= 0) samples.push(duration);
  }
  assert.ok(selected > 0 && selected < geometries.length);
  samples.sort((a, b) => a - b);
  rows.push({ features: geometries.length, vertices: 5000, lassoPoints: points.length, match, selected,
    medianMs: samples[15].toFixed(3), p95Ms: samples[28].toFixed(3) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
