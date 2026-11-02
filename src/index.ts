export type { AlignmentGuidesOptions, AlignmentGuide, AlignmentResult } from './core/alignment-guides.js';
export { VertexPinError } from './core/vertex-pins.js';
export { GeofencingError } from './core/geofencing.js';
export { DataLayerError, defaultDataLayerId, featureDataLayerId } from './core/data-layers.js';
export type { DataLayer, DataLayerDefinition, DataLayerOptions, DataLayerSelectionScope, DataLayerIssue, DataLayerIssueCode, DataLayerExportOptions, DataLayerImportOptions } from './core/data-layers.js';
export type { GeofenceArea, GeofencingOptions, GeofencingViolation, GeofencingViolationCode } from './core/geofencing.js';
export type { VertexAddress, VertexPin, PinnedVertexGroup, PinVerticesOptions, PinningErrorCode } from './core/vertex-pins.js';
export { defaultShapeTemplates } from './core/shape-templates.js';
export type { ShapeTemplate, ShapeTemplateFeature, TemplatePlacement, TemplateDraft, TemplatePlacementError } from './core/shape-templates.js';
export { isTextMarker } from './core/text-marker.js';
export type { TextMarkerOptions, TextMarkerStyle, TextMarkerFeature } from './core/text-marker.js';
export type { FeatureStyle, FeatureStyleResolver, SelectionStyle, OverlapMember, OverlapPalette, OverlapStyle, EditorStylingOptions, StylingIssue } from './core/feature-styling.js';
export { FeatureLockedError } from './core/feature-locks.js';
export { GeometryEditor } from './maplibre/geometry-editor.js';
export type { KeyboardAction, KeyboardShortcuts, ResolvedKeyboardShortcuts, KeyBinding, ShortcutModifier } from './core/keyboard-shortcuts.js';
export { LineEditor } from './maplibre/line-editor.js';
export { EditorToolbar } from './maplibre/toolbar.js';
export { DataLayerControl } from './maplibre/data-layer-control.js';
export type { DataLayerControlOptions, DataLayerControlLabels } from './maplibre/data-layer-control.js';
export type { ToolbarButton, ToolbarLabelKey, ToolbarLabels, ToolbarOptions, ToolbarTool } from './maplibre/toolbar.js';
export { measure, formatArea, formatDistance } from './core/measurement.js';
export type { Measurement } from './core/measurement.js';
export type { DrawShape } from './core/shapes.js';
export type { EditorAppearance, EditorAppearanceOptions, ShapeAppearance, DraftAppearance, PointAppearance, VertexAppearance, SnapAppearance, PolygonOutlineAppearance } from './core/appearance.js';
export type {
  // Geometry and identity.
  Coordinate, CutFeedback, FeatureId, FeatureProperties, JsonValue,
  GeometryFeature, GeometryFeatureCollection, GeometryType, DrawGeometryType,
  PointFeature, LineCollection, LineFeature, PolygonFeature, MultiLineFeature, MultiPolygonFeature,
  // Editor state and configuration.
  DrawingConstraintsOptions, EditorMode, EditorOptions, MeasurementOptions, MeasurementUnits, EditorState, VertexUpdate, ValidationError, LassoOptions,
  OffsetError, BufferError, SimplificationError, ScaleError, RotationError, SharedBoundaryPreview, SharedBoundaryError, TraceTarget, TraceSide, TracingOptions, SnappingOptions, SnapResult, ReshapePreview, ReshapeError, ReshapeSide, SplitPreview, SplitError, UnionPreview, UnionError, DifferencePreview, DifferenceError, IntersectionPreview, IntersectionError,
  // Committed changes and history.
  DataChangeEvent, DataChangeSource, FeatureChange, FeatureTransaction, TransactionEvent, HistoryAction, HistoryEvent,
} from './core/types.js';
export { GeoJSONImportError } from './core/geojson-import.js';
export type { ImportErrorCode } from './core/geojson-import.js';
