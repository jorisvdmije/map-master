/** GeoJSON position in longitude, latitude order (decimal degrees). */
export type Coordinate = [longitude: number, latitude: number];

export interface LineFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'LineString'; coordinates: Coordinate[] };
  properties: Record<string, never>;
}

export interface LineCollection {
  type: 'FeatureCollection';
  features: LineFeature[];
}

export interface PolygonFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Polygon'; coordinates: Coordinate[][] };
  properties: Record<string, never>;
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
  mode: 'idle' | 'draw-line' | 'draw-polygon';
  vertexCount: number;
  featureCount: number;
  /** UI selection only; never serialized into GeoJSON. */
  selectedFeatureId: string | null;
  canFinish: boolean;
  /** Why the clicked draft cannot be committed; null when valid or idle. */
  validationError: ValidationError | null;
}
