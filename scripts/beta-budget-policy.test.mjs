import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataset } from '../tests/fixtures/budgets/data.mjs';
import { policy, summarize, assessLatency, assessMemory } from './beta-budget-policy.mjs';

test('uses nearest-rank p95 and preserves raw ordering', () => {
  const samples = Array.from({ length: 30 }, (_, i) => 30 - i);
  assert.equal(summarize(samples).p95, 29); assert.equal(samples[0], 30);
});
test('fails a breached latency gate without silently dropping slow samples', () => {
  const samples = Array(30).fill(1); samples[0] = 200; samples[1] = 300;
  assert.equal(assessLatency('selectionRender', samples).passed, false);
  assert.equal(assessLatency('selectionRender', Array(30).fill(100)).passed, true);
  assert.throws(() => assessLatency('selectionRender', []));
  assert.throws(() => assessLatency('unknown', samples));
  for (const value of [NaN, Infinity, -1]) assert.throws(() => summarize([value]));
});
test('detects retained growth, slope, nodes and listeners independently', () => {
  const baseline = { heap: 1000000, nodes: 100, listeners: 20 };
  const stable = Array.from({ length: policy.lifecycleSamples }, () => ({ ...baseline }));
  assert.equal(assessMemory(baseline, stable).passed, true);
  for (const [key, extra] of [['heap', policy.memory.heapGrowthBytes + 1], ['nodes', 101], ['listeners', 21]]) {
    const leaked = stable.map(sample => ({ ...sample })); leaked[0][key] += extra;
    assert.equal(assessMemory(baseline, leaked).passed, false);
  }
  const growing = stable.map((sample, i) => ({ ...sample, heap: sample.heap + i * 300000 }));
  const result = assessMemory(baseline, growing);
  assert.ok(result.observed.heapGrowthBytes < policy.memory.heapGrowthBytes);
  assert.equal(result.passed, false); assert.throws(() => assessMemory(baseline, []));
});

test('locks the qualification fixture size and geometry complexity', () => {
  const { features } = dataset();
  assert.equal(features.length, 1000); assert.equal(new Set(features.map(feature => feature.id)).size, 1000);
  const counts = { Point: 0, LineString: 0, Polygon: 0 }; let positions = 0; let maxCorners = 0;
  for (const { geometry } of features) {
    counts[geometry.type]++;
    positions += geometry.type === 'Point' ? 1 : geometry.type === 'LineString' ? geometry.coordinates.length : geometry.coordinates.flat().length;
    if (geometry.type === 'Polygon') maxCorners = Math.max(maxCorners, ...geometry.coordinates.map(ring => ring.length - 1));
  }
  assert.deepEqual(counts, { Point: 333, LineString: 333, Polygon: 334 });
  assert.equal(positions, 2765); assert.equal(maxCorners, 100);
});
