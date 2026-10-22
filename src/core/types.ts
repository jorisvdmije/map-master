/** GeoJSON position in longitude, latitude order (decimal degrees). */
export type Coordinate = [longitude: number, latitude: number];

/** GeoJSON identity; numeric 7 and string "7" are distinct. */
export type FeatureId = string | number;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type FeatureProperties = { [key: string]: JsonValue } | null;

export interface LineFeature {
  type: 'Feature';
  id: FeatureId;
  geometry: { type: 'LineString'; coordinates: Coordinate[] };
  properties: FeatureProperties;
}

export interface LineCollection {
  type: 'FeatureCollection';
  features: LineFeature[];
}

export interface PolygonFeature {
  type: 'Feature';
  id: FeatureId;
  geometry: { type: 'Polygon'; coordinates: Coordinate[][] };
  properties: FeatureProperties;
}

export type GeometryType = 'LineString' | 'Polygon';
export type GeometryFeature = LineFeature | PolygonFeature;

export interface GeometryFeatureCollection {
  type: 'FeatureCollection';
  features: GeometryFeature[];
}

export type ValidationError = 'too-few-vertices' | 'duplicate-vertex'
  | 'zero-area' | 'self-intersection' | 'antimeridian-crossing';

export interface SnappingOptions {
  enabled: boolean;
  /** Acquisition radius in CSS pixels, default 18, range (0, 100]. */
  distance: number;
  vertices: boolean;
  edges: boolean;
}
export interface SnapResult {
  kind: 'vertex' | 'edge';
  /** null identifies the current polygon's first corner (click to close). */
  featureId: FeatureId | null;
  /** Vertex index or segment start index in the open ring/line. */
  index: number;
  coordinate: Coordinate;
  distance: number;
}

export interface EditorOptions {
  /** Maximum retained actions, default 100; 0 disables history. Not a byte limit. */
  historyLimit?: number;
  /** Drawing snapping is opt-in; vertices/edges default true, distance defaults to 18. */
  snapping?: Partial<SnappingOptions>;
}

/** Full feature replacements with explicit IDs. An ID may occur only once per transaction. */
export interface FeatureTransaction {
  create?: GeometryFeature[];
  update?: GeometryFeature[];
  delete?: FeatureId[];
}
export interface TransactionEvent {
  changes: FeatureChange[];
}

export type HistoryAction = 'create' | 'edit' | 'delete' | 'import' | 'transaction';
export interface FeatureChange {
  before: GeometryFeature | null;
  after: GeometryFeature | null;
}
export interface HistoryEvent {
  direction: 'undo' | 'redo';
  /** The original action being reversed or replayed. */
  action: HistoryAction;
  /** Snapshots in the direction applied, not necessarily the original direction. */
  changes: FeatureChange[];
}

export interface EditorState {
  mode: 'idle' | 'draw-line' | 'draw-polygon' | 'edit-line' | 'edit-polygon';
  vertexCount: number;
  featureCount: number;
  /** UI selection only; never serialized into GeoJSON. */
  selectedFeatureId: FeatureId | null;
  /** Zero-based index in the open editing draft, without a polygon's closing copy. */
  selectedVertexIndex: number | null;
  /** Increases on committed creation, deletion, changed edits, nonempty imports, and successful undo/redo. */
  dataRevision: number;
  canFinish: boolean;
  /** False during drawing/editing, even if retained history exists. */
  canUndo: boolean;
  canRedo: boolean;
  /** Why the clicked draft cannot be committed; null when valid or idle. */
  validationError: ValidationError | null;
}
