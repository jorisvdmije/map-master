import { emptyCutFeedback, markContact } from './cut-feedback.js';
import { orient2d } from 'robust-predicates';
import { boundaryAnchor } from './boundary-anchor.js';
import { closePolygon, openRing, samePosition, validatePolygon, insideRing, ringsIntersect, validatePolygonRings } from './polygon.js';
import type { Coordinate, CutFeedback, SplitError, SplitPreview } from './types.js';

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
export type SplitCalculation = { feedback: CutFeedback } & ({ preview: SplitPreview; error: null } | { preview: null; error: SplitError });

/** Restricted planar splitter: two boundary contacts, including cut endpoint attachments.
 * Input polygon is already validated. Other boundary touches/overlaps are rejected.
 */
export function splitPolygon(closedRing: Coordinate[], coordinates: Coordinate[]): SplitCalculation {
  const feedback = emptyCutFeedback();
  const fail = (error: SplitError): SplitCalculation => ({ preview: null, error, feedback });

  const originalRing = openRing(closedRing);
  const startAnchor = coordinates[0] ? boundaryAnchor(coordinates[0], originalRing) : null;
  const endAnchor = coordinates.length > 1 ? boundaryAnchor(coordinates.at(-1)!, originalRing) : null;
  const cut = coordinates.map((p): Coordinate => [...p]);
  if (startAnchor) cut[0] = startAnchor.point;
  if (endAnchor) cut[cut.length - 1] = endAnchor.point;
  const attachments = [startAnchor, endAnchor].filter((anchor) => anchor !== null);
  feedback.contacts = attachments.map(anchor => anchor.point);
  if (coordinates.length < 2) return fail('split-too-few-points');
  // Make attachments explicit vertices so projection roundoff cannot turn an
  // attached endpoint into a near miss or duplicate intersection.
  const ring: Coordinate[] = [];
  for (let edge = 0; edge < originalRing.length; edge++) {
    ring.push(originalRing[edge]!);
    for (const anchor of attachments.filter((a) => a.edge === edge && a.t > 0 && a.t < 1).sort((a, b) => a.t - b.t)) {
      if (!samePosition(ring.at(-1)!, anchor.point)) ring.push(anchor.point);
    }
  }
  for (let i = 0; i < cut.length - 1; i++) {
    const a = cut[i]!; const b = cut[i + 1]!;
    if (Math.abs(a[0] - b[0]) > 180) { feedback.problemSegments.push([a, b]); return fail('split-antimeridian'); }
    if (samePosition(a, b)) { feedback.problemPoints.push(a); return fail('split-self-intersection'); }
    if (i + 2 < cut.length && (onSegment(a, b, cut[i + 2]!) || onSegment(b, cut[i + 2]!, a))) { markContact(feedback, a, b, b, cut[i + 2]!); return fail('split-self-intersection'); }
    for (let j = i + 2; j < cut.length - 1; j++) {
      if (intersects(a, b, cut[j]!, cut[j + 1]!)) { markContact(feedback, a, b, cut[j]!, cut[j + 1]!); feedback.problemSegments.push([cut[j]!, cut[j + 1]!]); return fail('split-self-intersection'); }
    }
  }
  const hits: Crossing[] = [];
  if (startAnchor) hits.push({ edge: ring.findIndex((p) => samePosition(p, startAnchor.point)), segment: 0, t: 0, u: 0, point: startAnchor.point });
  if (endAnchor) hits.push({ edge: ring.findIndex((p) => samePosition(p, endAnchor.point)), segment: cut.length - 2, t: 1, u: 0, point: endAnchor.point });
  for (let segment = 0; segment < cut.length - 1; segment++) {
    const a = cut[segment]!; const b = cut[segment + 1]!;
    for (let edge = 0; edge < ring.length; edge++) {
      const c = ring[edge]!; const d = ring[(edge + 1) % ring.length]!;
      if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) {
        const atStart = startAnchor !== null && segment === 0 && (samePosition(a, c) || samePosition(a, d));
        const atEnd = endAnchor !== null && segment === cut.length - 2 && (samePosition(b, c) || samePosition(b, d));
        const extraContact = [c, d].some((p) => !samePosition(p, a) && !samePosition(p, b) && onSegment(a, b, p))
          || [a, b].some((p) => !samePosition(p, c) && !samePosition(p, d) && onSegment(c, d, p));
        if (!atStart && !atEnd || extraContact || atStart && atEnd) { markContact(feedback, a, b, c, d); return fail('split-boundary-touch'); }
        continue;
      }
      if (!opposite(orientation(a, b, c), orientation(a, b, d)) || !opposite(orientation(c, d, a), orientation(c, d, b))) continue;
      const rx = b[0] - a[0]; const ry = b[1] - a[1]; const sx = d[0] - c[0]; const sy = d[1] - c[1];
      const denominator = rx * sy - ry * sx;
      const qx = c[0] - a[0]; const qy = c[1] - a[1];
      const t = (qx * sy - qy * sx) / denominator; const u = (qx * ry - qy * rx) / denominator;
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0 || t >= 1 || u <= 0 || u >= 1) return fail('split-invalid-result');
      const point: Coordinate = [c[0] + u * sx, c[1] + u * sy];
      hits.push({ edge, segment, t, u, point }); feedback.contacts.push(point);
    }
  }
  if (!startAnchor && inside(cut[0]!, ring)) feedback.problemPoints.push(cut[0]!);
  if (!endAnchor && inside(cut.at(-1)!, ring)) feedback.problemPoints.push(cut.at(-1)!);
  if (feedback.problemPoints.length) return fail('split-endpoints-inside');
  if (hits.length !== 2) { feedback.problemPoints.push(...feedback.contacts); return fail('split-crossing-count'); }
  hits.sort((a, b) => a.segment - b.segment || a.t - b.t);
  const [entry, exit] = hits as [Crossing, Crossing];
  const interior = cut.slice(entry.segment + 1, exit.segment + 1);
  // Two contacts alone can also describe a path around the outside. Every
  // interval between them must be inside; intermediate contacts were rejected.
  const path = [entry.point, ...interior, exit.point];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!; const b = path[i + 1]!;
    if (!inside([a[0] + (b[0] - a[0]) / 2, a[1] + (b[1] - a[1]) / 2], ring)) { feedback.problemSegments.push([a, b]); return fail('split-invalid-result'); }
  }
  // Insert the two intersections in boundary order, then walk each boundary arc.
  const boundary: Coordinate[] = [];
  let start = -1; let end = -1;
  for (let edge = 0; edge < ring.length; edge++) {
    boundary.push(ring[edge]!);
    for (const hit of hits.filter((hit) => hit.edge === edge).sort((a, b) => a.u - b.u)) {
      const index = hit.u === 0 ? boundary.length - 1 : boundary.length;
      if (hit === entry) start = index; else end = index;
      if (hit.u !== 0) boundary.push(hit.point);
    }
  }
  const arc = (from: number, to: number): Coordinate[] => {
    const result = [boundary[from]!];
    for (let i = (from + 1) % boundary.length; i !== to; i = (i + 1) % boundary.length) result.push(boundary[i]!);
    result.push(boundary[to]!); return result;
  };
  const parts = [arc(start, end).concat([...interior].reverse()), arc(end, start).concat(interior)];
  if (parts.some((part) => validatePolygon(part) !== null)) return fail('split-invalid-result');
  const areas = parts.map(planarArea); const originalArea = planarArea(originalRing);
  if (areas.some((area) => !Number.isFinite(area) || area <= 0)
    || Math.abs(areas[0]! + areas[1]! - originalArea) > originalArea * 1e-10) return fail('split-invalid-result');
  const normalized = parts.map(canonical);
  // Largest area keeps the ID; equal-area ties use the canonical coordinate sequence.
  const retainFirst = areas[0]! > areas[1]! || areas[0] === areas[1] && JSON.stringify(normalized[0]) < JSON.stringify(normalized[1]);
  feedback.contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { feedback, error: null, preview: {
    retained: { type: 'Polygon', coordinates: [normalized[retainFirst ? 0 : 1]!] },
    created: { type: 'Polygon', coordinates: [normalized[retainFirst ? 1 : 0]!] },
  } };
}

/** Preserve holes wholly contained by one result; cutting/touching a hole is unsupported. */
export function splitPolygonRings(rings: Coordinate[][], cut: Coordinate[]): SplitCalculation {
  const result = splitPolygon(rings[0]!, cut);
  const feedback = result.feedback;
  const fail = (error: SplitError): SplitCalculation => ({ preview: null, error, feedback });
  if (!result.preview || rings.length === 1) return result;
  const parts = [result.preview.retained, result.preview.created];
  for (const hole of rings.slice(1)) {
    if (parts.some((part) => ringsIntersect(part.coordinates[0]!, hole))) {
      for (let i = 0; i + 1 < cut.length; i++) {
        for (let j = 0; j + 1 < hole.length; j++) {
          if (intersects(cut[i]!, cut[i + 1]!, hole[j]!, hole[j + 1]!)) markContact(feedback, cut[i]!, cut[i + 1]!, hole[j]!, hole[j + 1]!);
        }
      }
      return fail('split-hole-crossing');
    }
    const target = parts.find((part) => insideRing(hole[0]!, part.coordinates[0]!));
    if (!target) return fail('split-invalid-result');
    target.coordinates.push(hole.map((point) => [...point]));
  }
  if (parts.some((part) => validatePolygonRings(part.coordinates))) return fail('split-invalid-result');
  const areas = parts.map((part) => planarArea(part.coordinates[0]!) - part.coordinates.slice(1).reduce((sum, hole) => sum + planarArea(hole), 0));
  if (areas.some((area) => !Number.isFinite(area) || area <= 0)) return fail('split-invalid-result');
  if (areas[1]! > areas[0]! || areas[0] === areas[1]
    && JSON.stringify(parts[1]!.coordinates[0]) < JSON.stringify(parts[0]!.coordinates[0])) {
    result.preview = { retained: parts[1]!, created: parts[0]! };
  }
  return result;
}
