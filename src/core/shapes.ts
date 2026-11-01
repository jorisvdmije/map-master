import polygonClipping from 'polygon-clipping';
import { distance } from './measurement.js';
import { normalizeOverlay } from './polygon-overlay.js';
import { closePolygon, openRing, samePosition } from './polygon.js';
import { planarArea } from './split-polygon.js';
import type { Coordinate } from './types.js';

/** Shapes drawn with `GeometryEditor.draw()` that are stored as polygons. */
export type DrawShape = 'Rectangle' | 'Circle' | 'Ellipse' | 'Freehand';

const earthRadius = 6_371_008.8;
const radians = Math.PI / 180;
/** Corners of a drawn circle; enough to look round at any zoom where it fits on screen. */
export const circleSteps = 64;

/** The open, north/east-aligned ring spanned by two opposite corners, or null if it has no area. */
export function rectangleRing(a: Coordinate, b: Coordinate): Coordinate[] | null {
  if (a[0] === b[0] || a[1] === b[1]) return null;
  return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
}

/** The position `meters` away from `origin` along the initial bearing in degrees clockwise from north. */
export function destination([lng, lat]: Coordinate, meters: number, bearing: number): Coordinate {
  const angular = meters / earthRadius;
  const theta = bearing * radians;
  const phi1 = lat * radians;
  const lambda1 = lng * radians;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(angular) + Math.cos(phi1) * Math.sin(angular) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(angular) * Math.cos(phi1), Math.cos(angular) - Math.sin(phi1) * Math.sin(phi2));
  const wrapped = ((lambda2 / radians + 540) % 360) - 180;
  return [wrapped, phi2 / radians];
}

/** The geodesic radius in meters of a circle from its center to a point on its edge. */
export const circleRadius = (center: Coordinate, edge: Coordinate): number => distance(center, edge);

/**
 * An open ring approximating the geodesic circle through `edge` around `center`, or null
 * when the radius is zero or the circle would cross a pole or the antimeridian.
 */
export function circleRing(center: Coordinate, edge: Coordinate, steps = circleSteps): Coordinate[] | null {
  const radius = circleRadius(center, edge);
  if (!(radius > 0)) return null;
  const ring: Coordinate[] = [];
  for (let index = 0; index < steps; index++) {
    const point = destination(center, radius, (index * 360) / steps);
    ring.push([Math.round(point[0] * 1e9) / 1e9, Math.round(point[1] * 1e9) / 1e9]);
  }
  const lngs = ring.map(([x]) => x);
  if (Math.max(...lngs) - Math.min(...lngs) > 180 || ring.some(([, y]) => Math.abs(y) >= 89.9)) return null;
  return ring;
}

/**
 * An open ring approximating the ellipse around `center` whose east–west and north–south
 * radii reach `corner`, or null when either radius is zero or it would cross a pole or the
 * antimeridian. Radii are geodesic distances measured along the center's parallel and meridian.
 */
export function ellipseRing(center: Coordinate, corner: Coordinate, steps = circleSteps): Coordinate[] | null {
  const radiusX = distance(center, [corner[0], center[1]]);
  const radiusY = distance(center, [center[0], corner[1]]);
  if (!(radiusX > 0) || !(radiusY > 0)) return null;
  const ring: Coordinate[] = [];
  for (let index = 0; index < steps; index++) {
    const angle = (index * 2 * Math.PI) / steps;
    const east = radiusX * Math.sin(angle);
    const north = radiusY * Math.cos(angle);
    const point = destination(center, Math.hypot(east, north), Math.atan2(east, north) / radians);
    ring.push([Math.round(point[0] * 1e9) / 1e9, Math.round(point[1] * 1e9) / 1e9]);
  }
  const lngs = ring.map(([x]) => x);
  if (Math.max(...lngs) - Math.min(...lngs) > 180 || ring.some(([, y]) => Math.abs(y) >= 89.9)) return null;
  return ring;
}

/** Douglas–Peucker simplification of a screen-space path; keeps both endpoints. */
export function simplifyPath(points: readonly Coordinate[], tolerance: number): Coordinate[] {
  if (points.length <= 2) return points.map(([x, y]) => [x, y]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = points[first]!;
    const [bx, by] = points[last]!;
    const dx = bx - ax; const dy = by - ay;
    const length = Math.hypot(dx, dy);
    let farthest = -1; let maximum = tolerance;
    for (let index = first + 1; index < last; index++) {
      const [px, py] = points[index]!;
      const offset = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
      if (offset > maximum) { maximum = offset; farthest = index; }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }
  return points.filter((_, index) => keep[index] === 1).map(([x, y]) => [x, y]);
}

/**
 * Turn a traced freehand outline into one valid open polygon ring. Self-intersections,
 * which are common when the outline is closed by hand, are resolved by keeping the largest
 * enclosed area. Returns null when the outline encloses no area.
 */
export function freehandRing(points: readonly Coordinate[]): Coordinate[] | null {
  const ring = openRing(points.filter((point, index) => index === 0 || !samePosition(point, points[index - 1]!)));
  if (ring.length < 3) return null;
  let parts: Coordinate[][][];
  try { parts = polygonClipping.union([closePolygon(ring)]); } catch { return null; }
  const largest = parts.map(([outer]) => outer!).sort((a, b) => Math.abs(planarArea(b)) - Math.abs(planarArea(a)))[0];
  if (!largest) return null;
  const normalized = normalizeOverlay([[largest]]);
  return normalized?.type === 'Polygon' ? openRing(normalized.coordinates[0]!) : null;
}
