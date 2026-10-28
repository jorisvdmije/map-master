import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { project } from '../src/core/mercator-transform.js';
import type { Coordinate, GeometryFeature, LineFeature, MultiLineFeature } from '../src/index.js';

const radius = 6378137;
const at = (x: number, y: number): Coordinate => [x / radius * 180 / Math.PI, Math.atan(Math.sinh(y / radius)) * 180 / Math.PI];
const path = (points: number[][]): Coordinate[] => points.map(p => at(p[0]!, p[1]!));
const line = (points: number[][], id: string | number = 0): LineFeature => ({ type: 'Feature', id, properties: { nested: { label: 'route' } }, geometry: { type: 'LineString', coordinates: path(points) } });
function setup(features: GeometryFeature[] = [line([[0, 0], [100, 0], [100, 100]])], limit = 100) {
  const session = new DrawingSession(() => { throw new Error('No new IDs'); }, limit);
  session.importGeoJSON({ type: 'FeatureCollection', features }); session.clearHistory(); session.selectMany(features.map(f => f.id)); return session;
}
function previewPath(session: DrawingSession): Coordinate[] {
  const feature = session.getOffsetPreview()!.features[0] as LineFeature;
  return feature.geometry.coordinates.map(p => project(p).map(n => n * radius) as Coordinate);
}
function expectPath(actual: Coordinate[], expected: number[][]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((p, i) => { expect(p[0]).toBeCloseTo(expected[i]![0]!, 6); expect(p[1]).toBeCloseTo(expected[i]![1]!, 6); });
}

it('offsets left and right with exact miter intersections and perpendicular endpoints', () => {
  const session = setup(); expect(session.offsetSelection()).toBe(true);
  session.setOffsetDistance(10); expectPath(previewPath(session), [[0, 10], [90, 10], [90, 100]]);
  session.setOffsetDistance(-10); expectPath(previewPath(session), [[0, -10], [110, -10], [110, 100]]);
});
it('uses the direction of each line: reversing the path reverses the side', () => {
  const session = setup([line([[100, 100], [100, 0], [0, 0]])]); session.offsetSelection();
  session.setOffsetDistance(10); expectPath(previewPath(session), [[110, 100], [110, -10], [0, -10]]);
});
it('keeps diagonal segments parallel at the requested perpendicular distance', () => {
  const session = setup([line([[0, 0], [30, 40]])]); session.offsetSelection(); session.setOffsetDistance(10);
  expectPath(previewPath(session), [[-8, 6], [22, 46]]);
});
it('preserves collinear vertices, wrappers, component order and direction', () => {
  const feature: MultiLineFeature = { ...line([]), geometry: { type: 'MultiLineString', coordinates: [path([[0, 0], [50, 0], [100, 0]]), path([[100, 100], [0, 100]])] } };
  const session = setup([feature]); session.offsetSelection(); session.setOffsetDistance(10);
  const preview = session.getOffsetPreview()!.features[0] as MultiLineFeature;
  expect(preview.geometry.type).toBe('MultiLineString'); expect(preview.geometry.coordinates.map(p => p.length)).toEqual([3, 2]);
  expectPath(preview.geometry.coordinates[0]!.map(p => project(p).map(n => n * radius) as Coordinate), [[0, 10], [50, 10], [100, 10]]);
  expectPath(preview.geometry.coordinates[1]!.map(p => project(p).map(n => n * radius) as Coordinate), [[100, 90], [0, 90]]);
});
it('preserves one-part MultiLineString wrappers and allows independent components to cross', () => {
  for (const coordinates of [[path([[0, 0], [100, 0]])], [path([[0, 0], [100, 0]]), path([[50, -50], [50, 50]])]]) {
    const session = setup([{ ...line([]), geometry: { type: 'MultiLineString', coordinates } }]);
    expect(session.offsetSelection()).toBe(true); session.setOffsetDistance(10);
    expect(session.getOffsetPreview()!.features[0]!.geometry.type).toBe('MultiLineString'); expect(session.state.canFinish).toBe(true);
  }
});
it('uses projected meters at high latitude', () => {
  const y = project([0, 80])[1] * radius;
  const session = setup([line([[0, y], [100, y]])]); session.offsetSelection(); session.setOffsetDistance(10);
  expectPath(previewPath(session), [[0, y + 10], [100, y + 10]]);
});
it('rejects polygons in a mixed selection, closed or nonsimple paths without entering', () => {
  const invalid: GeometryFeature[] = [
    { ...line([]), geometry: { type: 'Polygon', coordinates: [path([[0, 0], [100, 0], [0, 100], [0, 0]])] } },
    line([[0, 0], [100, 0], [100, 100], [0, 0]]), line([[0, 0], [100, 0], [50, 0]]),
    line([[0, 0], [100, 100], [0, 100], [100, 0]]), line([[0, 0], [100, 0], [100, 100], [50, 0]]),
  ];
  for (const feature of invalid) {
    const session = setup([line([[0, 0], [10, 10]], 'valid'), feature]); const before = session.state;
    expect(session.offsetSelection()).toBe(false); expect(session.state).toEqual(before);
  }
});
it('rejects empty, polar, antimeridian and globally spread selections', () => {
  expect(new DrawingSession(() => 'id').offsetSelection()).toBe(false);
  for (const coordinates of [[[0, 86], [1, 87]], [[179, 0], [-179, 1]], [[-100, 0], [0, 0], [100, 0]]] as Coordinate[][]) {
    const session = setup([{ ...line([]), geometry: { type: 'LineString', coordinates } }]); expect(session.offsetSelection()).toBe(false);
  }
});
it('blocks excessive miter joins for either sign but lets zero preserve the original', () => {
  const session = setup([line([[0, 0], [100, 0], [1, 1]])]); expect(session.offsetSelection()).toBe(true);
  for (const distance of [10, -10, 0.001]) {
    session.setOffsetDistance(distance); expect(session.state).toMatchObject({ offsetError: 'offset-join-too-sharp', canFinish: false });
    expect(session.finishOffset()).toBeNull(); expect(session.state.mode).toBe('offset-lines');
  }
  session.setOffsetDistance(0); expect(session.state.canFinish).toBe(true); expect(session.finishOffset()).toBeNull();
});
it('rejects collapsed or reversed segments and permits correction', () => {
  const session = setup(); session.offsetSelection();
  for (const distance of [100, 110]) {
    session.setOffsetDistance(distance); expect(session.state.offsetError).toBe('offset-invalid-result'); expect(session.getOffsetPreview()).toBeNull();
  }
  session.setOffsetDistance(10); expect(session.state.canFinish).toBe(true);
});
it('rejects nonadjacent output crossings even when every segment still runs forward', () => {
  const session = setup([line([[0, 0], [100, 0], [100, 100], [0, 100], [0, 20]])]);
  session.offsetSelection(); const before = session.exportGeoJSON(); session.setOffsetDistance(30);
  expect(session.state.offsetError).toBe('offset-invalid-result'); expect(session.finishOffset()).toBeNull(); expect(session.exportGeoJSON()).toEqual(before);
  session.setOffsetDistance(5); expect(session.state.canFinish).toBe(true);
});
it('checks complete offset joins against world limits and keeps the whole selection unchanged', () => {
  const session = setup([line([[0, 0], [100, 0]], 'ok'), line([[Math.PI * radius - 5, 0], [Math.PI * radius - 5, 100]])]);
  session.offsetSelection(); const before = session.exportGeoJSON(); session.setOffsetDistance(-10);
  expect(session.state.offsetError).toBe('offset-out-of-bounds'); expect(session.getOffsetPreview()).toBeNull(); expect(session.finishOffset()).toBeNull();
  expect(session.exportGeoJSON()).toEqual(before);
  session.setOffsetDistance(10); expect(session.state.canFinish).toBe(true);
  session.setOffsetDistance(Number.MAX_VALUE); expect(session.state.offsetError).toBe('offset-out-of-bounds');
});
it('recalculates from originals, preserves exact zero including -0, and isolates snapshots', () => {
  const session = setup(); const before = session.exportGeoJSON(); session.offsetSelection();
  expect(session.getOffsetPreview()).toEqual(before); expect(session.setOffsetDistance(-0)).toBe(false);
  session.setOffsetDistance(10); const expected = session.getOffsetPreview(); session.setOffsetDistance(-5); session.setOffsetDistance(10);
  expect(session.getOffsetPreview()).toEqual(expected); expect(session.setOffsetDistance(10)).toBe(false);
  session.getOffsetPreview()!.features[0]!.geometry.coordinates.length = 0;
  session.getOffsetPreview()!.features[0]!.properties!['nested'] = null; expect(session.getOffsetPreview()).toEqual(expected);
  session.setOffsetDistance(0); expect(session.getOffsetPreview()).toEqual(before); expect(session.finishOffset()).toBeNull(); expect(session.state.canUndo).toBe(false);
});
it('commits the selection once and restores exact IDs, properties, types and order with Undo/Redo', () => {
  const session = setup([line([[0, 0], [100, 0]], 0), line([[0, 100], [100, 100]], 'untouched'), line([[200, 0], [300, 0]], '0')]);
  session.selectMany(['0', 0]); const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  session.offsetSelection(); session.setOffsetDistance(10); const preview = session.getOffsetPreview()!;
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state).toMatchObject({ mode: 'offset-lines', offsetDistance: 10, offsetError: null, canUndo: false, dataRevision: revision });
  const event = session.finishOffset()!; expect(event.changes).toHaveLength(2);
  const after = session.exportGeoJSON(); expect(after.features).toEqual([preview.features[1], before.features[1], preview.features[0]]);
  expect(session.state).toMatchObject({ mode: 'idle', offsetDistance: null, offsetError: null, dataRevision: revision + 1 });
  event.changes[0]!.after!.geometry.coordinates.length = 0; expect(session.exportGeoJSON()).toEqual(after);
  expect(session.undo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(before);
  expect(session.redo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(after);
});
it('preserves Redo and dataRevision on cancel and zero confirmation, and supports disabled history', () => {
  const session = setup(); session.offsetSelection(); session.setOffsetDistance(10); session.finishOffset(); session.undo();
  const revision = session.state.dataRevision; const before = session.exportGeoJSON();
  session.offsetSelection(); session.setOffsetDistance(20); session.cancel(); session.offsetSelection(); session.finishOffset();
  expect(session.state).toMatchObject({ canRedo: true, dataRevision: revision }); expect(session.exportGeoJSON()).toEqual(before);
  const disabled = setup([line([[0, 0], [10, 0]])], 0); disabled.offsetSelection(); disabled.setOffsetDistance(10); disabled.finishOffset(); expect(disabled.state.canUndo).toBe(false);
});
it.each([NaN, Infinity, -Infinity, '5', null])('rejects malformed distance %s without changing state', distance => {
  const session = setup(); expect(() => session.setOffsetDistance(distance as number)).toThrow(TypeError);
  session.offsetSelection(); const before = session.getOffsetPreview(); const state = session.state;
  expect(() => session.setOffsetDistance(distance as number)).toThrow(TypeError); expect(session.getOffsetPreview()).toEqual(before); expect(session.state).toEqual(state);
});
it('locks competing operations and keeps drawing inputs inert', () => {
  const session = setup(); session.offsetSelection(); expect(session.offsetSelection()).toBe(false);
  expect(session.add([0, 0])).toBe(false); expect(session.removeLastDrawStep()).toBe(false); expect(session.finish()).toBeNull();
  for (const action of [() => session.start('LineString'), () => session.bufferSelection(), () => session.simplifySelection(), () => session.select(null),
    () => session.deleteSelection(), () => session.editSelected(), () => session.undo(), () => session.redo(), () => session.importGeoJSON(line([[0, 0], [1, 1]], 'new')),
    () => session.applyTransaction({ delete: [0] }), () => session.clearHistory()]) expect(action).toThrow();
  session.cancel(); expect(session.setOffsetDistance(10)).toBe(false); expect(session.finishOffset()).toBeNull(); expect(session.getOffsetPreview()).toBeNull();
  session.start('LineString'); expect(() => session.offsetSelection()).toThrow('Finish or cancel');
});
