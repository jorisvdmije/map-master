import type { Coordinate, GeometryFeature } from './types.js';

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
  return features.map((feature): GeometryFeature => feature.geometry.type === 'Polygon'
    ? { ...feature, geometry: { type: 'Polygon', coordinates: feature.geometry.coordinates.map((ring) => ring.map(move)) } }
    : { ...feature, geometry: { type: 'LineString', coordinates: feature.geometry.coordinates.map(move) } });
}
