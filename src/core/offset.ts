import { mapGeometry, withGeometry } from './geometry.js';
import { project, unproject, transformPivot } from './mercator-transform.js';
import { onSegment, samePosition, segmentsIntersect } from './polygon.js';
import type { Coordinate, GeometryFeature, OffsetError } from './types.js';

const radius = 6378137;
const worldLimit = Math.PI * radius;
const miterLimit = 4;

export function validateOffsetDistance(meters: number): void {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) throw new TypeError('Expected a finite signed offset distance in Mercator meters.');
}

/** Open, simple path: no zero edges, backtracking, nonadjacent crossings or touches.
 * Sorting segment bounds avoids testing distant pairs, but worst-case work is quadratic.
 */
function simplePath(points: Coordinate[]): boolean {
  if (points.length < 2 || samePosition(points[0]!, points.at(-1)!)) return false;
  const segments = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!; const b = points[i]!;
    if (samePosition(a, b)) return false;
    if (i > 1 && (onSegment(points[i - 2]!, a, b) || onSegment(a, b, points[i - 2]!))) return false;
    segments.push({ a, b, index: i, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) });
  }
  segments.sort((a, b) => a.minX - b.minX);
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!;
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j]!;
      if (b.minX > a.maxX) break;
      if (Math.abs(a.index - b.index) === 1 || b.minY > a.maxY || b.maxY < a.minY) continue;
      if (segmentsIntersect(a.a, a.b, b.a, b.b)) return false;
    }
  }
  return true;
}

const meters = (point: Coordinate): Coordinate => {
  const [x, y] = project(point); return [x * radius, y * radius];
};

/** Whole-selection eligibility; no polygons, closed paths or nonsimple components. */
export function canOffsetFeatures(features: readonly GeometryFeature[]): boolean {
  if (!transformPivot(features)) return false;
  return features.every(feature => {
    if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') return false;
    const paths = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return paths.every(path => simplePath(path) && simplePath(path.map(meters)));
  });
}

function offsetPath(path: Coordinate[], distance: number): { path: Coordinate[]; error: null } | { path: null; error: OffsetError } {
  const origin = meters(path[0]!);
  const points = path.map(point => { const p = meters(point); return [p[0] - origin[0], p[1] - origin[1]] as Coordinate; });
  const directions: Coordinate[] = points.slice(1).map((p, i) => {
    const dx = p[0] - points[i]![0]; const dy = p[1] - points[i]![1]; const length = Math.hypot(dx, dy);
    return [dx / length, dy / length];
  });
  const output: Coordinate[] = [];
  for (let i = 0; i < points.length; i++) {
    const before = directions[Math.max(0, i - 1)]!;
    const after = directions[Math.min(i, directions.length - 1)]!;
    let nx = -before[1]; let ny = before[0];
    if (i > 0 && i < points.length - 1) {
      const denominator = 1 + before[0] * after[0] + before[1] * after[1];
      if (denominator <= 0 || Math.sqrt(2 / denominator) > miterLimit) return { path: null, error: 'offset-join-too-sharp' };
      nx = (-before[1] - after[1]) / denominator;
      ny = (before[0] + after[0]) / denominator;
    }
    const x = points[i]![0] + distance * nx; const y = points[i]![1] + distance * ny;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x + origin[0]) > worldLimit || Math.abs(y + origin[1]) > worldLimit) {
      return { path: null, error: 'offset-out-of-bounds' };
    }
    output.push([x, y]);
  }
  // A large inward offset may invert or eliminate a segment. Never silently trim it away.
  for (let i = 1; i < output.length; i++) {
    const a = output[i - 1]!; const b = output[i]!; const direction = directions[i - 1]!;
    if ((b[0] - a[0]) * direction[0] + (b[1] - a[1]) * direction[1] <= 0) return { path: null, error: 'offset-invalid-result' };
  }
  if (!simplePath(output)) return { path: null, error: 'offset-invalid-result' };
  const geographic = output.map(([x, y]) => unproject([(x + origin[0]) / radius, (y + origin[1]) / radius]));
  // GeoJSON segments are straight in lon/lat; validate that representation too.
  if (!simplePath(geographic) || geographic.some((p, i) => i > 0 && Math.abs(p[0] - geographic[i - 1]![0]) > 180)) {
    return { path: null, error: 'offset-invalid-result' };
  }
  return { path: geographic, error: null };
}

/** Offset supported, already validated originals. Preserves wrappers, order and direction. */
export function offsetFeatures(features: readonly GeometryFeature[], distance: number): { preview: GeometryFeature[] | null; error: OffsetError | null } {
  validateOffsetDistance(distance);
  if (distance === 0) return { preview: features.map(f => withGeometry(f, mapGeometry(f.geometry, p => [...p]))), error: null };
  const preview: GeometryFeature[] = [];
  for (const feature of features) {
    if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') throw new TypeError('Offset requires line features.');
    const paths = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const coordinates: Coordinate[][] = [];
    for (const path of paths) {
      const result = offsetPath(path, distance);
      if (!result.path) return { preview: null, error: result.error };
      coordinates.push(result.path);
    }
    preview.push(withGeometry(feature, feature.geometry.type === 'LineString'
      ? { type: 'LineString', coordinates: coordinates[0]! } : { type: 'MultiLineString', coordinates }));
  }
  return { preview, error: null };
}
