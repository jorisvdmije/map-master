import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { translateFeatures } from '../src/core/translation.js';
import type { Coordinate, GeometryFeature } from '../src/index.js';

function setup(historyLimit = 100): DrawingSession {
  const session = new DrawingSession(() => 'generated', historyLimit);
  session.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { nested: { label: 'polygon' } }, geometry: {
      type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    } },
    { type: 'Feature', id: 'untouched', properties: null, geometry: { type: 'LineString', coordinates: [[-10, 0], [-9, 1]] } },
    { type: 'Feature', id: '0', properties: { line: true }, geometry: { type: 'LineString', coordinates: [[3, 1], [5, 2]] } },
  ] });
  session.clearHistory(); session.selectMany(['0', 0]); return session;
}

it('translates mixed typed-ID selections once, preserves order/properties, and undoes/redoes exactly', () => {
  const session = setup(); const before = session.exportGeoJSON();
  const event = session.translateSelection([1, -2])!;
  expect(event.changes.map((change) => change.after!.id)).toEqual(['0', 0]);
  expect(session.state).toMatchObject({ selectedFeatureIds: ['0', 0], dataRevision: 2, canUndo: true });
  const after = session.exportGeoJSON();
  expect(after.features.map((feature) => feature.id)).toEqual([0, 'untouched', '0']);
  expect(after.features[1]).toEqual(before.features[1]);
  expect(after.features[0]!.geometry.coordinates).toEqual([[[1, -2], [3, -2], [3, 0], [1, 0], [1, -2]]]);
  expect(after.features[2]!.geometry.coordinates).toEqual([[4, -1], [6, 0]]);
  expect(after.features.map((feature) => feature.properties)).toEqual(before.features.map((feature) => feature.properties));
  event.changes[1]!.after!.properties!.nested = null;
  event.changes[0]!.before!.geometry.coordinates.length = 0;
  expect(session.undo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(before);
  expect(session.state.canUndo).toBe(false); expect(session.state.selectedFeatureIds).toEqual(['0', 0]);
  session.redo(); expect(session.exportGeoJSON()).toEqual(after);
});

it('treats zero offsets and empty selections as no-ops without discarding redo', () => {
  const session = setup(); session.translateSelection([1, 1]); session.undo();
  const state = session.state; const before = session.exportGeoJSON();
  expect(session.translateSelection([0, -0])).toBeNull(); expect(session.state).toEqual(state);
  session.selectMany([]); expect(session.translateSelection([1, 1])).toBeNull();
  expect(session.state.canRedo).toBe(true); expect(session.exportGeoJSON()).toEqual(before);
});

it.each([[180, 0], [-181, 0], [0, 90], [0, -91], [Infinity, 0], [NaN, 1], [1], [1, 2, 3], null, ['1', 0]].map((delta) => ({ delta })))(
  'rejects invalid offsets or group bounds atomically: $delta', ({ delta }) => {
    const session = setup(); session.translateSelection([1, 1]); session.undo();
    const state = session.state; const before = session.exportGeoJSON();
    expect(() => session.translateSelection(delta as Coordinate)).toThrow();
    expect(session.state).toEqual(state); expect(session.exportGeoJSON()).toEqual(before);
  },
);

it.each(['draw', 'edit', 'split'] as const)('protects an active %s session', (mode) => {
  const session = setup(); session.select(0);
  if (mode === 'draw') session.start('LineString');
  if (mode === 'edit') session.editSelected();
  if (mode === 'split') session.splitSelected();
  const before = session.state;
  expect(() => session.translateSelection([1, 1])).toThrow('Finish or cancel');
  expect(session.state).toEqual(before);
});

it('supports single selections and disabled history, with no accumulated preview drift', () => {
  const session = setup(0); session.select('0'); const originals = session.getSelection();
  const saved = structuredClone(originals);
  for (let step = 1; step <= 1000; step++) translateFeatures(originals, [step / 10000, -step / 10000]);
  expect(originals).toEqual(saved);
  const preview = translateFeatures(originals, [0.1, -0.1]);
  session.translateSelection([0.1, -0.1]); expect(session.getSelection()).toEqual(preview);
  expect(session.state.canUndo).toBe(false);
});

it('rejects floating-point collapse through final transaction validation', () => {
  const session = new DrawingSession(() => 'id');
  const feature: GeometryFeature = { type: 'Feature', id: 'tiny', properties: null,
    geometry: { type: 'LineString', coordinates: [[0, 0], [Number.MIN_VALUE, 0]] } };
  session.importGeoJSON(feature); session.select('tiny'); session.clearHistory();
  const before = session.exportGeoJSON();
  expect(() => session.translateSelection([1, 0])).toThrow();
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.canUndo).toBe(false);
});
