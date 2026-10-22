import { expect, it } from 'vitest';
import { SnapIndex, snappingOptions, type ScreenPoint } from '../src/core/snapping.js';
import type { Coordinate, GeometryFeatureCollection, LineFeature, PolygonFeature } from '../src/index.js';

const project = ([x, y]: Coordinate): ScreenPoint => ({ x, y });
const unproject = ({ x, y }: ScreenPoint): Coordinate => [x, y];
const options = snappingOptions({ enabled: true });
const line = (id: string | number, coordinates: Coordinate[]): LineFeature => ({ type: 'Feature', id, properties: {}, geometry: { type: 'LineString', coordinates } });
const polygon: PolygonFeature = { type: 'Feature', id: 'square', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]] } };
const collection = (...features: GeometryFeatureCollection['features']): GeometryFeatureCollection => ({ type: 'FeatureCollection', features });

it('uses an inclusive circular pixel tolerance, with vertices preferred over closer edges', () => {
  const index = new SnapIndex(collection(polygon), project);
  expect(index.query({ x: 0, y: -18 }, options, unproject)).toMatchObject({ kind: 'vertex', index: 0, coordinate: [0, 0], distance: 18 });
  expect(index.query({ x: -13, y: -13 }, options, unproject)).toBeNull();
  expect(index.query({ x: 17, y: 1 }, options, unproject)).toMatchObject({ kind: 'vertex', index: 0 });
  expect(index.query({ x: 50, y: 18 }, options, unproject)).toMatchObject({ kind: 'edge', index: 0, coordinate: [50, 0] });
  expect(index.query({ x: 50, y: 18.001 }, options, unproject)).toBeNull();
});

it('includes the polygon closing edge and excludes a synthetic line closing edge', () => {
  expect(new SnapIndex(collection(polygon), project).query({ x: -8, y: 50 }, options, unproject)).toMatchObject({ kind: 'edge', index: 3, coordinate: [0, 50] });
  const index = new SnapIndex(collection(line('open', [[0, 0], [100, 0], [100, 100]])), project);
  expect(index.query({ x: 50, y: 50 }, options, unproject)).toBeNull();
});

it('supports independent vertex/edge toggles and disabled snapping', () => {
  const index = new SnapIndex(collection(polygon), project);
  expect(index.query({ x: 17, y: 1 }, { ...options, vertices: false }, unproject)).toMatchObject({ kind: 'edge', coordinate: [17, 0] });
  expect(index.query({ x: 50, y: 1 }, { ...options, edges: false }, unproject)).toBeNull();
  expect(index.query({ x: 0, y: 0 }, { ...options, enabled: false }, unproject)).toBeNull();
  expect(index.query({ x: 0, y: 0 }, { ...options, vertices: false, edges: false }, unproject)).toBeNull();
});

it('chooses the nearest candidate, then later source order for exact ties while preserving typed IDs', () => {
  const index = new SnapIndex(collection(line(7, [[0, 0], [100, 0]]), line('7', [[0, 0], [100, 0]]), line('near', [[0, 10], [100, 10]])), project);
  expect(index.query({ x: 0, y: 0 }, options, unproject)?.featureId).toBe('7');
  expect(index.query({ x: 0, y: 9 }, options, unproject)?.featureId).toBe('near');
  expect(index.query({ x: 50, y: -1 }, options, unproject)).toMatchObject({ featureId: '7', kind: 'edge' });
});

it('preserves exact source vertices/endpoints and returns independent coordinates', () => {
  const input = collection(line('precise', [[0.123456789, 1.987654321], [10, 10]]));
  const index = new SnapIndex(input, ([x, y]) => ({ x: x * 100, y: y * 100 }));
  const point = { x: 12.3456789, y: 198.7654321 };
  const result = index.query(point, options, () => { throw new Error('Vertex must not be inverse projected'); })!;
  expect(result.coordinate).toEqual([0.123456789, 1.987654321]);
  result.coordinate[0] = 99;
  input.features[0]!.geometry.coordinates.length = 0;
  expect(index.query(point, { ...options, vertices: false }, unproject)?.coordinate).toEqual([0.123456789, 1.987654321]);
});

it('excludes every candidate of the edited feature while retaining typed IDs and the next best target', () => {
  const index = new SnapIndex(collection(line(0, [[0, 0], [100, 0]]), line('0', [[0, 10], [100, 10]])), project);
  expect(index.query({ x: 1, y: 0 }, options, unproject, 0)).toMatchObject({ featureId: '0', kind: 'vertex', coordinate: [0, 10] });
  expect(index.query({ x: 50, y: 0 }, options, unproject, 0)).toMatchObject({ featureId: '0', kind: 'edge', coordinate: [50, 10] });
  expect(index.query({ x: 0, y: 10 }, options, unproject, '0')?.featureId).toBe(0);
  expect(index.query({ x: 0, y: 0 }, options, unproject)?.featureId).toBe(0);
  const own = new SnapIndex(collection(polygon), project);
  expect(own.query({ x: 0, y: 0 }, options, unproject, 'square')).toBeNull();
  expect(own.query({ x: 0, y: 50 }, options, unproject, 'square')).toBeNull();
});

it('inverse projects interior points on long and diagonal screen segments', () => {
  const index = new SnapIndex(collection(line('long', [[-10000, -10000], [10000, 10000]])), project);
  expect(index.query({ x: 10, y: 0 }, options, ({ x, y }) => [x / 10, y / 10])).toMatchObject({ kind: 'edge', coordinate: [0.5, 0.5] });
});

it('finds targets throughout a spatial hierarchy and skips nonfinite projections', () => {
  const features = Array.from({ length: 1000 }, (_, i) => line(i, [[i * 100, 0], [i * 100 + 40, 0]]));
  const index = new SnapIndex(collection(...features, line('hidden', [[NaN, NaN], [Infinity, 0]])), project);
  for (const id of [0, 15, 300, 999]) {
    expect(index.query({ x: id * 100 + 20, y: 5 }, options, unproject)).toMatchObject({ featureId: id, kind: 'edge', coordinate: [id * 100 + 20, 0] });
  }
  expect(index.query({ x: NaN, y: 0 }, options, unproject)).toBeNull();
  expect(new SnapIndex(collection(), project).query({ x: 0, y: 0 }, options, unproject)).toBeNull();
});

it('validates bounded options without mutating the previous configuration', () => {
  expect(snappingOptions()).toEqual({ enabled: false, distance: 18, vertices: true, edges: true });
  for (const distance of [0, -1, NaN, Infinity, 101]) expect(() => snappingOptions({ distance }, options)).toThrow(RangeError);
  expect(() => snappingOptions({ enabled: 'yes' as unknown as boolean }, options)).toThrow(TypeError);
  expect(snappingOptions({ distance: 100, edges: false }, options)).toEqual({ enabled: true, distance: 100, vertices: true, edges: false });
  expect(options).toEqual({ enabled: true, distance: 18, vertices: true, edges: true });
});
