import type { Coordinate, GeometryFeature, LineFeature, PolygonFeature } from './types.js';

export type Geometry = GeometryFeature['geometry'];
export type GeometryPart = LineFeature['geometry'] | PolygonFeature['geometry'];

/** Component views share coordinates; mutate them only when the input is an isolated snapshot. */
export function geometryParts(geometry: Geometry): GeometryPart[] {
  switch (geometry.type) {
    case 'LineString': case 'Polygon': return [geometry];
    case 'MultiLineString': return geometry.coordinates.map((coordinates) => ({ type: 'LineString', coordinates }));
    case 'MultiPolygon': return geometry.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }));
  }
}

/** Map every position without changing geometry type, component/ring order or cardinality. */
export function mapGeometry(geometry: Geometry, map: (point: Coordinate) => Coordinate): Geometry {
  switch (geometry.type) {
    case 'LineString': return { type: geometry.type, coordinates: geometry.coordinates.map(map) };
    case 'Polygon': case 'MultiLineString':
      return { type: geometry.type, coordinates: geometry.coordinates.map((ring) => ring.map(map)) };
    case 'MultiPolygon': return { type: geometry.type, coordinates: geometry.coordinates.map((part) => part.map((ring) => ring.map(map))) };
  }
}

/** Keep the discriminated feature union intact when replacing a geometry. */
export function withGeometry(feature: Pick<GeometryFeature, 'id' | 'properties'>, geometry: Geometry): GeometryFeature {
  const common = { type: 'Feature' as const, id: feature.id, properties: feature.properties };
  switch (geometry.type) {
    case 'LineString': return { ...common, geometry };
    case 'Polygon': return { ...common, geometry };
    case 'MultiLineString': return { ...common, geometry };
    case 'MultiPolygon': return { ...common, geometry };
  }
}

/** Replace one component; keep multipart wrappers even when they contain one part. */
export function replacePart(geometry: Geometry, index: number, part: GeometryPart): Geometry {
  if (geometry.type === 'MultiLineString' && part.type === 'LineString') {
    return { type: geometry.type, coordinates: geometry.coordinates.map((coordinates, i) => i === index ? part.coordinates : coordinates) };
  }
  if (geometry.type === 'MultiPolygon' && part.type === 'Polygon') {
    return { type: geometry.type, coordinates: geometry.coordinates.map((coordinates, i) => i === index ? part.coordinates : coordinates) };
  }
  if (index === 0 && geometry.type === part.type) return part;
  throw new Error('Component type does not match its geometry.');
}
