import polygonClipping from 'polygon-clipping';
import { geometryParts, mapGeometry } from './geometry.js';
import { prepareImport } from './geojson-import.js';
import { insideRing, onSegment, samePosition, segmentsIntersect } from './polygon.js';
import type { Coordinate, FeatureId, GeometryFeature, PolygonFeature, MultiPolygonFeature } from './types.js';

export interface GeofenceArea { id: string; geometry: PolygonFeature['geometry'] | MultiPolygonFeature['geometry'] }
/** Areas are host configuration, separate from editable data and history. */
export interface GeofencingOptions {
  enabled: boolean;
  allowed: readonly GeofenceArea[];
  excluded: readonly GeofenceArea[];
  /** Applies to the union of allowed areas; default contains. */
  allowedMatch: 'contains' | 'intersects';
  /** Applies to the union of excluded areas; default intersects. */
  excludedMatch: 'contains' | 'intersects';
}
export type GeofencingViolationCode = 'outside-allowed-area' | 'intersects-excluded-area' | 'inside-excluded-area' | 'geofencing-calculation-failed';
export interface GeofencingViolation { featureId: FeatureId | null; code: GeofencingViolationCode; areaIds: string[] }
export interface GeofencingCandidate { featureId: FeatureId | null; geometry: GeometryFeature['geometry'] }
/** A rejected batch never changes data, selection, history or data revision. */
export class GeofencingError extends Error {
  readonly violations: GeofencingViolation[];
  constructor(violations: readonly GeofencingViolation[]) {
    super(violations.map(violation => `${violation.featureId === null ? 'Draft' : `Feature ${JSON.stringify(violation.featureId)}`}: ${violation.code} (${violation.areaIds.join(', ')}).`).join(' '));
    this.name = 'GeofencingError'; this.violations = copyViolations(violations);
  }
}
export const copyViolations = (values: readonly GeofencingViolation[]): GeofencingViolation[] => values.map(value => ({ ...value, areaIds: [...value.areaIds] }));

export function geofencingOptions(update: Partial<GeofencingOptions> = {}, previous?: GeofencingOptions): GeofencingOptions {
  if (!update || typeof update !== 'object' || Array.isArray(update) || Object.keys(update).some(key => !['enabled', 'allowed', 'excluded', 'allowedMatch', 'excludedMatch'].includes(key))) throw new TypeError('Expected geofencing options.');
  const enabled = update.enabled === undefined ? previous?.enabled ?? false : update.enabled;
  const allowedMatch = update.allowedMatch === undefined ? previous?.allowedMatch ?? 'contains' : update.allowedMatch;
  const excludedMatch = update.excludedMatch === undefined ? previous?.excludedMatch ?? 'intersects' : update.excludedMatch;
  if (typeof enabled !== 'boolean' || !['contains', 'intersects'].includes(allowedMatch) || !['contains', 'intersects'].includes(excludedMatch)) throw new TypeError('Invalid geofencing enabled flag or matching rule.');
  const ids = new Set<string>();
  const areas = (input: readonly GeofenceArea[]): GeofenceArea[] => {
    if (!Array.isArray(input)) throw new TypeError('Geofence areas must be an array.');
    return (input as readonly GeofenceArea[]).map(area => {
      if (!area || typeof area.id !== 'string' || !area.id.trim() || ids.has(area.id)) throw new TypeError('Geofence area IDs must be nonempty and unique across both groups.');
      ids.add(area.id);
      const feature = prepareImport({ type: 'Feature', id: area.id, properties: null, geometry: area.geometry }, () => false, () => 'unused')[0]!;
      if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') throw new TypeError('Geofence areas must be polygons or multipolygons.');
      return { id: area.id, geometry: feature.geometry };
    });
  };
  return { enabled, allowedMatch, excludedMatch, allowed: areas(update.allowed === undefined ? previous?.allowed ?? [] : update.allowed), excluded: areas(update.excluded === undefined ? previous?.excluded ?? [] : update.excluded) };
}

type Region = Coordinate[][][];
type Edge = readonly [Coordinate, Coordinate];
const edges = (ring: Coordinate[]): Edge[] => ring.slice(1).map((point, index) => [ring[index]!, point]);
const boundary = (region: Region): Edge[] => region.flatMap(part => part.flatMap(edges));
const inside = (point: Coordinate, region: Region, border: readonly Edge[]): boolean => border.some(([a, b]) => onSegment(a, b, point))
  || region.some(([outer, ...holes]) => insideRing(point, outer!) && !holes.some(hole => insideRing(point, hole)));

function segmentInside(a: Coordinate, b: Coordinate, region: Region, border: readonly Edge[]): boolean {
  if (!inside(a, region, border) || !inside(b, region, border)) return false;
  if (samePosition(a, b)) return true;
  const rx = b[0] - a[0]; const ry = b[1] - a[1]; const length2 = rx * rx + ry * ry;
  const parameters = [0, 1];
  for (const [c, d] of border) {
    if (!segmentsIntersect(a, b, c, d)) continue;
    const sx = d[0] - c[0]; const sy = d[1] - c[1]; const denominator = rx * sy - ry * sx;
    if (denominator !== 0) {
      const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denominator;
      if (!Number.isFinite(t)) throw new Error('Unstable geofence intersection.');
      if (t > 0 && t < 1) parameters.push(t);
    } else for (const point of [c, d]) if (onSegment(a, b, point)) parameters.push(((point[0] - a[0]) * rx + (point[1] - a[1]) * ry) / length2);
  }
  parameters.sort((a, b) => a - b);
  return parameters.slice(1).every((t, index) => {
    const middle = (parameters[index]! + t) / 2;
    return inside([a[0] + rx * middle, a[1] + ry * middle], region, border);
  });
}

function matches(geometry: GeometryFeature['geometry'], region: Region, border: readonly Edge[], match: GeofencingOptions['allowedMatch']): boolean {
  const results = geometryParts(geometry).map(part => {
    if (part.type === 'Point') return inside(part.coordinates, region, border);
    if (part.type === 'LineString') return match === 'contains'
      ? part.coordinates.slice(1).every((point, index) => segmentInside(part.coordinates[index]!, point, region, border))
      : part.coordinates.some(point => inside(point, region, border)) || edges(part.coordinates).some(([a, b]) => border.some(([c, d]) => segmentsIntersect(a, b, c, d)));
    if (match === 'contains') return polygonClipping.difference(part.coordinates, region).length === 0;
    return polygonClipping.intersection(part.coordinates, region).length > 0
      || part.coordinates.flatMap(edges).some(([a, b]) => border.some(([c, d]) => segmentsIntersect(a, b, c, d)));
  });
  return match === 'contains' ? results.every(Boolean) : results.some(Boolean);
}

/** Prepared region unions are immutable and reused by all mutation paths. */
export class GeofencingPolicy {
  readonly options: GeofencingOptions;
  private readonly allowed: Region;
  private readonly excluded: Region;
  private readonly allowedBorder: Edge[];
  private readonly excludedBorder: Edge[];
  constructor(update?: Partial<GeofencingOptions>, previous?: GeofencingOptions) {
    this.options = geofencingOptions(update, previous);
    const union = (areas: readonly GeofenceArea[]): Region => areas.length ? polygonClipping.union(areas[0]!.geometry.coordinates, ...areas.slice(1).map(area => area.geometry.coordinates)) : [];
    try { this.allowed = union(this.options.allowed); this.excluded = union(this.options.excluded); }
    catch { throw new TypeError('Unable to prepare geofence area unions.'); }
    this.allowedBorder = boundary(this.allowed); this.excludedBorder = boundary(this.excluded);
  }
  snapshot(): GeofencingOptions {
    const areas = (values: readonly GeofenceArea[]): GeofenceArea[] => values.map(area => ({ id: area.id, geometry: mapGeometry(area.geometry, point => [...point]) as GeofenceArea['geometry'] }));
    return { ...this.options, allowed: areas(this.options.allowed), excluded: areas(this.options.excluded) };
  }
  check(candidates: readonly GeofencingCandidate[]): GeofencingViolation[] {
    if (!this.options.enabled || !this.allowed.length && !this.excluded.length) return [];
    return candidates.flatMap(({ featureId, geometry }) => {
      const violations: GeofencingViolation[] = [];
      try {
        if (this.allowed.length && !matches(geometry, this.allowed, this.allowedBorder, this.options.allowedMatch)) violations.push({ featureId, code: 'outside-allowed-area', areaIds: this.options.allowed.map(area => area.id) });
        if (this.excluded.length && matches(geometry, this.excluded, this.excludedBorder, this.options.excludedMatch)) {
          const areaIds = this.options.excluded.filter(area => {
            const region = area.geometry.type === 'Polygon' ? [area.geometry.coordinates] : area.geometry.coordinates;
            return matches(geometry, region, boundary(region), 'intersects');
          }).map(area => area.id);
          violations.push({ featureId, code: this.options.excludedMatch === 'contains' ? 'inside-excluded-area' : 'intersects-excluded-area', areaIds });
        }
      } catch { return [{ featureId, code: 'geofencing-calculation-failed' as const, areaIds: [...this.options.allowed, ...this.options.excluded].map(area => area.id) }]; }
      return violations;
    });
  }
}
