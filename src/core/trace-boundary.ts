import { samePosition } from './polygon.js';
import { projectToEdge } from './boundary-anchor.js';
import type { Coordinate, GeometryFeature, TraceTarget, TraceSide } from './types.js';

/** Read one explicit source path. No transitions between rings, parts or features. */
export function traceSource(feature: GeometryFeature, target: TraceTarget): { points: Coordinate[]; closed: boolean } | null {
  const partIndex = target.partIndex ?? 0; const ringIndex = target.ringIndex ?? 0;
  if (!Number.isInteger(partIndex) || partIndex < 0 || !Number.isInteger(ringIndex) || ringIndex < 0) return null;
  const geometry = feature.geometry;
  const part = geometry.type === 'MultiPolygon' ? geometry.coordinates[partIndex] && { type: 'Polygon' as const, coordinates: geometry.coordinates[partIndex] }
    : geometry.type === 'MultiLineString' ? geometry.coordinates[partIndex] && { type: 'LineString' as const, coordinates: geometry.coordinates[partIndex] }
    : partIndex === 0 ? geometry : undefined;
  if (!part || part.type === 'Point' || part.type === 'LineString' && ringIndex !== 0) return null;
  const points = part.type === 'Polygon' ? part.coordinates[ringIndex] : part.coordinates;
  return points ? { points, closed: part.type === 'Polygon' } : null;
}

interface Anchor { position: number; point: Coordinate }
function attach(points: Coordinate[], coordinate: Coordinate): Anchor | null {
  const tolerance = 64 * Number.EPSILON * Math.max(1, Math.abs(coordinate[0]), Math.abs(coordinate[1]));
  // Only construction roundoff is accepted. Pixel acquisition belongs to the adapter.
  const vertex = points.findIndex((p) => Math.hypot(p[0] - coordinate[0], p[1] - coordinate[1]) <= tolerance);
  if (vertex !== -1) return { position: vertex, point: [...points[vertex]!] };
  let best: Anchor | null = null; let distance = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const projected = projectToEdge(coordinate, points[i]!, points[i + 1]!);
    const delta = Math.hypot(projected.point[0] - coordinate[0], projected.point[1] - coordinate[1]);
    if (delta <= tolerance && delta < distance) { best = { position: i + projected.t, point: projected.point }; distance = delta; }
  }
  return best;
}
const length = (path: Coordinate[]): number => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]), 0);
function compare(a: Coordinate[], b: Coordinate[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const delta = a[i]![0] - b[i]![0] || a[i]![1] - b[i]![1];
    if (delta) return delta;
  }
  return a.length - b.length;
}

/** Trace a validated source path, retaining its exact intervening vertices. */
export function traceBoundary(points: Coordinate[], closed: boolean, from: Coordinate, to: Coordinate, side: TraceSide = 'shorter'): Coordinate[] | null {
  if (side !== 'shorter' && side !== 'longer') throw new TypeError('Unknown trace side.');
  for (const p of [from, to]) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw new RangeError('Expected a finite longitude/latitude position.');
  }
  if (points.length < 2) return null;
  let start = attach(points, from); let end = attach(points, to);
  if (!start || !end || samePosition(start.point, end.point)) return null;
  // Canonical endpoint order makes equal-length ties independent of direction and winding.
  const reverse = start.point[0] > end.point[0] || start.point[0] === end.point[0] && start.point[1] > end.point[1];
  if (reverse) [start, end] = [end, start];
  const forward = (a: Anchor, b: Anchor): Coordinate[] => {
    const n = points.length - 1;
    const stop = closed && b.position < a.position ? b.position + n : b.position;
    const path: Coordinate[] = [[...a.point]];
    for (let i = Math.floor(a.position) + 1; i < stop; i++) path.push([...points[closed ? i % n : i]!]);
    path.push([...b.point]); return path;
  };
  let path: Coordinate[];
  if (!closed) path = start.position < end.position ? forward(start, end) : forward(end, start).reverse();
  else {
    const a = forward(start, end); const b = forward(end, start).reverse();
    const order = length(a) - length(b) || compare(a, b);
    path = (side === 'shorter' ? order <= 0 : order > 0) ? a : b;
  }
  if (reverse) path.reverse();
  // Sources can be lines: preserve their general drawing policy, but do not trace a dateline jump.
  if (path.some((p, i) => i > 0 && Math.abs(p[0] - path[i - 1]![0]) > 180)) return null;
  return path;
}
