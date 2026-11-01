import { geometryParts } from './geometry.js';
import { insideRing, onSegment, openRing, samePosition, segmentsIntersect, validatePolygon } from './polygon.js';
import type { Coordinate, GeometryFeature, LassoOptions, ValidationError } from './types.js';

function isArray(value: unknown): boolean { return Array.isArray(value); }

/** Resolve selection settings before changing any state. */
export function lassoOptions(update: Partial<LassoOptions> = {}, previous?: LassoOptions): LassoOptions {
  if (!update || typeof update !== 'object' || Array.isArray(update)) throw new TypeError('Expected lasso options.');
  const result = { operation: update.operation ?? previous?.operation ?? 'replace', match: update.match ?? previous?.match ?? 'intersects' };
  if (!['replace', 'add', 'subtract'].includes(result.operation)) throw new TypeError('Unknown lasso selection operation.');
  if (!['intersects', 'contains'].includes(result.match)) throw new TypeError('Unknown lasso selection match.');
  return result;
}

/** A finite simple screen-space ring, with an optional closing copy. */
export function prepareLasso(points: readonly Coordinate[]): { ring: Coordinate[]; error: ValidationError | null } {
  if (!isArray(points) || points.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((value) => !Number.isFinite(value)))) {
    throw new TypeError('Expected finite lasso coordinates.');
  }
  if (points.length > 2048) throw new RangeError('A lasso may contain at most 2048 positions.');
  const ring = openRing(points.filter((point, index) => index === 0 || !samePosition(point, points[index - 1]!)));
  if (ring.length < 3) return { ring, error: 'too-few-vertices' };
  // The polygon validator also checks longitude jumps. Normalize pixels to a unit
  // square so that check does not mistake a wide screen loop for an antimeridian cut.
  const bounds = extent(ring);
  const scale = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
  if (!Number.isFinite(scale)) throw new RangeError('The lasso extent is too large.');
  const normalized = ring.map(([x, y]): Coordinate => [(x - bounds.minX) / scale, (y - bounds.minY) / scale]);
  return { ring, error: validatePolygon(normalized) };
}

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
function extent(points: readonly Coordinate[]): Bounds {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  }
  return bounds;
}
const overlaps = (a: Bounds, b: Bounds): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const edges = (ring: readonly Coordinate[]): [Coordinate, Coordinate][] => ring.map((point, index) => [point, ring[(index + 1) % ring.length]!]);

/** Geometry coordinates are already projected into the same plane as the prepared ring.
 * Marker radii and line widths do not enlarge the selection. Boundaries count as inside.
 */
export function lassoMatcher(ring: readonly Coordinate[], match: LassoOptions['match']): (geometry: GeometryFeature['geometry']) => boolean {
  const boundary = edges(ring);
  const bounds = extent(ring);
  const inside = (point: Coordinate): boolean => boundary.some(([a, b]) => onSegment(a, b, point)) || insideRing(point, ring);
  const segmentInside = (a: Coordinate, b: Coordinate): boolean => {
    if (!inside(a) || !inside(b)) return false;
    if (samePosition(a, b)) return true;
    // Endpoints alone do not prove containment in a concave polygon. Check each
    // interval between boundary crossings, including collinear boundary contacts.
    const rx = b[0] - a[0]; const ry = b[1] - a[1]; const length2 = rx * rx + ry * ry;
    const parameters = [0, 1];
    for (const [c, d] of boundary) {
      if (!segmentsIntersect(a, b, c, d)) continue;
      const sx = d[0] - c[0]; const sy = d[1] - c[1];
      const denominator = rx * sy - ry * sx;
      if (denominator !== 0) {
        const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denominator;
        if (!Number.isFinite(t)) return false;
        if (t > 0 && t < 1) parameters.push(t);
      } else {
        for (const point of [c, d]) if (onSegment(a, b, point)) {
          parameters.push(((point[0] - a[0]) * rx + (point[1] - a[1]) * ry) / length2);
        }
      }
    }
    parameters.sort((a, b) => a - b);
    return parameters.slice(1).every((t, index) => {
      const middle = (parameters[index]! + t) / 2;
      return inside([a[0] + middle * rx, a[1] + middle * ry]);
    });
  };
  const lineMatches = (points: Coordinate[]): boolean => {
    if (!overlaps(bounds, extent(points))) return false;
    if (match === 'contains') return points.slice(1).every((point, index) => segmentInside(points[index]!, point));
    return points.some(inside) || points.slice(1).some((point, index) => boundary.some(([a, b]) => segmentsIntersect(points[index]!, point, a, b)));
  };
  return (geometry) => {
    const matches = geometryParts(geometry).map((part) => {
      if (part.type === 'Point') return inside(part.coordinates);
      if (part.type === 'LineString') return lineMatches(part.coordinates);
      const [outer, ...holes] = part.coordinates;
      if (!outer || !overlaps(bounds, extent(outer))) return false;
      if (match === 'contains') return lineMatches(outer);
      return part.coordinates.some(lineMatches) || ring.some((point) => insideRing(point, outer) && !holes.some((hole) => insideRing(point, hole)));
    });
    return match === 'contains' ? matches.every(Boolean) : matches.some(Boolean);
  };
}
