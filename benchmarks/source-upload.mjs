import process from 'node:process';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { sourceDiff } from '../dist/maplibre/source-upload.js';
const before = { type: 'FeatureCollection', features: Array.from({ length: 20_000 }, (_, id) => ({ type: 'Feature', id, properties: { __geo_editor_id: JSON.stringify(id) }, geometry: { type: 'Point', coordinates: [4.9, 52.3] } })) };
const after = JSON.parse(JSON.stringify(before)); after.features[100].geometry.coordinates = [4.91, 52.31];
const baseline = sourceDiff(new Map(), before).next;
const samples = [];
let result;
for (let i = 0; i < 12; i++) { const start = performance.now(); result = sourceDiff(baseline, after); samples.push(performance.now() - start); }
samples.sort((a, b) => a - b);
process.stdout.write(JSON.stringify({ workload: '20,000 points, one changed', fullBytes: Buffer.byteLength(JSON.stringify(after)), diffBytes: Buffer.byteLength(JSON.stringify(result.diff)), changed: result.diff.add.length, removed: result.diff.remove.length, preparationMedianMs: samples[Math.floor(samples.length / 2)], preparationP95Ms: samples.at(-1), note: 'Core preparation and transfer sizes; not a browser paint budget.' }, null, 2) + '\n');
