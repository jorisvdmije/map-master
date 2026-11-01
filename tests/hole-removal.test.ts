import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate, GeometryFeature, PolygonFeature } from '../src/index.js';

const box = (x: number, y: number, size: number): Coordinate[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const polygon: PolygonFeature = { type: 'Feature', id: 0, properties: { name: 'Courtyards', nested: { value: 3 } },
  geometry: { type: 'Polygon', coordinates: [box(0, 0, 10), box(1, 1, 2), box(6, 6, 2)] } };
function setup(feature: GeometryFeature = polygon): DrawingSession {
  const session = new DrawingSession(() => 'unused');
  session.importGeoJSON(feature); session.select(feature.id); session.clearHistory();
  return session;
}

it('previews a chosen hole without changing stored data and commits one exact undoable transaction', () => {
  const session = setup(); const before = session.exportGeoJSON();
  expect(session.removeHole()).toBe(true);
  expect(session.removeHole()).toBe(false);
  expect(session.state).toMatchObject({ mode: 'remove-hole', activePartIndex: 0, activeRingIndex: 1, canFinish: true, canUndo: false });
  expect(session.setHoleToRemove(2)).toBe(true);
  expect(session.setHoleToRemove(2)).toBe(false);
  const preview = session.getHoleRemovalPreview() as PolygonFeature;
  expect(preview.geometry.coordinates).toEqual(before.features[0]!.geometry.type === 'Polygon'
    ? before.features[0]!.geometry.coordinates.slice(0, 2) : []);
  preview.properties!.name = 'changed'; preview.geometry.coordinates.length = 0;
  expect(session.getHoleRemovalPreview()).not.toEqual(preview);
  expect(session.exportGeoJSON()).toEqual(before);
  expect(session.finish()).toBeNull();
  expect(session.add([5, 5])).toBe(false);
  const event = session.finishHoleRemoval()!;
  expect(event.changes).toHaveLength(1);
  expect(event.changes[0]!.before).toEqual(before.features[0]);
  expect(event.changes[0]!.after!.id).toBe(0);
  expect(event.changes[0]!.after!.properties).toEqual(polygon.properties);
  const after = session.exportGeoJSON();
  expect(session.state).toMatchObject({ mode: 'idle', activeRingIndex: null, activePartIndex: null, dataRevision: 2 });
  expect(session.getHoleRemovalPreview()).toBeNull();
  expect(session.undo()!.action).toBe('transaction');
  expect(session.exportGeoJSON()).toEqual(before);
  expect(session.state.canUndo).toBe(false);
  session.redo(); expect(session.exportGeoJSON()).toEqual(after);
});

it('cancels without consuming history, rejects invalid indices atomically and freezes mutation commands', () => {
  const session = setup(); session.translateSelection([1, 0]);
  const before = session.exportGeoJSON();
  session.removeHole(); const state = session.state; const preview = session.getHoleRemovalPreview();
  for (const [ring, part] of [[0, 0], [-1, 0], [3, 0], [1.5, 0], [1, -1], [1, 1], [1, NaN]]) {
    expect(() => session.setHoleToRemove(ring!, part)).toThrow(RangeError);
    expect(session.state).toEqual(state); expect(session.getHoleRemovalPreview()).toEqual(preview);
  }
  for (const run of [() => session.start('Polygon'), () => session.editSelected(), () => session.select(null),
    () => session.deleteHole(1), () => session.applyTransaction({}), () => session.undo(), () => session.importGeoJSON(polygon)]) {
    expect(run).toThrow('Finish or cancel');
  }
  expect(session.cancel()).toBe(true);
  expect(session.exportGeoJSON()).toEqual(before);
  expect(session.state.canUndo).toBe(true);
  expect(session.finishHoleRemoval()).toBeNull();
  expect(() => session.setHoleToRemove(1)).toThrow('Start removing');
});

it('targets holes in any multipolygon part without changing component order or the multipart wrapper', () => {
  const feature: GeometryFeature = { ...polygon, geometry: { type: 'MultiPolygon', coordinates: [
    [box(20, 0, 4)], polygon.geometry.coordinates,
  ] } };
  const session = setup(feature); const before = session.exportGeoJSON();
  session.removeHole();
  expect(session.state).toMatchObject({ activePartIndex: 1, activeRingIndex: 1 });
  session.setHoleToRemove(2, 1); session.finishHoleRemoval();
  const saved = session.getSelected()!;
  expect(saved.geometry.type).toBe('MultiPolygon');
  if (saved.geometry.type !== 'MultiPolygon') throw new Error('Expected multipart');
  expect(saved.geometry.coordinates[0]).toEqual([box(20, 0, 4)]);
  expect(saved.geometry.coordinates[1]).toHaveLength(2);
  session.undo(); expect(session.exportGeoJSON()).toEqual(before);
});

it('blocks filling a hole that contains another component, then lets the user choose a valid hole', () => {
  const feature: GeometryFeature = { ...polygon, geometry: { type: 'MultiPolygon', coordinates: [
    polygon.geometry.coordinates, [box(1.5, 1.5, 0.5)],
  ] } };
  const session = setup(feature); const before = session.exportGeoJSON();
  expect(session.removeHole()).toBe(true);
  expect(session.state).toMatchObject({ canFinish: false, validationError: 'part-overlap' });
  expect(session.getHoleRemovalPreview()).toBeNull();
  expect(session.finishHoleRemoval()).toBeNull();
  expect(session.exportGeoJSON()).toEqual(before);
  session.setHoleToRemove(2);
  expect(session.state.canFinish).toBe(true);
  expect(session.finishHoleRemoval()).not.toBeNull();
});

it('requires one unlocked polygon with holes and cancels when its lock changes', () => {
  const session = setup(); session.select(null); expect(session.removeHole()).toBe(false);
  session.select(0); session.setLockedFeatureIds([0]); expect(session.removeHole()).toBe(false);
  session.setLockedFeatureIds([]); const before = session.exportGeoJSON(); session.removeHole();
  session.setLockedFeatureIds([0]);
  expect(session.state.mode).toBe('idle'); expect(session.getHoleRemovalPreview()).toBeNull();
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.canUndo).toBe(false);
  const solid = setup({ ...polygon, geometry: { type: 'Polygon', coordinates: [box(0, 0, 10)] } });
  expect(solid.removeHole()).toBe(false);
  const point = setup({ ...polygon, geometry: { type: 'Point', coordinates: [0, 0] } });
  expect(point.removeHole()).toBe(false);
});
