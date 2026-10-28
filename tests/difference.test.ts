import polygonClipping from 'polygon-clipping';
import { afterEach, expect, it, vi } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { differencePolygons } from '../src/core/difference.js';
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
  expect(index === 0 ? signed > 0 : signed < 0).toBe(true);
  return filled + signed;
}, 0), 0);
function setup(features: GeometryFeature[] = [polygon(0, box(0, 0)), polygon('0', box(2, 0))]): DrawingSession {
  const tool = new DrawingSession(() => { throw new Error('Difference must not allocate IDs.'); });
  tool.importGeoJSON({ type: 'FeatureCollection', features }); tool.clearHistory(); tool.selectMany(features.map((f) => f.id)); return tool;
}
afterEach(() => { vi.restoreAllMocks(); });

it.each([
  ['overlap', box(2, 0), 'Polygon', 8],
  ['shared edge', box(4, 0), 'Polygon', 16],
  ['point contact', box(4, 4), 'Polygon', 16],
  ['contained cutter', box(1, 1, 1), 'Polygon', 15],
  ['disjoint', box(6, 0), 'Polygon', 16],
  ['splitting strip', box(1, -1, 1, 6), 'MultiPolygon', 12],
] as const)('subtracts %s with correct area, topology and winding without mutating input', (_, ring, type, expectedArea) => {
  const target = polygon(0, box(0, 0)).geometry; const cutters = [polygon(1, ring).geometry];
  const before = structuredClone({ target, cutters });
  const result = differencePolygons(target, cutters);
  expect(result.error).toBeNull(); expect(result.preview!.geometry!.type).toBe(type);
  expect(area(result.preview!.geometry!)).toBe(expectedArea); expect(validateMultiPolygon(parts(result.preview!.geometry!))).toBeNull();
  result.preview!.geometry!.coordinates.length = 0; expect({ target, cutters }).toEqual(before);
});

it('subtracts the combined filled area of overlapping cutters once', () => {
  const result = differencePolygons(polygon(0, box(0, 0, 10)).geometry,
    [polygon(1, box(1, 1)).geometry, polygon(2, box(3, 1)).geometry, polygon(3, box(1, 1)).geometry]);
  expect(result.error).toBeNull(); expect(area(result.preview!.geometry!)).toBe(76);
  expect(result.preview!.geometry!.coordinates).toHaveLength(2);
});

it('preserves target holes, opens holes into the exterior and retains islands inside cutter holes', () => {
  const target = polygon(0, box(0, 0, 10), box(2, 2, 2)).geometry;
  const preserved = differencePolygons(target, [polygon(1, box(7, 0, 5, 10)).geometry]);
  expect(preserved.error).toBeNull(); expect(area(preserved.preview!.geometry!)).toBe(66);
  expect(preserved.preview!.geometry!.coordinates).toHaveLength(2);
  const opened = differencePolygons(target, [polygon(1, box(3, -1, 1, 5)).geometry]);
  expect(opened.error).toBeNull(); expect(area(opened.preview!.geometry!)).toBe(94);
  expect(opened.preview!.geometry!.coordinates).toHaveLength(1);
  const island = differencePolygons(polygon(0, box(0, 0, 10)).geometry, [polygon(1, box(1, 1, 8), box(3, 3, 2)).geometry]);
  expect(island.error).toBeNull(); expect(island.preview!.geometry!.type).toBe('MultiPolygon'); expect(area(island.preview!.geometry!)).toBe(40);
});

it('handles multipart targets/cutters and normalizes a changed one-part result to Polygon', () => {
  const multi: UnionPreview = { type: 'MultiPolygon', coordinates: [[box(0, 0)], [box(10, 0)]] };
  const cutter: UnionPreview = { type: 'MultiPolygon', coordinates: [[box(-1, -1, 6)], [box(12, 0)]] };
  const result = differencePolygons(multi, [cutter]);
  expect(result.error).toBeNull(); expect(result.preview!.geometry!.type).toBe('Polygon'); expect(area(result.preview!.geometry!)).toBe(8);
});

it('constructs fractional intersections and rejects point-touching hole results', () => {
  const triangle = polygon(1, [[1, -1], [5, 2], [1, 5], [1, -1]]).geometry;
  const result = differencePolygons(polygon(0, box(0, 0)).geometry, [triangle]);
  expect(result.error).toBeNull(); expect(area(result.preview!.geometry!)).toBeCloseTo(16 - (12 - 4 / 3 - 0.75), 12);
  expect(differencePolygons(polygon(0, box(0, 0, 10)).geometry,
    [polygon(1, box(1, 1, 2)).geometry, polygon(2, box(3, 3, 2)).geometry]))
    .toEqual({ preview: null, error: 'difference-invalid-result' });
});

it.each([box(0, 0), box(-1, -1, 6)].map((ring) => [ring] as const))('represents complete coverage as valid empty geometry', (ring) => {
  expect(differencePolygons(polygon(0, box(0, 0)).geometry, [polygon(1, ring).geometry]))
    .toEqual({ preview: { geometry: null }, error: null });
});

it('fails closed for engine failures and nonfinite or out-of-range constructed positions', () => {
  const target = polygon(0, box(0, 0)).geometry; const clips = [polygon(1, box(2, 0)).geometry];
  vi.spyOn(polygonClipping, 'intersection').mockImplementationOnce(() => { throw new Error('numerical failure'); });
  expect(differencePolygons(target, clips)).toEqual({ preview: null, error: 'difference-failed' });
  vi.spyOn(polygonClipping, 'difference').mockImplementationOnce(() => { throw new Error('numerical failure'); });
  expect(differencePolygons(target, clips)).toEqual({ preview: null, error: 'difference-failed' });
  for (const x of [NaN, Infinity, 181]) {
    vi.spyOn(polygonClipping, 'difference').mockReturnValueOnce([[[[x, 0], [1, 0], [0, 1], [x, 0]]]]);
    expect(differencePolygons(target, clips)).toEqual({ preview: null, error: 'difference-invalid-result' });
  }
  expect(() => differencePolygons(target, [])).toThrow('at least one');
});

it('updates only the first selected typed ID with its properties/position, one revision and exact undo/redo', () => {
  const tool = setup([polygon(0, box(0, 0)), polygon('unrelated', box(20, 20)), { ...polygon('0', box(2, 0)), properties: null }]);
  tool.selectMany(['0', 0]); const before = tool.exportGeoJSON(); const revision = tool.state.dataRevision;
  expect(tool.differenceSelection()).toBe(true); expect(tool.differenceSelection()).toBe(false);
  expect(tool.state).toMatchObject({ mode: 'difference-polygons', canFinish: true, canUndo: false, canRedo: false, differenceError: null, unionError: null, validationError: null });
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.dataRevision).toBe(revision);
  const preview = tool.getDifferencePreview()!; tool.getDifferencePreview()!.geometry!.coordinates.length = 0;
  const event = tool.finishDifference()!; expect(event.changes).toHaveLength(1);
  const after = tool.exportGeoJSON(); expect(after.features).toEqual([before.features[0], before.features[1], { ...before.features[2], geometry: preview.geometry }]);
  expect(tool.state).toMatchObject({ mode: 'idle', selectedFeatureIds: ['0', 0], featureCount: 3, dataRevision: revision + 1, canUndo: true });
  expect(tool.getDifferencePreview()).toBeNull(); expect(tool.finishDifference()).toBeNull();
  event.changes[0]!.after!.geometry.coordinates.length = 0; expect(tool.exportGeoJSON()).toEqual(after);
  expect(tool.undo()?.action).toBe('transaction'); expect(tool.exportGeoJSON()).toEqual(before);
  expect(tool.redo()?.action).toBe('transaction'); expect(tool.exportGeoJSON()).toEqual(after);
});

it('deletes only a fully covered target and restores its exact order with Undo', () => {
  const tool = setup([polygon('unrelated', box(20, 20)), polygon(0, box(0, 0)), polygon('0', box(0, 0))]);
  tool.selectMany([0, '0']); const before = tool.exportGeoJSON(); tool.differenceSelection();
  expect(tool.state.canFinish).toBe(true); expect(tool.getDifferencePreview()).toEqual({ geometry: null });
  expect(tool.finishDifference()!.changes).toEqual([{ before: before.features[1], after: null }]);
  const after = tool.exportGeoJSON(); expect(after.features).toEqual([before.features[0], before.features[2]]);
  expect(tool.state.selectedFeatureIds).toEqual(['0']); tool.undo(); expect(tool.exportGeoJSON()).toEqual(before);
  expect(tool.state.selectedFeatureIds).toEqual(['0']); tool.redo(); expect(tool.exportGeoJSON()).toEqual(after);
});

it.each([box(6, 0), box(4, 0), box(4, 4)].map((ring) => [ring] as const))('preserves exact target representation, revision and Redo for no-area-overlap', (cutter) => {
  const target: GeometryFeature = { ...polygon(0), geometry: { type: 'MultiPolygon', coordinates: [[[[4, 4], [0, 4], [0, 0], [2, 0], [4, 0], [4, 4]]]] } };
  const tool = setup([target, polygon('0', cutter)]);
  tool.applyTransaction({ create: [polygon(2, box(30, 30))] }); tool.undo(); const before = tool.exportGeoJSON(); const revision = tool.state.dataRevision;
  tool.differenceSelection(); expect(tool.getDifferencePreview()!.geometry).toEqual(before.features[0]!.geometry);
  expect(tool.finishDifference()).toBeNull(); expect(tool.exportGeoJSON()).toEqual(before);
  expect(tool.state).toMatchObject({ mode: 'idle', dataRevision: revision, canRedo: true, canUndo: false });
  expect(tool.redo()).not.toBeNull();
});

it('keeps cutters inside existing holes as exact no-ops', () => {
  const tool = setup([polygon(0, box(0, 0, 10), box(2, 2, 6)), polygon(1, box(3, 3, 2))]); const before = tool.exportGeoJSON();
  tool.differenceSelection(); expect(tool.finishDifference()).toBeNull(); expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.canUndo).toBe(false);
});

it('preserves selection and redo on cancellation or invalid confirmation', () => {
  const tool = setup([polygon(0, box(0, 0, 10)), polygon(1, box(1, 1, 2)), polygon(2, box(3, 3, 2))]);
  tool.applyTransaction({ create: [polygon(3, box(20, 20))] }); tool.undo(); const before = tool.exportGeoJSON();
  tool.differenceSelection(); expect(tool.state).toMatchObject({ canFinish: false, differenceError: 'difference-invalid-result' });
  expect(tool.finishDifference()).toBeNull(); expect(tool.finish()).toBeNull(); tool.cancel();
  expect(tool.state).toMatchObject({ canRedo: true, selectedFeatureIds: [0, 1, 2], differenceError: null });
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.redo()).not.toBeNull();
});

it('rejects mixed/insufficient selection and refuses subtraction during another tool', () => {
  const tool = setup(); tool.importGeoJSON({ type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } });
  for (const ids of [[], [0], [0, 'line']]) {
    tool.selectMany(ids); const state = tool.state; expect(tool.differenceSelection()).toBe(false); expect(tool.state).toEqual(state);
  }
  tool.start('Polygon'); expect(() => tool.differenceSelection()).toThrow('Finish or cancel'); tool.cancel();
  tool.selectMany([0, '0']); tool.unionSelection(); expect(() => tool.differenceSelection()).toThrow('Finish or cancel');
});

it('locks competing commands and ignores drawing clicks during review', () => {
  const tool = setup(); tool.differenceSelection(); const preview = tool.getDifferencePreview();
  for (const action of [() => tool.select(null), () => tool.selectMany([0]), () => tool.toggleSelection(0),
    () => tool.start('Polygon'), () => tool.start('LineString'), () => tool.editSelected(), () => tool.splitSelected(), () => tool.unionSelection(),
    () => tool.drawHole(), () => tool.deleteHole(1), () => tool.deleteSelected(), () => tool.deleteSelection(),
    () => tool.duplicateSelection(), () => tool.translateSelection([1, 1]), () => tool.undo(), () => tool.redo(),
    () => tool.clearHistory(), () => tool.importGeoJSON(polygon(10, box(20, 20))), () => tool.applyTransaction({})]) {
    expect(action).toThrow('Finish or cancel');
  }
  expect(tool.add([20, 20])).toBe(false); expect(tool.getDraft()).toEqual([]); expect(tool.getDraftRings()).toBeNull();
  expect(tool.finish()).toBeNull(); expect(tool.getDifferencePreview()).toEqual(preview);
});

it('preserves preview and data if transaction preparation fails, and cancels valid review without changes', () => {
  const tool = setup(); tool.differenceSelection(); const before = tool.exportGeoJSON(); const state = tool.state; const preview = tool.getDifferencePreview();
  vi.spyOn(transaction, 'prepareTransaction').mockImplementationOnce(() => { throw new Error('Rejected result'); });
  expect(() => tool.finishDifference()).toThrow('Rejected result');
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state).toEqual(state); expect(tool.getDifferencePreview()).toEqual(preview);
  tool.cancel(); expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.canUndo).toBe(false);
  tool.differenceSelection(); expect(tool.finishDifference()).not.toBeNull();
});
