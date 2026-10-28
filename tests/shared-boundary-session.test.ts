import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { GeometryFeatureCollection } from '../src/core/types.js';
const fixture: GeometryFeatureCollection = { type: 'FeatureCollection', features: [
  { type: 'Feature', id: 0, properties: null, geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } },
  { type: 'Feature', id: 'unrelated', properties: { kind: 'line' }, geometry: { type: 'LineString', coordinates: [[-2, 0], [-1, 1]] } },
  { type: 'Feature', id: '0', properties: { nested: { name: 'east', values: [1, null] } }, geometry: { type: 'Polygon', coordinates: [[[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]] } },
] };
function setup(limit = 100) {
  const session = new DrawingSession(() => { throw new Error('Must not allocate IDs'); }, limit);
  session.importGeoJSON(fixture); session.clearHistory(); session.selectMany([0, '0']); return session;
}
it('previews both polygons and commits two updates with stable identity/order as one transaction', () => {
  const session = setup(); const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  expect(session.editSharedBoundary()).toBe(true);
  expect(session.state).toMatchObject({ mode: 'edit-shared-boundary', canFinish: true, selectedFeatureIds: [0, '0'], selectedFeatureId: null, activeRingIndex: null, activePartIndex: null });
  session.insertVertex(1, [2.5, 1]);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.dataRevision).toBe(revision);
  const preview = session.getSharedBoundaryPreview()!; expect(preview.features.map((feature) => feature.id)).toEqual([0, '0']);
  const event = session.finishSharedBoundary()!; expect(event.changes).toHaveLength(2);
  const after = session.exportGeoJSON(); expect(after.features).toEqual([preview.features[0], before.features[1], preview.features[1]]);
  expect(after.features[0]!.properties).toBeNull(); expect(after.features[2]!.properties).toEqual(before.features[2]!.properties);
  expect(session.state).toMatchObject({ mode: 'idle', dataRevision: revision + 1, selectedFeatureIds: [0, '0'], canUndo: true, sharedBoundaryError: null });
  expect(session.undo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(before);
  expect(session.redo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(after);
});
it('keeps invalid drafts correctable and preserves committed data and history until both results are valid', () => {
  const session = setup(); const before = session.exportGeoJSON(); session.editSharedBoundary();
  session.insertVertex(1, [5, 1]); expect(session.state).toMatchObject({ canFinish: false, sharedBoundaryError: 'shared-boundary-invalid-result', validationError: null });
  expect(session.getSharedBoundaryPreview()).toBeNull(); expect(session.finishSharedBoundary()).toBeNull(); expect(session.finish()).toBeNull();
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.mode).toBe('edit-shared-boundary');
  session.moveVertex(1, [2.5, 1]); expect(session.state.canFinish).toBe(true); expect(session.finishSharedBoundary()?.changes).toHaveLength(2);
});
it('keeps junctions fixed and supports inserting/removing interior shared vertices', () => {
  const session = setup(); session.editSharedBoundary(); const path = session.getDraft();
  expect(session.moveVertex(0, [1, 0])).toBe(false); expect(session.moveVertex(1, [1, 2])).toBe(false);
  expect(session.removeVertex(0)).toBe(false); expect(session.removeVertex(1)).toBe(false);
  expect(() => session.insertVertex(0, [1, 0])).toThrow('fixed'); expect(() => session.insertVertex(2, [1, 2])).toThrow('fixed');
  expect(session.getDraft()).toEqual(path); session.insertVertex(1, [2.5, 1]);
  expect(session.removeVertex(0)).toBe(false); expect(session.removeVertex(2)).toBe(false); expect(session.removeVertex(1)).toBe(true);
  expect(session.getDraft()).toEqual(path); expect(session.finishSharedBoundary()).toBeNull(); expect(session.state.canUndo).toBe(false);
});
it('rejects malformed edits without losing the current valid preview', () => {
  const session = setup(); session.editSharedBoundary(); session.insertVertex(1, [2.5, 1]); const expected = session.getSharedBoundaryPreview(); const path = session.getDraft();
  expect(() => session.moveVertex(1, [NaN, 0])).toThrow(); expect(() => session.insertVertex(1, [181, 0])).toThrow();
  expect(() => session.removeVertex(99)).toThrow(); expect(session.getDraft()).toEqual(path); expect(session.getSharedBoundaryPreview()).toEqual(expected);
});
it('cancels and saves unchanged drafts without discarding Redo or recording history', () => {
  const session = setup(); session.editSharedBoundary(); session.insertVertex(1, [2.5, 1]); session.finishSharedBoundary(); session.undo();
  const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  session.editSharedBoundary(); session.insertVertex(1, [1.5, 1]); session.cancel();
  expect(session.state.canRedo).toBe(true); expect(session.exportGeoJSON()).toEqual(before);
  session.editSharedBoundary(); expect(session.finishSharedBoundary()).toBeNull();
  expect(session.state).toMatchObject({ mode: 'idle', dataRevision: revision, canRedo: true });
  session.redo(); expect(session.exportGeoJSON()).not.toEqual(before);
});
it('locks competing operations and does not confuse shared editing with line drawing', () => {
  const session = setup(); session.editSharedBoundary();
  expect(session.editSharedBoundary()).toBe(false); expect(session.add([2, 1])).toBe(false); expect(session.removeLastDrawStep()).toBe(false);
  expect(session.traceBoundary({ featureId: 0 }, [2, 0], [2, 2])).toBe(false);
  for (const action of [() => session.start('LineString'), () => session.select(null), () => session.selectMany([0]), () => session.editSelected(),
    () => session.importGeoJSON(fixture), () => session.applyTransaction({ delete: [0] }), () => session.unionSelection(), () => session.deleteSelection(),
    () => session.translateSelection([1, 1]), () => session.drawHole(), () => session.duplicateSelection()]) expect(action).toThrow();
  expect(() => session.undo()).toThrow(); expect(() => session.redo()).toThrow();
  session.cancel(); expect(session.getSharedBoundaryPreview()).toBeNull(); session.start('LineString'); expect(session.add([1, 1])).toBe(true);
});
it('returns false without side effects for unsupported selections and throws during another tool', () => {
  const session = setup(); session.select(null); expect(session.editSharedBoundary()).toBe(false);
  session.select(0); expect(session.editSharedBoundary()).toBe(false);
  session.selectMany([0, 'unrelated']); expect(session.editSharedBoundary()).toBe(false);
  session.selectMany([0, '0', 'unrelated']); expect(session.editSharedBoundary()).toBe(false);
  session.selectMany([0, '0']); session.start('Polygon'); expect(() => session.editSharedBoundary()).toThrow('Finish or cancel');
});
it('isolates preview/event snapshots, supports reversed selection and disabled history', () => {
  const session = setup(0); session.selectMany(['0', 0]); session.editSharedBoundary(); session.insertVertex(1, [2.5, 1]);
  const preview = session.getSharedBoundaryPreview()!; preview.features[0].geometry.coordinates.length = 0;
  preview.features[0].properties!['nested'] = null;
  expect(session.getSharedBoundaryPreview()!.features[0].geometry.coordinates).toHaveLength(1);
  const event = session.finishSharedBoundary()!; event.changes[0]!.after!.geometry.coordinates.length = 0;
  expect(session.exportGeoJSON().features[2]!.geometry.coordinates).toHaveLength(1);
  expect(session.state).toMatchObject({ canUndo: false, selectedFeatureIds: ['0', 0] });
});
