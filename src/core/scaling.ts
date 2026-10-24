import { mapGeometry, withGeometry } from './geometry.js';
import { project, unproject, validateTransformPivot } from './mercator-transform.js';
import type { Coordinate, GeometryFeature } from './types.js';

export function validateScaleFactor(factor: number): void {
  if (typeof factor !== 'number' || !Number.isFinite(factor)) throw new TypeError('Expected a finite scale factor.');
  if (factor <= 0) throw new RangeError('Scale factor must be greater than zero.');
}

/** Uniform positive scaling in the Mercator plane from an immutable baseline.
 * Properties are shared with caller-owned snapshots; geometry is independently copied.
 */
export function scaleFeatures(features: readonly GeometryFeature[], factor: number, pivot: Coordinate): GeometryFeature[] {
  validateScaleFactor(factor); validateTransformPivot(pivot);
  const [cx, cy] = project(pivot);
  const scale = (point: Coordinate): Coordinate => {
    if (factor === 1 || point[0] === pivot[0] && point[1] === pivot[1]) return [...point];
    const [x, y] = project(point);
    const next: Coordinate = [cx + factor * (x - cx), cy + factor * (y - cy)];
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1]) || Math.abs(next[0]) > Math.PI || Math.abs(next[1]) > Math.PI) {
      throw new RangeError('Scaled coordinates leave the supported Mercator world.');
    }
    return unproject(next);
  };
  return features.map((feature) => withGeometry(feature, mapGeometry(feature.geometry, scale)));
}
