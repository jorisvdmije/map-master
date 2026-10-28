import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { GeoJSONImportError } from '../src/core/geojson-import.js';
import { closePolygon, validateMultiPolygon } from '../src/core/polygon.js';
import { SnapIndex, snappingOptions } from '../src/core/snapping.js';
import type { Coordinate, MultiLineFeature, MultiPolygonFeature, ValidationError } from '../src/core/types.js';

const box = (x: number, y: number, size: number): Coordinate[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const polygon = (): MultiPolygonFeature => ({ type: 'Feature', id: 0, properties: { label: 'islands', nested: { tags: ['original'] } },
  geometry: { type: 'MultiPolygon', coordinates: [[box(0, 0, 10), box(2, 2, 6)], [box(20, 0, 10), box(22, 2, 2)], [box(4, 4, 2)]] } });
const line = (): MultiLineFeature => ({ type: 'Feature', id: '0', properties: null,
  geometry: { type: 'MultiLineString', coordinates: [[[0, 12], [5, 12]], [[20, 12], [25, 12], [25, 15]]] } });
function setup(): DrawingSession {
  let id = 0; const session = new DrawingSession(() => `new-${++id}`);
  session.importGeoJSON({ type: 'FeatureCollection', features: [polygon(), line()] }); session.select(0); session.clearHistory(); return session;
}

it('round-trips multipart types, typed IDs, properties, part/ring order and winding with an island in a hole', () => {
  const session = setup(); const data = session.exportGeoJSON();
  expect(data.features[0]!.geometry).toEqual({ type: 'MultiPolygon', coordinates: polygon().geometry.coordinates.map((part) => part.map((ring, index) => closePolygon(ring, index > 0))) });
  expect(data.features[1]).toEqual(line());
  const other = new DrawingSession(() => 'unused'); other.importGeoJSON(data); expect(other.exportGeoJSON()).toEqual(data);
  const copy = session.getSelected() as MultiPolygonFeature;
  copy.geometry.coordinates[1]![1]![0]![0] = 100;
  (copy.properties!.nested as { tags: string[] }).tags.push('changed');
  expect(session.exportGeoJSON()).toEqual(data);
  session.undo(); expect(session.exportGeoJSON()).toEqual(data); // History was cleared.
});

it.each<{ name: string; parts: Coordinate[][][]; error: ValidationError }>([
  { name: 'crossing parts', parts: [[box(0, 0, 10)], [box(5, 5, 10)]], error: 'part-intersection' },
  { name: 'shared edge', parts: [[box(0, 0, 10)], [box(10, 0, 10)]], error: 'part-intersection' },
  { name: 'point touch', parts: [[box(0, 0, 10)], [box(10, 10, 10)]], error: 'part-intersection' },
  { name: 'contained filled part', parts: [[box(0, 0, 10)], [box(2, 2, 2)]], error: 'part-overlap' },
  { name: 'contained filled part reversed', parts: [[box(2, 2, 2)], [box(0, 0, 10)]], error: 'part-overlap' },
  { name: 'island touching hole', parts: [[box(0, 0, 10), box(2, 2, 6)], [box(2, 3, 2)]], error: 'part-intersection' },
])('rejects $name through import and transactions without losing redo or selection', ({ parts, error }) => {
  expect(validateMultiPolygon(parts)).toBe(error);
  const session = setup(); session.translateSelection([1, 0]); session.undo();
  const before = session.exportGeoJSON(); const state = session.state;
  const invalid: MultiPolygonFeature = { ...polygon(), geometry: { type: 'MultiPolygon', coordinates: parts } };
  expect(() => session.importGeoJSON({ ...invalid, id: 'bad' })).toThrow(GeoJSONImportError);
  expect(() => session.applyTransaction({ update: [invalid], delete: ['0'] })).toThrow(GeoJSONImportError);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state).toEqual(state);
});

it.each([
  ['MultiLineString', [], 'too-few-vertices', '$.geometry.coordinates'],
  ['MultiPolygon', [], 'too-few-vertices', '$.geometry.coordinates'],
  ['MultiLineString', new Array<unknown>(1), 'invalid-geojson', '$.geometry.coordinates[0]'],
  ['MultiPolygon', new Array<unknown>(1), 'invalid-geojson', '$.geometry.coordinates[0]'],
  ['MultiLineString', [[[0, 0], [1, 1]], [[2, 2]]], 'too-few-vertices', '$.geometry.coordinates[1]'],
  ['MultiLineString', [[[0, 0], [0, 0]]], 'duplicate-vertex', '$.geometry.coordinates[0]'],
  ['MultiPolygon', [[box(0, 0, 10)], [box(20, 0, 10), box(22, 2, 2).slice(0, -1)]], 'unclosed-ring', '$.geometry.coordinates[1][1]'],
  ['MultiPolygon', [[box(0, 0, 10)], new Array<unknown>(1)], 'invalid-geojson', '$.geometry.coordinates[1][0]'],
] as const)('rejects malformed %s coordinates with a precise path', (type, coordinates, code, path) => {
  const session = setup(); const before = session.exportGeoJSON();
  let caught: unknown;
  try { session.importGeoJSON({ type: 'Feature', id: 'bad', properties: null, geometry: { type, coordinates } }); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(GeoJSONImportError); expect(caught).toMatchObject({ code, path });
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.canUndo).toBe(false);
});

it('edits a hole of the second part without changing the other components, and restores the whole feature exactly', () => {
  const session = setup(); const before = session.exportGeoJSON(); session.editSelected(1, 1);
  expect(session.state).toMatchObject({ mode: 'edit-polygon', activePartIndex: 1, activeRingIndex: 1, vertexCount: 4 });
  session.moveVertex(0, [22.5, 2]); session.insertVertex(1, [22.2, 3]); session.removeVertex(1);
  expect(session.exportGeoJSON()).toEqual(before);
  const preview = session.getInactiveParts(); expect(preview).toHaveLength(2);
  preview[0]!.coordinates.length = 0; expect(session.getInactiveParts()[0]!.coordinates).toHaveLength(2);
  const saved = session.finish() as MultiPolygonFeature;
  const original = before.features[0] as MultiPolygonFeature;
  expect(saved.geometry.type).toBe('MultiPolygon'); expect(saved.geometry.coordinates[0]).toEqual(original.geometry.coordinates[0]);
  expect(saved.geometry.coordinates[2]).toEqual(original.geometry.coordinates[2]); expect(saved.geometry.coordinates[1]).not.toEqual(original.geometry.coordinates[1]);
  expect(session.state).toMatchObject({ mode: 'idle', activePartIndex: null, activeRingIndex: null });
  expect(session.undo()?.action).toBe('edit'); expect(session.exportGeoJSON()).toEqual(before); session.redo(); expect(session.getSelected()).toEqual(saved);
});

it('validates all polygon parts during edits, including the exterior and holes around islands', () => {
  const session = setup(); const before = session.exportGeoJSON();
  session.editSelected(0, 2); session.moveVertex(0, [1, 4]);
  expect(session.state.validationError).toBe('part-intersection'); expect(session.finish()).toBeNull(); session.cancel();
  // Filling a hole that contains an island would cause overlapping parts.
  expect(() => session.deleteHole(1, 0)).toThrow(GeoJSONImportError);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.canUndo).toBe(false);
  session.editSelected(1, 0); session.moveVertex(0, [5, 5]); expect(session.state.canFinish).toBe(false); session.cancel();
  expect(session.exportGeoJSON()).toEqual(before);
});

it('draws and deletes a hole on the requested part with exact edit and transaction history', () => {
  const session = setup(); const before = session.exportGeoJSON(); session.drawHole(1);
  expect(session.state).toMatchObject({ activePartIndex: 1, activeRingIndex: 2, mode: 'draw-hole' });
  for (const point of box(26, 6, 2).slice(0, -1)) session.add(point);
  const after = session.finish() as MultiPolygonFeature;
  expect(after.geometry.coordinates[1]).toHaveLength(3); expect(after.geometry.coordinates[0]).toEqual((before.features[0] as MultiPolygonFeature).geometry.coordinates[0]);
  session.deleteHole(2, 1); expect(session.exportGeoJSON()).toEqual(before);
  session.undo(); expect(session.getSelected()).toEqual(after); session.undo(); expect(session.exportGeoJSON()).toEqual(before);
  session.drawHole(1); session.add([26, 6]); session.cancel(); expect(session.exportGeoJSON()).toEqual(before);
});

it('edits multiline components with local indices, no-op saves, validation and preserved type', () => {
  const session = setup(); session.select('0'); const original = session.getSelected() as MultiLineFeature;
  session.editSelected(0, 1); expect(session.state).toMatchObject({ mode: 'edit-line', activePartIndex: 1, activeRingIndex: null });
  session.finish(); expect(session.state.canUndo).toBe(false);
  session.editSelected(0, 1); session.moveVertex(1, [20, 12]); expect(session.finish()).toBeNull();
  session.moveVertex(1, [24, 12]); session.insertVertex(1, [22, 13]); session.removeVertex(1);
  const saved = session.finish() as MultiLineFeature; expect(saved.geometry.coordinates[0]).toEqual(original.geometry.coordinates[0]);
  expect(saved.geometry.coordinates[1]).toEqual([[20, 12], [24, 12], [25, 15]]);
  session.undo(); expect(session.getSelected()).toEqual(original); session.redo(); expect(session.getSelected()).toEqual(saved);
});

it('keeps single-part multipart wrappers through editing and duplication', () => {
  for (const feature of [line(), polygon()]) {
    feature.geometry.coordinates.length = 1;
    const session = new DrawingSession(() => 'new'); session.importGeoJSON(feature); session.select(feature.id); session.clearHistory();
    session.editSelected(); session.moveVertex(0, [-1, 0]); const saved = session.finish()!;
    expect(saved.geometry.type).toBe(feature.geometry.type);
    const event = session.duplicateSelection([1, 0])!; expect(event.changes[0]!.after!.geometry.type).toBe(feature.geometry.type);
  }
});

it('rejects invalid component/ring addresses before entering a mode and keeps multipart splitting unsupported', () => {
  const session = setup(); const state = session.state;
  for (const index of [-1, 3, 0.5, NaN, Infinity]) {
    expect(() => session.editSelected(0, index)).toThrow(RangeError);
    expect(() => session.drawHole(index)).toThrow(RangeError);
    expect(() => session.deleteHole(1, index)).toThrow(RangeError);
    expect(session.state).toEqual(state);
  }
  expect(() => session.editSelected(2, 1)).toThrow(RangeError); expect(session.splitSelected()).toBe(false);
  expect(session.state).toEqual(state); session.select('0');
  expect(() => session.editSelected(1, 1)).toThrow(RangeError); expect(session.drawHole()).toBe(false);
  session.selectMany([0, '0']); expect(session.editSelected()).toBe(false);
});

it('duplicates, translates and deletes multipart selections as whole features with atomic history', () => {
  const session = setup(); session.selectMany([0, '0']); const before = session.exportGeoJSON();
  const event = session.duplicateSelection([1, -1])!; expect(event.changes).toHaveLength(2);
  expect(session.state.selectedFeatureIds).toEqual(['new-1', 'new-2']);
  session.translateSelection([-1, 1]);
  expect(session.getSelection().map((feature) => feature.geometry)).toEqual(before.features.map((feature) => feature.geometry));
  session.undo(); session.undo(); expect(session.exportGeoJSON()).toEqual(before);
  session.selectMany([0, '0']); session.deleteSelection(); expect(session.state.featureCount).toBe(0);
  session.undo(); expect(session.exportGeoJSON()).toEqual(before);
  session.selectMany([0, '0']); const state = session.state;
  expect(() => session.translateSelection([170, 0])).toThrow(RangeError); expect(session.state).toEqual(state); expect(session.exportGeoJSON()).toEqual(before);
});

it('snaps every part and ring with local indices and never bridges disconnected line parts', () => {
  const session = setup(); const index = new SnapIndex(session.exportGeoJSON(), ([x, y]) => ({ x, y }));
  const options = snappingOptions({ enabled: true, distance: 0.1 });
  const query = (x: number, y: number, excluded: string | number | null = null) => index.query({ x, y }, options, ({ x, y }) => [x, y], excluded);
  expect(query(22, 2)).toMatchObject({ featureId: 0, partIndex: 1, ringIndex: 1, index: 0, kind: 'vertex' });
  expect(query(23, 2)).toMatchObject({ partIndex: 1, ringIndex: 1, index: 3, kind: 'edge' });
  expect(query(20, 12)).toMatchObject({ featureId: '0', partIndex: 1, index: 0, kind: 'vertex' });
  expect(query(20, 12)).not.toHaveProperty('ringIndex');
  expect(query(12, 12)).toBeNull(); expect(query(22, 2, 0)).toBeNull();
  expect(query(22, 12, '0')).toBeNull();
});

it('breaks equally close snap ties by component index before local vertex index', () => {
  const feature = line(); feature.geometry.coordinates = [[[0, 0], [1, 1]], [[1, 1], [2, 0]]];
  const index = new SnapIndex({ type: 'FeatureCollection', features: [feature] }, ([x, y]) => ({ x, y }));
  expect(index.query({ x: 1, y: 1 }, snappingOptions({ enabled: true, distance: 0.1 }), ({ x, y }) => [x, y])).toMatchObject({ partIndex: 0, index: 1 });
});
