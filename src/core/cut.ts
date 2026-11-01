import { differencePolygons } from './difference.js';
import { geometryParts, type Geometry } from './geometry.js';
import { closePolygon, insideRing, onSegment, openRing, samePosition } from './polygon.js';
import type { Coordinate } from './types.js';

export type CutResult = { geometry: Geometry | null; error: null } | { geometry: null; error: 'cut-failed' };

type Bounds = [number, number, number, number];
function bounds(points: readonly Coordinate[]): Bounds {
  const box: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
  }
  return box;
}
const overlaps = (a: Bounds, b: Bounds): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function geometryPoints(geometry: Geometry): Coordinate[] {
  return geometryParts(geometry).flatMap((part) => part.type === 'Point' ? [part.coordinates]
    : part.type === 'LineString' ? part.coordinates : part.coordinates.flat());
}

const cross = (a: Coordinate, b: Coordinate): number => a[0] * b[1] - a[1] * b[0];
const lerp = (a: Coordinate, b: Coordinate, t: number): Coordinate => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Positions along segment ab (0..1) where it meets the ring's boundary, including overlaps. */
function crossings(a: Coordinate, b: Coordinate, ring: readonly Coordinate[]): number[] {
  const r: Coordinate = [b[0] - a[0], b[1] - a[1]];
  const lengthSquared = r[0] * r[0] + r[1] * r[1];
  const result: number[] = [];
  for (let index = 0; index < ring.length; index++) {
    const c = ring[index]!; const d = ring[(index + 1) % ring.length]!;
    const s: Coordinate = [d[0] - c[0], d[1] - c[1]];
    const offset: Coordinate = [c[0] - a[0], c[1] - a[1]];
    const denominator = cross(r, s);
    if (denominator === 0) {
      // Collinear overlap: split where the ring edge starts and ends along ab.
      if (cross(offset, r) !== 0 || lengthSquared === 0) continue;
      for (const point of [c, d]) {
        const t = ((point[0] - a[0]) * r[0] + (point[1] - a[1]) * r[1]) / lengthSquared;
        if (t > 0 && t < 1) result.push(t);
      }
      continue;
    }
    const t = cross(offset, s) / denominator;
    const u = cross(offset, r) / denominator;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) result.push(t);
  }
  return result.sort((x, y) => x - y);
}

/** Keep the parts of a path outside the cutting ring. Boundary contact is outside. */
function clipPath(points: readonly Coordinate[], ring: readonly Coordinate[]): Coordinate[][] {
  const pieces: Coordinate[][] = [];
  let current: Coordinate[] = [];
  let removed = false;
  const close = (): void => { if (current.length >= 2) pieces.push(current); current = []; };
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!; const b = points[index]!;
    const stops = [0, ...crossings(a, b, ring), 1];
    for (let step = 1; step < stops.length; step++) {
      if (stops[step] === stops[step - 1]) continue;
      const from = stops[step - 1] === 0 ? a : lerp(a, b, stops[step - 1]!);
      const to = stops[step] === 1 ? b : lerp(a, b, stops[step]!);
      const middle = lerp(from, to, 0.5);
      const onBoundary = ring.some((point, i) => onSegment(point, ring[(i + 1) % ring.length]!, middle));
      if (!onBoundary && insideRing(middle, ring)) { removed = true; close(); continue; }
      if (!current.length) current.push(from);
      else if (!samePosition(current.at(-1)!, from)) { close(); current.push(from); }
      if (!samePosition(current.at(-1)!, to)) current.push(to);
    }
  }
  close();
  // Untouched paths keep their exact vertices, without split points along the boundary.
  return removed ? pieces : [points.map(([x, y]) => [x, y])];
}

/**
 * Remove the area of a simple cutting polygon from a geometry. Polygons lose the
 * overlapping area, lines lose the parts inside the polygon, and markers are unchanged.
 * Returns the unchanged input when nothing overlaps, and null geometry when nothing remains.
 */
export function cutGeometry(geometry: Geometry, cutter: readonly Coordinate[]): CutResult {
  const ring = openRing(cutter);
  if (geometry.type === 'Point' || !overlaps(bounds(ring), bounds(geometryPoints(geometry)))) return { geometry, error: null };
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    const { preview, error } = differencePolygons(geometry, [{ type: 'Polygon', coordinates: [closePolygon(ring)] }]);
    return error || !preview ? { geometry: null, error: 'cut-failed' } : { geometry: preview.geometry, error: null };
  }
  const paths = geometryParts(geometry).flatMap((part) => part.type === 'LineString' ? clipPath(part.coordinates, ring) : []);
  if (!paths.length) return { geometry: null, error: null };
  if (paths.some((path) => path.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)))) return { geometry: null, error: 'cut-failed' };
  const unchanged = JSON.stringify(geometryParts(geometry).map((part) => part.coordinates)) === JSON.stringify(paths);
  if (unchanged) return { geometry, error: null };
  return { geometry: paths.length === 1 && geometry.type === 'LineString' ? { type: 'LineString', coordinates: paths[0]! }
    : { type: 'MultiLineString', coordinates: paths }, error: null };
}
