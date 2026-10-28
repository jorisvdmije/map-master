import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { simplifyFeatures } from '../src/core/simplification.js';
import type { Coordinate, GeometryFeatureCollection, LineFeature, PolygonFeature } from '../src/index.js';
const at = (x: number, y: number): Coordinate => [x / 6378137 * 180 / Math.PI, Math.atan(Math.sinh(y / 6378137)) * 180 / Math.PI];
const path = (points: number[][]): Coordinate[] => points.map(p => at(p[0]!, p[1]!));
const line = (points: number[][], id: string | number = 'line'): LineFeature => ({ type: 'Feature', id, properties: null, geometry: { type: 'LineString', coordinates: path(points) } });
const ring = path([[0, 0], [50, 1], [100, 0], [100, 100], [0, 100], [0, 0]]);
const fixture: GeometryFeatureCollection = { type: 'FeatureCollection', features: [
  { type: 'Feature', id: 0, properties: { nested: { name: 'parcel' } }, geometry: { type: 'Polygon', coordinates: [ring,
    path([[20, 20], [20, 40], [40, 40], [40, 20], [30, 20.5], [20, 20]]),
  ] } },
  line([[0, -20], [100, -20]], 'untouched'),
  { type: 'Feature', id: '0', properties: null, geometry: { type: 'MultiLineString', coordinates: [path([[0, 120], [50, 121], [100, 120]]), path([[0, 150], [50, 149], [100, 150]])] } },
  { type: 'Feature', id: 'multi', properties: { category: 'islands' }, geometry: { type: 'MultiPolygon', coordinates: [[ring.map(([x, y]) => [x + 0.01, y])], [ring.map(([x, y]) => [x + 0.02, y])]] } },
] };
function setup(limit = 100) {
  const session = new DrawingSession(() => { throw new Error('No ID allocation'); }, limit);
  session.importGeoJSON(fixture); session.clearHistory(); session.selectMany(['0', 0, 'multi']); return session;
}
it('removes small deviations while retaining exact source endpoints and significant bends', () => {
  const feature = line([[0, 0], [20, 0.5], [40, 0], [60, 20], [80, 10.5], [100, 0]]);
  const original = structuredClone(feature);
  const reduced = simplifyFeatures([feature], 2)[0] as LineFeature;
  expect(reduced.geometry.coordinates).toEqual([feature.geometry.coordinates[0], feature.geometry.coordinates[2], feature.geometry.coordinates[3], feature.geometry.coordinates[5]]);
  expect(feature).toEqual(original); reduced.geometry.coordinates[0]![0] = 10; expect(feature).toEqual(original);
});
it('uses finite-segment distance so backtracking points beyond endpoints survive', () => {
  const feature = line([[0, 0], [20, 0], [10, 0]]);
  expect(simplifyFeatures([feature], 2)).toEqual([feature]);
});
it('tolerance zero preserves every vertex exactly, including collinear vertices', () => {
  expect(simplifyFeatures(fixture.features, 0)).toEqual(fixture.features);
  const feature = line([[0, 0], [50, 0], [100, 0]]);
  expect(simplifyFeatures([feature], 0)).toEqual([feature]);
  expect((simplifyFeatures([feature], 0.01)[0] as LineFeature).geometry.coordinates).toHaveLength(2);
});
it('keeps projected deviations within tolerance without a recursive stack', () => {
  const points = Array.from({ length: 20000 }, (_, i) => [i, Math.sin(i) * 0.5]);
  const result = simplifyFeatures([line(points)], 1)[0] as LineFeature;
  expect(result.geometry.coordinates).toEqual([at(0, 0), at(19999, Math.sin(19999) * 0.5)]);
  // Every discarded point lies within one meter of this near-horizontal segment.
  const endY = Math.sin(19999) * 0.5;
  for (const [x, y] of points) expect(Math.abs(y! - endY * x! / 19999)).toBeLessThanOrEqual(1);
});
it('preserves polygon closure, first corners, holes and multipart wrappers', () => {
  const session = setup(); const before = session.getSelection(); session.simplifySelection(); session.setSimplificationTolerance(2);
  const features = session.getSimplificationPreview()!.features;
  expect(features.map(f => f.geometry.type)).toEqual(['MultiLineString', 'Polygon', 'MultiPolygon']);
  const polygon = features[1] as PolygonFeature; const original = before[1] as PolygonFeature;
  expect(polygon.geometry.coordinates).toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    expect(polygon.geometry.coordinates[i]).toHaveLength(5);
    expect(polygon.geometry.coordinates[i]![0]).toEqual(original.geometry.coordinates[i]![0]);
    expect(polygon.geometry.coordinates[i]!.at(-1)).toEqual(polygon.geometry.coordinates[i]![0]);
  }
});
it('commits the whole mixed selection once with exact history, identities, properties and ordering', () => {
  const session = setup(); const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  expect(session.simplifySelection()).toBe(true);
  expect(session.state).toMatchObject({ mode: 'simplify-features', simplificationTolerance: 0, simplificationError: null, canFinish: true, canUndo: false, vertexCount: 0 });
  session.setSimplificationTolerance(2); const preview = session.getSimplificationPreview()!;
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.dataRevision).toBe(revision);
  expect(session.finishSimplification()!.changes).toHaveLength(3);
  const after = session.exportGeoJSON(); expect(after.features).toEqual([preview.features[1], before.features[1], preview.features[0], preview.features[2]]);
  expect(after.features.map(f => f.properties)).toEqual(before.features.map(f => f.properties));
  expect(session.state).toMatchObject({ mode: 'idle', simplificationTolerance: null, simplificationError: null, dataRevision: revision + 1 });
  expect(session.undo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(before);
  expect(session.redo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(after);
});
it('recalculates from frozen originals and isolates preview/state/event snapshots', () => {
  const session = setup(); session.simplifySelection(); session.setSimplificationTolerance(2); const expected = session.getSimplificationPreview();
  session.setSimplificationTolerance(10); session.setSimplificationTolerance(2); expect(session.getSimplificationPreview()).toEqual(expected);
  expect(session.setSimplificationTolerance(2)).toBe(false);
  session.getSimplificationPreview()!.features[0]!.geometry.coordinates.length = 0;
  session.getSimplificationPreview()!.features[1]!.properties!['nested'] = null;
  expect(session.getSimplificationPreview()).toEqual(expected);
  const event = session.finishSimplification()!; event.changes[0]!.after!.geometry.coordinates.length = 0;
  expect(session.getSelection()).toEqual(expected!.features);
});
it('rejects collapsed rings atomically and allows correction to a valid result', () => {
  const session = setup(); const before = session.exportGeoJSON(); session.simplifySelection(); session.setSimplificationTolerance(200);
  expect(session.state).toMatchObject({ canFinish: false, simplificationError: 'simplification-invalid-result' });
  expect(session.getSimplificationPreview()).toBeNull(); expect(session.finishSimplification()).toBeNull(); expect(session.finish()).toBeNull();
  expect(session.state.mode).toBe('simplify-features'); expect(session.exportGeoJSON()).toEqual(before);
  session.setSimplificationTolerance(2); expect(session.state.canFinish).toBe(true); expect(session.finishSimplification()!.changes).toHaveLength(3);
});
it('rejects hole collapse even when the simplified outer ring remains valid', () => {
  const session = setup(); session.select(0); session.simplifySelection(); session.setSimplificationTolerance(20);
  expect(session.state.simplificationError).toBe('simplification-invalid-result');
  session.setSimplificationTolerance(0); expect(session.finishSimplification()).toBeNull(); expect(session.state.canUndo).toBe(false);
});
it('preserves Redo on cancel, zero and nonzero no-op confirmation', () => {
  const session = setup(); session.simplifySelection(); session.setSimplificationTolerance(2); session.finishSimplification(); session.undo();
  const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  session.simplifySelection(); session.setSimplificationTolerance(2); session.cancel();
  session.simplifySelection(); session.setSimplificationTolerance(2); session.setSimplificationTolerance(0); expect(session.finishSimplification()).toBeNull();
  session.select('untouched'); session.simplifySelection(); session.setSimplificationTolerance(5); expect(session.finishSimplification()).toBeNull();
  expect(session.state).toMatchObject({ canRedo: true, dataRevision: revision }); expect(session.exportGeoJSON()).toEqual(before);
});
it.each([NaN, Infinity, -Infinity, '5', null])('rejects malformed tolerance %s atomically', tolerance => {
  const session = setup(); session.simplifySelection(); const state = session.state; const preview = session.getSimplificationPreview();
  expect(() => session.setSimplificationTolerance(tolerance as number)).toThrow(TypeError);
  expect(session.state).toEqual(state); expect(session.getSimplificationPreview()).toEqual(preview);
});
it('rejects negative tolerance but accepts negative zero and very large finite tolerances', () => {
  const session = setup(); expect(() => session.setSimplificationTolerance(-1)).toThrow(RangeError);
  session.simplifySelection(); expect(session.setSimplificationTolerance(-0)).toBe(false);
  session.setSimplificationTolerance(Number.MAX_VALUE); expect(session.state.simplificationError).toBe('simplification-invalid-result');
});
it('refuses empty, polar, dateline-crossing and globally spread inputs before entry', () => {
  const empty = new DrawingSession(() => 'id'); expect(empty.simplifySelection()).toBe(false);
  for (const coordinates of [[[0, 86], [1, 87]], [[179, 0], [-179, 1]], [[-100, 0], [0, 0], [100, 0]]] as Coordinate[][]) {
    const session = new DrawingSession(() => 'id'); const feature = line([[0, 0], [1, 0]]); feature.geometry.coordinates = coordinates;
    session.importGeoJSON(feature); session.select('line'); const state = session.state;
    expect(session.simplifySelection()).toBe(false); expect(session.state).toEqual(state);
  }
});
it('locks competing commands, leaves drawing inputs inert, and resets on cancel', () => {
  const session = setup(); session.simplifySelection(); expect(session.simplifySelection()).toBe(false);
  expect(session.add([0, 0])).toBe(false); expect(session.removeLastDrawStep()).toBe(false);
  for (const action of [() => session.start('LineString'), () => session.select(null), () => session.deleteSelection(),
    () => session.rotateSelection(), () => session.scaleSelection(), () => session.editSelected(), () => session.undo(), () => session.redo(),
    () => session.importGeoJSON(fixture), () => session.applyTransaction({ delete: [0] }), () => session.clearHistory(), () => session.duplicateSelection()]) expect(action).toThrow();
  session.cancel(); expect(session.setSimplificationTolerance(2)).toBe(false); expect(session.getSimplificationPreview()).toBeNull(); expect(session.finishSimplification()).toBeNull();
  session.start('LineString'); expect(() => session.simplifySelection()).toThrow('Finish or cancel');
});
it('supports disabled history and commits only actually changed features', () => {
  const session = setup(0); session.selectMany([0, 'untouched']); session.simplifySelection(); session.setSimplificationTolerance(2);
  expect(session.finishSimplification()!.changes.map(c => c.after!.id)).toEqual([0]); expect(session.state.canUndo).toBe(false);
});

it('rejects a simplified outer boundary cutting across a still-valid hole', () => {
  const session = new DrawingSession(() => 'id');
  session.importGeoJSON({ type: 'Feature', id: 'parcel', properties: null, geometry: { type: 'Polygon', coordinates: [
    path([[0, 0], [100, 0], [100, 100], [80, 110], [0, 100], [0, 0]]),
    path([[80, 105], [95, 70], [50, 70], [80, 105]]),
  ] } }); session.select('parcel'); session.clearHistory(); const before = session.exportGeoJSON();
  session.simplifySelection(); session.setSimplificationTolerance(11);
  expect(session.state.simplificationError).toBe('simplification-invalid-result');
  expect(session.finishSimplification()).toBeNull(); expect(session.exportGeoJSON()).toEqual(before);
  session.setSimplificationTolerance(1); expect(session.state.canFinish).toBe(true);
});

it('rejects a closed line collapsing to coincident endpoints without dropping it', () => {
  const session = new DrawingSession(() => 'id');
  session.importGeoJSON(line([[0, 0], [10, 0], [10, 10], [0, 0]]));
  session.select('line'); session.clearHistory(); const before = session.exportGeoJSON();
  session.simplifySelection(); session.setSimplificationTolerance(100);
  expect(session.state).toMatchObject({ canFinish: false, simplificationError: 'simplification-invalid-result' });
  expect(session.finishSimplification()).toBeNull(); expect(session.exportGeoJSON()).toEqual(before);
  session.cancel(); expect(session.state.canUndo).toBe(false);
});

it('rejects new overlap between otherwise valid simplified MultiPolygon components', () => {
  const coordinates = [
    [path([[0, 0], [100, 0], [100, 100], [80, 90], [0, 100], [0, 0]])],
    [path([[80, 95], [95, 130], [50, 130], [80, 95]])],
  ];
  // Each component simplifies successfully on its own; only the pair becomes invalid.
  for (const rings of coordinates) {
    const single = new DrawingSession(() => 'id');
    single.importGeoJSON({ type: 'Feature', id: 'part', properties: null, geometry: { type: 'Polygon', coordinates: rings } });
    single.select('part'); single.simplifySelection(); single.setSimplificationTolerance(11);
    expect(single.state.canFinish).toBe(true);
  }
  const session = new DrawingSession(() => 'id');
  session.importGeoJSON({ type: 'Feature', id: 'parts', properties: null, geometry: { type: 'MultiPolygon', coordinates } });
  session.select('parts'); session.clearHistory(); const before = session.exportGeoJSON();
  session.simplifySelection(); session.setSimplificationTolerance(11);
  expect(session.state).toMatchObject({ canFinish: false, simplificationError: 'simplification-invalid-result' });
  expect(session.getSimplificationPreview()).toBeNull(); expect(session.finishSimplification()).toBeNull();
  expect(session.exportGeoJSON()).toEqual(before);
  session.setSimplificationTolerance(1); expect(session.state.canFinish).toBe(true);
});
