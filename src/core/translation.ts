import { geometryParts, mapGeometry, withGeometry } from './geometry.js';
import type { ScreenPoint } from './snapping.js';
import type { Coordinate, GeometryFeature } from './types.js';

/** Pick once from the grabbed feature, in CSS pixels; ties keep geometry order. */
export function translationAnchor(feature: GeometryFeature, pointer: ScreenPoint, project: (coordinate: Coordinate) => ScreenPoint): Coordinate | null {
  let best: Coordinate | null = null; let distance = Infinity;
  for (const part of geometryParts(feature.geometry)) {
    const paths = part.type === 'Polygon' ? part.coordinates : part.type === 'Point' ? [[part.coordinates]] : [part.coordinates];
    for (const path of paths) for (const coordinate of path) {
      const point = project(coordinate); const next = Math.hypot(point.x - pointer.x, point.y - pointer.y);
      if (next < distance) { distance = next; best = coordinate; }
    }
  }
  return best ? [...best] : null;
}

/** Translate from an immutable gesture baseline, never from the last preview.
 * Properties are shared with the input; callers own the input snapshots.
 * Bounds are checked before returning, without wrapping or clamping vertices.
 */
export function translateFeatures(features: readonly GeometryFeature[], delta: Coordinate): GeometryFeature[] {
  if (!Array.isArray(delta) || delta.length !== 2 || !Number.isFinite(delta[0]) || !Number.isFinite(delta[1])) {
    throw new TypeError('Expected two finite longitude/latitude offsets in degrees.');
  }
  const move = ([lng, lat]: Coordinate): Coordinate => {
    const next: Coordinate = [lng + delta[0], lat + delta[1]];
    if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])
      || next[0] < -180 || next[0] > 180 || next[1] < -90 || next[1] > 90) {
      throw new RangeError('Translated coordinates must stay within [-180, 180] / [-90, 90].');
    }
    return next;
  };
  return features.map((feature) => withGeometry(feature, mapGeometry(feature.geometry, move)));
}
