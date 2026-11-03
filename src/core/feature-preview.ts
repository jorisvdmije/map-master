import type { GeometryFeature, JsonValue, MeasurementUnits } from './types.js';
import { measure, formatArea, formatDistance } from './measurement.js';

export interface FeaturePreviewField {
  /** Exact own property key, not a dot-separated path. */
  key: string;
  label?: string;
  format?: 'auto' | 'number' | 'date' | 'json';
  decimals?: number;
}
export interface FeaturePreviewOptions {
  enabled?: boolean;
  /** Null uses the feature ID. Default: name, with ID fallback. */
  titleProperty?: string | null;
  /** Null/omitted picks properties automatically; [] hides all custom fields. */
  fields?: FeaturePreviewField[] | null;
  /** Total custom + geometry rows, 2–10. Default: 5. Geometry rows are reserved. */
  maxRows?: number;
  geometry?: { area?: boolean; perimeter?: boolean; length?: boolean; coordinates?: boolean };
  units?: MeasurementUnits;
  locale?: string;
}
export interface FeaturePreviewContent {
  title: string;
  rows: { label: string; value: string }[];
  omittedFields: number;
}
const internal = new Set(['mapMasterLayer', 'mapMasterPins', 'mapMasterPlaygroundStyle']);
const record = (value: unknown): boolean => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);
const text = (value: unknown, limit: number) => typeof value === 'string' && value.length <= limit;

/** Validate serializable configuration without retaining caller-owned objects. */
export function resolveFeaturePreview(options: FeaturePreviewOptions = {}): FeaturePreviewOptions {
  if (!record(options) || Object.keys(options).some(key => !['enabled', 'titleProperty', 'fields', 'maxRows', 'geometry', 'units', 'locale'].includes(key))) throw new TypeError('Invalid feature preview options.');
  if (options.enabled !== undefined && typeof options.enabled !== 'boolean'
    || options.titleProperty !== undefined && options.titleProperty !== null && (!text(options.titleProperty, 200) || internal.has(options.titleProperty))
    || options.maxRows !== undefined && (!Number.isInteger(options.maxRows) || options.maxRows < 2 || options.maxRows > 10)
    || options.units !== undefined && !['metric', 'imperial'].includes(options.units)
    || options.locale !== undefined && (!text(options.locale, 80) || !options.locale)) throw new TypeError('Invalid feature preview settings.');
  if (options.locale !== undefined) new Intl.NumberFormat(options.locale);
  if (options.geometry !== undefined && (!record(options.geometry) || Object.entries(options.geometry).some(([key, value]) => !['area', 'perimeter', 'length', 'coordinates'].includes(key) || typeof value !== 'boolean'))) throw new TypeError('Invalid preview geometry options.');
  if (options.fields !== undefined && options.fields !== null) {
    if (!Array.isArray(options.fields) || options.fields.length > 40) throw new TypeError('Choose at most 40 preview fields.');
    const keys = new Set<string>();
    for (const field of options.fields) {
      if (!record(field) || Object.keys(field).some(key => !['key', 'label', 'format', 'decimals'].includes(key))
        || !text(field.key, 200) || internal.has(field.key) || keys.has(field.key)
        || field.label !== undefined && !text(field.label, 120)
        || field.format !== undefined && !['auto', 'number', 'date', 'json'].includes(field.format)
        || field.decimals !== undefined && (!Number.isInteger(field.decimals) || field.decimals < 0 || field.decimals > 8)) throw new TypeError('Invalid or duplicate preview field.');
      keys.add(field.key);
    }
  }
  const copy = { ...options };
  if (options.geometry) copy.geometry = { ...options.geometry };
  if (options.fields) copy.fields = options.fields.map(field => ({ ...field }));
  return copy;
}

const bound = (value: string, length: number) => value.length > length ? `${value.slice(0, length)}…` : value;
function format(value: JsonValue, field: FeaturePreviewField, locale: string): string {
  if (field.format === 'number' && typeof value === 'number') return new Intl.NumberFormat(locale, { maximumFractionDigits: field.decimals ?? 2 }).format(value);
  if (field.format === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/u.test(value) && Number.isFinite(Date.parse(value))) {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
  }
  return typeof value === 'string' && field.format !== 'json' ? value : JSON.stringify(value);
}

/** Pure plain-text content for a host popup; never changes data or owns map UI. */
export function featurePreview(feature: GeometryFeature, options: FeaturePreviewOptions = {}): FeaturePreviewContent | null {
  const config = resolveFeaturePreview(options);
  if (config.enabled === false) return null;
  const properties = feature.properties ?? {};
  const titleKey = config.titleProperty === undefined ? 'name' : config.titleProperty;
  const title = titleKey !== null && Object.hasOwn(properties, titleKey) ? properties[titleKey] : undefined;
  const locale = config.locale ?? 'en'; const units = config.units ?? 'metric';
  const geometryRows: FeaturePreviewContent['rows'] = [];
  const geometry = feature.geometry; const settings = config.geometry ?? {};
  if (geometry.type === 'Point') {
    if (settings.coordinates !== false) geometryRows.push({ label: 'Latitude', value: geometry.coordinates[1].toFixed(6) }, { label: 'Longitude', value: geometry.coordinates[0].toFixed(6) });
  } else if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    if (settings.area !== false || settings.perimeter !== false) {
      const measurement = measure(geometry);
      if (settings.area !== false) geometryRows.push({ label: 'Area', value: formatArea(measurement.area, units, locale) });
      if (settings.perimeter !== false) geometryRows.push({ label: 'Perimeter', value: formatDistance(measurement.perimeter, units, locale) });
    }
  } else if (settings.length !== false) geometryRows.push({ label: 'Length', value: formatDistance(measure(geometry).length, units, locale) });
  const fields: FeaturePreviewField[] = (config.fields ?? Object.keys(properties).filter(key => !internal.has(key) && key !== titleKey).map(key => ({ key })))
    .filter(field => Object.hasOwn(properties, field.key));
  const visible = fields.slice(0, Math.max(0, (config.maxRows ?? 5) - geometryRows.length));
  return {
    title: bound(title === null || title === undefined || title === '' || typeof title === 'object' ? String(feature.id) : String(title), 200),
    rows: [...visible.map(field => ({ label: bound(field.label || field.key, 120), value: bound(format(properties[field.key]!, field, locale), 1000) })), ...geometryRows],
    omittedFields: fields.length - visible.length,
  };
}
