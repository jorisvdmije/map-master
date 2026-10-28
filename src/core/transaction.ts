import { GeoJSONImportError, prepareImport } from './geojson-import.js';
import type { FeatureChange, FeatureId, GeometryFeature, JsonValue } from './types.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function featureId(value: unknown, path: string): FeatureId {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError(`${path}: Expected an explicit string or finite numeric feature ID.`);
  }
  return value;
}
function equalJson(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, JsonValue>; const right = b as Record<string, JsonValue>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equalJson(left[key]!, right[key]!));
}

/** Prepare isolated changes against the original store. Never mutate data or history here. */
export function prepareTransaction(input: unknown, features: ReadonlyMap<FeatureId, GeometryFeature>): FeatureChange[] {
  if (!record(input)) throw new TypeError('Expected a feature transaction object.');
  for (const key of Object.keys(input)) {
    if (key !== 'create' && key !== 'update' && key !== 'delete') throw new TypeError(`Unknown transaction operation: ${key}.`);
  }
  const seen = new Set<FeatureId>();
  const changes: FeatureChange[] = [];
  for (const operation of ['update', 'delete', 'create'] as const) {
    if (!Object.hasOwn(input, operation)) continue;
    const values = input[operation];
    if (!Array.isArray(values)) throw new TypeError(`$.${operation}: Expected an array.`);
    for (const [index, value] of (values as unknown[]).entries()) {
      const path = `$.${operation}[${index}]`;
      if (operation !== 'delete' && (!record(value) || value.type !== 'Feature')) {
        throw new TypeError(`${path}: Expected a GeoJSON Feature.`);
      }
      const id = featureId(operation === 'delete' ? value : record(value) ? value.id : undefined, path);
      if (seen.has(id)) throw new RangeError(`${path}: Feature ID ${JSON.stringify(id)} occurs more than once in the transaction.`);
      seen.add(id);
      const before = features.get(id) ?? null;
      if (operation === 'create' ? before !== null : before === null) {
        throw new RangeError(`${path}: Feature ID ${JSON.stringify(id)} ${operation === 'create' ? 'already exists' : 'does not exist'}.`);
      }
      let after: GeometryFeature | null = null;
      if (operation !== 'delete') {
        try {
          after = prepareImport(value, () => false, () => { throw new Error('Transactions require explicit IDs.'); })[0]!;
        } catch (error) {
          if (!(error instanceof GeoJSONImportError)) throw error;
          throw new GeoJSONImportError(error.code, path + error.path.slice(1), error.message.slice(error.path.length + 2));
        }
      }
      if (before && after && JSON.stringify(before.geometry) === JSON.stringify(after.geometry)
        && equalJson(before.properties, after.properties)) continue;
      changes.push({ before, after });
    }
  }
  return changes;
}
