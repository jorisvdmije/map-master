import polygonClipping from 'polygon-clipping';
import { orient2d } from 'robust-predicates';
import { geometryParts, withGeometry } from './geometry.js';
import { project, unproject, transformPivot } from './mercator-transform.js';
import { normalizeOverlay } from './polygon-overlay.js';
import type { BufferError, Coordinate, GeometryFeature } from './types.js';

const radius = 6378137;
const worldLimit = Math.PI * radius;
// One fixed, inscribed 32-gon approximates a disk for every segment and join.
const disk: Coordinate[] = Array.from({ length: 32 }, (_, i) => {
  const angle = i * Math.PI / 16;
  const clean = (n: number) => Math.abs(n) < 1e-15 ? 0 : n;
  return [clean(Math.cos(angle)), clean(Math.sin(angle))];
});

export function validateBufferDistance(meters: number): void {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) throw new TypeError('Expected a finite buffer distance in Mercator meters.');
  if (meters <= 0) throw new RangeError('Buffer distance must be positive.');
}

/** Convex hull of the disk translated to both segment endpoints: a polygonal capsule. */
function capsule(a: Coordinate, b: Coordinate, distance: number): Coordinate[] | null {
  const points = [a, b].flatMap(([x, y]) => disk.map(([dx, dy]): Coordinate => [x + dx * distance, y + dy * distance]))
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const half = (ordered: Coordinate[]): Coordinate[] => {
    const result: Coordinate[] = [];
    for (const point of ordered) {
      while (result.length > 1) {
        const first = result[result.length - 2]!; const second = result[result.length - 1]!;
        if (orient2d(first[0], first[1], second[0], second[1], point[0], point[1]) < 0) break;
        result.pop();
      }
      result.push(point);
    }
    result.pop(); return result;
  };
  const ring = [...half(points), ...half([...points].reverse())];
  if (ring.length < 3) return null;
  ring.push([...ring[0]!]); return ring;
}

/** Dissolve nearby path pieces before overlaying the complete feature. This keeps
 * many almost-identical capsule interiors out of one large sweep-line operation.
 * Group count shrinks even when the resulting components remain disjoint.
 */
function unionPieces(pieces: Coordinate[][][]): Coordinate[][][] {
  let groups = pieces.map(piece => [piece]);
  while (groups.length > 32) {
    const next: Coordinate[][][][] = [];
    for (let i = 0; i < groups.length; i += 32) next.push(polygonClipping.union(groups.slice(i, i + 32).flat()));
    groups = next;
  }
  return polygonClipping.union(groups.flat());
}

/** Positive dilation of each feature independently. Caller validates normalized candidates
 * through the transaction boundary before exposing a preview or committing.
 */
export function bufferFeatures(features: readonly GeometryFeature[], distance: number): {
  preview: GeometryFeature[] | null; error: BufferError | null;
} {
  validateBufferDistance(distance);
  const preview: GeometryFeature[] = [];
  for (const feature of features) {
    const pivot = transformPivot([feature]);
    if (!pivot) return { preview: null, error: 'buffer-out-of-bounds' };
    const origin = project(pivot).map(n => n * radius) as Coordinate;
    const pieces: Coordinate[][][] = [];
    for (const part of geometryParts(feature.geometry)) {
      const paths = (part.type === 'Polygon' ? part.coordinates : [part.coordinates])
        .map(path => path.map(point => {
          const [x, y] = project(point); return [x * radius - origin[0], y * radius - origin[1]] as Coordinate;
        }));
      // The full circular envelope must fit the supported world, before expensive overlay work.
      if (paths.some(path => path.some(([x, y]) => Math.abs(x + origin[0]) + distance > worldLimit
        || Math.abs(y + origin[1]) + distance > worldLimit))) return { preview: null, error: 'buffer-out-of-bounds' };
      if (part.type === 'Polygon') pieces.push(paths);
      for (const path of paths) {
        for (let i = 1; i < path.length; i++) {
          const ring = capsule(path[i - 1]!, path[i]!, distance);
          if (!ring) return { preview: null, error: 'buffer-invalid-result' };
          pieces.push([ring]);
        }
      }
    }
    let merged: Coordinate[][][];
    try {
      // MultiPolygon arguments avoid unbounded argument spreading. Original polygon interiors
      // plus all boundary capsules produce outward growth, including shrinking/filling holes.
      merged = unionPieces(pieces);
    } catch {
      return { preview: null, error: 'buffer-failed' };
    }
    const geographic = merged.map(part => part.map(ring => ring.map(([x, y]) =>
      unproject([(x + origin[0]) / radius, (y + origin[1]) / radius]))));
    const geometry = normalizeOverlay(geographic);
    if (!geometry) return { preview: null, error: 'buffer-invalid-result' };
    preview.push(withGeometry(feature, geometry));
  }
  return { preview, error: null };
}
