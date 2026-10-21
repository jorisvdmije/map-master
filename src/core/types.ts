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

export interface EditorState {
  mode: 'idle' | 'draw-line';
  vertexCount: number;
  featureCount: number;
  canFinish: boolean;
}
