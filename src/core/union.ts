import polygonClipping from 'polygon-clipping';
import { closePolygon, validateMultiPolygon } from './polygon.js';
import type { UnionError, UnionPreview } from './types.js';

/** Union of already validated stored geometries. Never mutates the inputs.
 * Keep the overlay engine behind our stricter topology and coordinate policy.
 */
export function unionPolygons(geometries: UnionPreview[]): { preview: UnionPreview | null; error: UnionError | null } {
  if (geometries.length < 2) throw new RangeError('Union requires at least two polygon features.');
  let parts;
  try {
    // One MultiPolygon argument avoids a spread/argument limit for large selections.
    parts = polygonClipping.union(geometries.flatMap((geometry) => geometry.type === 'Polygon'
      ? [geometry.coordinates] : geometry.coordinates));
  } catch {
    return { preview: null, error: 'union-failed' };
  }
  if (parts.some((part) => part.some((ring) => ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)
    || x < -180 || x > 180 || y < -90 || y > 90))) || validateMultiPolygon(parts)) {
    return { preview: null, error: 'union-invalid-result' };
  }
  const coordinates = parts.map((part) => part.map((ring, index) => closePolygon(ring, index > 0)));
  return { preview: coordinates.length === 1 ? { type: 'Polygon', coordinates: coordinates[0]! }
    : { type: 'MultiPolygon', coordinates }, error: null };
}
