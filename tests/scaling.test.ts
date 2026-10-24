import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { scaleFeatures } from '../src/core/scaling.js';
import { transformPivot, mercatorLatitudeLimit } from '../src/core/mercator-transform.js';
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
it('scales uniformly in Mercator around an exact explicit pivot, independently of input', () => {
  const input = [line([[10, 30], [20, 45]])];
  const output = scaleFeatures(input, 2, [10, 30])[0] as LineFeature;
  expect(output.geometry.coordinates[0]).toEqual([10, 30]);
  expect(output.geometry.coordinates[1]![0]).toBeCloseTo(30, 12);
  const projectY = (lat: number) => Math.asinh(Math.tan(lat * Math.PI / 180));
  expect(projectY(output.geometry.coordinates[1]![1]) - projectY(30)).toBeCloseTo(2 * (projectY(45) - projectY(30)), 12);
  expect(input[0]!.geometry.coordinates).toEqual([[10, 30], [20, 45]]);
  expect(scaleFeatures(input, 1, [0, 0])).toEqual(input);
  expect(scaleFeatures(input, 1, [0, 0])[0]!.geometry).not.toBe(input[0]!.geometry);
});
it('uses the projected bounds centre, independent of feature order and vertex density', () => {
  const a = [line([[0, 0], [10, 60]])]; const b = [line([[10, 60], [5, 5], [0, 0]])];
  expect(transformPivot(a)).toEqual(transformPivot(b));
  expect(transformPivot(a)![0]).toBeCloseTo(5, 12);
  expect(transformPivot(a)![1]).toBeCloseTo(35.2643896828, 9);
  expect(transformPivot([])).toBeNull();
});
it('previews mixed multipart/holed geometry and commits in one transaction with exact Undo/Redo', () => {
  const session = setup(); const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  expect(session.scaleSelection()).toBe(true);
  expect(session.state).toMatchObject({ mode: 'scale-features', scaleFactor: 1, scaleError: null, canFinish: true, canUndo: false, activePartIndex: null, activeRingIndex: null, vertexCount: 0 });
  expect(session.setScaleFactor(1.5)).toBe(true);
  const preview = session.getScalePreview()!;
  expect(preview.features.map((f) => f.id)).toEqual(['0', 0, 'multi']);
  expect(preview.features.map((f) => f.geometry.type)).toEqual(['MultiLineString', 'Polygon', 'MultiPolygon']);
  expect((preview.features[1] as Extract<GeometryFeature, { geometry: { type: 'Polygon' } }>).geometry.coordinates).toHaveLength(2);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.dataRevision).toBe(revision);
  const event = session.finishScale()!; expect(event.changes).toHaveLength(3);
  const after = session.exportGeoJSON(); expect(after.features).toEqual([preview.features[1], before.features[1], preview.features[0], preview.features[2]]);
  expect(after.features.map((f) => f.properties)).toEqual(before.features.map((f) => f.properties));
  expect(session.state).toMatchObject({ mode: 'idle', scaleFactor: null, scalePivot: null, scaleError: null, dataRevision: revision + 1 });
  expect(session.undo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(before);
  expect(session.redo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(after);
});
it('uses a frozen baseline, supports shrink/grow factors and keeps all snapshots isolated', () => {
  const session = setup(); const pivot: Coordinate = [5, 52]; session.scaleSelection(pivot); pivot[0] = 100;
  for (let factor = 0.1; factor < 2; factor += 0.1) session.setScaleFactor(factor);
  session.setScaleFactor(0.5); const expected = session.getScalePreview();
  session.setScaleFactor(2); session.setScaleFactor(0.5); expect(session.getScalePreview()).toEqual(expected);
  expect(session.setScaleFactor(0.5)).toBe(false);
  session.state.scalePivot![0] = 99; expect(session.state.scalePivot).toEqual([5, 52]);
  session.getScalePreview()!.features[0]!.geometry.coordinates.length = 0;
  session.getScalePreview()!.features[1]!.properties!['nested'] = null;
  expect(session.getScalePreview()).toEqual(expected);
  const event = session.finishScale()!; event.changes[0]!.after!.geometry.coordinates.length = 0;
  expect(session.getSelection()).toEqual(expected!.features);
});
it('cancels or confirms a factor one without changing revision/history or discarding Redo', () => {
  const session = setup(); session.scaleSelection(); session.setScaleFactor(1.1); session.finishScale(); session.undo();
  const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  session.scaleSelection(); session.setScaleFactor(0.8); session.cancel(); expect(session.state.canRedo).toBe(true);
  session.scaleSelection(); session.setScaleFactor(2); session.setScaleFactor(1);
  expect(session.getScalePreview()!.features).toEqual(session.getSelection()); expect(session.finishScale()).toBeNull();
  expect(session.state).toMatchObject({ mode: 'idle', canRedo: true, dataRevision: revision }); expect(session.exportGeoJSON()).toEqual(before);
  expect(session.redo()).not.toBeNull();
});
it('rejects out-of-world results without partial changes and allows correction', () => {
  const session = new DrawingSession(() => 'id'); session.importGeoJSON(line([[179, 0], [180, 1]])); session.clearHistory(); session.select('line');
  const before = session.exportGeoJSON(); session.scaleSelection([179, 0]); session.setScaleFactor(2);
  expect(session.state).toMatchObject({ canFinish: false, scaleError: 'scale-out-of-bounds' });
  expect(session.getScalePreview()).toBeNull(); expect(session.finishScale()).toBeNull(); expect(session.finish()).toBeNull();
  expect(session.state.mode).toBe('scale-features'); expect(session.exportGeoJSON()).toEqual(before);
  session.setScaleFactor(0.5); expect(session.state.canFinish).toBe(true); expect(session.finishScale()?.changes).toHaveLength(1);
});
it('validates numeric degeneration before offering a preview and can recover to exact identity', () => {
  const session = new DrawingSession(() => 'id'); session.importGeoJSON(line([[0, 0], [Number.MIN_VALUE, 0]])); session.select('line'); session.clearHistory();
  session.scaleSelection([0, 0]); session.setScaleFactor(0.5);
  expect(session.state).toMatchObject({ scaleError: 'scale-invalid-result', canFinish: false });
  session.setScaleFactor(1); expect(session.state.canFinish).toBe(true); expect(session.finishScale()).toBeNull(); expect(session.state.canUndo).toBe(false);
});
it.each([NaN, Infinity, -Infinity, '2', null])('rejects malformed factor %s atomically', (angle) => {
  const session = setup(); session.scaleSelection(); session.setScaleFactor(1.2); const state = session.state; const preview = session.getScalePreview();
  expect(() => session.setScaleFactor(angle as number)).toThrow(TypeError); expect(session.state).toEqual(state); expect(session.getScalePreview()).toEqual(preview);
});
it.each([[0, 86], [181, 0], [NaN, 0], [0], [0, 0, 0], Array(2), null])('rejects malformed/out-of-range pivot %s before entering', (pivot) => {
  const session = setup(); const state = session.state;
  expect(() => session.scaleSelection(pivot as Coordinate)).toThrow(); expect(session.state).toEqual(state);
});
it('refuses empty, polar, dateline-crossing and globally spread selections without side effects', () => {
  const session = new DrawingSession(() => 'id'); expect(session.scaleSelection()).toBe(false);
  for (const points of [[[0, 86], [1, 87]], [[179, 0], [-179, 1]]] as Coordinate[][]) {
    const tool = new DrawingSession(() => 'id'); tool.importGeoJSON(line(points)); tool.select('line'); const state = tool.state;
    expect(tool.scaleSelection()).toBe(false); expect(tool.state).toEqual(state);
  }
  expect(transformPivot([line([[-179, 0], [-178, 0]]), line([[178, 0], [179, 0]], 'two')])).toBeNull();
  expect(transformPivot([line([[0, mercatorLatitudeLimit], [1, mercatorLatitudeLimit]])])).not.toBeNull();
});
it('locks selection, competing tools and data/history operations until finish/cancel', () => {
  const session = setup(); session.scaleSelection(); expect(session.scaleSelection()).toBe(false);
  expect(session.add([0, 0])).toBe(false); expect(session.removeLastDrawStep()).toBe(false);
  expect(session.traceBoundary({ featureId: '0' }, [5.1, 51], [5.5, 51.2])).toBe(false);
  for (const action of [() => session.start('LineString'), () => session.editSelected(), () => session.editSharedBoundary(), () => session.select(null),
    () => session.selectMany([0]), () => session.deleteSelection(), () => session.translateSelection([1, 0]), () => session.duplicateSelection(),
    () => session.applyTransaction({ delete: [0] }), () => session.importGeoJSON(fixture), () => session.undo(), () => session.redo(), () => session.clearHistory(),
    () => session.insertVertex(0, [0, 0])]) expect(action).toThrow();
  session.cancel(); expect(session.setScaleFactor(1.2)).toBe(false); expect(session.finishScale()).toBeNull(); expect(session.getScalePreview()).toBeNull();
  session.start('LineString'); expect(() => session.scaleSelection()).toThrow('Finish or cancel');
});
it('supports a single selection and disabled history without assigning a new identity', () => {
  const session = setup(0); session.select(0); session.scaleSelection(); session.setScaleFactor(1.5); expect(session.finishScale()?.changes).toHaveLength(1);
  expect(session.state).toMatchObject({ selectedFeatureId: 0, selectedFeatureIds: [0], canUndo: false });
});

it('rejects a scaled selection spanning over half the world even with in-range endpoints', () => {
  const session = new DrawingSession(() => 'id'); session.importGeoJSON(line([[-60, 0], [60, 0]])); session.select('line'); session.clearHistory();
  session.scaleSelection([0, 0]); session.setScaleFactor(2);
  expect(session.state).toMatchObject({ scaleError: 'scale-out-of-bounds', canFinish: false });
  expect(session.finishScale()).toBeNull(); session.setScaleFactor(1); expect(session.finishScale()).toBeNull(); expect(session.state.canUndo).toBe(false);
});

it.each([0, -0, -1])('rejects nonpositive factor %s without changing an active preview', (factor) => {
  const session = setup(); session.scaleSelection(); session.setScaleFactor(1.5);
  const state = session.state; const preview = session.getScalePreview();
  expect(() => session.setScaleFactor(factor)).toThrow(RangeError);
  expect(session.state).toEqual(state); expect(session.getScalePreview()).toEqual(preview);
});
it('blocks rotation and scaling from replacing each other', () => {
  const session = setup(); session.scaleSelection(); expect(() => session.rotateSelection()).toThrow('Finish or cancel');
  session.cancel(); session.rotateSelection(); expect(() => session.scaleSelection()).toThrow('Finish or cancel');
});
it('keeps shared coordinates identical across scaled features and preserves closure', () => {
  const session = new DrawingSession(() => 'id');
  session.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'parcel', properties: null, geometry: { type: 'Polygon', coordinates: [[[4, 52], [5, 52], [5, 53], [4, 52]]] } },
    line([[5, 52], [5, 53]], 'edge'),
  ] }); session.selectMany(['parcel', 'edge']); session.scaleSelection(); session.setScaleFactor(0.7);
  const features = session.getScalePreview()!.features;
  const polygon = features[0]!.geometry; const edge = features[1]!.geometry;
  if (polygon.type !== 'Polygon' || edge.type !== 'LineString') throw new Error('Wrong geometry types');
  expect(polygon.coordinates[0]!.slice(1, 3)).toEqual(edge.coordinates);
  expect(polygon.coordinates[0]![0]).toEqual(polygon.coordinates[0]!.at(-1));
});
it('rejects enormous and numerically collapsed factors, then recovers without history', () => {
  const session = setup(); const before = session.exportGeoJSON(); session.scaleSelection();
  session.setScaleFactor(Number.MAX_VALUE); expect(session.state.scaleError).toBe('scale-out-of-bounds');
  session.setScaleFactor(Number.MIN_VALUE); expect(session.state.scaleError).toBe('scale-invalid-result');
  expect(session.finishScale()).toBeNull(); expect(session.exportGeoJSON()).toEqual(before);
  session.setScaleFactor(1); expect(session.finishScale()).toBeNull(); expect(session.state.canUndo).toBe(false);
});
