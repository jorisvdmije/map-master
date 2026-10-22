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

export interface EditorState {
  mode: 'idle' | 'draw-line' | 'draw-polygon' | 'edit-line' | 'edit-polygon';
  vertexCount: number;
  featureCount: number;
  /** UI selection only; never serialized into GeoJSON. */
  selectedFeatureId: FeatureId | null;
  /** Zero-based index in the open editing draft, without a polygon's closing copy. */
  selectedVertexIndex: number | null;
  /** Increases on committed creation, deletion, changed edits, and nonempty imports only. */
  dataRevision: number;
  canFinish: boolean;
  /** Why the clicked draft cannot be committed; null when valid or idle. */
  validationError: ValidationError | null;
}
