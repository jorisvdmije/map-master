import { orient2d } from 'robust-predicates';
import { closePolygon, openRing, samePosition, validatePolygon } from './polygon.js';
import type { Coordinate, SplitError, SplitPreview } from './types.js';

const orientation = (a: Coordinate, b: Coordinate, c: Coordinate): number => orient2d(...a, ...b, ...c);
const opposite = (a: number, b: number): boolean => a < 0 && b > 0 || a > 0 && b < 0;
function onSegment(a: Coordinate, b: Coordinate, p: Coordinate): boolean {
  return orientation(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0])
    && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}
function intersects(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
    || opposite(orientation(a, b, c), orientation(a, b, d)) && opposite(orientation(c, d, a), orientation(c, d, b));
}
function inside(point: Coordinate, ring: Coordinate[]): boolean {
  let winding = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!; const b = ring[(i + 1) % ring.length]!;
    if (a[1] <= point[1] && b[1] > point[1] && orientation(a, b, point) < 0) winding++;
    if (a[1] > point[1] && b[1] <= point[1] && orientation(a, b, point) > 0) winding--;
  }
  return winding !== 0;
}
/** Translated shoelace area in square coordinate units; not a geodesic measurement. */
export function planarArea(ring: Coordinate[]): number {
  const origin = ring[0]!;
  let area = 0;
  for (let i = 1; i + 1 < ring.length; i++) {
    const a = ring[i]!; const b = ring[i + 1]!;
    area += (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
  }
  return Math.abs(area) / 2;
}
function canonical(points: Coordinate[]): Coordinate[] {
  const ring = openRing(closePolygon(points));
  let first = 0;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i]![0] < ring[first]![0] || ring[i]![0] === ring[first]![0] && ring[i]![1] < ring[first]![1]) first = i;
  }
  const result = [...ring.slice(first), ...ring.slice(0, first)];
  return [...result, [...result[0]!] as Coordinate];
}
interface Crossing { edge: number; segment: number; t: number; u: number; point: Coordinate }
export type SplitCalculation = { preview: SplitPreview; error: null } | { preview: null; error: SplitError };
const fail = (error: SplitError): SplitCalculation => ({ preview: null, error });

/** Restricted planar splitter: a simple outside-to-outside cut, two proper edge crossings.
 * Input polygon is already validated. Boundary touches/overlaps are explicitly rejected.
 */
export function splitPolygon(closedRing: Coordinate[], cut: Coordinate[]): SplitCalculation {
  if (cut.length < 2) return fail('split-too-few-points');
  const ring = openRing(closedRing);
  for (let i = 0; i < cut.length - 1; i++) {
    const a = cut[i]!; const b = cut[i + 1]!;
    if (Math.abs(a[0] - b[0]) > 180) return fail('split-antimeridian');
    if (samePosition(a, b)) return fail('split-self-intersection');
    if (i + 2 < cut.length && (onSegment(a, b, cut[i + 2]!) || onSegment(b, cut[i + 2]!, a))) return fail('split-self-intersection');
    for (let j = i + 2; j < cut.length - 1; j++) {
      if (intersects(a, b, cut[j]!, cut[j + 1]!)) return fail('split-self-intersection');
    }
  }
  const hits: Crossing[] = [];
  for (let segment = 0; segment < cut.length - 1; segment++) {
    const a = cut[segment]!; const b = cut[segment + 1]!;
    for (let edge = 0; edge < ring.length; edge++) {
      const c = ring[edge]!; const d = ring[(edge + 1) % ring.length]!;
      if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return fail('split-boundary-touch');
      if (!opposite(orientation(a, b, c), orientation(a, b, d)) || !opposite(orientation(c, d, a), orientation(c, d, b))) continue;
      const rx = b[0] - a[0]; const ry = b[1] - a[1]; const sx = d[0] - c[0]; const sy = d[1] - c[1];
      const denominator = rx * sy - ry * sx;
      const qx = c[0] - a[0]; const qy = c[1] - a[1];
      const t = (qx * sy - qy * sx) / denominator; const u = (qx * ry - qy * rx) / denominator;
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0 || t >= 1 || u <= 0 || u >= 1) return fail('split-invalid-result');
      hits.push({ edge, segment, t, u, point: [c[0] + u * sx, c[1] + u * sy] });
    }
  }
  if (inside(cut[0]!, ring) || inside(cut.at(-1)!, ring)) return fail('split-endpoints-inside');
  if (hits.length !== 2) return fail('split-crossing-count');
  hits.sort((a, b) => a.segment - b.segment || a.t - b.t);
  const [entry, exit] = hits as [Crossing, Crossing];
  const interior = cut.slice(entry.segment + 1, exit.segment + 1);
  // Insert the two intersections in boundary order, then walk each boundary arc.
  const boundary: Coordinate[] = [];
  let start = -1; let end = -1;
  for (let edge = 0; edge < ring.length; edge++) {
    boundary.push(ring[edge]!);
    for (const hit of hits.filter((hit) => hit.edge === edge).sort((a, b) => a.u - b.u)) {
      if (hit === entry) start = boundary.length; else end = boundary.length;
      boundary.push(hit.point);
    }
  }
  const arc = (from: number, to: number): Coordinate[] => {
    const result = [boundary[from]!];
    for (let i = (from + 1) % boundary.length; i !== to; i = (i + 1) % boundary.length) result.push(boundary[i]!);
    result.push(boundary[to]!); return result;
  };
  const parts = [arc(start, end).concat([...interior].reverse()), arc(end, start).concat(interior)];
  if (parts.some((part) => validatePolygon(part) !== null)) return fail('split-invalid-result');
  const areas = parts.map(planarArea); const originalArea = planarArea(ring);
  if (areas.some((area) => !Number.isFinite(area) || area <= 0)
    || Math.abs(areas[0]! + areas[1]! - originalArea) > originalArea * 1e-10) return fail('split-invalid-result');
  const normalized = parts.map(canonical);
  // Largest area keeps the ID; equal-area ties use the canonical coordinate sequence.
  const retainFirst = areas[0]! > areas[1]! || areas[0] === areas[1] && JSON.stringify(normalized[0]) < JSON.stringify(normalized[1]);
  return { error: null, preview: {
    retained: { type: 'Polygon', coordinates: [normalized[retainFirst ? 0 : 1]!] },
    created: { type: 'Polygon', coordinates: [normalized[retainFirst ? 1 : 0]!] },
  } };
}
