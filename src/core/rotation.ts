import { geometryParts, mapGeometry, withGeometry } from './geometry.js';
import type { Coordinate, GeometryFeature } from './types.js';

// Spherical Mercator in angular units, with north-positive y. Scale cancels in rotation.
const radians = Math.PI / 180;
export const rotationLatitudeLimit = Math.atan(Math.sinh(Math.PI)) / radians;

export function validateRotationPivot(point: Coordinate): void {
  if (!Array.isArray(point) || point.length !== 2 || ![point[0], point[1]].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError('Expected a finite 2D rotation pivot.');
  }
  if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > rotationLatitudeLimit) {
    throw new RangeError('Rotation requires longitude within ±180° and latitude within ±85.0511287798066°.');
  }
}
const project = ([lng, lat]: Coordinate): Coordinate => [lng * radians, Math.asinh(Math.tan(lat * radians))];
const unproject = ([x, y]: Coordinate): Coordinate => [x / radians, Math.atan(Math.sinh(y)) / radians];

export function normalizeRotationAngle(angle: number): number {
  if (typeof angle !== 'number' || !Number.isFinite(angle)) throw new TypeError('Expected a finite rotation angle in degrees.');
  const normalized = angle % 360;
  return normalized === 0 ? 0 : normalized > 180 ? normalized - 360 : normalized <= -180 ? normalized + 360 : normalized;
}

/** Fixed projected bounding-box midpoint; no centroid weighting or world wrapping. */
export function rotationPivot(features: readonly GeometryFeature[]): Coordinate | null {
  if (!features.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const feature of features) {
    for (const part of geometryParts(feature.geometry)) {
      const paths = part.type === 'Polygon' ? part.coordinates : [part.coordinates];
      for (const path of paths) {
        for (let i = 0; i < path.length; i++) {
          const point = path[i]!;
          // Lines have a wider import contract; rotation deliberately excludes dateline jumps.
          if (Math.abs(point[1]) > rotationLatitudeLimit || i > 0 && Math.abs(point[0] - path[i - 1]![0]) > 180) return null;
          const [x, y] = project(point);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
  }
  // Treat selections spanning more than half the world as ambiguous, even across separate parts.
  if (maxX - minX > Math.PI) return null;
  return unproject([(minX + maxX) / 2, (minY + maxY) / 2]);
}

/** Always rotate an immutable baseline. Positive degrees are clockwise on a north-up map.
 * Properties are shared with caller-owned input snapshots; geometry is independently copied.
 */
export function rotateFeatures(features: readonly GeometryFeature[], degrees: number, pivot: Coordinate): GeometryFeature[] {
  validateRotationPivot(pivot);
  const angle = normalizeRotationAngle(degrees);
  const [cx, cy] = project(pivot);
  // Exact quarter-turn coefficients, including an exact identity for complete turns.
  const cos = angle === 180 ? -1 : Math.abs(angle) === 90 ? 0 : Math.cos(angle * radians);
  const sin = angle === 180 ? 0 : angle === 90 ? 1 : angle === -90 ? -1 : Math.sin(angle * radians);
  const rotate = (point: Coordinate): Coordinate => {
    if (angle === 0 || point[0] === pivot[0] && point[1] === pivot[1]) return [...point];
    const [x, y] = project(point);
    const next: Coordinate = [cx + cos * (x - cx) + sin * (y - cy), cy - sin * (x - cx) + cos * (y - cy)];
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1]) || Math.abs(next[0]) > Math.PI || Math.abs(next[1]) > Math.PI) {
      throw new RangeError('Rotated coordinates leave the supported Mercator world.');
    }
    return unproject(next);
  };
  return features.map((feature) => withGeometry(feature, mapGeometry(feature.geometry, rotate)));
}
