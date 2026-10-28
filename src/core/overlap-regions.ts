import { project, unproject, validateTransformPivot } from './mercator-transform.js';
import polygonClipping from 'polygon-clipping';
import type { Coordinate, FeatureId, GeometryFeature, PolygonFeature, MultiPolygonFeature } from './types.js';

type Bounds = [number, number, number, number];
export interface OverlapRegion {
  members: FeatureId[];
  coordinates: Coordinate[][][];
  bounds: Bounds;
}
const boundsOf = (parts: Coordinate[][][]): Bounds => {
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const part of parts) for (const ring of part) for (const [x, y] of ring) {
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
  }
  return bounds;
};
const intersects = (a: Bounds, b: Bounds) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
export const compareFeatureIds = (a: FeatureId, b: FeatureId): number => {
  const x = JSON.stringify(a); const y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0;
};

/** Disjoint display cells, not document features. Bound work before invoking the overlay engine. */
export function overlapRegions(features: readonly GeometryFeature[]): OverlapRegion[] {
  const polygons = features.filter((feature): feature is PolygonFeature | MultiPolygonFeature => feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')
    .sort((a, b) => compareFeatureIds(a.id, b.id));
  if (polygons.length > 1000) throw new RangeError('Overlap styling supports at most 1,000 polygons.');
  let vertices = 0;
  const inputs = polygons.map(feature => {
    const original = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const coordinates = original.map(part => part.map(ring => ring.map(point => { validateTransformPivot(point); return project(point); })));
    for (const part of coordinates) for (const ring of part) vertices += ring.length;
    return { members: [feature.id], coordinates, bounds: boundsOf(coordinates) };
  });
  if (vertices > 20000) throw new RangeError('Overlap styling supports at most 20,000 input vertices.');
  let cells: OverlapRegion[] = []; let operations = 0; let outputVertices = 0;
  const cell = (members: FeatureId[], coordinates: Coordinate[][][]): OverlapRegion[] => {
    for (const part of coordinates) for (const ring of part) outputVertices += ring.length;
    if (outputVertices > 200000) throw new RangeError('Overlap styling output budget exceeded.');
    return coordinates.length ? [{ members, coordinates, bounds: boundsOf(coordinates) }] : [];
  };
  for (const input of inputs) {
    let remaining = input.coordinates;
    const next: OverlapRegion[] = [];
    for (const existing of cells) {
      if (!intersects(existing.bounds, input.bounds)) { next.push(existing); continue; }
      if (++operations > 10000) throw new RangeError('Overlap styling operation budget exceeded.');
      const intersection = polygonClipping.intersection(existing.coordinates, input.coordinates);
      if (!intersection.length) { next.push(existing); continue; }
      next.push(...cell(existing.members, polygonClipping.difference(existing.coordinates, input.coordinates)));
      next.push(...cell([...existing.members, ...input.members], intersection));
      remaining = polygonClipping.difference(remaining, existing.coordinates);
    }
    next.push(...cell(input.members, remaining));
    if (next.length > 4096) throw new RangeError('Overlap styling region budget exceeded.');
    cells = next;
  }
  return cells.map(region => ({ ...region, coordinates: region.coordinates.map(part => part.map(ring => ring.map(unproject))) }));
}
