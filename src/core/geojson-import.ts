import { closePolygon, samePosition, validatePolygon } from './polygon.js';
import type { Coordinate, FeatureId, FeatureProperties, GeometryFeature, JsonValue, ValidationError } from './types.js';

export type ImportErrorCode = 'invalid-geojson' | 'unsupported-geometry' | 'invalid-coordinate'
  | 'invalid-properties' | 'invalid-id' | 'duplicate-id' | 'unclosed-ring' | 'unsupported-crs' | ValidationError;

/** A failed import never changes stored features. Paths identify the failing input. */
export class GeoJSONImportError extends TypeError {
  constructor(public readonly code: ImportErrorCode, public readonly path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = 'GeoJSONImportError';
  }
}

function fail(code: ImportErrorCode, path: string, message: string): never {
  throw new GeoJSONImportError(code, path, message);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail('invalid-geojson', path, 'Expected an array.');
  return value as unknown[];
}

/** Copy JSON properties without invoking toJSON or retaining nested caller references. */
function copyJson(value: unknown, path: string, ancestors = new Set<object>(), depth = 0): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === null || depth >= 100 || ancestors.has(value)) {
    return fail('invalid-properties', path, 'Expected finite, acyclic JSON values, at most 100 containers deep.');
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return fail('invalid-properties', path, 'Expected a plain JSON object.');
  }
  ancestors.add(value);
  const result: JsonValue = Array.isArray(value)
    ? Array.from(value as unknown[], (item, index) => copyJson(item, `${path}[${index}]`, ancestors, depth + 1))
    : Object.fromEntries(Object.entries(value).map(([key, item]: [string, unknown]) =>
      [key, copyJson(item, `${path}.${key}`, ancestors, depth + 1)]));
  ancestors.delete(value);
  return result;
}

export function copyProperties(value: unknown, path = '$.properties'): FeatureProperties {
  if (value === null) return null;
  if (!record(value)) return fail('invalid-properties', path, 'Expected a properties object or null.');
  return copyJson(value, path) as Exclude<FeatureProperties, null>;
}

function position(value: unknown, path: string): Coordinate {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail('invalid-coordinate', path, 'Expected exactly [longitude, latitude]; only 2D is supported.');
  }
  const [lng, lat] = value as unknown[];
  if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)
    || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return fail('invalid-coordinate', path, 'Expected finite longitude/latitude within [-180, 180] / [-90, 90].');
  }
  return [lng, lat];
}

function geometry(value: unknown, path: string): GeometryFeature['geometry'] {
  if (!record(value)) return fail('unsupported-geometry', path, 'Expected a LineString or Polygon geometry.');
  if ('crs' in value) fail('unsupported-crs', path, 'Use WGS84 longitude/latitude; legacy CRS declarations are not supported.');
  const coordinatesPath = `${path}.coordinates`;
  if (value.type === 'LineString') {
    const coordinates = Array.from(array(value.coordinates, coordinatesPath), (point, i) => position(point, `${coordinatesPath}[${i}]`));
    if (coordinates.length < 2) fail('too-few-vertices', coordinatesPath, 'A line needs at least two points.');
    if (coordinates.some((point, i) => i > 0 && samePosition(point, coordinates[i - 1]!))) {
      fail('duplicate-vertex', coordinatesPath, 'Consecutive line points must differ.');
    }
    return { type: 'LineString', coordinates };
  }
  if (value.type !== 'Polygon') return fail('unsupported-geometry', path, 'Only LineString and single-ring Polygon are supported.');
  const rings = array(value.coordinates, coordinatesPath);
  if (rings.length !== 1) fail('unsupported-geometry', coordinatesPath, 'Expected one outer ring; holes are not supported.');
  const ringPath = `${coordinatesPath}[0]`;
  const ring = Array.from(array(rings[0], ringPath), (point, i) => position(point, `${ringPath}[${i}]`));
  if (ring.length < 4) fail('too-few-vertices', ringPath, 'A polygon ring needs three corners plus its closing position.');
  if (!samePosition(ring[0]!, ring.at(-1)!)) fail('unclosed-ring', ringPath, 'The first and last position must match.');
  const error = validatePolygon(ring);
  if (error) fail(error, ringPath, `Invalid polygon: ${error}.`);
  return { type: 'Polygon', coordinates: [closePolygon(ring)] };
}

/** Validate and copy the whole batch before the caller commits any feature. */
export function prepareImport(input: unknown, hasId: (id: FeatureId) => boolean, createId: () => string): GeometryFeature[] {
  if (!record(input)) return fail('invalid-geojson', '$', 'Expected a parsed Feature or FeatureCollection.');
  if ('crs' in input) fail('unsupported-crs', '$.crs', 'Legacy CRS declarations are not supported.');
  const collection = input.type === 'FeatureCollection';
  if (!collection && input.type !== 'Feature') return fail('invalid-geojson', '$.type', 'Expected Feature or FeatureCollection.');
  const values = collection ? array(input.features, '$.features') : [input];
  const ids = new Set<FeatureId>();
  const prepared = Array.from(values, (value, index) => {
    const path = collection ? `$.features[${index}]` : '$';
    if (!record(value) || value.type !== 'Feature') return fail('invalid-geojson', path, 'Expected a Feature.');
    if ('crs' in value) fail('unsupported-crs', `${path}.crs`, 'Legacy CRS declarations are not supported.');
    let id: FeatureId | undefined;
    if ('id' in value) {
      if (typeof value.id !== 'string' && !(typeof value.id === 'number' && Number.isFinite(value.id))) {
        fail('invalid-id', `${path}.id`, 'Expected a string or finite number.');
      }
      id = value.id;
      if (ids.has(id) || hasId(id)) fail('duplicate-id', `${path}.id`, `Feature ID ${JSON.stringify(id)} already exists.`);
      ids.add(id);
    }
    return { id, geometry: geometry(value.geometry, `${path}.geometry`), properties: copyProperties(value.properties, `${path}.properties`) };
  });
  // Reserve explicit IDs first, even when they occur after an anonymous feature.
  return prepared.map((feature) => {
    let id = feature.id;
    for (let attempt = 0; id === undefined && attempt < 100; attempt++) {
      const candidate = createId();
      if (!ids.has(candidate) && !hasId(candidate)) { id = candidate; ids.add(id); }
    }
    if (id === undefined) return fail('duplicate-id', '$', 'Could not allocate a unique feature ID.');
    const common = { type: 'Feature' as const, id, properties: feature.properties };
    return feature.geometry.type === 'LineString'
      ? { ...common, geometry: feature.geometry } : { ...common, geometry: feature.geometry };
  });
}
