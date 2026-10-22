import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { FeatureId } from '../src/index.js';

function setup(): DrawingSession {
  const session = new DrawingSession(() => 'generated');
  session.importGeoJSON({ type: 'FeatureCollection', features: [0, '0', 'middle', 'last'].map((id) => ({
    type: 'Feature', id, properties: { nested: { id } }, geometry: {
      type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    },
  })) });
  session.clearHistory();
  return session;
}

it('deduplicates typed IDs in acquisition order, toggles and replaces without changing data or history', () => {
  const session = setup(); const before = session.exportGeoJSON();
  expect(session.selectMany([0, '0', 0])).toBe(true);
  expect(session.state).toMatchObject({ selectedFeatureIds: [0, '0'], selectedFeatureId: null, dataRevision: 1, canUndo: false });
  expect(session.getSelected()).toBeNull();
  expect(session.getSelection()).toEqual(before.features.slice(0, 2));
  expect(session.selectMany([0, '0'])).toBe(false);
  session.toggleSelection(0); expect(session.state.selectedFeatureIds).toEqual(['0']);
  expect(session.getSelected()?.id).toBe('0');
  session.toggleSelection(0); expect(session.state.selectedFeatureIds).toEqual(['0', 0]);
  session.select('middle'); expect(session.state.selectedFeatureIds).toEqual(['middle']);
  session.select(null); expect(session.getSelection()).toEqual([]);
  expect(session.selectMany([])).toBe(false);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.canUndo).toBe(false);
});

it('validates complete selection requests before changes and isolates arrays/properties', () => {
  const session = setup(); const ids: FeatureId[] = ['last', 0]; session.selectMany(ids);
  ids.length = 0; session.state.selectedFeatureIds.length = 0;
  session.getSelection()[0]!.geometry.coordinates.length = 0;
  session.getSelection()[0]!.properties!.nested = null;
  const before = session.getSelection();
  for (const invalid of [['middle', 'missing'], null, [null], [Infinity], [true]]) {
    expect(() => session.selectMany(invalid as FeatureId[])).toThrow();
    expect(session.getSelection()).toEqual(before);
  }
  expect(() => session.toggleSelection('missing')).toThrow(RangeError);
  expect(session.state.selectedFeatureIds).toEqual(['last', 0]);
  expect(session.getSelection()).toEqual([session.exportGeoJSON().features[3], session.exportGeoJSON().features[0]]);
});

it('requires exactly one feature for legacy deletion, editing and splitting', () => {
  const session = setup(); session.selectMany([0, '0']);
  expect(session.editSelected()).toBe(false); expect(session.splitSelected()).toBe(false);
  expect(() => session.deleteSelected()).toThrow('deleteSelection');
  expect(session.state).toMatchObject({ mode: 'idle', selectedFeatureIds: [0, '0'], featureCount: 4 });
  session.toggleSelection('0'); expect(session.editSelected()).toBe(true);
  session.cancel(); expect(session.splitSelected()).toBe(true); session.cancel();
});

it('deletes a mixed typed-ID selection atomically, preserves survivor order, and restores exact data in one undo', () => {
  const session = setup(); const before = session.exportGeoJSON(); session.selectMany(['last', 0, '0']);
  const event = session.deleteSelection()!;
  expect(event.changes.map((change) => change.before!.id)).toEqual(['last', 0, '0']);
  expect(event.changes.every((change) => change.after === null)).toBe(true);
  expect(session.state).toMatchObject({ selectedFeatureIds: [], dataRevision: 2, featureCount: 1 });
  expect(session.exportGeoJSON().features).toEqual([before.features[2]]);
  expect(session.deleteSelection()).toBeNull(); expect(session.state.dataRevision).toBe(2);
  event.changes[0]!.before!.properties!.nested = null;
  expect(session.undo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(before);
  expect(session.state.selectedFeatureIds).toEqual([]); expect(session.state.canUndo).toBe(false);
  session.selectMany([0, 'middle']); session.redo();
  expect(session.state.selectedFeatureIds).toEqual(['middle']);
  session.undo(); expect(session.state.selectedFeatureIds).toEqual(['middle']);
  expect(session.exportGeoJSON()).toEqual(before);
});

it('prunes only removed IDs for transactions/history, preserves selection on import/update, and does not restore it on undo', () => {
  const session = setup(); session.selectMany([0, '0', 'last']);
  const original = session.exportGeoJSON().features[1]!;
  session.applyTransaction({ delete: [0], update: [{ ...original, properties: null }] });
  expect(session.state.selectedFeatureIds).toEqual(['0', 'last']);
  expect(session.getSelection()[0]!.properties).toBeNull();
  session.undo(); expect(session.state.selectedFeatureIds).toEqual(['0', 'last']);
  const saved = session.state;
  expect(() => session.applyTransaction({ delete: ['0', 'missing'] })).toThrow();
  expect(session.state).toEqual(saved);
  session.importGeoJSON({ ...original, id: 'imported' });
  expect(session.state.selectedFeatureIds).toEqual(['0', 'last']);
  session.selectMany(['imported', 'last']); session.undo();
  expect(session.state.selectedFeatureIds).toEqual(['last']);
});

it.each(['draw', 'edit', 'split'] as const)('protects active %s sessions and preserves redo on selection/cancel', (mode) => {
  const session = setup(); session.select('middle'); session.deleteSelection(); session.undo();
  session.selectMany([0, 'last']); expect(session.state.canRedo).toBe(true);
  if (mode === 'draw') { session.start('LineString'); expect(session.state.selectedFeatureIds).toEqual([]); }
  else { session.select(0); if (mode === 'edit') session.editSelected(); else session.splitSelected(); }
  const before = session.state;
  for (const action of [() => session.selectMany(['last']), () => session.toggleSelection('last'), () => session.deleteSelection()]) {
    expect(action).toThrow('Finish or cancel'); expect(session.state).toEqual(before);
  }
  session.cancel(); expect(session.state.canRedo).toBe(true);
});
