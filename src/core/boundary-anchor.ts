import type { Coordinate } from './types.js';

/** Nearest position on a planar lon/lat edge, preserving exact endpoint coordinates. */
export function projectToEdge(point: Coordinate, a: Coordinate, b: Coordinate): { point: Coordinate; t: number } {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length));
  return { t, point: t === 0 ? [...a] : t === 1 ? [...b] : [a[0] + t * dx, a[1] + t * dy] };
}
export interface BoundaryAnchor { edge: number; t: number; point: Coordinate }
export function boundaryAnchor(point: Coordinate, ring: Coordinate[]): BoundaryAnchor | null {
  // Only accommodate construction roundoff, never a UI/geographic snapping radius.
  const tolerance = 64 * Number.EPSILON * Math.max(1, Math.abs(point[0]), Math.abs(point[1]));
  const vertex = ring.findIndex((p) => Math.hypot(p[0] - point[0], p[1] - point[1]) <= tolerance);
  if (vertex !== -1) return { edge: vertex, t: 0, point: [...ring[vertex]!] };
  let nearest: BoundaryAnchor | null = null; let distance = Infinity;
  for (let edge = 0; edge < ring.length; edge++) {
    const projected = projectToEdge(point, ring[edge]!, ring[(edge + 1) % ring.length]!);
    const delta = Math.hypot(point[0] - projected.point[0], point[1] - projected.point[1]);
    if (delta <= tolerance && delta < distance) { nearest = { edge, ...projected }; distance = delta; }
  }
  return nearest;
}
