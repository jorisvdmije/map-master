import { closePolygon, validateMultiPolygon } from './polygon.js';
import type { Coordinate, UnionPreview } from './types.js';

/** Normalize nonempty engine output through the editor's strict topology policy. */
export function normalizeOverlay(parts: Coordinate[][][]): UnionPreview | null {
  if (parts.some((part) => part.some((ring) => ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)
    || x < -180 || x > 180 || y < -90 || y > 90))) || validateMultiPolygon(parts)) {
    return null;
  }
  const coordinates = parts.map((part) => part.map((ring, index) => closePolygon(ring, index > 0)));
  return coordinates.length === 1 ? { type: 'Polygon', coordinates: coordinates[0]! }
    : { type: 'MultiPolygon', coordinates };
}
