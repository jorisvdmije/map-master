import { expect, it } from 'vitest';
import { reshapePolygon } from '../src/core/reshape-polygon.js';
import { planarArea } from '../src/core/split-polygon.js';
import { validatePolygon } from '../src/core/polygon.js';
import type { Coordinate, ReshapeError } from '../src/index.js';
const ring: Coordinate[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

it.each([
  ['outward detour', [[2, 0], [3, -2], [4, 0]], 102, 2],
  ['inward detour', [[2, 0], [3, 2], [4, 0]], 98, 2],
  ['straight chord', [[0, 3], [10, 3]], 70, 30],
  ['vertex endpoints', [[0, 0], [-2, 5], [0, 10]], 110, 10],
] as const)('replaces either arc for %s without mutating inputs', (_, input, shorter, longer) => {
  const path: Coordinate[] = input.map(([x, y]) => [x, y]); const before = structuredClone({ ring, path });
  for (const [side, expected] of [['shorter', shorter], ['longer', longer]] as const) {
    const result = reshapePolygon(ring, path, side); expect(result.error).toBeNull();
    const output = result.preview!.coordinates[0]!;
    expect(validatePolygon(output)).toBeNull(); expect(planarArea(output)).toBe(expected);
    expect(output[0]).toEqual(output.at(-1));
    expect(output.slice(0, -1).reduce((sum, [x, y], i) => sum + x * output[i + 1]![1] - output[i + 1]![0] * y, 0)).toBeGreaterThan(0);
    output.length = 0; expect({ ring, path }).toEqual(before);
  }
});

it('makes equal-length arc choices independent of path direction, ring start and winding', () => {
  const path: Coordinate[] = [[0, 5], [10, 5]];
  for (const side of ['shorter', 'longer'] as const) {
    const expected = reshapePolygon(ring, path, side);
    expect(expected.error).toBeNull();
    for (const boundary of [ring, [...ring].reverse(), [[10, 10], [0, 10], [0, 0], [10, 0], [10, 10]] as Coordinate[]]) {
      expect(reshapePolygon(boundary, path, side)).toEqual(expected);
      expect(reshapePolygon(boundary, [...path].reverse(), side)).toEqual(expected);
    }
  }
  expect(reshapePolygon(ring, path, 'shorter')).not.toEqual(reshapePolygon(ring, path, 'longer'));
});

it.each<[string, Coordinate[], ReshapeError]>([
  ['empty path', [], 'reshape-too-few-points'],
  ['one point', [[0, 0]], 'reshape-too-few-points'],
  ['off-boundary start', [[2, 2], [10, 5]], 'reshape-endpoints-off-boundary'],
  ['off-boundary end', [[0, 5], [8, 5]], 'reshape-endpoints-off-boundary'],
  ['same attachment', [[0, 0], [2, -2], [0, 0]], 'reshape-same-endpoint'],
  ['repeated point', [[0, 3], [3, 3], [3, 3], [10, 3]], 'reshape-self-intersection'],
  ['backtrack', [[0, 3], [4, 3], [2, 3], [10, 4]], 'reshape-self-intersection'],
  ['self crossing', [[0, 3], [8, 8], [2, 8], [8, 2], [10, 3]], 'reshape-self-intersection'],
  ['boundary recrossing', [[0, 3], [11, 3], [10, 4]], 'reshape-boundary-touch'],
  ['corner touch', [[0, 3], [10, 10], [0, 8]], 'reshape-boundary-touch'],
  ['boundary overlap', [[2, 0], [4, 0]], 'reshape-boundary-touch'],
  ['partial boundary overlap', [[2, 0], [6, 0], [8, 3], [10, 3]], 'reshape-boundary-touch'],
  ['nonfinite point', [[0, 3], [NaN, 2], [10, 3]], 'reshape-invalid-result'],
])('rejects %s', (_, path, error) => {
  expect(reshapePolygon(ring, path)).toEqual({ preview: null, error });
});

it('handles sloped-edge construction roundoff without accepting a geographic snapping tolerance', () => {
  const sloped: Coordinate[] = [[4.89123, 52.37012], [4.89987, 52.37765], [4.89002, 52.38], [4.89123, 52.37012]];
  const a = sloped[0]!; const b = sloped[1]!;
  const at = (t: number): Coordinate => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  const path: Coordinate[] = [at(0.2), [4.899, 52.369], at(0.7)];
  const result = reshapePolygon(sloped, path); expect(result.error).toBeNull();
  expect(validatePolygon(result.preview!.coordinates[0]!)).toBeNull();
  path[0]![1] += 1e-8; expect(reshapePolygon(sloped, path).error).toBe('reshape-endpoints-off-boundary');
});

it('rejects a path crossing the antimeridian', () => {
  const boundary: Coordinate[] = [[170, 0], [179, 0], [179, 10], [170, 10], [170, 0]];
  expect(reshapePolygon(boundary, [[171, 0], [-175, -2], [178, 0]]).error).toBe('reshape-antimeridian');
});
