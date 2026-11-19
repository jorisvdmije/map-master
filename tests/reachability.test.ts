import { describe, expect, it, vi } from 'vitest';
import { calculateReachability, createValhallaProvider, validateReachabilityRequest, ReachabilityError, type ReachabilityProvider, type ReachabilityRequest } from '../src/index.js';
const request: ReachabilityRequest = { origin: [4.9, 52.37], profile: 'cycling', minutes: [10, 5] };
const polygon = (minutes: number, size: number) => ({ type: 'Feature', properties: { minutes }, geometry: { type: 'Polygon', coordinates: [[[-size, -size], [size, -size], [size, size], [-size, size], [-size, -size]]] } });
const provider: ReachabilityProvider = () => Promise.resolve({ data: { type: 'FeatureCollection', features: [polygon(10, 2), polygon(5, 1)] }, provider: 'test network', attribution: 'Test source' });

describe('reachability provider boundary', () => {
  it('copies and sorts budgets and rejects impossible or ambiguous requests', () => {
    expect(validateReachabilityRequest(request)).toEqual({ ...request, minutes: [5, 10], direction: 'from' });
    expect(request.minutes).toEqual([10, 5]);
    for (const update of [{ origin: [181, 2] }, { origin: [1, 86] }, { profile: 'teleport' }, { minutes: [] }, { minutes: [5, 5] }, { minutes: [NaN] }, { minutes: [90] }, { minutes: [1, 2, 3, 4, 5] }]) expect(() => validateReachabilityRequest({ ...request, ...update } as never)).toThrow(ReachabilityError);
  });
  it('preserves cumulative area and produces disjoint display bands', async () => {
    const result = await calculateReachability(provider, request);
    expect(result.contours.features.map(f => f.properties!.minutes)).toEqual([5, 10]);
    expect(result.bands.features).toHaveLength(2);
    const area = result.bands.features.reduce((sum, f) => sum + Number(f.properties!.areaSquareMetres), 0);
    expect(area).toBeCloseTo(Number(result.contours.features[1]!.properties!.areaSquareMetres), 2);
    expect(result.bands.features[1]!.geometry.type).toBe('MultiPolygon');
    expect(result.request.origin).not.toBe(request.origin);
    expect(result.attribution).toBe('Test source');
  });
  it.each([
    ['disjoint', [polygon(5, 1), { ...polygon(10, 0.1), geometry: { type: 'Polygon', coordinates: [[[4, 4], [5, 4], [5, 5], [4, 5], [4, 4]]] } }]],
    ['reversed', [polygon(5, 2), polygon(10, 1)]],
    ['a tiny outside sliver', [polygon(5, 1), { ...polygon(10, 1), geometry: { type: 'Polygon', coordinates: [[[-1 + 1e-7, -1], [1 + 1e-7, -1], [1 + 1e-7, 1], [-1 + 1e-7, 1], [-1 + 1e-7, -1]]] } }]],
    ['an excluded hole', [polygon(5, 0.2), { ...polygon(10, 2), geometry: { type: 'Polygon', coordinates: [...polygon(10, 2).geometry.coordinates, polygon(5, 0.5).geometry.coordinates[0]] } }]],
    ['a missing island', [{ ...polygon(5, 1), geometry: { type: 'MultiPolygon', coordinates: [polygon(5, 1).geometry.coordinates, [[[3, 3], [4, 3], [4, 4], [3, 4], [3, 3]]]] } }, polygon(10, 2)]],
  ])('rejects non-cumulative contours: %s', async (_name, features) => {
    const calculation = calculateReachability(() => Promise.resolve({ data: { type: 'FeatureCollection', features }, provider: 'test', attribution: 'test' }), request);
    await expect(calculation).rejects.toMatchObject({ code: 'invalid-response' });
    await expect(calculation).rejects.toThrow(/5.*10.*cumulative/i);
  });
  it('accepts shared boundaries and equal contours without manufacturing extra area', async () => {
    const features = [polygon(10, 1), polygon(5, 1)], before = structuredClone(features);
    const result = await calculateReachability(() => Promise.resolve({ data: { type: 'FeatureCollection', features }, provider: 'test', attribution: 'test' }), request);
    expect(result.bands.features).toHaveLength(1);
    expect(result.contours.features.map(f => f.geometry.coordinates)).toEqual([features[1]!.geometry.coordinates, features[0]!.geometry.coordinates]);
    expect(features).toEqual(before);
  });
  it('never returns incomplete, repeated or non-polygon budgets as success', async () => {
    for (const features of [[polygon(5, 1)], [polygon(5, 1), polygon(5, 2)], [polygon(5, 1), polygon(11, 2)], [{ ...polygon(5, 1), geometry: { type: 'Point', coordinates: [0, 0] } }, polygon(10, 2)]]) {
      await expect(calculateReachability(() => Promise.resolve({ data: { type: 'FeatureCollection', features }, provider: 'test', attribution: 'test' }), request)).rejects.toMatchObject({ code: 'invalid-response' });
    }
  });
  it('ignores provider mutation of the request and aborts before publishing a result', async () => {
    const controller = new AbortController();
    await expect(calculateReachability(async (input) => { input.origin[0] = 10; controller.abort(); return provider(input, {}); }, request, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(request.origin).toEqual([4.9, 52.37]);
  });
  it('encodes Valhalla time, mode, inverse direction and e-bike model without a map token', async () => {
    const network = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ type: 'FeatureCollection', features: [{ ...polygon(10, 1), properties: { contour: 10, metric: 'time' } }] })));
    const adapter = createValhallaProvider({ endpoint: 'https://routing.example/isochrone', clientId: 'test-client', fetch: network });
    await calculateReachability(adapter, { ...request, profile: 'e-bike', direction: 'to', minutes: [10] });
    const value = network.mock.calls[0]![0];
    if (!(value instanceof URL)) throw new Error('Expected a URL');
    const url = value;
    const input = JSON.parse(url.searchParams.get('json')!) as { costing: string; reverse: boolean; costing_options: { bicycle: { cycling_speed: number } }; contours: unknown[] };
    expect(input).toMatchObject({ costing: 'bicycle', reverse: true, costing_options: { bicycle: { cycling_speed: 25 } }, contours: [{ time: 10 }] });
    expect(network.mock.calls[0]![1]?.headers).toMatchObject({ 'X-Client-Id': 'test-client' });
  });
  it('normalizes grid boundary revisits into valid polygons and reports HTTP failure', async () => {
    const raw = polygon(5, 1); raw.geometry.coordinates[0]!.splice(2, 0, [1, -1]);
    const adapter = createValhallaProvider({ endpoint: 'https://routing.example/isochrone', clientId: 'test', fetch: () => Promise.resolve(Response.json({ type: 'FeatureCollection', features: [{ ...raw, properties: { contour: 5, metric: 'time' } }] })) });
    expect((await calculateReachability(adapter, { ...request, minutes: [5] })).contours.features).toHaveLength(1);
    const failed = createValhallaProvider({ endpoint: 'https://routing.example/isochrone', clientId: 'test', fetch: () => Promise.resolve(new Response('', { status: 429 })) });
    await expect(calculateReachability(failed, request)).rejects.toMatchObject({ code: 'provider-error' });
  });
});
