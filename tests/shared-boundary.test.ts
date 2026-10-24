import { expect, it } from 'vitest';
import { prepareSharedBoundary, updateSharedBoundary } from '../src/core/shared-boundary.js';
import type { Coordinate, PolygonFeature } from '../src/core/types.js';
const polygon = (ring: Coordinate[]): PolygonFeature['geometry'] => ({ type: 'Polygon', coordinates: [ring] });
const left = polygon([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]);
const right = polygon([[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]);
it('finds the complete shared edge and updates both sides with exactly matching coordinates', () => {
  const context = prepareSharedBoundary(left, right)!;
  expect(context.path).toEqual([[2, 0], [2, 2]]);
  expect(updateSharedBoundary(context, context.path).geometries).toEqual([left, right]);
  const result = updateSharedBoundary(context, [[2, 0], [2.7, 1], [2, 2]]);
  expect(result.error).toBeNull(); expect(result.geometries).toEqual([
    polygon([[0, 0], [2, 0], [2.7, 1], [2, 2], [0, 2], [0, 0]]),
    polygon([[2, 0], [4, 0], [4, 2], [2, 2], [2.7, 1], [2, 0]]),
  ]);
  expect(left.coordinates[0]).toHaveLength(5); expect(right.coordinates[0]).toHaveLength(5);
});
it('handles reversed input winding, ring-start wraparound and selection order', () => {
  const rotated = polygon([[2, 2], [0, 2], [0, 0], [2, 0], [2, 2]]);
  const clockwise = polygon([...right.coordinates[0]!].reverse());
  expect(prepareSharedBoundary(rotated, clockwise)?.path).toEqual([[2, 0], [2, 2]]);
  const reversed = prepareSharedBoundary(right, left)!;
  expect(reversed.path).toEqual([[2, 2], [2, 0]]);
  expect(updateSharedBoundary(reversed, [[2, 2], [2.7, 1], [2, 0]]).geometries).toEqual(
    updateSharedBoundary(prepareSharedBoundary(left, right)!, [[2, 0], [2.7, 1], [2, 2]]).geometries!.slice().reverse(),
  );
});
it('supports a multi-edge common chain and preserves each original ring start on changed output', () => {
  const a = polygon([[0, 0], [2, 0], [2.5, 1], [2, 2], [0, 2], [0, 0]]);
  const b = polygon([[2.5, 1], [2, 0], [4, 0], [4, 2], [2, 2], [2.5, 1]]);
  const context = prepareSharedBoundary(a, b)!;
  expect(context.path).toEqual([[2, 0], [2.5, 1], [2, 2]]);
  expect(updateSharedBoundary(context, [[2, 0], [2.5, 1], [2.3, 1.5], [2, 2]]).geometries![1].coordinates[0]![0]).toEqual([2.5, 1]);
  expect(updateSharedBoundary(context, [[2, 0], [2, 2]]).error).toBeNull();
});
it('rejects gaps, point contacts, identical inputs, holes and differently segmented shared edges', () => {
  expect(prepareSharedBoundary(left, left)).toBeNull();
  expect(prepareSharedBoundary(left, polygon([[3, 0], [5, 0], [5, 2], [3, 2], [3, 0]]))).toBeNull();
  expect(prepareSharedBoundary(left, polygon([[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]))).toBeNull();
  expect(prepareSharedBoundary(left, { type: 'Polygon', coordinates: [...left.coordinates, [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 0.5]]] })).toBeNull();
  expect(prepareSharedBoundary(left, polygon([[2, 0], [4, 0], [4, 2], [2, 2], [2, 1], [2, 0]]))).toBeNull();
});
it('refuses partial matching chains with a differently segmented continuation', () => {
  const a = polygon([[0, 0], [2, 0], [2, 1], [2, 2], [0, 2], [0, 0]]);
  const b = polygon([[2, 0], [4, 0], [4, 2], [2, 2], [2, 1.5], [2, 1], [2, 0]]);
  expect(prepareSharedBoundary(a, b)).toBeNull();
});
it('rejects disconnected common chains and additional isolated boundary contacts', () => {
  const a = polygon([[0, 0], [2, 0], [2, 1], [1, 2], [2, 3], [2, 4], [0, 4], [0, 0]]);
  const b = polygon([[2, 0], [4, 0], [4, 4], [2, 4], [2, 3], [3, 2], [2, 1], [2, 0]]);
  expect(prepareSharedBoundary(a, b)).toBeNull();
  const touching = polygon([[2, 0], [4, 0], [4, 4], [0, 4], [0, 2], [2, 3], [2, 2], [2, 0]]);
  expect(prepareSharedBoundary(left, touching)).toBeNull();
});
it('rejects invalid routes, fixed-junction changes and overlap while retaining a correctable draft', () => {
  const context = prepareSharedBoundary(left, right)!;
  for (const path of [ [[2, 0], [5, 1], [2, 2]], [[2, 0], [2, 0], [2, 2]], [[1, 0], [2, 2]], [[2, 0], [2, 2], [2, 2]], [[2, 0], [NaN, 1], [2, 2]] ] as Coordinate[][]) {
    expect(updateSharedBoundary(context, path)).toEqual({ geometries: null, error: 'shared-boundary-invalid-result' });
  }
  // A route wrapping around the entire right polygon can leave both individual rings simple,
  // yet make their filled areas overlap. Pair validation must also reject this.
  const around: Coordinate[] = [[2, 0], [2, -1], [5, -1], [5, 3], [2, 3], [2, 2]];
  expect(updateSharedBoundary(context, around)).toEqual({ geometries: null, error: 'shared-boundary-overlap' });
  expect(updateSharedBoundary(context, [[2, 0], [2.5, 1], [2, 2]]).error).toBeNull();
});
it('isolates prepared and returned geometry from input and preview mutation', () => {
  const a = structuredClone(left); const b = structuredClone(right); const context = prepareSharedBoundary(a, b)!;
  a.coordinates.length = 0; b.coordinates[0]![0]![0] = 99;
  const preview = updateSharedBoundary(context, context.path).geometries!; preview[0].coordinates.length = 0;
  expect(updateSharedBoundary(context, context.path).geometries).toEqual([left, right]);
});
