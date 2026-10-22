import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { closePolygon, insideRing, validatePolygonRings } from '../src/core/polygon.js';
import { SnapIndex, snappingOptions } from '../src/core/snapping.js';
import type { Coordinate, PolygonFeature, ValidationError } from '../src/index.js';

const box = (x: number, y: number, size: number): Coordinate[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const outer = box(0, 0, 10);
const hole = box(1, 1, 2);
const fixture = (): PolygonFeature => ({ type: 'Feature', id: 0, properties: { nested: { label: 'courtyard' } },
  geometry: { type: 'Polygon', coordinates: [outer, hole, box(6, 6, 2)] } });
function setup(): DrawingSession {
  let id = 0; const session = new DrawingSession(() => `copy-${++id}`);
  session.importGeoJSON(fixture()); session.select(0); session.clearHistory(); return session;
}

it('normalizes exterior CCW and holes CW while preserving first vertices and snapshot isolation', () => {
  const session = setup(); const saved = session.getSelected() as PolygonFeature;
  expect(saved.geometry.coordinates).toEqual([closePolygon(outer), closePolygon(hole, true), closePolygon(box(6, 6, 2), true)]);
  saved.geometry.coordinates[1]![0]![0] = 100;
  expect((session.getSelected() as PolygonFeature).geometry.coordinates[1]![0]).toEqual([1, 1]);
  expect(insideRing([2, 2], outer)).toBe(true); expect(insideRing([0, 2], outer)).toBe(false);
  expect(validatePolygonRings([outer.slice().reverse(), hole])).toBeNull();
});

it.each<{ name: string; rings: Coordinate[][]; error: ValidationError }>([
  { name: 'outside', rings: [outer, box(11, 1, 2)], error: 'hole-outside' },
  { name: 'crossing outer', rings: [outer, box(9, 1, 2)], error: 'ring-intersection' },
  { name: 'touching outer', rings: [outer, box(0, 1, 2)], error: 'ring-intersection' },
  { name: 'overlapping holes', rings: [outer, hole, box(2, 2, 2)], error: 'ring-intersection' },
  { name: 'touching holes', rings: [outer, hole, box(3, 3, 2)], error: 'ring-intersection' },
  { name: 'nested holes', rings: [outer, box(1, 1, 5), box(2, 2, 1)], error: 'nested-holes' },
  { name: 'nested in reverse order', rings: [outer, box(2, 2, 1), box(1, 1, 5)], error: 'nested-holes' },
  { name: 'concave exterior escape', rings: [[[0, 0], [10, 0], [10, 10], [6, 10], [6, 4], [4, 4], [4, 10], [0, 10]], [[2, 2], [8, 2], [8, 8], [2, 8]]], error: 'ring-intersection' },
])('rejects $name atomically through import and transactions', ({ rings, error }) => {
  expect(validatePolygonRings(rings)).toBe(error);
  const session = setup(); session.translateSelection([1, 0]); session.undo(); const before = session.exportGeoJSON(); const state = session.state;
  const invalid = { ...fixture(), geometry: { type: 'Polygon' as const, coordinates: rings.map((ring) => closePolygon(ring)) } };
  expect(() => session.applyTransaction({ update: [invalid] })).toThrow();
  expect(() => session.importGeoJSON({ ...invalid, id: 'bad' })).toThrow();
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state).toEqual(state);
});

it('adds a hole as one edit with original ID/properties, isolated draft, exact undo/redo and cancel', () => {
  const session = setup(); const before = session.exportGeoJSON();
  expect(session.drawHole()).toBe(true); expect(session.drawHole()).toBe(false);
  expect(session.state).toMatchObject({ mode: 'draw-hole', activeRingIndex: 3, canUndo: false, canFinish: false });
  for (const point of box(6, 1, 2).slice(0, -1)) session.add(point);
  expect(session.state.canFinish).toBe(true); expect(session.exportGeoJSON()).toEqual(before);
  session.getDraftRings()![0]!.length = 0;
  const saved = session.finish() as PolygonFeature;
  expect(saved.id).toBe(0); expect(saved.properties).toEqual(fixture().properties); expect(saved.geometry.coordinates).toHaveLength(4);
  expect(session.state.activeRingIndex).toBeNull(); expect(session.undo()?.action).toBe('edit'); expect(session.exportGeoJSON()).toEqual(before);
  session.redo(); expect(session.getSelected()).toEqual(saved);
  session.drawHole(); session.add([4, 4]); session.cancel(); expect(session.getSelected()).toEqual(saved);
});

it('keeps invalid holes editable and protects ongoing gestures from commands', () => {
  const session = setup(); const before = session.exportGeoJSON(); session.drawHole();
  for (const point of box(20, 20, 2).slice(0, -1)) session.add(point);
  expect(session.state.validationError).toBe('hole-outside'); expect(session.finish()).toBeNull();
  for (const action of [() => session.start('Polygon'), () => session.editSelected(1), () => session.splitSelected(), () => session.duplicateSelection(), () => session.deleteHole(1)]) expect(action).toThrow('Finish or cancel');
  session.cancel(); expect(session.exportGeoJSON()).toEqual(before); expect(session.state.canUndo).toBe(false);
});

it('edits a chosen ring with local vertex indices and validates the whole polygon', () => {
  const session = setup(); const before = session.exportGeoJSON(); session.editSelected(1);
  expect(session.state).toMatchObject({ activeRingIndex: 1, vertexCount: 4 });
  session.moveVertex(0, [-1, 1]); expect(session.state.validationError).toBe('ring-intersection'); expect(session.finish()).toBeNull();
  session.moveVertex(0, [1.5, 1]); session.insertVertex(1, [1.2, 2]); expect(session.removeVertex(1)).toBe(true);
  const saved = session.finish() as PolygonFeature;
  expect(saved.geometry.coordinates[0]).toEqual(before.features[0]!.geometry.coordinates[0]);
  expect(saved.geometry.coordinates[2]).toEqual(before.features[0]!.geometry.coordinates[2]);
  session.undo(); expect(session.exportGeoJSON()).toEqual(before); session.redo(); expect(session.getSelected()).toEqual(saved);
  session.editSelected(0); session.moveVertex(0, [5, 5]); expect(session.state.canFinish).toBe(false); session.cancel();
});

it('no-op ring edits preserve history and invalid ring indices leave the session idle', () => {
  const session = setup(); const state = session.state;
  for (const index of [-1, 0.5, 3, NaN]) expect(() => session.editSelected(index)).toThrow(RangeError);
  expect(session.state).toEqual(state);
  session.editSelected(2); session.finish(); expect(session.state).toEqual(state);
  for (const index of [0, -1, 3, NaN]) expect(() => session.deleteHole(index)).toThrow(RangeError);
  expect(session.state).toEqual(state);
  session.select(null); expect(session.drawHole()).toBe(false); expect(session.deleteHole(1)).toBeNull();
});

it('deletes just the requested hole through one transaction and restores exact ring order', () => {
  const session = setup(); const before = session.exportGeoJSON(); const event = session.deleteHole(1)!;
  expect(event.changes).toHaveLength(1); expect(session.getSelected()!.geometry.coordinates).toHaveLength(2);
  expect(session.undo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(before);
  session.redo(); expect(session.getSelected()).toEqual(event.changes[0]!.after);
});

it('translates and duplicates every ring, then restores unchanged originals', () => {
  const session = setup(); const before = session.exportGeoJSON(); const event = session.duplicateSelection([1, -1])!;
  const copied = event.changes[0]!.after as PolygonFeature;
  expect(copied.geometry.coordinates).toEqual((before.features[0] as PolygonFeature).geometry.coordinates.map((ring) => ring.map(([x, y]) => [x + 1, y - 1])));
  session.translateSelection([-1, 1]); expect(session.getSelected()!.geometry).toEqual(before.features[0]!.geometry);
  session.undo(); session.undo(); expect(session.exportGeoJSON()).toEqual(before);
});

it('preserves holes on the correct split parts and rejects cuts touching or crossing holes', () => {
  const session = setup(); const before = session.exportGeoJSON(); session.splitSelected(); session.setSplitLine([[-1, 5], [11, 5]]);
  const preview = session.getSplitPreview()!; expect(preview).not.toBeNull();
  expect(preview.retained.coordinates).toHaveLength(2); expect(preview.created.coordinates).toHaveLength(2);
  expect(validatePolygonRings(preview.retained.coordinates)).toBeNull(); expect(validatePolygonRings(preview.created.coordinates)).toBeNull();
  session.finishSplit(); session.undo(); expect(session.exportGeoJSON()).toEqual(before);
  for (const y of [1, 2, 3]) {
    session.splitSelected(); session.setSplitLine([[-1, y], [11, y]]);
    expect(session.state.splitError).toBe('split-hole-crossing'); expect(session.finishSplit()).toBeNull(); session.cancel();
  }
});

it('indexes vertices and closing edges of holes with unambiguous ring indices', () => {
  const index = new SnapIndex({ type: 'FeatureCollection', features: [fixture()] }, ([x, y]) => ({ x, y }));
  const options = snappingOptions({ enabled: true, distance: 0.2 });
  expect(index.query({ x: 1, y: 1 }, options, ({ x, y }) => [x, y])).toMatchObject({ kind: 'vertex', featureId: 0, ringIndex: 1, index: 0 });
  expect(index.query({ x: 1, y: 2 }, options, ({ x, y }) => [x, y])).toMatchObject({ kind: 'edge', ringIndex: 1, index: 3, coordinate: [1, 2] });
  expect(index.query({ x: 1, y: 1 }, options, ({ x, y }) => [x, y], 0)).toBeNull();
});

it('uses filled planar area, subtracting holes, to choose which split part retains the ID', () => {
  const session = new DrawingSession(() => 'other');
  session.importGeoJSON({ ...fixture(), geometry: { type: 'Polygon', coordinates: [outer, [[0.5, 0.5], [9.5, 0.5], [9.5, 5.5], [0.5, 5.5], [0.5, 0.5]]] } });
  session.select(0); session.splitSelected(); session.setSplitLine([[-1, 6], [11, 6]]);
  const preview = session.getSplitPreview()!;
  expect(preview.retained.coordinates).toHaveLength(1); // 40 filled units versus 60 - 45.
  expect(preview.created.coordinates).toHaveLength(2);
});
