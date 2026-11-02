import type { PolygonOutlineAppearance } from '../core/appearance.js';
import type { ExpressionSpecification } from '../gl/map.js';

/** Keep a composite camera expression even while disabled. Switching a live
 * layer between source/composite binders can leave old GL buckets incompatible.
 * Camera input must remain at the top level for both style implementations.
 */
export function polygonLineWidth(width: number | ExpressionSpecification, outline: PolygonOutlineAppearance): ExpressionSpecification {
  const scale = outline.scaleWithZoom ? 2 ** (-2 - outline.referenceZoom) : 1;
  return ['interpolate', ['exponential', 2], ['zoom'],
    -2, ['case', ['==', ['geometry-type'], 'Polygon'], ['*', width, scale], width],
    outline.referenceZoom, width];
}
