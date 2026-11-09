/** Preflight budgets bound quadratic topology checks before any heavy work. */
export const geometryLimits = { totalPositions: 200_000, polygonPositions: 4_000, ringPositions: 2_000 } as const;

export class GeometryComplexityError extends RangeError {
  constructor(readonly path: string, detail: string) { super(`${path}: ${detail}`); this.name = 'GeometryComplexityError'; }
}

/** Count coordinates by declared shape, without traversing arbitrary properties. */
export function assertGeometryComplexity(input: unknown): void {
  let total = 0;
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const count = (value: unknown, depth: number, path: string): number => {
    if (!Array.isArray(value)) return 0; // Structural errors belong to the geometry parser.
    if (depth === 0) {
      if (++total > geometryLimits.totalPositions) throw new GeometryComplexityError(path, 'Import exceeds 200,000 coordinate positions.');
      return 1;
    }
    if (depth === 1 && value.length > geometryLimits.totalPositions) throw new GeometryComplexityError(path, 'Coordinate array exceeds the import budget.');
    return (value as unknown[]).reduce<number>((sum, item: unknown, i) => sum + count(item, depth - 1, `${path}[${i}]`), 0);
  };
  const polygon = (value: unknown, path: string): number => {
    if (!Array.isArray(value)) return 0;
    return (value as unknown[]).reduce<number>((sum, ring: unknown, i) => {
      if (Array.isArray(ring) && ring.length > geometryLimits.ringPositions) throw new GeometryComplexityError(`${path}[${i}]`, 'Ring exceeds 2,000 coordinate positions; simplify before importing.');
      const next = sum + count(ring, 1, `${path}[${i}]`);
      if (next > geometryLimits.polygonPositions) throw new GeometryComplexityError(path, 'Polygon exceeds 4,000 coordinate positions.');
      return next;
    }, 0);
  };
  const values = record(input) && input.type === 'FeatureCollection' && Array.isArray(input.features) ? input.features : [input];
  for (let index = 0; index < values.length; index++) {
    const feature: unknown = values[index];
    if (!record(feature) || !record(feature.geometry)) continue;
    const geometry = feature.geometry, path = `$.features[${index}].geometry.coordinates`;
    if (geometry.type === 'Polygon') polygon(geometry.coordinates, path);
    else if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
      let positions = 0;
      for (let i = 0; i < geometry.coordinates.length; i++) {
        positions += polygon(geometry.coordinates[i], `${path}[${i}]`);
        if (positions > geometryLimits.polygonPositions) throw new GeometryComplexityError(path, 'MultiPolygon exceeds 4,000 coordinate positions.');
      }
    } else if (geometry.type === 'Point') count(geometry.coordinates, 0, path);
    else if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') count(geometry.coordinates, 1, path);
    else if (geometry.type === 'MultiLineString') count(geometry.coordinates, 2, path);
  }
}
