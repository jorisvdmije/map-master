import { expect, it, vi } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate, GeometryFeatureCollection } from '../src/index.js';

const fixture = (): GeometryFeatureCollection => ({ type: 'FeatureCollection', features: [
  { type: 'Feature', id: 0, properties: { nested: { values: [1, true, null] } },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } },
  { type: 'Feature', id: 'middle', properties: null, geometry: { type: 'LineString', coordinates: [[-10, 0], [-9, 1]] } },
  { type: 'Feature', id: '0', properties: { name: 'line' }, geometry: { type: 'LineString', coordinates: [[3, 1], [5, 2]] } },
] });
function setup(createId?: () => string, historyLimit = 100): DrawingSession {
  let id = 0;
  const session = new DrawingSession(createId ?? (() => `copy-${++id}`), historyLimit);
  session.importGeoJSON(fixture()); session.clearHistory(); session.selectMany(['0', 0]); return session;
}

it('appends independent mixed copies in selection order, selects them, and undoes/redoes once with stable IDs', () => {
  let next = 0; const allocate = vi.fn(() => `copy-${++next}`); const session = setup(allocate);
  const event = session.duplicateSelection()!;
  const expected = { type: 'FeatureCollection', features: [...fixture().features,
    { ...fixture().features[2]!, id: 'copy-1' }, { ...fixture().features[0]!, id: 'copy-2' }] };
  expect(session.exportGeoJSON()).toEqual(expected);
  expect(event.changes).toEqual(expected.features.slice(3).map((after) => ({ before: null, after })));
  expect(session.state).toMatchObject({ dataRevision: 2, featureCount: 5, selectedFeatureIds: ['copy-1', 'copy-2'] });
  // Returned events and selected snapshots must not alias stored copies or originals.
  event.changes[0]!.after!.geometry.coordinates.length = 0;
  event.changes[1]!.after!.properties!.nested = null;
  session.getSelection()[0]!.properties!.name = 'mutated';
  expect(session.exportGeoJSON()).toEqual(expected);
  expect(session.undo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(fixture());
  expect(session.state).toMatchObject({ canUndo: false, selectedFeatureIds: [], canRedo: true });
  session.select(0); session.redo(); expect(session.exportGeoJSON()).toEqual(expected);
  expect(session.state.selectedFeatureIds).toEqual([0]); expect(allocate).toHaveBeenCalledTimes(2);
});

it('offsets all copies uniformly and allows moving/editing them without affecting originals', () => {
  const session = setup(); session.duplicateSelection([1, -2]);
  const copies = session.getSelection();
  expect(copies[0]!.geometry.coordinates).toEqual([[4, -1], [6, 0]]);
  expect(copies[1]!.geometry.coordinates).toEqual([[[1, -2], [3, -2], [3, 0], [1, 0], [1, -2]]]);
  session.translateSelection([0.5, 0.5]);
  expect(session.exportGeoJSON().features.slice(0, 3)).toEqual(fixture().features);
  session.undo(); expect(session.getSelection()).toEqual(copies);
  session.select('copy-1'); session.editSelected(); session.moveVertex(0, [10, 10]); session.finish();
  expect(session.exportGeoJSON().features.slice(0, 3)).toEqual(fixture().features);
});

it('reserves pending IDs as well as existing typed IDs before any mutation', () => {
  const candidates = ['0', 'middle', 'fresh', 'fresh', 'next'];
  const allocate = vi.fn(() => candidates.shift()!); const session = setup(allocate);
  session.duplicateSelection();
  expect(session.state.selectedFeatureIds).toEqual(['fresh', 'next']); expect(allocate).toHaveBeenCalledTimes(5);
  expect(session.exportGeoJSON().features.slice(0, 3)).toEqual(fixture().features);
});

it('rejects an exhausted ID factory after a partially prepared group, preserving selection, data and redo', () => {
  const allocate = vi.fn(() => 'one-id'); const session = setup(allocate);
  session.translateSelection([1, 1]); session.undo();
  const before = session.exportGeoJSON(); const state = session.state;
  expect(() => session.duplicateSelection()).toThrow('unique feature ID');
  expect(allocate).toHaveBeenCalledTimes(101);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state).toEqual(state);
});

it.each([[NaN, 0], [0, Infinity], [1], null, [0, 90], [179, 0]].map((delta) => ({ delta })))(
  'rejects malformed offsets or out-of-bounds groups atomically: $delta', ({ delta }) => {
    const allocate = vi.fn(() => 'unused'); const session = setup(allocate);
    session.translateSelection([1, 1]); session.undo(); const before = session.exportGeoJSON(); const state = session.state;
    expect(() => session.duplicateSelection(delta as Coordinate)).toThrow();
    expect(session.exportGeoJSON()).toEqual(before); expect(session.state).toEqual(state);
    expect(allocate).not.toHaveBeenCalled();
  },
);

it('rejects a degenerate result through transaction validation without creating the other valid copy', () => {
  const session = setup(); session.importGeoJSON({ type: 'Feature', id: 'tiny', properties: null,
    geometry: { type: 'LineString', coordinates: [[0, 0], [Number.MIN_VALUE, 0]] } });
  session.selectMany([0, 'tiny']); session.clearHistory(); const before = session.exportGeoJSON(); const state = session.state;
  expect(() => session.duplicateSelection([1, 0])).toThrow();
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state).toEqual(state);
});

it('empty selection preserves redo, while a successful duplicate replaces the redo branch', () => {
  const allocate = vi.fn(() => 'fresh'); const session = setup(allocate);
  session.translateSelection([1, 1]); session.undo(); session.select(null); const state = session.state;
  expect(session.duplicateSelection()).toBeNull(); expect(session.state).toEqual(state); expect(allocate).not.toHaveBeenCalled();
  session.select('middle'); session.duplicateSelection();
  expect(session.getSelected()).toEqual({ ...fixture().features[1], id: 'fresh' });
  expect(session.state.canRedo).toBe(false); session.undo(); expect(session.exportGeoJSON()).toEqual(fixture());
});

it.each(['draw', 'edit', 'split'] as const)('protects an active %s session', (mode) => {
  const session = setup(); session.select(0);
  if (mode === 'draw') session.start('Polygon');
  if (mode === 'edit') session.editSelected();
  if (mode === 'split') session.splitSelected();
  const before = session.state;
  expect(() => session.duplicateSelection()).toThrow('Finish or cancel'); expect(session.state).toEqual(before);
});

it('supports repeated duplication with new IDs and disabled history', () => {
  const session = setup(undefined, 0); session.select(0); session.duplicateSelection(); session.duplicateSelection();
  expect(session.exportGeoJSON().features.map((feature) => feature.id)).toEqual([0, 'middle', '0', 'copy-1', 'copy-2']);
  expect(session.state).toMatchObject({ selectedFeatureId: 'copy-2', canUndo: false, canRedo: false });
});
