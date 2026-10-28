import { mercatorLatitudeLimit, project, unproject } from './mercator-transform.js';
import type { Coordinate, DrawingConstraintsOptions } from './types.js';

export function drawingConstraintsOptions(update: Partial<DrawingConstraintsOptions> = {}, previous: DrawingConstraintsOptions = {
  enabled: false, angleStep: 45,
}): DrawingConstraintsOptions {
  const options = { ...previous, ...update };
  if (typeof options.enabled !== 'boolean' || options.angleStep !== 45 && options.angleStep !== 90) {
    throw new TypeError('Drawing constraints require a boolean enabled and an angleStep of 45 or 90.');
  }
  return options;
}

const supported = (point: Coordinate): boolean => Number.isFinite(point[0]) && Number.isFinite(point[1])
  && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= mercatorLatitudeLimit;

const diagonal = Math.SQRT1_2;
const directions: readonly Coordinate[] = [[1, 0], [diagonal, diagonal], [0, 1], [-diagonal, diagonal], [-1, 0], [-diagonal, -diagonal], [0, -1], [diagonal, -diagonal]];

/** Nearest north/east-aligned Mercator ray, preserving projected radial distance.
 * Null rejects unsupported input/output rather than clamping or wrapping it.
 * Exact half-step ties go counterclockwise in the north-positive plane.
 */
export function constrainDrawingPoint(anchor: Coordinate, pointer: Coordinate, step: 45 | 90): Coordinate | null {
  if (!supported(anchor) || !supported(pointer) || Math.abs(pointer[0] - anchor[0]) > 180) return null;
  if (anchor[0] === pointer[0] && anchor[1] === pointer[1]) return [...anchor];
  const [ax, ay] = project(anchor); const [px, py] = project(pointer);
  const dx = px - ax; const dy = py - ay;
  const octant = ((Math.round(Math.atan2(dy, dx) / (step * Math.PI / 180)) * (step / 45)) % 8 + 8) % 8;
  const [ux, uy] = directions[octant]!;
  const length = Math.hypot(dx, dy);
  const x = ax + length * ux; const y = ay + length * uy;
  if (Math.abs(x) > Math.PI || Math.abs(y) > Math.PI || Math.abs(x - ax) > Math.PI) return null;
  const result = unproject([x, y]);
  // Keep axis-aligned coordinates exact and avoid manufacturing tiny duplicate segments.
  if (ux === 0) result[0] = anchor[0];
  if (uy === 0) result[1] = anchor[1];
  return supported(result) ? result : null;
}
