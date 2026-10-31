import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { overlapRegions } from '../dist/core/overlap-regions.js';
import { FeatureStyling } from '../dist/maplibre/feature-styling.js';
import { resolveAppearance } from '../dist/core/appearance.js';
import { resolveStyling } from '../dist/core/feature-styling.js';

const rows = [];
const stats = samples => { samples.sort((a, b) => a - b); return `${samples[10].toFixed(3)} / ${samples[18].toFixed(3)}`; };
for (const [layout, count] of [['disjoint', 1000], ['groups-of-three', 999], ['dense', 30]]) {
  const features = Array.from({ length: count }, (_, i) => {
    const group = layout === 'groups-of-three' ? Math.floor(i / 3) : i;
    const x = layout === 'dense' ? i * 0.0001 : 4 + group % 40 * 0.02 + (layout === 'groups-of-three' ? i % 3 * 0.002 : 0);
    const y = 52 + Math.floor(group / 40) * 0.02;
    return { type: 'Feature', id: i, properties: { color: ['#f00', '#0f0', '#00f'][i % 3] }, geometry: { type: 'Polygon',
      coordinates: [[[x, y], [x + 0.008, y], [x + 0.008, y + 0.008], [x, y + 0.008], [x, y]]] } };
  });
  const collection = { type: 'FeatureCollection', features }; const original = JSON.stringify(collection);
  const cold = []; const warm = []; const regionCounts = [];
  // No GPU/source work: measures partitioning and cached rule/palette evaluation only.
  const map = { on() {}, off() {}, hasImage() { return true; } };
  const styling = new FeatureStyling(map, 'benchmark', resolveStyling({ feature: feature => ({ shape: { fillColor: feature.properties.color } }),
    overlap: { enabled: true, palette: ['#f00', '#0f0', '#00f'] } }));
  const appearance = resolveAppearance(); styling.prepare(collection, appearance);
  for (let iteration = -3; iteration < 20; iteration++) {
    let start = performance.now(); const regions = overlapRegions(features); const elapsed = performance.now() - start;
    start = performance.now(); styling.prepare(collection, appearance); const cached = performance.now() - start;
    assert.deepEqual(styling.issues, []); assert.equal(JSON.stringify(collection), original);
    if (iteration >= 0) { cold.push(elapsed); warm.push(cached); regionCounts.push(regions.length); }
  }
  assert.equal(new Set(regionCounts).size, 1);
  rows.push({ layout, polygons: count, regions: regionCounts[0], 'partition median/p95 ms': stats(cold), 'cached restyle median/p95 ms': stats(warm) });
  styling.destroy(false);
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`); table(rows);
