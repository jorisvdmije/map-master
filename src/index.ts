export { FeatureLockedError } from './core/feature-locks.js';
export { GeometryEditor } from './maplibre/geometry-editor.js';
export { LineEditor } from './maplibre/line-editor.js';
export type { EditorAppearance, EditorAppearanceOptions, ShapeAppearance, DraftAppearance, PointAppearance, VertexAppearance, SnapAppearance } from './core/appearance.js';
export type {
  // Geometry and identity.
  Coordinate, FeatureId, FeatureProperties, JsonValue,
  GeometryFeature, GeometryFeatureCollection, GeometryType, DrawGeometryType,
  PointFeature, LineCollection, LineFeature, PolygonFeature, MultiLineFeature, MultiPolygonFeature,
  // Editor state and configuration.
  DrawingConstraintsOptions, EditorOptions, EditorState, VertexUpdate, ValidationError,
  OffsetError, BufferError, SimplificationError, ScaleError, RotationError, SharedBoundaryPreview, SharedBoundaryError, TraceTarget, TraceSide, TracingOptions, SnappingOptions, SnapResult, ReshapePreview, ReshapeError, ReshapeSide, SplitPreview, SplitError, UnionPreview, UnionError, DifferencePreview, DifferenceError, IntersectionPreview, IntersectionError,
  // Committed changes and history.
  FeatureChange, FeatureTransaction, TransactionEvent, HistoryAction, HistoryEvent,
} from './core/types.js';
export { GeoJSONImportError } from './core/geojson-import.js';
export type { ImportErrorCode } from './core/geojson-import.js';
