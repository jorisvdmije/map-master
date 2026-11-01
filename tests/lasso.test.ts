import { expect, it } from 'vitest';
import { lassoMatcher, lassoOptions, prepareLasso } from '../src/core/lasso.js';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate, GeometryFeature, LassoOptions } from '../src/index.js';

type Geometry = GeometryFeature['geometry'];
const box = (x: number, y: number, size: number): Coordinate[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const point = (x: number, y: number): Geometry => ({ type: 'Point', coordinates: [x, y] });
const polygon = (rings: Coordinate[][]): Geometry => ({ type: 'Polygon', coordinates: rings });
const line = (...coordinates: Coordinate[]): Geometry => ({ type: 'LineString', coordinates });
function matches(ring: Coordinate[], geometry: Geometry, match: LassoOptions['match'] = 'intersects'): boolean {
  const prepared = prepareLasso(ring); expect(prepared.error).toBeNull();
  return lassoMatcher(prepared.ring, match)(geometry);
}

it('validates and isolates screen loops, accepting closure, consecutive samples and either winding', () => {
  const pixels = box(300, 500, 700);
  for (const ring of [pixels, [...pixels].reverse(), [...pixels.slice(0, 2), pixels[1]!, ...pixels.slice(2)]]) {
    expect(prepareLasso(ring).error).toBeNull();
  }
  const prepared = prepareLasso(pixels); prepared.ring[0]![0] = 0;
  expect(pixels[0]![0]).toBe(300);
  expect(prepareLasso([[0, 0], [1, 1]]).error).toBe('too-few-vertices');
  expect(prepareLasso([[0, 0], [1, 1], [2, 2]]).error).toBe('zero-area');
  expect(prepareLasso([[0, 0], [10, 10], [0, 10], [10, 0]]).error).toBe('self-intersection');
  expect(() => prepareLasso([[NaN, 0], [0, 1], [1, 0]])).toThrow(TypeError);
  expect(() => prepareLasso(Array.from({ length: 2049 }, () => [0, 0]))).toThrow(RangeError);
});

it('tests geometry, including boundary contacts and lines whose endpoints are outside', () => {
  const ring = box(0, 0, 10);
  expect(matches(ring, point(5, 5))).toBe(true);
  expect(matches(ring, point(0, 5), 'contains')).toBe(true);
  expect(matches(ring, point(11, 5))).toBe(false);
  expect(matches(ring, line([-5, 5], [15, 5]))).toBe(true);
  expect(matches(ring, line([-5, 5], [15, 5]), 'contains')).toBe(false);
  expect(matches(ring, line([0, 0], [10, 0]), 'contains')).toBe(true);
  expect(matches(ring, polygon([box(-5, -5, 20)]))).toBe(true);
  expect(matches(ring, polygon([box(-5, -5, 20)]), 'contains')).toBe(false);
  expect(matches(ring, polygon([box(2, 2, 4)]), 'contains')).toBe(true);
});

it('leaves holes empty, but selects a polygon when its filled surface or a hole boundary is touched', () => {
  const courtyard = polygon([box(0, 0, 20), box(5, 5, 10)]);
  expect(matches(box(7, 7, 2), courtyard)).toBe(false);
  expect(matches(box(4, 7, 2), courtyard)).toBe(true);
  expect(matches(box(5, 7, 2), courtyard)).toBe(true);
  expect(matches(box(6, 6, 8), courtyard)).toBe(false);
  expect(matches(box(-1, -1, 22), courtyard, 'contains')).toBe(true);
  expect(matches(box(7, 7, 2), courtyard, 'contains')).toBe(false);
});

it('requires complete containment in concave loops, including segment interiors and multipart components', () => {
  const concave: Coordinate[] = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]];
  expect(matches(concave, line([1, 8], [9, 8]), 'contains')).toBe(false);
  expect(matches(concave, polygon([box(1, 1, 8)]), 'contains')).toBe(false);
  expect(matches(concave, line([1, 8], [1, 1], [9, 1], [9, 8]), 'contains')).toBe(true);
  const multipart: Geometry = { type: 'MultiPolygon', coordinates: [[box(1, 1, 1)], [box(20, 20, 1)]] };
  expect(matches(box(0, 0, 10), multipart)).toBe(true);
  expect(matches(box(0, 0, 10), multipart, 'contains')).toBe(false);
  const paths: Geometry = { type: 'MultiLineString', coordinates: [[[1, 1], [2, 2]], [[20, 20], [21, 21]]] };
  expect(matches(box(0, 0, 10), paths)).toBe(true);
  expect(matches(box(0, 0, 10), paths, 'contains')).toBe(false);
});

it('validates options before changing selection settings', () => {
  expect(lassoOptions()).toEqual({ operation: 'replace', match: 'intersects' });
  expect(lassoOptions({ operation: 'add' }, { operation: 'subtract', match: 'contains' })).toEqual({ operation: 'add', match: 'contains' });
  expect(() => lassoOptions({ operation: 'invalid' as LassoOptions['operation'] })).toThrow(TypeError);
  expect(() => lassoOptions({ match: 'invalid' as LassoOptions['match'] })).toThrow(TypeError);
});

function session(): DrawingSession {
  const result = new DrawingSession(() => 'new');
  result.importGeoJSON({ type: 'FeatureCollection', features: [0, '0', 'other'].map((id) => ({ type: 'Feature', id, properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } })) });
  result.selectMany(['other', 0]); result.clearHistory();
  return result;
}

it.each(['replace', 'add', 'subtract'] as const)('applies %s selection once, deduplicating exact typed IDs without data/history changes', (operation) => {
  const tool = session(); const before = tool.exportGeoJSON(); const revision = tool.state.dataRevision;
  expect(tool.startLasso({ operation })).toBe(true); expect(tool.startLasso()).toBe(false);
  expect(tool.state).toMatchObject({ mode: 'select-lasso', canFinish: false, canUndo: false, selectedFeatureIds: ['other', 0] });
  expect(tool.add([1, 1])).toBe(false); expect(tool.finish()).toBeNull();
  tool.getLassoOptions()!.operation = 'replace';
  expect(tool.getLassoOptions()!.operation).toBe(operation);
  expect(() => tool.finishLasso(['missing'])).toThrow(RangeError);
  expect(tool.state.mode).toBe('select-lasso');
  tool.finishLasso([0, '0', 0]);
  expect(tool.state.selectedFeatureIds).toEqual(operation === 'replace' ? [0, '0'] : operation === 'add' ? ['other', 0, '0'] : ['other']);
  expect(tool.state).toMatchObject({ mode: 'idle', dataRevision: revision, canUndo: false });
  expect(tool.exportGeoJSON()).toEqual(before);
});

it('cancels invalid strokes, keeps locked features selectable and blocks mutations until the lasso ends', () => {
  const tool = session(); tool.translateSelection([1, 0]); const before = tool.exportGeoJSON();
  tool.startLasso(); tool.setLassoError('self-intersection');
  expect(tool.state.validationError).toBe('self-intersection');
  for (const run of [() => tool.undo(), () => tool.select(null), () => tool.applyTransaction({}), () => tool.start('Polygon')]) expect(run).toThrow('Finish or cancel');
  tool.setLockedFeatureIds([0]); expect(tool.state.mode).toBe('select-lasso');
  tool.setLassoOptions({ match: 'contains' }); expect(tool.state.validationError).toBeNull();
  expect(() => tool.setLassoOptions({ operation: 'invalid' as LassoOptions['operation'] })).toThrow(TypeError);
  expect(tool.getLassoOptions()).toEqual({ match: 'contains', operation: 'replace' });
  tool.cancel(); expect(tool.state.selectedFeatureIds).toEqual(['other', 0]);
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.getLassoOptions()).toBeNull();
  tool.startLasso(); tool.finishLasso([0]); expect(tool.state.selectedFeatureIds).toEqual([0]);
});
