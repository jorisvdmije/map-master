import { validateFeatureStyle, type FeatureStyle } from './feature-styling.js';
import { withGeometry } from './geometry.js';
import type { FeatureChange, FeatureId, GeometryFeature } from './types.js';

export const defaultDataLayerId = 'default';
export type DataLayerSelectionScope = 'all' | 'active';
/** Ordered bottom to top. Configuration belongs to the host; membership belongs to features. */
export interface DataLayer {
  id: string;
  name: string;
  visible: boolean;
  editable: boolean;
  locked: boolean;
  selectable: boolean;
  snapping: boolean;
  /** Base style; per-feature styles can override individual fields. */
  style: FeatureStyle;
}
export type DataLayerDefinition = Pick<DataLayer, 'id'> & Partial<Omit<DataLayer, 'id'>>;
export interface DataLayerOptions {
  layers?: readonly DataLayerDefinition[];
  activeLayerId?: string | null;
  selectionScope?: DataLayerSelectionScope;
}
export interface DataLayerExportOptions { dataLayerId?: string; visibleOnly?: boolean }
export interface DataLayerImportOptions { dataLayerId?: string }
export type DataLayerIssueCode = 'unknown-layer' | 'hidden-layer' | 'locked-layer' | 'readonly-layer' | 'no-active-layer' | 'unselectable-layer';
export interface DataLayerIssue { featureId: FeatureId | null; layerId: string | null; code: DataLayerIssueCode }
export class DataLayerError extends Error {
  readonly issues: DataLayerIssue[];
  constructor(issues: readonly DataLayerIssue[]) {
    super(issues.map(issue => `${issue.featureId === null ? 'Data layer' : `Feature ${JSON.stringify(issue.featureId)}`}: ${issue.code} (${JSON.stringify(issue.layerId)}).`).join(' '));
    this.name = 'DataLayerError'; this.issues = issues.map(issue => ({ ...issue }));
  }
}

function validId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new TypeError('Data layer IDs must be nonempty strings of at most 200 characters.');
  try { encodeURIComponent(value); } catch { throw new TypeError('Data layer IDs must contain valid Unicode.'); }
}

/** The reserved property is validated even before layer definitions are available. */
export function featureDataLayerId(feature: Pick<GeometryFeature, 'properties'>): string {
  const id = feature.properties?.mapMasterLayer;
  if (id === undefined) return defaultDataLayerId;
  validId(id); return id;
}

export function assignDataLayer(feature: GeometryFeature, id: string): GeometryFeature {
  validId(id);
  if (id === defaultDataLayerId && !Object.hasOwn(feature.properties ?? {}, 'mapMasterLayer')) return feature;
  return withGeometry({ ...feature, properties: { ...feature.properties, mapMasterLayer: id } }, feature.geometry);
}

export function normalizeDataLayers(input: readonly DataLayerDefinition[] = []): DataLayer[] {
  if (!Array.isArray(input)) throw new TypeError('Data layers must be an array.');
  const ids = new Set<string>();
  const layers = (input as readonly DataLayerDefinition[]).map(spec => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec) || Object.keys(spec).some(key => !['id', 'name', 'visible', 'editable', 'locked', 'selectable', 'snapping', 'style'].includes(key))) throw new TypeError('Invalid data layer definition.');
    validId(spec.id);
    if (ids.has(spec.id)) throw new RangeError(`Duplicate data layer ID: ${spec.id}`);
    ids.add(spec.id);
    const layer: DataLayer = { name: spec.id, visible: true, editable: true, locked: false, selectable: true, snapping: true, ...spec, style: validateFeatureStyle(spec.style === undefined ? {} : spec.style) };
    if (typeof layer.name !== 'string' || !layer.name.trim()) throw new TypeError('Data layer names must be nonempty strings.');
    for (const key of ['visible', 'editable', 'locked', 'selectable', 'snapping'] as const) if (typeof layer[key] !== 'boolean') throw new TypeError(`Data layer ${key} must be boolean.`);
    return layer;
  });
  if (!ids.has(defaultDataLayerId)) layers.unshift({ id: defaultDataLayerId, name: 'Default', visible: true, editable: true, locked: false, selectable: true, snapping: true, style: {} });
  return layers;
}

/** Fast membership/policy lookup; no browser or geometry dependencies. */
export class DataLayerStore {
  readonly layers: readonly DataLayer[];
  private readonly byId: ReadonlyMap<string, DataLayer>;
  constructor(input?: readonly DataLayerDefinition[]) {
    this.layers = normalizeDataLayers(input); this.byId = new Map(this.layers.map(layer => [layer.id, layer]));
  }
  get(id: string): DataLayer | undefined { return this.byId.get(id); }
  snapshot(): DataLayer[] { return this.layers.map(layer => ({ ...layer, style: validateFeatureStyle(layer.style) })); }
  issue(id: string | null, featureId: FeatureId | null = null): DataLayerIssue | null {
    const layer = id === null ? undefined : this.get(id);
    const code = id === null ? 'no-active-layer' : !layer ? 'unknown-layer' : !layer.visible ? 'hidden-layer' : layer.locked ? 'locked-layer' : !layer.editable ? 'readonly-layer' : null;
    return code ? { featureId, layerId: id, code } : null;
  }
  assertWritable(id: string | null, featureId: FeatureId | null = null): void {
    const issue = this.issue(id, featureId); if (issue) throw new DataLayerError([issue]);
  }
  assertKnown(id: string, featureId: FeatureId | null = null): void {
    if (!this.get(id)) throw new DataLayerError([{ featureId, layerId: id, code: 'unknown-layer' }]);
  }
  assertChanges(changes: readonly FeatureChange[]): void {
    for (const { before, after } of changes) {
      if (after) this.assertKnown(featureDataLayerId(after), after.id);
      if (before) {
        this.assertWritable(featureDataLayerId(before), before.id);
        if (after) this.assertWritable(featureDataLayerId(after), after.id);
      }
    }
  }
}
