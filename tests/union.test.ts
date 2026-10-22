import polygonClipping from 'polygon-clipping';
import { afterEach, expect, it, vi } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { unionPolygons } from '../src/core/union.js';
import { validateMultiPolygon } from '../src/core/polygon.js';
import * as transaction from '../src/core/transaction.js';
import type { Coordinate, FeatureId, GeometryFeature, PolygonFeature, UnionPreview } from '../src/index.js';

const box = (x: number, y: number, width = 4, height = width): Coordinate[] =>
  [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]];
const polygon = (id: FeatureId, ...rings: Coordinate[][]): PolygonFeature =>
  ({ type: 'Feature', id, properties: { name: String(id), nested: { values: [1] } }, geometry: { type: 'Polygon', coordinates: rings } });
const parts = (geometry: UnionPreview): Coordinate[][][] => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
const area = (geometry: UnionPreview): number => parts(geometry).reduce((total, rings) => total + rings.reduce((filled, ring, index) => {
  const signed = ring.slice(0, -1).reduce((sum, [x, y], i) => sum + x * ring[i + 1]![1] - ring[i + 1]![0] * y, 0) / 2;
  return filled + (index === 0 ? 1 : -1) * Math.abs(signed);
}, 0), 0);
function setup(features: GeometryFeature[] = [polygon(0, box(0, 0)), polygon('0', box(2, 0))]): DrawingSession {
  const tool = new DrawingSession(() => { throw new Error('Union must not allocate IDs.'); });
  tool.importGeoJSON({ type: 'FeatureCollection', features }); tool.clearHistory(); tool.selectMany(features.map((f) => f.id)); return tool;
}
afterEach(() => { vi.restoreAllMocks(); });

it.each([
  ['overlap', box(2, 0), 'Polygon', 24],
  ['shared edge', box(4, 0), 'Polygon', 32],
  ['identical', box(0, 0), 'Polygon', 16],
  ['contained', box(1, 1, 1), 'Polygon', 16],
  ['disjoint', box(6, 0), 'MultiPolygon', 32],
] as const)('unions %s with correct filled area, winding and isolated input', (_, second, type, expectedArea) => {
  const inputs: UnionPreview[] = [polygon(0, box(0, 0)).geometry, polygon(1, second).geometry];
  const before = structuredClone(inputs); const result = unionPolygons(inputs);
  expect(result.error).toBeNull(); expect(result.preview!.type).toBe(type); expect(area(result.preview!)).toBe(expectedArea);
  expect(validateMultiPolygon(parts(result.preview!))).toBeNull(); expect(inputs).toEqual(before);
  result.preview!.coordinates.length = 0; expect(inputs).toEqual(before);
});

it('preserves, partially fills and completely removes holes according to the filled union', () => {
  const garden = polygon(0, box(0, 0, 10), box(2, 2, 6)).geometry;
  for (const [addition, expectedArea, rings] of [
    [box(8, 0, 4, 10), 84, 2], [box(1, 1, 4, 8), 82, 2], [box(1, 1, 8), 100, 1],
  ] as const) {
    const result = unionPolygons([garden, polygon(1, addition).geometry]);
    expect(result.error).toBeNull(); expect(result.preview!.type).toBe('Polygon');
    expect(result.preview!.coordinates).toHaveLength(rings); expect(area(result.preview!)).toBe(expectedArea);
  }
});

it('creates a hole when four filled strips form a frame', () => {
  const strips = [box(0, 0, 10, 2), box(0, 8, 10, 2), box(0, 0, 2, 10), box(8, 0, 2, 10)];
  const result = unionPolygons(strips.map((ring) => polygon(0, ring).geometry));
  expect(result.error).toBeNull(); expect(result.preview!.type).toBe('Polygon');
  expect(result.preview!.coordinates).toHaveLength(2); expect(area(result.preview!)).toBe(64);
});

it('merges multipart inputs, bridges components and allows an island strictly within a hole', () => {
  const multi: UnionPreview = { type: 'MultiPolygon', coordinates: [[box(0, 0, 2)], [box(4, 0, 2)]] };
  const bridged = unionPolygons([multi, polygon(1, box(1, 0, 4, 2)).geometry]);
  expect(bridged.error).toBeNull(); expect(bridged.preview!.type).toBe('Polygon'); expect(area(bridged.preview!)).toBe(12);
  const island = unionPolygons([polygon(0, box(0, 0, 10), box(2, 2, 6)).geometry, polygon(1, box(3, 3, 2)).geometry]);
  expect(island.error).toBeNull(); expect(island.preview!.type).toBe('MultiPolygon'); expect(area(island.preview!)).toBe(68);
});

it('constructs noninteger crossing coordinates without changing filled area', () => {
  const triangle = polygon(1, [[1, -1], [5, 2], [1, 5], [1, -1]]).geometry;
  const result = unionPolygons([polygon(0, box(0, 0)).geometry, triangle]);
  expect(result.error).toBeNull(); expect(area(result.preview!)).toBeCloseTo(16 + 4 / 3 + 0.75, 12);
});

it('rejects point-touching parts and dateline-spanning output under the existing topology policy', () => {
  expect(unionPolygons([polygon(0, box(0, 0)).geometry, polygon(1, box(4, 4)).geometry]))
    .toEqual({ preview: null, error: 'union-invalid-result' });
  expect(unionPolygons([polygon(0, box(-170, 0, 170, 2)).geometry, polygon(1, box(-10, 0, 180, 2)).geometry]))
    .toEqual({ preview: null, error: 'union-invalid-result' });
});

it('fails closed for engine failure, empty output and nonfinite constructed coordinates', () => {
  const input = [polygon(0, box(0, 0)).geometry, polygon(1, box(2, 0)).geometry];
  vi.spyOn(polygonClipping, 'union').mockImplementationOnce(() => { throw new Error('numerical failure'); });
  expect(unionPolygons(input)).toEqual({ preview: null, error: 'union-failed' });
  vi.spyOn(polygonClipping, 'union').mockReturnValueOnce([]);
  expect(unionPolygons(input)).toEqual({ preview: null, error: 'union-invalid-result' });
  vi.spyOn(polygonClipping, 'union').mockReturnValueOnce([[[[NaN, 0], [1, 0], [0, 1], [NaN, 0]]]]);
  expect(unionPolygons(input)).toEqual({ preview: null, error: 'union-invalid-result' });
});

it('previews without changing data, then retains the first selected typed ID/properties/position in one transaction', () => {
  const unrelated = polygon('unrelated', box(20, 20));
  const tool = setup([polygon(0, box(0, 0)), unrelated, polygon('0', box(2, 0))]);
  tool.selectMany(['0', 0]); const before = tool.exportGeoJSON(); const revision = tool.state.dataRevision;
  expect(tool.unionSelection()).toBe(true); expect(tool.unionSelection()).toBe(false);
  expect(tool.state).toMatchObject({ mode: 'union-polygons', canFinish: true, canUndo: false, canRedo: false, unionError: null, validationError: null });
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.dataRevision).toBe(revision);
  expect(tool.add([30, 30])).toBe(false); expect(tool.getDraft()).toEqual([]);
  const preview = tool.getUnionPreview()!; tool.getUnionPreview()!.coordinates.length = 0;
  const event = tool.finishUnion()!; expect(event.changes).toHaveLength(2);
  const after = tool.exportGeoJSON();
  expect(after.features).toEqual([before.features[1], { ...before.features[2], geometry: preview }]);
  expect(tool.state).toMatchObject({ mode: 'idle', selectedFeatureIds: ['0'], featureCount: 2, dataRevision: revision + 1, canUndo: true });
  expect(tool.getUnionPreview()).toBeNull(); expect(tool.finishUnion()).toBeNull();
  event.changes[0]!.after!.properties!.nested = null; event.changes[0]!.after!.geometry.coordinates.length = 0;
  expect(tool.exportGeoJSON()).toEqual(after);
  expect(tool.undo()?.action).toBe('transaction'); expect(tool.exportGeoJSON()).toEqual(before);
  expect(tool.redo()?.action).toBe('transaction'); expect(tool.exportGeoJSON()).toEqual(after);
});

it('records contained unions even when the retained feature is unchanged and preserves null properties', () => {
  const retained = { ...polygon(0, box(0, 0)), properties: null };
  const tool = setup([retained, polygon(1, box(1, 1, 1))]); const before = tool.exportGeoJSON(); tool.unionSelection();
  expect(tool.finishUnion()!.changes).toEqual([{ before: before.features[1], after: null }]);
  expect(tool.exportGeoJSON().features).toEqual([retained]); tool.undo(); expect(tool.exportGeoJSON()).toEqual(before);
});

it('keeps redo, selection and originals on cancel or invalid confirmation', () => {
  const tool = setup([polygon(0, box(0, 0)), polygon(1, box(4, 4))]);
  tool.applyTransaction({ create: [polygon(2, box(20, 20))] }); tool.undo(); const before = tool.exportGeoJSON();
  tool.unionSelection(); expect(tool.state).toMatchObject({ canFinish: false, unionError: 'union-invalid-result' });
  expect(tool.finishUnion()).toBeNull(); expect(tool.finish()).toBeNull(); tool.cancel();
  expect(tool.state).toMatchObject({ canRedo: true, selectedFeatureIds: [0, 1], unionError: null });
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.redo()).not.toBeNull();
});

it('rejects mixed/insufficient selection without changing state and refuses union during another tool', () => {
  const tool = setup(); tool.importGeoJSON({ type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } });
  for (const ids of [[], [0], [0, 'line']]) {
    tool.selectMany(ids); const state = tool.state; expect(tool.unionSelection()).toBe(false); expect(tool.state).toEqual(state);
  }
  tool.start('Polygon'); expect(() => tool.unionSelection()).toThrow('Finish or cancel'); tool.cancel();
  tool.select(0); tool.editSelected(); expect(() => tool.unionSelection()).toThrow('Finish or cancel');
});

it('blocks competing commands while reviewing a union', () => {
  const tool = setup(); tool.unionSelection(); const preview = tool.getUnionPreview();
  for (const action of [() => tool.select(null), () => tool.selectMany([0]), () => tool.toggleSelection(0),
    () => tool.start('Polygon'), () => tool.start('LineString'), () => tool.editSelected(), () => tool.splitSelected(),
    () => tool.drawHole(), () => tool.deleteHole(1), () => tool.deleteSelected(), () => tool.deleteSelection(),
    () => tool.duplicateSelection(), () => tool.translateSelection([1, 1]), () => tool.undo(), () => tool.redo(),
    () => tool.clearHistory(), () => tool.importGeoJSON(polygon(10, box(20, 20))), () => tool.applyTransaction({})]) {
    expect(action).toThrow('Finish or cancel');
  }
  expect(tool.getUnionPreview()).toEqual(preview); expect(tool.finish()).toBeNull();
});

it('keeps preview and history intact if final transaction preparation fails', () => {
  const tool = setup(); tool.unionSelection(); const before = tool.exportGeoJSON(); const state = tool.state; const preview = tool.getUnionPreview();
  vi.spyOn(transaction, 'prepareTransaction').mockImplementationOnce(() => { throw new Error('Rejected result'); });
  expect(() => tool.finishUnion()).toThrow('Rejected result');
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state).toEqual(state); expect(tool.getUnionPreview()).toEqual(preview);
  expect(tool.finishUnion()).not.toBeNull();
});
