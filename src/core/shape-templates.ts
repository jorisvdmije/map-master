import { GeoJSONImportError, prepareImport } from './geojson-import.js';
import { geometryParts, mapGeometry, withGeometry } from './geometry.js';
import { project, unproject, transformPivot, validateTransformPivot, radians } from './mercator-transform.js';
import { normalizeRotationAngle } from './rotation.js';
import type { Coordinate, FeatureId, FeatureProperties, GeometryFeature, GeometryFeatureCollection, PolygonFeature } from './types.js';

/** Template source features may omit IDs; committed copies always receive fresh IDs. */
export interface ShapeTemplateFeature {
  type: 'Feature';
  id?: FeatureId;
  properties: FeatureProperties;
  geometry: GeometryFeature['geometry'];
}

/** A reusable, WGS84 GeoJSON shape or group. Source IDs are replaced on placement. */
export interface ShapeTemplate {
  id: string;
  label: string;
  data: ShapeTemplateFeature | { type: 'FeatureCollection'; features: ShapeTemplateFeature[] };
}
/** Size is the longest unrotated bounding-box side in Mercator-plane meters. */
export interface TemplatePlacement {
  position: Coordinate | null;
  size: number;
  /** Degrees clockwise from the original orientation, normalized to (-180, 180]. */
  rotation: number;
}
export interface TemplateDraft extends TemplatePlacement { templateId: string; }
export type TemplatePlacementError = 'template-out-of-bounds' | 'template-invalid-result';

export interface PreparedTemplate {
  definition: ShapeTemplate;
  features: GeometryFeature[];
  center: Coordinate;
  span: number;
}
const earthRadius = 6_378_137;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Validate and isolate the entire library before replacing it. No application IDs are allocated. */
export function prepareShapeTemplates(input: readonly ShapeTemplate[]): PreparedTemplate[] {
  if (!Array.isArray(input)) throw new TypeError('Shape templates must be an array.');
  const ids = new Set<string>();
  return (input as unknown[]).map(value => {
    if (!record(value) || Object.keys(value).some(key => key !== 'id' && key !== 'label' && key !== 'data')
      || typeof value.id !== 'string' || !value.id.trim() || typeof value.label !== 'string' || !value.label.trim()) {
      throw new TypeError('Each shape template needs an id, label and GeoJSON data.');
    }
    if (ids.has(value.id)) throw new RangeError(`Repeated shape template ID: ${value.id}`);
    ids.add(value.id);
    let sourceId = 0;
    const features = prepareImport(value.data, () => false, () => `template-source-${++sourceId}`);
    const pivot = transformPivot(features);
    if (!pivot) throw new RangeError('Templates need nonempty geometry within one Mercator half-world, without dateline jumps.');
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const feature of features) for (const part of geometryParts(feature.geometry)) {
      const paths = part.type === 'Point' ? [[part.coordinates]] : part.type === 'LineString' ? [part.coordinates] : part.coordinates;
      for (const path of paths) for (const point of path) {
        const [x, y] = project(point);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const span = Math.max(maxX - minX, maxY - minY);
    if (!(span > 0)) throw new RangeError('A shape template needs nonzero width or height.');
    const definition: ShapeTemplate = { id: value.id, label: value.label, data: { type: 'FeatureCollection', features } };
    return { definition, features, center: [(minX + maxX) / 2, (minY + maxY) / 2], span };
  });
}

/** Syntax/range errors reject the whole patch before modifying the draft. */
export function templatePlacement(patch: Partial<TemplateDraft>, current: TemplateDraft): TemplateDraft {
  if (!record(patch) || Object.keys(patch).some(key => !['templateId', 'position', 'size', 'rotation'].includes(key))) throw new TypeError('Expected templateId, position, size or rotation.');
  const next = { ...current, ...patch };
  if (typeof next.templateId !== 'string' || !next.templateId) throw new TypeError('Expected a template ID.');
  if (typeof next.size !== 'number' || !Number.isFinite(next.size)) throw new TypeError('Expected a finite template size.');
  if (next.size <= 0) throw new RangeError('Template size must be greater than zero.');
  next.rotation = normalizeRotationAngle(next.rotation);
  if (next.position !== null) {
    const point = next.position;
    if (!Array.isArray(point) || point.length !== 2 || point.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError('Expected a 2D template position.');
    if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new RangeError('Template position must be within ±180° longitude and ±90° latitude.');
    next.position = [...point];
  }
  return next;
}

/** Absolute transformation from the immutable template. Never mutate or accumulate rounding in the baseline. */
export function placeTemplate(template: PreparedTemplate, placement: TemplatePlacement): { preview: GeometryFeatureCollection | null; error: TemplatePlacementError | null } {
  if (placement.position === null) return { preview: null, error: null };
  try {
    validateTransformPivot(placement.position);
    const [cx, cy] = project(placement.position);
    const factor = placement.size / earthRadius / template.span;
    const angle = placement.rotation;
    const cos = angle === 180 ? -1 : Math.abs(angle) === 90 ? 0 : Math.cos(angle * radians);
    const sin = angle === 180 ? 0 : angle === 90 ? 1 : angle === -90 ? -1 : Math.sin(angle * radians);
    const features = template.features.map(feature => withGeometry(feature, mapGeometry(feature.geometry, point => {
      const [x, y] = project(point); const dx = factor * (x - template.center[0]); const dy = factor * (y - template.center[1]);
      const result: Coordinate = [cx + cos * dx + sin * dy, cy - sin * dx + cos * dy];
      if (!result.every(Number.isFinite) || Math.abs(result[0]) > Math.PI || Math.abs(result[1]) > Math.PI) throw new RangeError('Template leaves the supported Mercator world.');
      return unproject(result);
    })));
    if (!transformPivot(features)) throw new RangeError('Template spans more than half the world.');
    // Validate topology after transformation using exactly the import/transaction contract.
    const validated = prepareImport({ type: 'FeatureCollection', features }, () => false, () => { throw new Error('Template preview IDs are explicit.'); });
    return { preview: { type: 'FeatureCollection', features: validated }, error: null };
  } catch (error) {
    if (error instanceof GeoJSONImportError) return { preview: null, error: 'template-invalid-result' };
    if (error instanceof RangeError) return { preview: null, error: 'template-out-of-bounds' };
    throw error;
  }
}

/** Fresh, editable copies of the example arrow and five-pointed star templates. */
export function defaultShapeTemplates(): ShapeTemplate[] {
  const polygon = (id: string, label: string, points: Coordinate[]): ShapeTemplate => ({ id, label, data: {
    type: 'Feature', id, properties: { name: label, shape: id },
    geometry: { type: 'Polygon', coordinates: [[...points, [...points[0]!]]] },
  } satisfies PolygonFeature });
  return [
    polygon('arrow', 'Arrow', [[-0.001, -0.0003], [0.0002, -0.0003], [0.0002, -0.0007], [0.001, 0], [0.0002, 0.0007], [0.0002, 0.0003], [-0.001, 0.0003]]),
    polygon('star', 'Star', Array.from({ length: 10 }, (_, index): Coordinate => {
      const radius = index % 2 === 0 ? 0.001 : 0.00045; const angle = index * Math.PI / 5;
      return [Math.sin(angle) * radius, Math.cos(angle) * radius];
    })),
  ];
}
