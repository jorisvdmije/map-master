import { orient2d } from 'robust-predicates';
import type { Coordinate, ValidationError } from './types.js';

export const samePosition = (a: Coordinate, b: Coordinate): boolean => a[0] === b[0] && a[1] === b[1];
const orientation = (a: Coordinate, b: Coordinate, c: Coordinate): number =>
  orient2d(a[0], a[1], b[0], b[1], c[0], c[1]);

/** Accept an explicit closing position without counting it as another vertex. */
export function openRing(points: readonly Coordinate[]): Coordinate[] {
  const first = points[0];
  const last = points.at(-1);
  const ring = first && last && points.length > 1 && samePosition(first, last)
    ? points.slice(0, -1) : points;
  return ring.map(([lng, lat]) => [lng, lat]);
}

function onSegment(a: Coordinate, b: Coordinate, point: Coordinate): boolean {
  return orientation(a, b, point) === 0
    && point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0])
    && point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1]);
}

function intersects(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC === 0 && onSegment(a, b, c) || abD === 0 && onSegment(a, b, d)
    || cdA === 0 && onSegment(c, d, a) || cdB === 0 && onSegment(c, d, b)) return true;
  return (abC > 0 && abD < 0 || abC < 0 && abD > 0)
    && (cdA > 0 && cdB < 0 || cdA < 0 && cdB > 0);
}

/** Validate a simple planar ring. Input positions are validated by DrawingSession. */
export function validatePolygon(points: readonly Coordinate[]): ValidationError | null {
  const ring = openRing(points);
  if (ring.length < 3) return 'too-few-vertices';
  if (new Set(ring.map(([lng, lat]) => `${lng},${lat}`)).size !== ring.length) {
    return 'duplicate-vertex';
  }
  // All indexes below refer to a ring with at least three vertices.
  const at = (index: number): Coordinate => ring[(index + ring.length) % ring.length]!;
  for (let i = 0; i < ring.length; i++) {
    if (Math.abs(at(i)[0] - at(i + 1)[0]) > 180) return 'antimeridian-crossing';
  }
  if (ring.every((point) => orientation(at(0), at(1), point) === 0)) return 'zero-area';
  for (let i = 0; i < ring.length; i++) {
    const a = at(i);
    const b = at(i + 1);
    const c = at(i + 2);
    // Adjacent edges may share an endpoint, but may not double back and overlap.
    if (onSegment(a, b, c) || onSegment(b, c, a)) return 'self-intersection';
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      if (intersects(a, b, at(j), at(j + 1))) return 'self-intersection';
    }
  }
  return null;
}

/** Close a validated ring: CCW exterior by default, clockwise for holes. */
export function closePolygon(points: readonly Coordinate[], clockwise = false): Coordinate[] {
  const ring = openRing(points);
  if (ring.length < 3) throw new Error('Expected a validated polygon ring.');
  // A simple ring's lexicographically lowest vertex is convex. Its robust local
  // orientation determines winding without cancellation in a global area sum.
  let lowest = 0;
  for (let i = 1; i < ring.length; i++) {
    const point = ring[i]!;
    const candidate = ring[lowest]!;
    if (point[0] < candidate[0] || point[0] === candidate[0] && point[1] < candidate[1]) lowest = i;
  }
  const previous = ring[(lowest + ring.length - 1) % ring.length]!;
  const next = ring[(lowest + 1) % ring.length]!;
  // robust-predicates uses screen-y-down signs; positive means clockwise in lon/lat.
  if ((orientation(previous, ring[lowest]!, next) > 0) !== clockwise) {
    // Retain the user's first vertex while reversing traversal.
    ring.splice(1, ring.length - 1, ...ring.slice(1).reverse());
  }
  const first = ring[0]!;
  ring.push([first[0], first[1]]);
  return ring;
}

/** Strict interior test using robust orientation; boundary points are outside. */
export function insideRing(point: Coordinate, points: readonly Coordinate[]): boolean {
  const ring = openRing(points);
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!; const b = ring[(i + 1) % ring.length]!;
    if (onSegment(a, b, point)) return false;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && (orientation(a, b, point) < 0) === (b[1] > a[1])) inside = !inside;
  }
  return inside;
}

/** Includes touching and overlapping boundaries, not just proper crossings. */
export function ringsIntersect(first: readonly Coordinate[], second: readonly Coordinate[]): boolean {
  const a = openRing(first); const b = openRing(second);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (intersects(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return false;
}

interface RingBounds { minX: number; minY: number; maxX: number; maxY: number }
function ringBounds(ring: readonly Coordinate[]): RingBounds {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of ring) {
    bounds.minX = Math.min(bounds.minX, x); bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x); bounds.maxY = Math.max(bounds.maxY, y);
  }
  return bounds;
}
function overlap(a: RingBounds, b: RingBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Exterior followed by disjoint, strictly contained holes. No nested holes. */
export function validatePolygonRings(rings: readonly Coordinate[][]): ValidationError | null {
  if (rings.length === 0) return 'too-few-vertices';
  for (const ring of rings) {
    const error = validatePolygon(ring);
    if (error) return error;
  }
  const bounds = rings.map(ringBounds);
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i]!;
    if (ringsIntersect(rings[0]!, hole)) return 'ring-intersection';
    if (!insideRing(hole[0]!, rings[0]!)) return 'hole-outside';
    for (let j = 1; j < i; j++) {
      // Disjoint extents cannot touch or contain each other. Include equality
      // so boundary touches still reach the robust geometry checks.
      if (!overlap(bounds[i]!, bounds[j]!)) continue;
      const other = rings[j]!;
      if (ringsIntersect(other, hole)) return 'ring-intersection';
      if (insideRing(hole[0]!, other) || insideRing(other[0]!, hole)) return 'nested-holes';
    }
  }
  return null;
}
