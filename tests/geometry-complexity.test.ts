import { expect, it } from 'vitest';
import { assertGeometryComplexity, GeometryComplexityError } from '../src/core/geometry-complexity.js';
import { validateGeoJSON } from '../src/core/geojson-import.js';
const polygon = (length: number) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [Array.from({ length }, (_, i) => [i, 0])] } });
it('rejects a small file with an oversized ring before topology or coordinate checks', () => {
  expect(() => validateGeoJSON(polygon(2001))).toThrow(GeometryComplexityError);
  expect(() => assertGeometryComplexity(polygon(2000))).not.toThrow();
});
it('bounds aggregate import and multipart complexity', () => {
  expect(() => assertGeometryComplexity({ type: 'FeatureCollection', features: Array.from({ length: 201 }, () => ({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: Array.from({ length: 1000 }, () => [0, 0]) } })) })).toThrow(/200,000/);
  expect(() => assertGeometryComplexity({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: Array.from({ length: 5 }, () => polygon(1000).geometry.coordinates) } })).toThrow(/MultiPolygon/);
});
