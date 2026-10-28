import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { normalizeRotationAngle, rotateFeatures, rotationPivot, rotationLatitudeLimit } from '../src/core/rotation.js';
import type { Coordinate, GeometryFeature, GeometryFeatureCollection, LineFeature } from '../src/index.js';

const line = (coordinates: Coordinate[], id: string | number = 'line'): LineFeature => ({ type: 'Feature', id, properties: null, geometry: { type: 'LineString', coordinates } });
const fixture: GeometryFeatureCollection = { type: 'FeatureCollection', features: [
  { type: 'Feature', id: 0, properties: { nested: { name: 'parcel' } }, geometry: { type: 'Polygon', coordinates: [
    [[4, 51], [5, 51], [5, 52], [4, 52], [4, 51]],
    [[4.2, 51.2], [4.2, 51.4], [4.4, 51.4], [4.4, 51.2], [4.2, 51.2]],
  ] } },
  line([[-10, 0], [-9, 1]], 'untouched'),
  { type: 'Feature', id: '0', properties: null, geometry: { type: 'MultiLineString', coordinates: [[[5.1, 51], [5.5, 51.2]], [[5.6, 51.4], [5.7, 51.5]]] } },
  { type: 'Feature', id: 'multi', properties: { category: 'islands' }, geometry: { type: 'MultiPolygon', coordinates: [
    [[[6, 51], [6.5, 51], [6, 51.5], [6, 51]]], [[[7, 51], [7.5, 51], [7, 51.5], [7, 51]]],
  ] } },
] };
function setup(limit = 100) {
  const session = new DrawingSession(() => { throw new Error('Do not allocate IDs'); }, limit);
  session.importGeoJSON(fixture); session.clearHistory(); session.selectMany(['0', 0, 'multi']); return session;
}
it('uses clockwise Mercator rotation with known quarter/half turns and an exact fixed pivot', () => {
  const input = [line([[0, 0], [1, 0]])];
  const quarter = rotateFeatures(input, 90, [0, 0])[0] as LineFeature;
  expect(quarter.geometry.coordinates[0]).toEqual([0, 0]);
  expect(quarter.geometry.coordinates[1]![0]).toBe(0);
  expect(quarter.geometry.coordinates[1]![1]).toBeCloseTo(-0.9999492343, 9);
  const half = rotateFeatures([line([[10, 45], [20, 30]])], 180, [0, 0])[0] as LineFeature;
  expect(half.geometry.coordinates[0]![0]).toBeCloseTo(-10, 12);
  expect(half.geometry.coordinates[0]![1]).toBeCloseTo(-45, 12);
  expect(rotateFeatures(input, -90, [0, 0])).toEqual(rotateFeatures(input, 270, [0, 0]));
  expect(input[0]!.geometry.coordinates).toEqual([[0, 0], [1, 0]]);
});
it('uses the projected bounds centre, independent of feature order and vertex density', () => {
  const a = [line([[0, 0], [10, 60]])]; const b = [line([[10, 60], [5, 5], [0, 0]])];
  expect(rotationPivot(a)).toEqual(rotationPivot(b));
  expect(rotationPivot(a)![0]).toBeCloseTo(5, 12);
  expect(rotationPivot(a)![1]).toBeCloseTo(35.2643896828, 9); // Not the geographic midpoint 30°.
  expect(rotationPivot([])).toBeNull();
});
it.each([0, -0, 360, -360, 720])('preserves exact coordinates for complete turn %s', (angle) => {
  expect(rotateFeatures(fixture.features, angle, [5, 52])).toEqual(fixture.features);
  expect(normalizeRotationAngle(angle)).toBe(0);
});
it('previews mixed multipart/holed geometry and commits in one transaction with exact Undo/Redo', () => {
  const session = setup(); const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  expect(session.rotateSelection()).toBe(true);
  expect(session.state).toMatchObject({ mode: 'rotate-features', rotationAngle: 0, rotationError: null, canFinish: true, canUndo: false, activePartIndex: null, activeRingIndex: null, vertexCount: 0 });
  expect(session.setRotationAngle(35)).toBe(true);
  const preview = session.getRotationPreview()!;
  expect(preview.features.map((f) => f.id)).toEqual(['0', 0, 'multi']);
  expect(preview.features.map((f) => f.geometry.type)).toEqual(['MultiLineString', 'Polygon', 'MultiPolygon']);
  expect((preview.features[1] as Extract<GeometryFeature, { geometry: { type: 'Polygon' } }>).geometry.coordinates).toHaveLength(2);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.dataRevision).toBe(revision);
  const event = session.finishRotation()!; expect(event.changes).toHaveLength(3);
  const after = session.exportGeoJSON(); expect(after.features).toEqual([preview.features[1], before.features[1], preview.features[0], preview.features[2]]);
  expect(after.features.map((f) => f.properties)).toEqual(before.features.map((f) => f.properties));
  expect(session.state).toMatchObject({ mode: 'idle', rotationAngle: null, rotationPivot: null, rotationError: null, dataRevision: revision + 1 });
  expect(session.undo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(before);
  expect(session.redo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(after);
});
it('uses a frozen baseline, supports negative/equivalent angles and keeps all snapshots isolated', () => {
  const session = setup(); const pivot: Coordinate = [5, 52]; session.rotateSelection(pivot); pivot[0] = 100;
  for (let angle = 1; angle < 50; angle++) session.setRotationAngle(angle);
  session.setRotationAngle(30); const expected = session.getRotationPreview();
  session.setRotationAngle(90); session.setRotationAngle(390); expect(session.getRotationPreview()).toEqual(expected);
  expect(session.setRotationAngle(30)).toBe(false);
  session.state.rotationPivot![0] = 99; expect(session.state.rotationPivot).toEqual([5, 52]);
  session.getRotationPreview()!.features[0]!.geometry.coordinates.length = 0;
  session.getRotationPreview()!.features[1]!.properties!['nested'] = null;
  expect(session.getRotationPreview()).toEqual(expected);
  const event = session.finishRotation()!; event.changes[0]!.after!.geometry.coordinates.length = 0;
  expect(session.getSelection()).toEqual(expected!.features);
});
it('cancels or confirms a full turn without changing revision/history or discarding Redo', () => {
  const session = setup(); session.rotateSelection(); session.setRotationAngle(10); session.finishRotation(); session.undo();
  const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  session.rotateSelection(); session.setRotationAngle(-20); session.cancel(); expect(session.state.canRedo).toBe(true);
  session.rotateSelection(); session.setRotationAngle(90); session.setRotationAngle(360);
  expect(session.getRotationPreview()!.features).toEqual(session.getSelection()); expect(session.finishRotation()).toBeNull();
  expect(session.state).toMatchObject({ mode: 'idle', canRedo: true, dataRevision: revision }); expect(session.exportGeoJSON()).toEqual(before);
  expect(session.redo()).not.toBeNull();
});
it('rejects out-of-world results without partial changes and allows correction', () => {
  const session = new DrawingSession(() => 'id'); session.importGeoJSON(line([[179, 0], [180, 1]])); session.clearHistory(); session.select('line');
  const before = session.exportGeoJSON(); session.rotateSelection([179, 0]); session.setRotationAngle(90);
  expect(session.state).toMatchObject({ canFinish: false, rotationError: 'rotation-out-of-bounds' });
  expect(session.getRotationPreview()).toBeNull(); expect(session.finishRotation()).toBeNull(); expect(session.finish()).toBeNull();
  expect(session.state.mode).toBe('rotate-features'); expect(session.exportGeoJSON()).toEqual(before);
  session.setRotationAngle(-90); expect(session.state.canFinish).toBe(true); expect(session.finishRotation()?.changes).toHaveLength(1);
});
it('validates numeric degeneration before offering a preview and can recover to exact zero', () => {
  const session = new DrawingSession(() => 'id'); session.importGeoJSON(line([[0, 0], [Number.MIN_VALUE, 0]])); session.select('line'); session.clearHistory();
  session.rotateSelection([0, 0]); session.setRotationAngle(30);
  expect(session.state).toMatchObject({ rotationError: 'rotation-invalid-result', canFinish: false });
  session.setRotationAngle(0); expect(session.state.canFinish).toBe(true); expect(session.finishRotation()).toBeNull(); expect(session.state.canUndo).toBe(false);
});
it.each([NaN, Infinity, -Infinity, '90', null])('rejects malformed angle %s atomically', (angle) => {
  const session = setup(); session.rotateSelection(); session.setRotationAngle(20); const state = session.state; const preview = session.getRotationPreview();
  expect(() => session.setRotationAngle(angle as number)).toThrow(TypeError); expect(session.state).toEqual(state); expect(session.getRotationPreview()).toEqual(preview);
});
it.each([[0, 86], [181, 0], [NaN, 0], [0], [0, 0, 0], Array(2), null])('rejects malformed/out-of-range pivot %s before entering', (pivot) => {
  const session = setup(); const state = session.state;
  expect(() => session.rotateSelection(pivot as Coordinate)).toThrow(); expect(session.state).toEqual(state);
});
it('refuses empty, polar, dateline-crossing and globally spread selections without side effects', () => {
  const session = new DrawingSession(() => 'id'); expect(session.rotateSelection()).toBe(false);
  for (const points of [[[0, 86], [1, 87]], [[179, 0], [-179, 1]]] as Coordinate[][]) {
    const tool = new DrawingSession(() => 'id'); tool.importGeoJSON(line(points)); tool.select('line'); const state = tool.state;
    expect(tool.rotateSelection()).toBe(false); expect(tool.state).toEqual(state);
  }
  expect(rotationPivot([line([[-179, 0], [-178, 0]]), line([[178, 0], [179, 0]], 'two')])).toBeNull();
  expect(rotationPivot([line([[0, rotationLatitudeLimit], [1, rotationLatitudeLimit]])])).not.toBeNull();
});
it('locks selection, competing tools and data/history operations until finish/cancel', () => {
  const session = setup(); session.rotateSelection(); expect(session.rotateSelection()).toBe(false);
  expect(session.add([0, 0])).toBe(false); expect(session.removeLastDrawStep()).toBe(false);
  expect(session.traceBoundary({ featureId: '0' }, [5.1, 51], [5.5, 51.2])).toBe(false);
  for (const action of [() => session.start('LineString'), () => session.editSelected(), () => session.editSharedBoundary(), () => session.select(null),
    () => session.selectMany([0]), () => session.deleteSelection(), () => session.translateSelection([1, 0]), () => session.duplicateSelection(),
    () => session.applyTransaction({ delete: [0] }), () => session.importGeoJSON(fixture), () => session.undo(), () => session.redo(), () => session.clearHistory(),
    () => session.insertVertex(0, [0, 0])]) expect(action).toThrow();
  session.cancel(); expect(session.setRotationAngle(20)).toBe(false); expect(session.finishRotation()).toBeNull(); expect(session.getRotationPreview()).toBeNull();
  session.start('LineString'); expect(() => session.rotateSelection()).toThrow('Finish or cancel');
});
it('supports a single selection and disabled history without assigning a new identity', () => {
  const session = setup(0); session.select(0); session.rotateSelection(); session.setRotationAngle(15); expect(session.finishRotation()?.changes).toHaveLength(1);
  expect(session.state).toMatchObject({ selectedFeatureId: 0, selectedFeatureIds: [0], canUndo: false });
});

it('rejects a rotated line spanning over half the world even with in-range endpoints', () => {
  const session = new DrawingSession(() => 'id'); session.importGeoJSON(line([[0, -80], [0, 80]])); session.select('line'); session.clearHistory();
  session.rotateSelection([0, 0]); session.setRotationAngle(90);
  expect(session.state).toMatchObject({ rotationError: 'rotation-out-of-bounds', canFinish: false });
  expect(session.finishRotation()).toBeNull(); session.setRotationAngle(0); expect(session.finishRotation()).toBeNull(); expect(session.state.canUndo).toBe(false);
});
