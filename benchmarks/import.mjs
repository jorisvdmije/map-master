import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';

const fixtures = [10, 1000, 10000].map((count) => ({ name: `${count} lines`, input: {
  type: 'FeatureCollection', features: Array.from({ length: count }, (_, index) => ({
    type: 'Feature', id: `line-${index}`, properties: { label: 'Road', nested: { active: true } },
    geometry: { type: 'LineString', coordinates: [[4.895 + index / 1_000_000, 52.372], [4.896, 52.373]] },
  })),
} }));
for (const count of [100, 1000]) {
  const ring = Array.from({ length: count }, (_, index) => {
    const angle = index * 2 * Math.PI / count;
    return [4.895 + 0.01 * Math.cos(angle), 52.372 + 0.01 * Math.sin(angle)];
  });
  ring.push([...ring[0]]);
  fixtures.push({ name: `polygon, ${count} corners`, input: { type: 'FeatureCollection', features: [{
    type: 'Feature', id: 'polygon', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] },
  }] } });
}
const rows = [];
for (const { name, input } of fixtures) {
  const samples = [];
  for (let sample = -10; sample < 50; sample++) {
    const session = new DrawingSession(() => 'unused');
    const start = performance.now();
    const result = session.importGeoJSON(input);
    const elapsed = performance.now() - start;
    assert.equal(result.features.length, input.features.length);
    assert.equal(session.state.dataRevision, 1);
    if (sample >= 0) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  rows.push({ fixture: name, medianMs: samples[25].toFixed(3), p95Ms: samples[47].toFixed(3) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
