import { geometryParts } from './geometry.js';
import type { Coordinate, GeometryFeature } from './types.js';

// Spherical Mercator in angular units, with north-positive y. Used by rotation and scaling.
export const radians = Math.PI / 180;
export const mercatorLatitudeLimit = Math.atan(Math.sinh(Math.PI)) / radians;

export function validateTransformPivot(point: Coordinate): void {
  if (!Array.isArray(point) || point.length !== 2 || ![point[0], point[1]].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError('Expected a finite 2D transformation pivot.');
  }
  if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > mercatorLatitudeLimit) {
    throw new RangeError('Transformation requires longitude within ±180° and latitude within ±85.0511287798066°.');
  }
}
export const project = ([lng, lat]: Coordinate): Coordinate => [lng * radians, Math.asinh(Math.tan(lat * radians))];
export const unproject = ([x, y]: Coordinate): Coordinate => [x / radians, Math.atan(Math.sinh(y)) / radians];

/** Fixed projected bounding-box midpoint; no centroid weighting or world wrapping. */
export function transformPivot(features: readonly GeometryFeature[]): Coordinate | null {
  if (!features.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const feature of features) {
    for (const part of geometryParts(feature.geometry)) {
      const paths = part.type === 'Polygon' ? part.coordinates : [part.coordinates];
      for (const path of paths) {
        for (let i = 0; i < path.length; i++) {
          const point = path[i]!;
          // Lines have a wider import contract; transformation deliberately excludes dateline jumps.
          if (Math.abs(point[1]) > mercatorLatitudeLimit || i > 0 && Math.abs(point[0] - path[i - 1]![0]) > 180) return null;
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

