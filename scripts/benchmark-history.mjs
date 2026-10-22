import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';

const rows = [];
for (const count of [10, 1000, 10000]) {
  const session = new DrawingSession(() => 'unused');
  session.importGeoJSON({ type: 'FeatureCollection', features: Array.from({ length: count }, (_, index) => ({
    type: 'Feature', id: String(index), properties: {}, geometry: { type: 'LineString', coordinates: [
      [4.895 + index / 1_000_000, 52.372], [4.896 + index / 1_000_000, 52.373],
    ] },
  })) });
  session.clearHistory();
  session.select(String(Math.floor(count / 2))); session.deleteSelected();
  const restoreSamples = []; const exportSamples = [];
  for (let sample = -10; sample < 50; sample++) {
    let start = performance.now();
    const result = session.undo();
    const restoreMs = performance.now() - start;
    assert.equal(result.action, 'delete');
    assert.equal(session.state.featureCount, count);
    session.redo();
    start = performance.now();
    session.undo(); const exported = session.exportGeoJSON();
    const exportMs = performance.now() - start;
    assert.equal(exported.features.length, count);
    assert.equal(exported.features[Math.floor(count / 2)].id, String(Math.floor(count / 2)));
    session.redo();
    if (sample >= 0) { restoreSamples.push(restoreMs); exportSamples.push(exportMs); }
  }
  restoreSamples.sort((a, b) => a - b); exportSamples.sort((a, b) => a - b);
  rows.push({ features: count, undoMedianMs: restoreSamples[25].toFixed(3), undoP95Ms: restoreSamples[47].toFixed(3),
    undoExportMedianMs: exportSamples[25].toFixed(3), undoExportP95Ms: exportSamples[47].toFixed(3) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
