import { mapGeometry, withGeometry, type Geometry } from './geometry.js';
import { project } from './mercator-transform.js';
import type { Coordinate, GeometryFeature } from './types.js';

const radius = 6378137;
export function validateSimplificationTolerance(meters: number): void {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) throw new TypeError('Expected a finite simplification tolerance in Mercator meters.');
  if (meters < 0) throw new RangeError('Simplification tolerance must be nonnegative.');
}

/** Squared distance to a finite segment, including degenerate/closed endpoints. */
function distanceSquared(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const dx = end[0] - start[0]; const dy = end[1] - start[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length));
  return (point[0] - start[0] - t * dx) ** 2 + (point[1] - start[1] - t * dy) ** 2;
}

/** Iterative Douglas–Peucker. Indices let output retain original coordinates exactly. */
function retain(points: Coordinate[], first: number, last: number, toleranceSquared: number, keep: Uint8Array): void {
  const stack = [first, last]; keep[first] = 1; keep[last] = 1;
  while (stack.length) {
    const end = stack.pop()!; const start = stack.pop()!;
    let farthest = -1; let distance = toleranceSquared;
    for (let i = start + 1; i < end; i++) {
      const candidate = distanceSquared(points[i]!, points[start]!, points[end]!);
      if (candidate > distance) { distance = candidate; farthest = i; }
    }
    if (farthest !== -1) {
      keep[farthest] = 1; stack.push(start, farthest, farthest, end);
    }
  }
}

function simplifyPath(path: Coordinate[], tolerance: number, ring: boolean): Coordinate[] {
  const points = path.map(point => { const [x, y] = project(point); return [x * radius, y * radius] as Coordinate; });
  const keep = new Uint8Array(path.length);
  if (ring) {
    // Anchor the first corner and its farthest corner, then simplify both arcs.
    // Do not silently delete collapsed rings: ordinary transaction validation rejects them.
    let split = 1; let farthest = -1;
    for (let i = 1; i < points.length - 1; i++) {
      const distance = distanceSquared(points[i]!, points[0]!, points[0]!);
      if (distance > farthest) { farthest = distance; split = i; }
    }
    retain(points, 0, split, tolerance * tolerance, keep);
    retain(points, split, points.length - 1, tolerance * tolerance, keep);
  } else retain(points, 0, points.length - 1, tolerance * tolerance, keep);
  return path.filter((_, i) => keep[i]).map(point => [...point]);
}

/** Operates on supported, already validated Mercator input. The caller must validate
 * resulting topology; rings/components are never dropped or repaired here.
 */
export function simplifyFeatures(features: readonly GeometryFeature[], tolerance: number): GeometryFeature[] {
  validateSimplificationTolerance(tolerance);
  const simplify = (geometry: Geometry): Geometry => {
    if (tolerance === 0) return mapGeometry(geometry, point => [...point]);
    switch (geometry.type) {
      case 'LineString': return { type: geometry.type, coordinates: simplifyPath(geometry.coordinates, tolerance, false) };
      case 'MultiLineString': return { type: geometry.type, coordinates: geometry.coordinates.map(path => simplifyPath(path, tolerance, false)) };
      case 'Polygon': return { type: geometry.type, coordinates: geometry.coordinates.map(path => simplifyPath(path, tolerance, true)) };
      case 'MultiPolygon': return { type: geometry.type, coordinates: geometry.coordinates.map(part => part.map(path => simplifyPath(path, tolerance, true))) };
    }
  };
  return features.map(feature => withGeometry(feature, simplify(feature.geometry)));
}
