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

export interface MultiLineFeature {
  type: 'Feature';
  id: FeatureId;
  geometry: { type: 'MultiLineString'; coordinates: Coordinate[][] };
  properties: FeatureProperties;
}

export interface MultiPolygonFeature {
  type: 'Feature';
  id: FeatureId;
  geometry: { type: 'MultiPolygon'; coordinates: Coordinate[][][] };
  properties: FeatureProperties;
}

export type DrawGeometryType = 'LineString' | 'Polygon';
export type GeometryType = DrawGeometryType | 'MultiLineString' | 'MultiPolygon';
export type GeometryFeature = LineFeature | PolygonFeature | MultiLineFeature | MultiPolygonFeature;

export interface GeometryFeatureCollection {
  type: 'FeatureCollection';
  features: GeometryFeature[];
}

export type ValidationError = 'too-few-vertices' | 'duplicate-vertex'
  | 'zero-area' | 'self-intersection' | 'antimeridian-crossing'
  | 'ring-intersection' | 'hole-outside' | 'nested-holes' | 'part-intersection' | 'part-overlap';

export type SplitError = 'split-too-few-points' | 'split-self-intersection' | 'split-antimeridian'
  | 'split-hole-crossing' | 'split-boundary-touch' | 'split-endpoints-inside' | 'split-crossing-count' | 'split-invalid-result';
export interface SplitPreview {
  retained: PolygonFeature['geometry'];
  created: PolygonFeature['geometry'];
}

export type ScaleError = 'scale-out-of-bounds' | 'scale-invalid-result';
export type RotationError = 'rotation-out-of-bounds' | 'rotation-invalid-result';

/** Two complete polygon previews in selection order. */
export interface SharedBoundaryPreview {
  type: 'FeatureCollection';
  features: [PolygonFeature, PolygonFeature];
}
export type SharedBoundaryError = 'shared-boundary-invalid-result' | 'shared-boundary-overlap' | 'shared-boundary-calculation-failed';

/** Which old boundary arc to replace; length is measured in planar coordinate units. */
export type ReshapeSide = 'shorter' | 'longer';
export type ReshapePreview = PolygonFeature['geometry'];
export type ReshapeError = 'reshape-too-few-points' | 'reshape-endpoints-off-boundary' | 'reshape-same-endpoint'
  | 'reshape-self-intersection' | 'reshape-boundary-touch' | 'reshape-antimeridian' | 'reshape-invalid-result';

/** Result geometry before confirmation; no new ID is allocated. */
export type UnionPreview = PolygonFeature['geometry'] | MultiPolygonFeature['geometry'];
export type UnionError = 'union-failed' | 'union-invalid-result';

/** A valid preview. Null geometry means confirmation deletes the target. */
export interface DifferencePreview {
  geometry: PolygonFeature['geometry'] | MultiPolygonFeature['geometry'] | null;
}
export type DifferenceError = 'difference-failed' | 'difference-invalid-result';

/** A valid preview. Null geometry means confirmation deletes every selected input. */
export interface IntersectionPreview {
  geometry: PolygonFeature['geometry'] | MultiPolygonFeature['geometry'] | null;
}
export type IntersectionError = 'intersection-failed' | 'intersection-invalid-result';

/** One source path; omitted part/ring indices mean zero. */
export interface TraceTarget {
  featureId: FeatureId;
  partIndex?: number;
  ringIndex?: number;
}
export type TraceSide = 'shorter' | 'longer';
export interface TracingOptions {
  enabled: boolean;
  /** Ring arc length in longitude/latitude units; open lines have one route. */
  side: TraceSide;
}

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
  /** Polygon ring index (0 = exterior); absent for lines and closure targets. */
  ringIndex?: number;
  /** Multipart component index; absent for simple geometries and closure targets. */
  partIndex?: number;
  coordinate: Coordinate;
  distance: number;
}

export interface EditorOptions {
  /** Maximum retained actions, default 100; 0 disables history. Not a byte limit. */
  historyLimit?: number;
  /** Drawing and vertex-drag snapping is opt-in; vertices/edges default true, distance defaults to 18. */
  snapping?: Partial<SnappingOptions>;
  /** Opt-in boundary tracing while drawing; uses ordinary snapping acquisition. */
  tracing?: Partial<TracingOptions>;
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
  mode: 'idle' | 'draw-line' | 'draw-polygon' | 'edit-line' | 'edit-polygon' | 'split-polygon' | 'draw-hole' | 'union-polygons' | 'difference-polygons' | 'intersection-polygons' | 'reshape-polygon' | 'edit-shared-boundary' | 'rotate-features' | 'scale-features';
  vertexCount: number;
  featureCount: number;
  /** The sole selected ID, or null for zero/multiple selections. */
  selectedFeatureId: FeatureId | null;
  /** UI selection in acquisition order; never serialized into GeoJSON or history. */
  selectedFeatureIds: FeatureId[];
  /** Zero-based index in the open editing draft, without a polygon's closing copy. */
  selectedVertexIndex: number | null;
  /** Active polygon ring while editing/drawing a hole; otherwise null. */
  activeRingIndex: number | null;
  /** Component being edited (0 for simple geometries); null outside editing/hole drawing. */
  activePartIndex: number | null;
  /** Increases on committed creation, deletion, changed edits, nonempty imports, and successful undo/redo. */
  dataRevision: number;
  canFinish: boolean;
  /** False during drawing/editing, even if retained history exists. */
  canUndo: boolean;
  canRedo: boolean;
  /** Why the clicked draft cannot be committed; null when valid or idle. */
  validationError: ValidationError | null;
  /** Split diagnostics are separate from ordinary drawing validation. */
  splitError: SplitError | null;
  sharedBoundaryError: SharedBoundaryError | null;
  /** Clockwise degrees in (-180, 180]; null outside rotation. */
  rotationAngle: number | null;
  /** Fixed geographic pivot; an independent snapshot, null outside rotation. */
  rotationPivot: Coordinate | null;
  rotationError: RotationError | null;
  /** Positive uniform factor from entry geometry; null outside scaling. */
  scaleFactor: number | null;
  /** Fixed geographic pivot; an independent snapshot, null outside scaling. */
  scalePivot: Coordinate | null;
  scaleError: ScaleError | null;
  reshapeError: ReshapeError | null;
  /** Selected old boundary arc; null outside reshape. */
  reshapeSide: ReshapeSide | null;
  /** Overlay calculation or strict result-topology failure; null outside union. */
  unionError: UnionError | null;
  /** Subtraction failure; an empty result is valid and has no error. */
  differenceError: DifferenceError | null;
  /** Overlay failure; null outside intersection and for valid empty results. */
  intersectionError: IntersectionError | null;
}
