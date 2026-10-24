export { GeometryEditor } from './maplibre/geometry-editor.js';
export { LineEditor } from './maplibre/line-editor.js';
export type {
  // Geometry and identity.
  Coordinate, FeatureId, FeatureProperties, JsonValue,
  GeometryFeature, GeometryFeatureCollection, GeometryType, DrawGeometryType,
  LineCollection, LineFeature, PolygonFeature, MultiLineFeature, MultiPolygonFeature,
  // Editor state and configuration.
  EditorOptions, EditorState, ValidationError,
  RotationError, SharedBoundaryPreview, SharedBoundaryError, TraceTarget, TraceSide, TracingOptions, SnappingOptions, SnapResult, ReshapePreview, ReshapeError, ReshapeSide, SplitPreview, SplitError, UnionPreview, UnionError, DifferencePreview, DifferenceError, IntersectionPreview, IntersectionError,
  // Committed changes and history.
  FeatureChange, FeatureTransaction, TransactionEvent, HistoryAction, HistoryEvent,
} from './core/types.js';
export { GeoJSONImportError } from './core/geojson-import.js';
export type { ImportErrorCode } from './core/geojson-import.js';
