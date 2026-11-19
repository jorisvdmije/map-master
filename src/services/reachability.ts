import polygonClipping from 'polygon-clipping';
import { prepareImport } from '../core/geojson-import.js';
import { measure } from '../core/measurement.js';
import type { Coordinate, GeometryFeatureCollection, MultiPolygonFeature, PolygonFeature } from '../core/types.js';

export type TravelProfile = 'walking' | 'cycling' | 'e-bike' | 'driving';
export interface ReachabilityRequest {
  origin: Coordinate;
  profile: TravelProfile;
  /** One to four unique travel-time budgets, in minutes, at most 60. */
  minutes: readonly number[];
  /** `to` computes where the origin can be reached FROM. Default `from`. */
  direction?: 'from' | 'to';
}
export type ReachabilityProvider = (request: ReachabilityRequest, options: { signal?: AbortSignal }) => Promise<{ data: unknown; provider: string; attribution: string }>;
export interface ReachabilityResult {
  request: ReachabilityRequest;
  provider: string;
  attribution: string;
  calculatedAt: string;
  /** Original model contours, strictly nested by budget. Use for counting/export. */
  contours: GeometryFeatureCollection;
  /** Non-overlapping display bands, with empty bands omitted. */
  bands: GeometryFeatureCollection;
}
export class ReachabilityError extends Error {
  constructor(public readonly code: 'invalid-request' | 'invalid-response' | 'provider-error', message: string) { super(message); this.name = 'ReachabilityError'; }
}
export function validateReachabilityRequest(input: ReachabilityRequest): ReachabilityRequest {
  if (!input || !Array.isArray(input.origin) || input.origin.length !== 2 || !input.origin.every(Number.isFinite) || Math.abs(input.origin[0]) > 180 || Math.abs(input.origin[1]) > 85
    || !['walking', 'cycling', 'e-bike', 'driving'].includes(input.profile) || !Array.isArray(input.minutes) || input.minutes.length < 1 || input.minutes.length > 4 || input.minutes.some(t => !Number.isFinite(t) || t <= 0 || t > 60) || new Set(input.minutes).size !== input.minutes.length
    || input.direction !== undefined && input.direction !== 'from' && input.direction !== 'to') throw new ReachabilityError('invalid-request', 'Use a valid origin, travel profile and 1–4 unique budgets between 0 and 60 minutes.');
  return { origin: [...input.origin], profile: input.profile, minutes: [...input.minutes as readonly number[]].sort((a, b) => a - b), direction: input.direction ?? 'from' };
}

/** Request network-derived polygons without changing an editor, selection or history. */
export async function calculateReachability(provider: ReachabilityProvider, input: ReachabilityRequest, options: { signal?: AbortSignal } = {}): Promise<ReachabilityResult> {
  const request = validateReachabilityRequest(input);
  options.signal?.throwIfAborted();
  const response = await provider(structuredClone(request), options);
  options.signal?.throwIfAborted();
  try {
    if (typeof response.provider !== 'string' || !response.provider || typeof response.attribution !== 'string' || !response.attribution) throw new Error('Provider and attribution are required.');
    const raw = response.data as { type?: string; features?: unknown[] };
    if (!raw || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features) || raw.features.length !== request.minutes.length || JSON.stringify(raw).length > 5_000_000) throw new Error('Return exactly one polygon feature per requested budget, at most 5 MB.');
    let id = 0;
    const features = prepareImport(raw, () => false, () => `contour-${++id}`);
    const seen = new Set<number>(), calculatedAt = new Date().toISOString();
    const contours = features.map((f): PolygonFeature | MultiPolygonFeature => {
      const minutes = f.properties?.minutes;
      if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon' || typeof minutes !== 'number' || !request.minutes.includes(minutes) || seen.has(minutes)) throw new Error('Contours need unique requested minutes and Polygon/MultiPolygon geometry.');
      seen.add(minutes);
      const common = { type: 'Feature' as const, id: `reachability-${minutes}`, properties: { minutes, profile: request.profile, origin: [...request.origin], direction: request.direction!, provider: response.provider, attribution: response.attribution, calculatedAt, areaSquareMetres: measure(f.geometry).area } };
      return f.geometry.type === 'Polygon' ? { ...common, geometry: f.geometry } : { ...common, geometry: f.geometry };
    }).sort((a, b) => Number(a.properties!.minutes) - Number(b.properties!.minutes));
    const bands: (PolygonFeature | MultiPolygonFeature)[] = [];
    for (let i = 0; i < contours.length; i++) {
      const current = contours[i]!, geometry = current.geometry;
      const shape = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      const previous = contours[i - 1];
      if (previous) {
        const smaller = previous.geometry.type === 'Polygon' ? [previous.geometry.coordinates] : previous.geometry.coordinates;
        // Strict cumulative contract: even a small outside sliver can change a
        // point count. Do not repair it by adding territory to a later budget.
        if (polygonClipping.difference(smaller, shape).length) throw new Error(`Contours at ${Number(previous.properties!.minutes)} and ${Number(current.properties!.minutes)} minutes are not cumulative: the later contour must contain the entire earlier contour.`);
      }
      const smaller = contours.slice(0, i).flatMap(f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
      const parts = smaller.length ? polygonClipping.difference(shape, smaller) : shape;
      if (parts.length) bands.push({ type: 'Feature', id: `band-${Number(current.properties!.minutes)}`, geometry: { type: 'MultiPolygon', coordinates: parts }, properties: { ...current.properties, minMinutes: i ? contours[i - 1]!.properties!.minutes! : 0, areaSquareMetres: measure({ type: 'MultiPolygon', coordinates: parts }).area } });
    }
    return { request, provider: response.provider, attribution: response.attribution, calculatedAt, contours: { type: 'FeatureCollection', features: contours }, bands: { type: 'FeatureCollection', features: bands } };
  } catch (error) { throw new ReachabilityError('invalid-response', error instanceof Error ? error.message : 'Invalid reachability response.'); }
}

/** Explicit endpoint, so applications choose their own server, proxy and usage policy. */
export function createValhallaProvider(options: { endpoint: string; clientId: string; fetch?: typeof fetch; headers?: Record<string, string> }): ReachabilityProvider {
  const endpoint = new URL(options.endpoint);
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || !options.clientId.trim()) throw new TypeError('Configure an HTTP(S) Valhalla endpoint and a client ID.');
  const request = options.fetch ?? globalThis.fetch;
  return async (input, context) => {
    const normalized = validateReachabilityRequest(input), mode = normalized.profile === 'driving' ? 'auto' : normalized.profile === 'walking' ? 'pedestrian' : 'bicycle';
    const url = new URL(endpoint);
    url.searchParams.set('json', JSON.stringify({ locations: [{ lon: normalized.origin[0], lat: normalized.origin[1] }], costing: mode, ...(normalized.profile === 'e-bike' ? { costing_options: { bicycle: { cycling_speed: 25, bicycle_type: 'hybrid' } } } : {}), contours: normalized.minutes.map(time => ({ time })), polygons: true, generalize: 0, denoise: 0, reverse: normalized.direction === 'to' }));
    const response = await request(url, { headers: { ...options.headers, 'X-Client-Id': options.clientId }, signal: context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    if (!response.ok) throw new ReachabilityError('provider-error', `Valhalla returned HTTP ${response.status}.`);
    const data = await response.json() as { features?: { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }[] };
    // Grid-derived contours can revisit a boundary vertex. A geometric union
    // splits touching lobes and removes redundant vertices without smoothing or
    // inventing a radius. The generic import then validates the normalized area.
    if (Array.isArray(data.features)) for (const f of data.features) {
      if (f.properties?.metric !== 'time') throw new ReachabilityError('invalid-response', 'Expected travel-time contours.');
      const raw = f.geometry, input = raw?.type === 'Polygon' ? [raw.coordinates] : raw?.type === 'MultiPolygon' ? raw.coordinates : null;
      let points = 0;
      const invalid = (): never => { throw new ReachabilityError('invalid-response', 'Invalid or oversized Valhalla polygon.'); };
      const ring = (value: unknown): Coordinate[] => {
        if (!Array.isArray(value) || value.length < 4) return invalid();
        const coordinates = (value as unknown[]).map((c): Coordinate => {
          if (++points > 20_000 || !Array.isArray(c) || c.length !== 2) return invalid();
          const [lng, lat] = c as unknown[];
          if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return invalid();
          return [lng, lat];
        });
        if (coordinates[0]![0] !== coordinates.at(-1)![0] || coordinates[0]![1] !== coordinates.at(-1)![1]) return invalid();
        return coordinates;
      };
      if (!Array.isArray(input) || !input.length) return invalid();
      const polygons = (input as unknown[]).map(p => { if (!Array.isArray(p) || !p.length) return invalid(); return (p as unknown[]).map(ring); });
      try { f.geometry = { type: 'MultiPolygon', coordinates: polygonClipping.union(polygons) }; }
      catch { throw new ReachabilityError('invalid-response', 'Valhalla contour topology could not be normalized.'); }
      f.properties = { minutes: f.properties.contour };
    }
    return { data, provider: 'Valhalla', attribution: 'Routing: Valhalla · Map data © OpenStreetMap contributors' };
  };
}
