import polygonClipping from 'polygon-clipping';
import { normalizeOverlay } from './polygon-overlay.js';
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
  const preview = normalizeOverlay(parts);
  return { preview, error: preview ? null : 'union-invalid-result' };
}
