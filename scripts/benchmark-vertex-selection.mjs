import { strict as assert } from 'node:assert';
import { log, table } from 'node:console';
import { arch, cpus, platform } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';
import { pickEditVertices } from '../dist/maplibre/vertex-handles.js';

// Deterministic projection isolates draft copying/picking/selection from WebGL.
// Actual camera projection and rendering are covered by browser acceptance.
const projection = { project: ([x, y]) => ({ x: (x - 4) * 1000, y: (y - 52) * 1000 }) };
const rows = [];
for (const vertices of [100, 1000, 10000]) {
  const session = new DrawingSession(() => 'line');
  session.importGeoJSON({ type: 'Feature', id: 'line', properties: null, geometry: {
    type: 'LineString', coordinates: Array.from({length: vertices}, (_, i) => [4 + i / vertices, 52 + (i % 2) / 1000]),
  } });
  session.select('line'); session.clearHistory(); session.editSelected();
  const saved = session.exportGeoJSON(); const samples = [];
  for (let sample = -20; sample < 100; sample++) {
    // Alternate disjoint half-width rectangles; bounds lie between vertices.
    const start = { x: sample % 2 === 0 ? -0.01 : 500 - 0.01, y: -1 };
    const end = { x: sample % 2 === 0 ? 500 - 0.01 : 1000, y: 2 };
    const began = performance.now();
    const indices = pickEditVertices(projection, session.getDraft(), start, end, false);
    session.selectVertices(indices);
    const state = session.state;
    const elapsed = performance.now() - began;
    assert.equal(state.selectedVertexIndices.length, vertices / 2);
    assert.equal(state.canUndo, false);
    if (sample >= 0) samples.push(elapsed);
  }
  assert.deepEqual(session.exportGeoJSON(), saved);
  samples.sort((a,b) => a-b);
  rows.push({vertices, selected: vertices / 2, medianMs: samples[49].toFixed(3), p95Ms: samples[94].toFixed(3)});
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
