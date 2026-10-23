import polygonClipping from 'polygon-clipping';
import { normalizeOverlay } from './polygon-overlay.js';
import type { IntersectionError, IntersectionPreview, UnionPreview } from './types.js';

/** Intersect validated features, retaining each MultiPolygon as one operand. */
export function intersectionPolygons(geometries: UnionPreview[]): {
  preview: IntersectionPreview | null; error: IntersectionError | null;
} {
  if (geometries.length < 2) throw new RangeError('Intersection requires at least two polygon features.');
  const first = geometries[0]!;
  let parts = first.type === 'Polygon' ? [first.coordinates] : first.coordinates;
  try {
    // Fold instead of spreading an unbounded selection into function arguments.
    // Flattening the operands would intersect with their union, not with all inputs.
    for (const geometry of geometries.slice(1)) {
      parts = polygonClipping.intersection(parts, geometry.coordinates);
      if (parts.length === 0) return { preview: { geometry: null }, error: null };
    }
  } catch {
    return { preview: null, error: 'intersection-failed' };
  }
  // Validate only the final result: a later operand can remove unsupported contacts.
  const geometry = normalizeOverlay(parts);
  return geometry ? { preview: { geometry }, error: null } : { preview: null, error: 'intersection-invalid-result' };
}
