import polygonClipping from 'polygon-clipping';
import { normalizeOverlay } from './polygon-overlay.js';
import type { Coordinate, DifferenceError, DifferencePreview, UnionPreview } from './types.js';

/** Subtract all cutters from one validated target, without modifying any input. */
export function differencePolygons(target: UnionPreview, cutters: UnionPreview[]): {
  preview: DifferencePreview | null; error: DifferenceError | null;
} {
  if (cutters.length === 0) throw new RangeError('Difference requires at least one cutting polygon.');
  const subject = target.type === 'Polygon' ? [target.coordinates] : target.coordinates;
  // A single MultiPolygon argument avoids spreading an unbounded selection.
  const clips = cutters.flatMap((geometry) => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates);
  let parts;
  try {
    // Preserve exact input representation when there is no filled-area overlap,
    // including shared edges, point contact, and cutters entirely inside a hole.
    if (polygonClipping.intersection(subject, clips).length === 0) {
      const copyRings = (rings: Coordinate[][]): Coordinate[][] => rings.map((ring) => ring.map(([x, y]) => [x, y]));
      return { preview: { geometry: target.type === 'Polygon'
        ? { type: target.type, coordinates: copyRings(target.coordinates) }
        : { type: target.type, coordinates: target.coordinates.map(copyRings) } }, error: null };
    }
    parts = polygonClipping.difference(subject, clips);
  } catch {
    return { preview: null, error: 'difference-failed' };
  }
  // Empty is a valid result: confirmation deletes the target, never the cutters.
  if (parts.length === 0) return { preview: { geometry: null }, error: null };
  const geometry = normalizeOverlay(parts);
  return geometry ? { preview: { geometry }, error: null } : { preview: null, error: 'difference-invalid-result' };
}
