import polygonClipping from 'polygon-clipping';
import { afterEach, expect, it, vi } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { intersectionPolygons } from '../src/core/intersection.js';
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
  const tool = new DrawingSession(() => { throw new Error('Intersection must not allocate IDs.'); });
  tool.importGeoJSON({ type: 'FeatureCollection', features }); tool.clearHistory(); tool.selectMany(features.map((f) => f.id)); return tool;
}
afterEach(() => { vi.restoreAllMocks(); });

it('previews without changing data, then retains the first selected typed ID/properties/position in one transaction', () => {
  const unrelated = polygon('unrelated', box(20, 20));
  const tool = setup([polygon(0, box(0, 0)), unrelated, polygon('0', box(2, 0))]);
  tool.selectMany(['0', 0]); const before = tool.exportGeoJSON(); const revision = tool.state.dataRevision;
  expect(tool.intersectionSelection()).toBe(true); expect(tool.intersectionSelection()).toBe(false);
  expect(tool.state).toMatchObject({ mode: 'intersection-polygons', canFinish: true, canUndo: false, canRedo: false, intersectionError: null, validationError: null });
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.dataRevision).toBe(revision);
  expect(tool.add([30, 30])).toBe(false); expect(tool.getDraft()).toEqual([]);
  const preview = tool.getIntersectionPreview()!.geometry!; tool.getIntersectionPreview()!.geometry!.coordinates.length = 0;
  const event = tool.finishIntersection()!; expect(event.changes).toHaveLength(2);
  const after = tool.exportGeoJSON();
  expect(after.features).toEqual([before.features[1], { ...before.features[2], geometry: preview }]);
  expect(tool.state).toMatchObject({ mode: 'idle', selectedFeatureIds: ['0'], featureCount: 2, dataRevision: revision + 1, canUndo: true });
  expect(tool.getIntersectionPreview()).toBeNull(); expect(tool.finishIntersection()).toBeNull();
  event.changes[0]!.after!.properties!.nested = null; event.changes[0]!.after!.geometry.coordinates.length = 0;
  expect(tool.exportGeoJSON()).toEqual(after);
  expect(tool.undo()?.action).toBe('transaction'); expect(tool.exportGeoJSON()).toEqual(before);
  expect(tool.redo()?.action).toBe('transaction'); expect(tool.exportGeoJSON()).toEqual(after);
});

it('records contained intersections even when the retained feature is unchanged and preserves null properties', () => {
  const retained = { ...polygon(0, box(0, 0)), properties: null };
  const tool = setup([retained, polygon(1, box(-1, -1, 6))]); const before = tool.exportGeoJSON(); tool.intersectionSelection();
  expect(tool.finishIntersection()!.changes).toEqual([{ before: before.features[1], after: null }]);
  expect(tool.exportGeoJSON().features).toEqual([retained]); tool.undo(); expect(tool.exportGeoJSON()).toEqual(before);
});

it('keeps redo, selection and originals on cancel or invalid confirmation', () => {
  const tool = setup([polygon(0, box(0, 0)), polygon(1, box(4, 4))]);
  tool.applyTransaction({ create: [polygon(2, box(20, 20))] }); tool.undo(); const before = tool.exportGeoJSON();
  vi.spyOn(polygonClipping, 'intersection').mockImplementationOnce(() => { throw new Error('numerical failure'); });
  tool.intersectionSelection(); expect(tool.state).toMatchObject({ canFinish: false, intersectionError: 'intersection-failed' });
  expect(tool.finishIntersection()).toBeNull(); expect(tool.finish()).toBeNull(); tool.cancel();
  expect(tool.state).toMatchObject({ canRedo: true, selectedFeatureIds: [0, 1], intersectionError: null });
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.redo()).not.toBeNull();
});

it('rejects mixed/insufficient selection without changing state and refuses intersection during another tool', () => {
  const tool = setup(); tool.importGeoJSON({ type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } });
  for (const ids of [[], [0], [0, 'line']]) {
    tool.selectMany(ids); const state = tool.state; expect(tool.intersectionSelection()).toBe(false); expect(tool.state).toEqual(state);
  }
  tool.start('Polygon'); expect(() => tool.intersectionSelection()).toThrow('Finish or cancel'); tool.cancel();
  tool.select(0); tool.editSelected(); expect(() => tool.intersectionSelection()).toThrow('Finish or cancel');
});

it('blocks competing commands while reviewing an intersection', () => {
  const tool = setup(); tool.intersectionSelection(); const preview = tool.getIntersectionPreview();
  for (const action of [() => tool.select(null), () => tool.selectMany([0]), () => tool.toggleSelection(0),
    () => tool.unionSelection(), () => tool.differenceSelection(), () => tool.start('Polygon'), () => tool.start('LineString'), () => tool.editSelected(), () => tool.splitSelected(),
    () => tool.drawHole(), () => tool.deleteHole(1), () => tool.deleteSelected(), () => tool.deleteSelection(),
    () => tool.duplicateSelection(), () => tool.translateSelection([1, 1]), () => tool.undo(), () => tool.redo(),
    () => tool.clearHistory(), () => tool.importGeoJSON(polygon(10, box(20, 20))), () => tool.applyTransaction({})]) {
    expect(action).toThrow('Finish or cancel');
  }
  expect(tool.getIntersectionPreview()).toEqual(preview); expect(tool.finish()).toBeNull();
});

it('keeps preview and history intact if final transaction preparation fails', () => {
  const tool = setup(); tool.intersectionSelection(); const before = tool.exportGeoJSON(); const state = tool.state; const preview = tool.getIntersectionPreview();
  vi.spyOn(transaction, 'prepareTransaction').mockImplementationOnce(() => { throw new Error('Rejected result'); });
  expect(() => tool.finishIntersection()).toThrow('Rejected result');
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state).toEqual(state); expect(tool.getIntersectionPreview()).toEqual(preview);
  expect(tool.finishIntersection()).not.toBeNull();
});

it.each([
  ['overlap', box(2, 0), 8], ['identical', box(0, 0), 16], ['contained', box(1, 1, 1), 1],
  ['shared edge', box(4, 0), 0], ['point contact', box(4, 4), 0], ['disjoint', box(6, 0), 0],
] as const)('intersects %s with correct area, valid winding and isolated inputs', (_, second, expectedArea) => {
  const inputs = [polygon(0, box(0, 0)).geometry, polygon(1, second).geometry];
  const before = structuredClone(inputs); const result = intersectionPolygons(inputs);
  expect(result.error).toBeNull(); expect(result.preview).not.toBeNull();
  if (expectedArea === 0) expect(result.preview).toEqual({ geometry: null });
  else {
    const geometry = result.preview!.geometry!;
    expect(geometry.type).toBe('Polygon'); expect(area(geometry)).toBe(expectedArea);
    expect(validateMultiPolygon(parts(geometry))).toBeNull();
    const signed = (ring: Coordinate[]) => ring.slice(0, -1).reduce((sum, [x, y], i) => sum + x * ring[i + 1]![1] - ring[i + 1]![0] * y, 0);
    expect(signed(parts(geometry)[0]![0]!)).toBeGreaterThan(0);
    geometry.coordinates.length = 0;
  }
  expect(inputs).toEqual(before);
});

it('intersects all operands, not the union of the later operands, regardless of selection order', () => {
  const inputs = [polygon(0, box(0, 0, 10)), polygon(1, box(2, 0, 8)), polygon(2, box(0, 2, 6))].map((f) => f.geometry);
  for (const order of [inputs, [...inputs].reverse(), [inputs[1]!, inputs[0]!, inputs[2]!]]) {
    const geometry = intersectionPolygons(order).preview!.geometry!;
    expect(area(geometry)).toBe(24); expect(parts(geometry)[0]![0]).toEqual(box(2, 2, 4, 6));
  }
  expect(intersectionPolygons([polygon(0, box(0, 0, 10)).geometry,
    polygon(1, box(0, 0, 2)).geometry, polygon(2, box(8, 8, 2)).geometry]).preview).toEqual({ geometry: null });
});

it('respects holes and multipart operands and normalizes a single surviving component', () => {
  const garden = polygon(0, box(0, 0, 10), box(2, 2, 6)).geometry;
  const contained = intersectionPolygons([garden, polygon(1, box(1, 1, 8)).geometry]).preview!.geometry!;
  expect(contained.type).toBe('Polygon'); expect(contained.coordinates).toHaveLength(2); expect(area(contained)).toBe(28);
  expect(validateMultiPolygon(parts(contained))).toBeNull();
  expect(intersectionPolygons([garden, polygon(1, box(3, 3, 2)).geometry]).preview).toEqual({ geometry: null });
  const multi: UnionPreview = { type: 'MultiPolygon', coordinates: [[box(0, 0, 2)], [box(4, 0, 2)]] };
  const common = intersectionPolygons([multi, polygon(1, box(1, -1, 4, 4)).geometry]).preview!.geometry!;
  expect(common.type).toBe('MultiPolygon'); expect(area(common)).toBe(4); expect(validateMultiPolygon(parts(common))).toBeNull();
  expect(intersectionPolygons([multi, polygon(1, box(1, -1, 2, 4)).geometry]).preview!.geometry?.type).toBe('Polygon');
});

it('constructs fractional crossings and rejects unsupported touching components', () => {
  const triangle = polygon(1, [[1, -1], [5, 2], [1, 5], [1, -1]]).geometry;
  expect(area(intersectionPolygons([polygon(0, box(0, 0)).geometry, triangle]).preview!.geometry!)).toBeCloseTo(12 - 4 / 3 - 0.75, 12);
  // Both inputs are simple concave polygons; their overlap has two squares meeting at one point.
  const a = polygon(0, [[0, 0], [2, 0], [2, 2], [1, 2], [1, 1], [0, 1], [0, 0]]).geometry;
  const b = polygon(1, [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [0, 2], [0, 0]]).geometry;
  expect(validateMultiPolygon(parts(a))).toBeNull(); expect(validateMultiPolygon(parts(b))).toBeNull();
  expect(intersectionPolygons([a, b])).toEqual({ preview: null, error: 'intersection-invalid-result' });
  // A later operand can remove the unsupported contact; only final output is validated.
  expect(area(intersectionPolygons([a, b, polygon(2, box(0, 0, 1)).geometry]).preview!.geometry!)).toBe(1);
});

it('reports engine failures and invalid output separately from valid empty output', () => {
  const inputs = [polygon(0, box(0, 0)).geometry, polygon(1, box(2, 0)).geometry];
  expect(() => intersectionPolygons([inputs[0]!])).toThrow(RangeError);
  const engine = vi.spyOn(polygonClipping, 'intersection');
  engine.mockImplementationOnce(() => { throw new Error('numerical failure'); });
  expect(intersectionPolygons(inputs)).toEqual({ preview: null, error: 'intersection-failed' });
  engine.mockReturnValueOnce([[[[NaN, 0], [1, 0], [0, 1], [NaN, 0]]]]);
  expect(intersectionPolygons(inputs)).toEqual({ preview: null, error: 'intersection-invalid-result' });
  engine.mockReturnValueOnce([[box(0, 0)], [box(4, 4)]]);
  expect(intersectionPolygons(inputs)).toEqual({ preview: null, error: 'intersection-invalid-result' });
  engine.mockReturnValueOnce([]);
  expect(intersectionPolygons(inputs)).toEqual({ preview: { geometry: null }, error: null });
});

it('deletes every selected input for an empty result in one reversible transaction', () => {
  const tool = setup([polygon(0, box(0, 0)), polygon('other', box(20, 20)), polygon('0', box(5, 0))]);
  tool.selectMany(['0', 0]); const before = tool.exportGeoJSON(); const revision = tool.state.dataRevision;
  tool.intersectionSelection(); expect(tool.getIntersectionPreview()).toEqual({ geometry: null });
  expect(tool.state).toMatchObject({ canFinish: true, intersectionError: null });
  expect(tool.exportGeoJSON()).toEqual(before);
  expect(tool.finishIntersection()!.changes).toHaveLength(2);
  expect(tool.exportGeoJSON().features).toEqual([before.features[1]]);
  expect(tool.state).toMatchObject({ mode: 'idle', selectedFeatureIds: [], dataRevision: revision + 1 });
  tool.undo(); expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.selectedFeatureIds).toEqual([]);
  tool.redo(); expect(tool.exportGeoJSON().features).toEqual([before.features[1]]);
});

it('caches the calculation throughout review and cancels empty or nonempty previews without losing Redo', () => {
  for (const offset of [2, 8]) {
    const tool = setup([polygon(0, box(0, 0)), polygon('0', box(offset, 0))]);
    tool.translateSelection([1, 1]); tool.undo(); const before = tool.exportGeoJSON();
    const engine = vi.spyOn(polygonClipping, 'intersection'); tool.intersectionSelection();
    for (let i = 0; i < 10; i++) { expect(tool.state.canFinish).toBe(true); tool.getIntersectionPreview(); }
    expect(engine).toHaveBeenCalledOnce(); engine.mockRestore();
    tool.cancel(); expect(tool.exportGeoJSON()).toEqual(before);
    expect(tool.state).toMatchObject({ mode: 'idle', canRedo: true, selectedFeatureIds: [0, '0'], intersectionError: null });
    expect(tool.redo()).not.toBeNull();
  }
});
