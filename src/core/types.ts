import type { EditorStylingOptions } from './feature-styling.js';
import type { EditorAppearanceOptions } from './appearance.js';

/** GeoJSON position in longitude, latitude order (decimal degrees). */
export type Coordinate = [longitude: number, latitude: number];

/** GeoJSON identity; numeric 7 and string "7" are distinct. */
export type FeatureId = string | number;
/** Any JSON-serializable value, as allowed in feature properties. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/** GeoJSON feature properties: a plain JSON object or null. */
export type FeatureProperties = { [key: string]: JsonValue } | null;

/** A GeoJSON Point feature (a marker). */
export interface PointFeature {
  type: 'Feature';
  id: FeatureId;
  geometry: { type: 'Point'; coordinates: Coordinate };
  properties: FeatureProperties;
}

/** A GeoJSON LineString feature. */
export interface LineFeature {
  type: 'Feature';
  id: FeatureId;
  geometry: { type: 'LineString'; coordinates: Coordinate[] };
  properties: FeatureProperties;
}

/** A FeatureCollection containing only lines, as returned by the deprecated `LineEditor`. */
export interface LineCollection {
  type: 'FeatureCollection';
  features: LineFeature[];
}

/** A GeoJSON Polygon feature. Ring 0 is the exterior; later rings are holes. */
export interface PolygonFeature {
  type: 'Feature';
  id: FeatureId;
  geometry: { type: 'Polygon'; coordinates: Coordinate[][] };
  properties: FeatureProperties;
}

/** A GeoJSON MultiLineString feature. */
export interface MultiLineFeature {
  type: 'Feature';
  id: FeatureId;
  geometry: { type: 'MultiLineString'; coordinates: Coordinate[][] };
  properties: FeatureProperties;
}

/** A GeoJSON MultiPolygon feature. */
export interface MultiPolygonFeature {
  type: 'Feature';
  id: FeatureId;
  geometry: { type: 'MultiPolygon'; coordinates: Coordinate[][][] };
  properties: FeatureProperties;
}

/** Geometry types that can be drawn interactively with `GeometryEditor.draw()`. */
export type DrawGeometryType = 'Point' | 'LineString' | 'Polygon';
/** Every geometry type the editor can store, import and export. */
export type GeometryType = DrawGeometryType | 'MultiLineString' | 'MultiPolygon';
/** Any feature stored by the editor. Coordinates are WGS84 `[longitude, latitude]`. */
export type GeometryFeature = PointFeature | LineFeature | PolygonFeature | MultiLineFeature | MultiPolygonFeature;

/** A GeoJSON FeatureCollection of editor features. */
export interface GeometryFeatureCollection {
  type: 'FeatureCollection';
  features: GeometryFeature[];
}

/** Why a drawn or edited geometry cannot be committed. */
export type ValidationError = 'too-few-vertices' | 'duplicate-vertex'
  | 'zero-area' | 'self-intersection' | 'antimeridian-crossing'
  | 'ring-intersection' | 'hole-outside' | 'nested-holes' | 'part-intersection' | 'part-overlap';

/** Map feedback for placed split/reshape points, never the hover cursor.
 * Empty problem arrays mean the failure has no reliably localized cause. */
export interface CutFeedback {
  contacts: Coordinate[];
  problemPoints: Coordinate[];
  problemSegments: Coordinate[][];
}
export type SplitError = 'split-too-few-points' | 'split-self-intersection' | 'split-antimeridian'
  | 'split-hole-crossing' | 'split-boundary-touch' | 'split-endpoints-inside' | 'split-crossing-count' | 'split-invalid-result';
export interface SplitPreview {
  retained: PolygonFeature['geometry'];
  created: PolygonFeature['geometry'];
}

export type OffsetError = 'offset-out-of-bounds' | 'offset-join-too-sharp' | 'offset-invalid-result';

export type BufferError = 'buffer-out-of-bounds' | 'buffer-failed' | 'buffer-invalid-result';

export type SimplificationError = 'simplification-invalid-result';
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

/** Pointer placement aid; exact snapping, tracing and polygon closure take precedence. */
export interface DrawingConstraintsOptions {
  enabled: boolean;
  /** Absolute north/east-aligned directions in the Mercator plane; default 45. */
  angleStep: 45 | 90;
}

/** Snapping settings; see `EditorOptions.snapping`. */
export interface SnappingOptions {
  enabled: boolean;
  /** Acquisition and release radius in CSS pixels, default 10, range (0, 100]. */
  distance: number;
  vertices: boolean;
  edges: boolean;
  /**
   * IDs of your own map layers to snap to as well, such as building footprints or parcels
   * from a vector tile source. Rendered geometry is used; default none.
   */
  layers: string[];
}
/** The snap target currently acquired by the pointer. */
export interface SnapResult {
  kind: 'vertex' | 'edge';
  /** null identifies the current polygon's first corner (click to close), or a map layer feature. */
  featureId: FeatureId | null;
  /** The map layer of a snap to rendered geometry from `SnappingOptions.layers`. */
  layer?: string;
  /** Vertex index or segment start index in the open ring/line. */
  index: number;
  /** Polygon ring index (0 = exterior); absent for lines and closure targets. */
  ringIndex?: number;
  /** Multipart component index; absent for simple geometries and closure targets. */
  partIndex?: number;
  coordinate: Coordinate;
  distance: number;
}

/** Unit system for measurement labels. */
export type MeasurementUnits = 'metric' | 'imperial';
/** Live measurement labels; see `EditorOptions.measurements`. */
export interface MeasurementOptions {
  enabled: boolean;
  /** `metric` (m, km, m², ha, km²) or `imperial` (ft, mi, ft², ac, mi²); default `metric`. */
  units: MeasurementUnits;
  /** BCP 47 locale for number formatting, such as `nl` for `1,5 km`; default `en`. */
  locale: string;
}

/** Options for `new GeometryEditor(map, options)`. Every option is optional. */
export interface EditorOptions {
  /** Named editable/reference datasets; omitted preserves the implicit default layer. */
  dataLayers?: import('./data-layers.js').DataLayerOptions;
  /** Host-owned allowed/excluded polygon areas; disabled by default. */
  geofencing?: Partial<import('./geofencing.js').GeofencingOptions>;
  /** Opt-in screen-space alignment to visible vertices and edge extensions. */
  alignmentGuides?: Partial<import('./alignment-guides.js').AlignmentGuidesOptions>;
  /** Reusable WGS84 templates; omitted uses the built-in arrow and star. */
  shapeTemplates?: readonly import('./shape-templates.js').ShapeTemplate[];
  /** Override map command bindings. Omitted actions retain defaults; false disables an action. */
  keyboardShortcuts?: import('./keyboard-shortcuts.js').KeyboardShortcuts | false;
  /** Host-owned read-only IDs. Initial imports are allowed; existing features cannot change. */
  lockedFeatureIds?: readonly FeatureId[];
  /** Partial presentation settings. Omitted values use the built-in appearance. */
  appearance?: EditorAppearanceOptions;
  /** Optional per-feature rules, selection overrides and striped overlap. */
  styling?: EditorStylingOptions;
  /** Opt-in angle constraints for new line, polygon and hole segments. Alt bypasses them. */
  drawingConstraints?: Partial<DrawingConstraintsOptions>;
  /** Maximum retained actions, default 100; 0 disables history. Not a byte limit. */
  historyLimit?: number;
  /** Drawing and vertex-drag snapping is opt-in; vertices/edges default true, distance defaults to 10. */
  snapping?: Partial<SnappingOptions>;
  /** Opt-in boundary tracing while drawing; uses ordinary snapping acquisition. */
  tracing?: Partial<TracingOptions>;
  /** Opt-in length and area labels while drawing and editing, and for a selected feature. */
  measurements?: Partial<MeasurementOptions>;
  /**
   * Generate the ID of each new feature, for example from a database sequence. Must return a
   * string or finite number; IDs already in use are skipped. Defaults to `crypto.randomUUID()`.
   */
  createId?: () => FeatureId;
}

/** Full feature replacements with explicit IDs. An ID may occur only once per transaction. */
export interface FeatureTransaction {
  create?: GeometryFeature[];
  update?: GeometryFeature[];
  delete?: FeatureId[];
}
/** The committed result of a transaction or transactional tool. */
export interface TransactionEvent {
  changes: FeatureChange[];
}

/** The kind of action recorded in undo/redo history. */
export type HistoryAction = 'create' | 'edit' | 'delete' | 'import' | 'transaction';
/** One feature before and after a committed change: `before: null` is a creation, `after: null` a deletion. */
export interface FeatureChange {
  before: GeometryFeature | null;
  after: GeometryFeature | null;
}
/** Emitted by `onHistory` after a successful undo or redo. */
export interface HistoryEvent {
  direction: 'undo' | 'redo';
  /** The original action being reversed or replayed. */
  action: HistoryAction;
  /** Snapshots in the direction applied, not necessarily the original direction. */
  changes: FeatureChange[];
}

/** What produced a committed data change reported by `onDataChange`. */
export type DataChangeSource = 'create' | 'update' | 'delete' | 'import' | 'transaction' | 'undo' | 'redo';

/** Every committed change to the stored features, from any tool, import, transaction or undo/redo. */
export interface DataChangeEvent {
  source: DataChangeSource;
  /** Committed snapshots in application order; `before: null` is a creation, `after: null` a deletion. */
  changes: FeatureChange[];
  /** `EditorState.dataRevision` after this change. */
  dataRevision: number;
}

/** An absolute coordinate update in the active open edit draft. */
export interface VertexUpdate { index: number; coordinate: Coordinate; }

/** How a lasso changes the current selection and which geometries qualify. */
export interface LassoOptions {
  /** Replace the selection, append new hits or remove hits. Default `replace`. */
  operation: 'replace' | 'add' | 'subtract';
  /** Touching counts for `intersects`; `contains` requires the whole feature. Default `intersects`. */
  match: 'intersects' | 'contains';
}

/** The active tool. `idle` means no draft, edit or preview is in progress. */
export type EditorMode = 'idle' | 'draw-template' | 'draw-text' | 'draw-point' | 'edit-point' | 'draw-line' | 'draw-polygon' | 'edit-line' | 'edit-polygon'
  | 'draw-rectangle' | 'draw-circle' | 'draw-ellipse' | 'draw-freehand' | 'draw-cut' | 'draw-part' | 'select-lasso'
  | 'split-polygon' | 'draw-hole' | 'remove-hole' | 'union-polygons' | 'difference-polygons' | 'intersection-polygons' | 'reshape-polygon'
  | 'edit-shared-boundary' | 'rotate-features' | 'scale-features' | 'simplify-features' | 'buffer-features' | 'offset-lines';

/** A snapshot of the editor, returned by `getState()` and emitted by `onChange`. */
export interface EditorState {
  mode: EditorMode;
  /** Why the anchored template cannot be placed; null outside template placement. */
  templateError: import('./shape-templates.js').TemplatePlacementError | null;
  vertexCount: number;
  featureCount: number;
  /** The sole selected ID, or null for zero/multiple selections. */
  selectedFeatureId: FeatureId | null;
  /** UI selection in acquisition order; never serialized into GeoJSON or history. */
  selectedFeatureIds: FeatureId[];
  /** Last selected index in the open editing draft, or null; no polygon closing copy. */
  selectedVertexIndex: number | null;
  /** Selected indices in acquisition order, scoped to the active component/ring. */
  selectedVertexIndices: number[];
  /** Active polygon ring while editing, drawing or removing a hole; otherwise null. */
  activeRingIndex: number | null;
  /** Active component (0 for simple geometries); null outside editing or hole operations. */
  activePartIndex: number | null;
  /** Increases on committed creation, deletion, changed edits, nonempty imports, and successful undo/redo. */
  dataRevision: number;
  /** Host configuration revision; changing layers does not change dataRevision/history. */
  dataLayerRevision: number;
  activeDataLayerId: string | null;
  dataLayerSelectionScope: import('./data-layers.js').DataLayerSelectionScope;
  canFinish: boolean;
  /** False during drawing/editing, even if retained history exists. */
  canUndo: boolean;
  canRedo: boolean;
  /** Why the clicked draft cannot be committed; null when valid or idle. */
  validationError: ValidationError | null;
  /** A linked participant prevents saving; the draft remains correctable. */
  pinningError: import('./vertex-pins.js').PinningErrorCode | null;
  /** Violations of the final active preview; incomplete geometry is checked after it becomes valid. */
  geofencingViolations: import('./geofencing.js').GeofencingViolation[];
  /** Split diagnostics are separate from ordinary drawing validation. */
  splitError: SplitError | null;
  sharedBoundaryError: SharedBoundaryError | null;
  /** Clockwise degrees in (-180, 180]; null outside rotation. */
  rotationAngle: number | null;
  /** Fixed geographic pivot; an independent snapshot, null outside rotation. */
  rotationPivot: Coordinate | null;
  rotationError: RotationError | null;
  /** Uniform factor; null outside scaling or when the axis factors differ. */
  scaleFactor: number | null;
  /** Positive Mercator axis factors from entry geometry; null outside scaling. */
  scaleFactorX: number | null;
  scaleFactorY: number | null;
  /** Fixed geographic pivot; an independent snapshot, null outside scaling. */
  scalePivot: Coordinate | null;
  scaleError: ScaleError | null;
  /** Nonnegative Mercator-plane meters; null outside simplification. */
  simplificationTolerance: number | null;
  simplificationError: SimplificationError | null;
  /** Positive Mercator-plane meters; null outside buffering. */
  bufferDistance: number | null;
  bufferError: BufferError | null;
  /** Signed Mercator-plane meters: positive left, negative right; null outside offset. */
  offsetDistance: number | null;
  offsetError: OffsetError | null;
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
