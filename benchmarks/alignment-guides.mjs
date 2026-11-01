import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { AlignmentIndex, alignmentGuidesOptions } from '../dist/core/alignment-guides.js';

// Fixed screen-space polygons, 800x600 viewport; all vertices are in view.
// Index construction is timed separately. Query batches include up to four draft
// references but exclude map projection, DOM rendering and browser event delivery.
const options = alignmentGuidesOptions({ enabled: true });
const project = ([x, y]) => ({ x, y });
const draft = new AlignmentIndex([{ featureId: null, coordinates: [[40, 40], [60, 50], [80, 40], [100, 80]], closed: false }], project, 800, 600);
const rows = [];
for (const count of [100, 1000, 10_000]) {
  const paths = Array.from({ length: count }, (_, i) => {
    const x = 20 + (i * 37 % 740); const y = 20 + (i * 53 % 540);
    return { featureId: i, coordinates: [[x, y], [x + 12, y + 2], [x + 10, y + 12], [x - 2, y + 10]], closed: true };
  });
  const start = performance.now(); const engine = new AlignmentIndex(paths, project, 800, 600); const buildMs = performance.now() - start;
  const samples = []; let maximum = 0; let limited = 0; let acquired = 0;
  for (let batch = -10; batch < 100; batch++) {
    const begin = performance.now();
    for (let i = 0; i < 100; i++) {
      const query = engine.query({ x: 10 + (i * 47 % 780), y: 10 + (i * 71 % 580) }, options, draft);
      maximum = Math.max(maximum, query.examinedCandidates); limited += Number(query.limited); acquired += Number(query.point !== null);
    }
    if (batch >= 0) samples.push((performance.now() - begin) / 100);
  }
  assert.ok(maximum <= options.maxCandidates); assert.ok(acquired > 0);
  samples.sort((a, b) => a - b);
  rows.push({ features: count, vertices: count * 4, buildMs: buildMs.toFixed(2), medianMs: samples[50].toFixed(4), p95Ms: samples[94].toFixed(4), maxInspected: maximum, limitedQueries: limited });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
