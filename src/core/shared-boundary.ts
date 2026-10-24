import polygonClipping from 'polygon-clipping';
import { closePolygon, openRing, onSegment, samePosition, segmentsIntersect, validatePolygon } from './polygon.js';
import type { Coordinate, PolygonFeature, SharedBoundaryError } from './types.js';

type Polygon = PolygonFeature['geometry'];
export interface SharedBoundary {
  originals: [Polygon, Polygon];
  path: Coordinate[];
  /** Remaining CCW arcs: end -> start for the first polygon, start -> end for the second. */
  kept: [Coordinate[], Coordinate[]];
}
const key = (point: Coordinate): string => `${point[0]},${point[1]}`;
const edgeKey = (a: Coordinate, b: Coordinate): string => `${key(a)}:${key(b)}`;
const copyPolygon = (geometry: Polygon): Polygon => ({ type: 'Polygon', coordinates: geometry.coordinates.map((ring) => ring.map((p) => [...p])) });
const samePath = (a: Coordinate[], b: Coordinate[]): boolean => a.length === b.length && a.every((p, i) => samePosition(p, b[i]!));
function arc(ring: Coordinate[], start: number, edges: number): Coordinate[] {
  return Array.from({ length: edges + 1 }, (_, i) => [...ring[(start + i) % ring.length]!] as Coordinate);
}

/** Outside the common chain the boundaries may meet only at its two junctions. */
function extraContact(a: Coordinate[], b: Coordinate[]): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const p = a[i]!; const q = a[i + 1]!; const r = b[j]!; const s = b[j + 1]!;
      if (!segmentsIntersect(p, q, r, s)) continue;
      const shared = [p, q].filter((point) => samePosition(point, r) || samePosition(point, s));
      if (shared.length !== 1 || ![a[0]!, a.at(-1)!].some((point) => samePosition(point, shared[0]!))) return true;
      if ([p, q].some((point) => !samePosition(point, shared[0]!) && onSegment(r, s, point))
        || [r, s].some((point) => !samePosition(point, shared[0]!) && onSegment(p, q, point))) return true;
    }
  }
  return false;
}

/** One complete, exactly noded, contiguous boundary between validated single-ring polygons. */
export function prepareSharedBoundary(first: Polygon, second: Polygon): SharedBoundary | null {
  if (first.coordinates.length !== 1 || second.coordinates.length !== 1) return null;
  const a = openRing(closePolygon(first.coordinates[0]!)); const b = openRing(closePolygon(second.coordinates[0]!));
  const reversedEdges = new Map(b.map((p, i) => [edgeKey(b[(i + 1) % b.length]!, p), i]));
  const shared = a.map((p, i) => reversedEdges.get(edgeKey(p, a[(i + 1) % a.length]!)));
  const count = shared.filter((index) => index !== undefined).length;
  if (count === 0 || count === a.length || count === b.length) return null;
  const starts = shared.flatMap((index, i) => index !== undefined && shared[(i + a.length - 1) % a.length] === undefined ? [i] : []);
  if (starts.length !== 1) return null;
  const start = starts[0]!; const end = (start + count) % a.length;
  const secondStart = shared[(end + a.length - 1) % a.length]!;
  const path = arc(a, start, count);
  if (!samePath(path, arc(b, secondStart, count).reverse())) return null;
  const kept: [Coordinate[], Coordinate[]] = [arc(a, end, a.length - count), arc(b, (secondStart + count) % b.length, b.length - count)];
  // Reject partial overlaps/differently segmented continuations and isolated extra contacts.
  if (extraContact(...kept)) return null;
  try { if (polygonClipping.intersection([a], [b]).length) return null; } catch { return null; }
  return { originals: [copyPolygon(first), copyPolygon(second)], path, kept };
}

export function updateSharedBoundary(context: SharedBoundary, path: Coordinate[]): {
  geometries: [Polygon, Polygon] | null; error: SharedBoundaryError | null;
} {
  const fail = (error: SharedBoundaryError) => ({ geometries: null, error });
  if (path.length < 2 || !samePosition(path[0]!, context.path[0]!) || !samePosition(path.at(-1)!, context.path.at(-1)!)
    || path.some((p) => p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) return fail('shared-boundary-invalid-result');
  if (samePath(path, context.path)) return { geometries: context.originals.map(copyPolygon) as [Polygon, Polygon], error: null };
  const rings: [Coordinate[], Coordinate[]] = [path.concat(context.kept[0].slice(1, -1)), [...path].reverse().concat(context.kept[1].slice(1, -1))];
  if (rings.some((ring) => validatePolygon(ring))) return fail('shared-boundary-invalid-result');
  const geometries = rings.map((ring, i): Polygon => {
    const closed = closePolygon(ring); const open = openRing(closed);
    const originalStart = context.originals[i]!.coordinates[0]![0]!;
    const start = open.findIndex((point) => samePosition(point, originalStart));
    const rotated = start < 0 ? open : open.slice(start).concat(open.slice(0, start));
    return { type: 'Polygon', coordinates: [[...rotated, [...rotated[0]!]]] };
  }) as [Polygon, Polygon];
  try {
    if (polygonClipping.intersection(geometries[0].coordinates, geometries[1].coordinates).length) return fail('shared-boundary-overlap');
  } catch { return fail('shared-boundary-calculation-failed'); }
  return { geometries, error: null };
}
