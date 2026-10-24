import { describe, expect, it } from 'vitest';
import { traceBoundary, traceSource } from '../src/core/trace-boundary.js';
import type { Coordinate, GeometryFeature } from '../src/core/types.js';
const ring: Coordinate[] = [[0, 0], [8, 0], [8, 4], [0, 4], [0, 0]];
it('retains exact intervening vertices and partial edges in either direction', () => {
  const expected = [[4, 0], [8, 0], [8, 2]];
  expect(traceBoundary(ring, true, [4, 0], [8, 2])).toEqual(expected);
  expect(traceBoundary(ring, true, [8, 2], [4, 0])).toEqual([...expected].reverse());
  expect(traceBoundary(ring, true, [4, 0], [8, 2], 'longer')).toEqual([[4, 0], [0, 0], [0, 4], [8, 4], [8, 2]]);
});
it('handles the closing edge, same-edge attachments and vertices without duplicates', () => {
  expect(traceBoundary(ring, true, [0, 2], [4, 0])).toEqual([[0, 2], [0, 0], [4, 0]]);
  expect(traceBoundary(ring, true, [0, 3], [0, 1])).toEqual([[0, 3], [0, 1]]);
  expect(traceBoundary(ring, true, [0, 3], [0, 1], 'longer')).toEqual([[0, 3], [0, 4], [8, 4], [8, 0], [0, 0], [0, 1]]);
  expect(traceBoundary(ring, true, [0, 0], [8, 0])).toEqual([[0, 0], [8, 0]]);
  expect(traceBoundary(ring, true, [0, 0], [0, 0], 'longer')).toBeNull();
});
it('keeps equal-length choices invariant under winding, ring start and route reversal', () => {
  const square: Coordinate[] = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  for (const side of ['shorter', 'longer'] as const) {
    const expected = traceBoundary(square, true, [0, 0], [4, 4], side);
    expect(traceBoundary([...square].reverse(), true, [0, 0], [4, 4], side)).toEqual(expected);
    expect(traceBoundary([[4, 4], [0, 4], [0, 0], [4, 0], [4, 4]], true, [0, 0], [4, 4], side)).toEqual(expected);
    expect(traceBoundary(square, true, [4, 4], [0, 0], side)).toEqual([...expected!].reverse());
  }
});
it('follows the only open-line route without shortcuts or wraparound', () => {
  const line: Coordinate[] = [[0, 0], [3, 0], [3, 3], [6, 3]];
  for (const side of ['shorter', 'longer'] as const) {
    expect(traceBoundary(line, false, [1, 0], [5, 3], side)).toEqual([[1, 0], [3, 0], [3, 3], [5, 3]]);
    expect(traceBoundary(line, false, [5, 3], [1, 0], side)).toEqual([[5, 3], [3, 3], [3, 0], [1, 0]]);
  }
});
it('rejects off-source/equal endpoints and dateline jumps without modifying inputs', () => {
  const before = structuredClone(ring);
  expect(traceBoundary(ring, true, [1, 1], [8, 2])).toBeNull();
  expect(traceBoundary([[179, 0], [-179, 0]], false, [179, 0], [-179, 0])).toBeNull();
  expect(() => traceBoundary(ring, true, [NaN, 0], [8, 2])).toThrow();
  expect(() => traceBoundary(ring, true, [0, 0], [8, 2], 'invalid' as 'shorter')).toThrow();
  const path = traceBoundary(ring, true, [0, 0], [8, 4])!; path[0]![0] = 70;
  expect(ring).toEqual(before);
});
it('accepts construction roundoff on oblique edges without adding a user tolerance', () => {
  const line: Coordinate[] = [[4.89001, 52.37003], [4.89504, 52.37507], [4.89902, 52.37001]];
  const from: Coordinate = [line[0]![0] + 0.3 * (line[1]![0] - line[0]![0]), line[0]![1] + 0.3 * (line[1]![1] - line[0]![1])];
  expect(traceBoundary(line, false, from, line[2]!)).toHaveLength(3);
  expect(traceBoundary(line, false, [from[0], from[1] + 1e-8], line[2]!)).toBeNull();
});
describe('source addressing', () => {
  const features: GeometryFeature[] = [
    { type: 'Feature', id: 0, properties: null, geometry: { type: 'Polygon', coordinates: [ring, [[2, 1], [2, 2], [3, 2], [3, 1], [2, 1]]] } },
    { type: 'Feature', id: '0', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [ [ring], [[[10, 0], [12, 0], [12, 2], [10, 0]]] ] } },
    { type: 'Feature', id: 'line', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[1, 1], [2, 2]], [[3, 3], [4, 4]]] } },
  ];
  it('selects individual holes and multipart components', () => {
    expect(traceSource(features[0]!, { featureId: 0, ringIndex: 1 })?.points[0]).toEqual([2, 1]);
    expect(traceSource(features[1]!, { featureId: '0', partIndex: 1 })?.points[0]).toEqual([10, 0]);
    expect(traceSource(features[2]!, { featureId: 'line', partIndex: 1 })).toEqual({ points: [[3, 3], [4, 4]], closed: false });
  });
  it('refuses missing, fractional, negative and incompatible indices', () => {
    for (const partIndex of [-1, 0.5, 4, NaN]) expect(traceSource(features[1]!, { featureId: '0', partIndex })).toBeNull();
    expect(traceSource(features[0]!, { featureId: 0, ringIndex: 2 })).toBeNull();
    expect(traceSource(features[2]!, { featureId: 'line', ringIndex: 1 })).toBeNull();
  });
});
