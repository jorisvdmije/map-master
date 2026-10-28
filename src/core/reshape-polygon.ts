import { emptyCutFeedback, markContact } from './cut-feedback.js';
import { boundaryAnchor } from './boundary-anchor.js';
import { orient2d } from 'robust-predicates';
import { closePolygon, openRing, samePosition, validatePolygon } from './polygon.js';
import type { Coordinate, CutFeedback, ReshapeError, ReshapePreview, ReshapeSide } from './types.js';

const orientation = (a: Coordinate, b: Coordinate, c: Coordinate): number => orient2d(...a, ...b, ...c);
const opposite = (a: number, b: number): boolean => a < 0 && b > 0 || a > 0 && b < 0;
const onSegment = (a: Coordinate, b: Coordinate, p: Coordinate): boolean => orientation(a, b, p) === 0
  && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
const intersects = (a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean =>
  onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
  || opposite(orientation(a, b, c), orientation(a, b, d)) && opposite(orientation(c, d, a), orientation(c, d, b));

export type ReshapeCalculation = { feedback: CutFeedback } & ({ preview: ReshapePreview; error: null } | { preview: null; error: ReshapeError });
const length = (path: Coordinate[]): number => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]), 0);

/** Replace one boundary arc of a validated single-ring polygon. No input mutation. */
export function reshapePolygon(closedRing: Coordinate[], coordinates: Coordinate[], side: ReshapeSide = 'shorter'): ReshapeCalculation {
  const feedback = emptyCutFeedback();
  const fail = (error: ReshapeError): ReshapeCalculation => ({ preview: null, error, feedback });
  if (side !== 'shorter' && side !== 'longer') throw new TypeError('Unknown reshape side.');
  if (coordinates.some((p) => p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])
    || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) return fail('reshape-invalid-result');

  const ring = openRing(closePolygon(closedRing));
  let start = coordinates[0] ? boundaryAnchor(coordinates[0], ring) : null; let end = coordinates.length > 1 ? boundaryAnchor(coordinates.at(-1)!, ring) : null;
  feedback.contacts = [start, end].flatMap(anchor => anchor ? [anchor.point] : []);
  if (coordinates.length < 2) return fail('reshape-too-few-points');
  if (!start || !end) {
    if (!start) feedback.problemPoints.push(coordinates[0]!);
    if (!end) feedback.problemPoints.push(coordinates.at(-1)!);
    return fail('reshape-endpoints-off-boundary');
  }
  if (samePosition(start.point, end.point)) { feedback.problemPoints.push(start.point); return fail('reshape-same-endpoint'); }
  let path = coordinates.map((p): Coordinate => [...p]); path[0] = start.point; path[path.length - 1] = end.point;
  // Canonical endpoint order makes equal-length ties independent of path direction.
  if (start.point[0] > end.point[0] || start.point[0] === end.point[0] && start.point[1] > end.point[1]) {
    [start, end] = [end, start]; path = path.reverse();
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!; const b = path[i + 1]!;
    if (Math.abs(a[0] - b[0]) > 180) { feedback.problemSegments.push([a, b]); return fail('reshape-antimeridian'); }
    if (samePosition(a, b)) { feedback.problemPoints.push(a); return fail('reshape-self-intersection'); }
    if (i + 2 < path.length && (onSegment(a, b, path[i + 2]!) || onSegment(b, path[i + 2]!, a))) { markContact(feedback, a, b, b, path[i + 2]!); return fail('reshape-self-intersection'); }
    for (let j = i + 2; j < path.length - 1; j++) {
      if (intersects(a, b, path[j]!, path[j + 1]!)) { markContact(feedback, a, b, path[j]!, path[j + 1]!); feedback.problemSegments.push([path[j]!, path[j + 1]!]); return fail('reshape-self-intersection'); }
    }
  }
  const boundary: Coordinate[] = [];
  for (let edge = 0; edge < ring.length; edge++) {
    boundary.push(ring[edge]!);
    for (const hit of [start, end].filter((hit) => hit.edge === edge && hit.t > 0 && hit.t < 1).sort((a, b) => a.t - b.t)) boundary.push(hit.point);
  }
  // Endpoints are explicit boundary vertices, avoiding brittle collinearity tests
  // against the original unsplit edge after floating-point projection.
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!; const b = path[i + 1]!;
    for (let j = 0; j < boundary.length; j++) {
      const c = boundary[j]!; const d = boundary[(j + 1) % boundary.length]!;
      if (!intersects(a, b, c, d)) continue;
      const atStart = i === 0 && (samePosition(a, c) || samePosition(a, d));
      const atEnd = i === path.length - 2 && (samePosition(b, c) || samePosition(b, d));
      // Meeting at the two attachments is allowed; following any boundary is not.
      const extraContact = [c, d].some((p) => !samePosition(p, a) && !samePosition(p, b) && onSegment(a, b, p))
        || [a, b].some((p) => !samePosition(p, c) && !samePosition(p, d) && onSegment(c, d, p));
      if (!atStart && !atEnd || extraContact || atStart && atEnd) { markContact(feedback, a, b, c, d); return fail('reshape-boundary-touch'); }
    }
  }
  const startIndex = boundary.findIndex((p) => samePosition(p, start.point));
  const endIndex = boundary.findIndex((p) => samePosition(p, end.point));
  const arc = (from: number, to: number): Coordinate[] => {
    const points = [boundary[from]!];
    for (let i = (from + 1) % boundary.length; i !== to; i = (i + 1) % boundary.length) points.push(boundary[i]!);
    return [...points, boundary[to]!];
  };
  const forward = arc(startIndex, endIndex); const backward = arc(endIndex, startIndex);
  const removeForward = side === 'shorter' ? length(forward) <= length(backward) : length(forward) > length(backward);
  const kept = removeForward ? backward : [...forward].reverse();
  const result = [...path, ...kept.slice(1, -1)];
  if (validatePolygon(result)) return fail('reshape-invalid-result');
  feedback.contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { feedback, preview: { type: 'Polygon', coordinates: [closePolygon(result)] }, error: null };
}
