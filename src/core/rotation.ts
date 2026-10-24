import { mapGeometry, withGeometry } from './geometry.js';
import type { Coordinate, GeometryFeature } from './types.js';
import { radians, project, unproject, validateTransformPivot as validateRotationPivot } from './mercator-transform.js';
export { transformPivot as rotationPivot, mercatorLatitudeLimit as rotationLatitudeLimit, validateTransformPivot as validateRotationPivot } from './mercator-transform.js';

export function normalizeRotationAngle(angle: number): number {
  if (typeof angle !== 'number' || !Number.isFinite(angle)) throw new TypeError('Expected a finite rotation angle in degrees.');
  const normalized = angle % 360;
  return normalized === 0 ? 0 : normalized > 180 ? normalized - 360 : normalized <= -180 ? normalized + 360 : normalized;
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
