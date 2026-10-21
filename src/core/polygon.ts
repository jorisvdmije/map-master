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

/** Validate a simple planar outer ring. Input positions are validated by DrawingSession. */
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

/** Close an already validated ring and normalize its exterior winding to CCW. */
export function closePolygon(points: readonly Coordinate[]): Coordinate[] {
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
  if (orientation(previous, ring[lowest]!, next) > 0) {
    // Retain the user's first vertex while reversing traversal.
    ring.splice(1, ring.length - 1, ...ring.slice(1).reverse());
  }
  const first = ring[0]!;
  ring.push([first[0], first[1]]);
  return ring;
}
