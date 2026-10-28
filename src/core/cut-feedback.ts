import { orient2d } from 'robust-predicates';
import type { Coordinate, CutFeedback } from './types.js';

export const emptyCutFeedback = (): CutFeedback => ({ contacts: [], problemPoints: [], problemSegments: [] });
export const copyCutFeedback = (feedback: CutFeedback): CutFeedback => ({
  contacts: feedback.contacts.map(p => [...p]),
  problemPoints: feedback.problemPoints.map(p => [...p]),
  problemSegments: feedback.problemSegments.map(segment => segment.map(p => [...p])),
});

/** Diagnostic construction only, called after the geometry validator found a contact.
 * Overlaps identify their endpoints; proper crossings identify the intersection. */
export function markContact(feedback: CutFeedback, a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): void {
  feedback.problemSegments.push([a, b]);
  const on = (p: Coordinate, x: Coordinate, y: Coordinate) => orient2d(...x, ...y, ...p) === 0
    && p[0] >= Math.min(x[0], y[0]) && p[0] <= Math.max(x[0], y[0])
    && p[1] >= Math.min(x[1], y[1]) && p[1] <= Math.max(x[1], y[1]);
  const endpoints = [a, b].filter(p => on(p, c, d)).concat([c, d].filter(p => on(p, a, b)));
  if (endpoints.length) { feedback.problemPoints.push(...endpoints); return; }
  const rx = b[0] - a[0]; const ry = b[1] - a[1]; const sx = d[0] - c[0]; const sy = d[1] - c[1];
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / (rx * sy - ry * sx);
  const point: Coordinate = [a[0] + t * rx, a[1] + t * ry];
  if (t >= 0 && t <= 1 && point.every(Number.isFinite)) feedback.problemPoints.push(point);
}
