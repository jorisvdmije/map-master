export { GeometryEditor } from './maplibre/geometry-editor.js';
export { LineEditor } from './maplibre/line-editor.js';
export type {
  // Geometry and identity.
  Coordinate, FeatureId, FeatureProperties, JsonValue,
  GeometryFeature, GeometryFeatureCollection, GeometryType,
  LineCollection, LineFeature, PolygonFeature,
  // Editor state and configuration.
  EditorOptions, EditorState, ValidationError,
  SnappingOptions, SnapResult, SplitPreview, SplitError,
  // Committed changes and history.
  FeatureChange, FeatureTransaction, TransactionEvent, HistoryAction, HistoryEvent,
} from './core/types.js';
export { GeoJSONImportError } from './core/geojson-import.js';
export type { ImportErrorCode } from './core/geojson-import.js';
