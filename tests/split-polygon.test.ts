import { expect, it } from 'vitest';
import { planarArea, splitPolygon } from '../src/core/split-polygon.js';
import { validatePolygon } from '../src/core/polygon.js';
import type { Coordinate, SplitError } from '../src/index.js';

const square: Coordinate[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const split = (cut: Coordinate[], ring = square) => splitPolygon(ring, cut);
it('splits a square into two valid parts with matching boundary intersections and conserved area', () => {
  const result = split([[-1, 3], [11, 3]]); expect(result.error).toBeNull();
  const { retained, created } = result.preview!;
  expect(planarArea(retained.coordinates[0]!)).toBe(70); expect(planarArea(created.coordinates[0]!)).toBe(30);
  for (const part of [retained, created]) {
    expect(validatePolygon(part.coordinates[0]!)).toBeNull();
    expect(part.coordinates[0]).toContainEqual([0, 3]); expect(part.coordinates[0]).toContainEqual([10, 3]);
  }
  expect(result).toEqual(split([[11, 3], [-1, 3]]));
  expect(square).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
});
it('supports bent cuts, including cuts entering and exiting the same edge', () => {
  for (const cut of [ [[-1, 2], [5, 2], [5, 8], [11, 8]], [[-1, 2], [3, 2], [3, 8], [-1, 8]] ] as Coordinate[][]) {
    const result = split(cut); expect(result.error).toBeNull();
    expect(planarArea(result.preview!.retained.coordinates[0]!) + planarArea(result.preview!.created.coordinates[0]!)).toBe(100);
    expect(result).toEqual(split([...cut].reverse()));
  }
});
it('splits concave and clockwise rings and resolves equal area deterministically', () => {
  const concave: Coordinate[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10], [0, 0]];
  const result = split([[-1, 2], [11, 2]], concave); expect(result.error).toBeNull();
  expect(planarArea(result.preview!.retained.coordinates[0]!)).toBe(44);
  expect(split([[-1, 2], [11, 2]], [...concave].reverse())).toEqual(result);
  expect(split([[-1, 5], [11, 5]])).toEqual(split([[11, 5], [-1, 5]]));
});
it.each<[Coordinate[], SplitError]>([
  [[], 'split-too-few-points'], [[[1, 1]], 'split-too-few-points'],
  [[[-1, 3], [5, 3]], 'split-endpoints-inside'],
  [[[1, 3], [5, 3]], 'split-endpoints-inside'],
  [[[-1, -1], [11, -1]], 'split-crossing-count'],
  [[[-1, 0], [11, 0]], 'split-boundary-touch'],
  [[[-1, -1], [11, 11]], 'split-boundary-touch'],
  [[[0, 3], [11, 3]], 'split-boundary-touch'],
  [[[-1, 3], [0, 3], [11, 3]], 'split-boundary-touch'],
  [[[-1, 3], [-1, 3]], 'split-self-intersection'],
  [[[-1, 3], [5, 3], [2, 3], [11, 3]], 'split-self-intersection'],
  [[[-1, 2], [11, 8], [-1, 8], [11, 2]], 'split-self-intersection'],
  [[[-170, 2], [170, 3]], 'split-antimeridian'],
])('rejects unsupported cut %# explicitly', (cut, error) => { expect(split(cut)).toEqual({ preview: null, error }); });
it('rejects more than two crossings instead of dropping parts', () => {
  const u: Coordinate[] = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10], [0, 0]];
  expect(split([[-1, 5], [11, 5]], u).error).toBe('split-crossing-count');
});
it('preserves area and validity for varied scales and translated coordinates', () => {
  for (const scale of [1e-7, 0.01, 1]) {
    for (let i = 1; i < 10; i++) {
      const ring = square.map(([x, y]): Coordinate => [4.895 + x * scale, 52.372 + y * scale]);
      const cut: Coordinate[] = [[4.895 - scale, 52.372 + i * scale], [4.895 + 11 * scale, 52.372 + i * scale]];
      const result = split(cut, ring); expect(result.error).toBeNull();
      const parts = [result.preview!.retained.coordinates[0]!, result.preview!.created.coordinates[0]!];
      expect(parts.map(validatePolygon)).toEqual([null, null]);
      expect(Math.abs(parts.reduce((sum, part) => sum + planarArea(part), 0) - planarArea(ring)) / planarArea(ring)).toBeLessThan(1e-10);
    }
  }
});

it('covers the original interior exactly once across both results, with no added exterior area', () => {
  // Independent ray-casting oracle on off-boundary sample points.
  const contains = ([x, y]: Coordinate, ring: Coordinate[]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i]!; const [bx, by] = ring[j]!;
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  };
  for (const cut of [ [[-1, 3], [11, 3]], [[-1, 2], [5, 2], [5, 8], [11, 8]], [[-1, 2], [3, 2], [3, 8], [-1, 8]] ] as Coordinate[][]) {
    const { retained, created } = split(cut).preview!;
    for (let x = -1; x < 12; x++) for (let y = -1; y < 12; y++) {
      const point: Coordinate = [x + 0.37, y + 0.23];
      const coverage = Number(contains(point, retained.coordinates[0]!)) + Number(contains(point, created.coordinates[0]!));
      expect(coverage).toBe(Number(contains(point, square)));
    }
  }
});
