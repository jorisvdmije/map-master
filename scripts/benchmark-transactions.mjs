import assert from 'node:assert/strict';
import { log, table } from 'node:console';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { DrawingSession } from '../dist/core/drawing-session.js';

const line = (id, x = 4.895) => ({ type: 'Feature', id, properties: { nested: { label: 'original' } },
  geometry: { type: 'LineString', coordinates: [[x, 52.372], [x + 0.001, 52.373]] },
});
const rows = [];
for (const count of [10, 1000, 10000]) {
  const session = new DrawingSession(() => 'unused');
  session.importGeoJSON({ type: 'FeatureCollection', features: Array.from({ length: count }, (_, i) => line(String(i))) });
  session.clearHistory();
  const input = { update: [line('1', 4.896)], delete: [String(count - 1), '0'], create: [line('new-a'), line('new-b')] };
  const commits = []; const replays = [];
  for (let sample = -10; sample < 50; sample++) {
    const start = performance.now(); const event = session.applyTransaction(input);
    const commitMs = performance.now() - start;
    assert.equal(event.changes.length, 5); assert.equal(session.state.featureCount, count);
    const undoStart = performance.now(); session.undo(); const undoMs = performance.now() - undoStart;
    const data = session.exportGeoJSON(); assert.equal(data.features[0].id, '0'); assert.equal(data.features.at(-1).id, String(count - 1));
    if (sample >= 0) { commits.push(commitMs); replays.push(undoMs); }
  }
  commits.sort((a, b) => a - b); replays.sort((a, b) => a - b);
  rows.push({ features: count, commitMedianMs: commits[25].toFixed(3), commitP95Ms: commits[47].toFixed(3),
    undoMedianMs: replays[25].toFixed(3), undoP95Ms: replays[47].toFixed(3) });
}
log(`${process.version}; ${platform()} ${arch()}; ${cpus()[0]?.model}`);
table(rows);
