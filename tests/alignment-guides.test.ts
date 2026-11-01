import { expect, it } from 'vitest';
import { AlignmentIndex, alignmentPaths, alignmentGuidesOptions, type AlignmentPath } from '../src/core/alignment-guides.js';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate, GeometryFeatureCollection } from '../src/index.js';
const project = ([x, y]: Coordinate) => ({ x, y });
const path = (coordinates: Coordinate[], featureId: string | number | null = 'reference'): AlignmentPath => ({ featureId, coordinates, closed: false });
const index = (paths: AlignmentPath[]) => new AlignmentIndex(paths, project, 1000, 800);
const options = alignmentGuidesOptions({ enabled: true });

it('aligns horizontal and vertical references together within one radial tolerance', () => {
  const result = index([path([[100, 300]], 0), path([[500, 200]], '0')]).query({ x: 103, y: 204 }, options);
  expect(result.point).toEqual({ x: 100, y: 200 }); expect(result.distance).toBe(5);
  expect(result.guides.map(guide => [guide.kind, guide.featureId])).toEqual([['horizontal', '0'], ['vertical', 0]]);
  expect(result.guides[0]?.start).toEqual({ x: 500, y: 200 });
  const single = index([path([[100, 300]]), path([[500, 200]])]).query({ x: 107, y: 207 }, options);
  expect(single.guides).toHaveLength(1); expect(single.distance).toBe(7);
});

it('projects onto edge extensions beyond both endpoints, leaving segment interiors to ordinary snapping', () => {
  const engine = index([path([[100, 100], [200, 200]])]);
  const configured = alignmentGuidesOptions({ horizontal: false, vertical: false }, options);
  expect(engine.query({ x: 304, y: 300 }, configured)).toMatchObject({ point: { x: 302, y: 302 }, guides: [{ kind: 'extension', index: 0 }] });
  expect(engine.query({ x: 52, y: 48 }, configured).point).toEqual({ x: 50, y: 50 });
  expect(engine.query({ x: 154, y: 150 }, configured).point).toBeNull();
});

it('chooses the closest single guide, prefers axes on ties and honors all independent toggles', () => {
  const engine = index([path([[100, 100], [200, 200]]), path([[600, 304]])]);
  expect(engine.query({ x: 304, y: 300 }, options).guides[0]?.kind).toBe('extension');
  const axis = engine.query({ x: 304, y: 304 }, alignmentGuidesOptions({ extensions: false }, options));
  expect(axis.point).toEqual({ x: 304, y: 304 }); expect(axis.guides[0]?.kind).toBe('horizontal');
  expect(engine.query({ x: 304, y: 300 }, alignmentGuidesOptions({ horizontal: false, vertical: false, extensions: false }, options)).point).toBeNull();
  expect(engine.query({ x: 304, y: 300 }, alignmentGuidesOptions({ enabled: false }, options)).examinedCandidates).toBe(0);
});

it('uses stable nearest sources and isolates returned guide points from the index', () => {
  const engine = index([path([[10, 100]], 'far'), path([[490, 100]], 'near'), path([[490, 100]], 'tie')]);
  const result = engine.query({ x: 500, y: 104 }, options);
  expect(result.guides[0]?.featureId).toBe('near'); result.guides[0]!.start.y = 900;
  expect(engine.query({ x: 500, y: 104 }, options).guides[0]?.start.y).toBe(100);
});

it('shares the hard inspection budget with a frozen draft index and combines draft/committed axes', () => {
  const engine = index([path([[500, 200]])]); const draft = index([path([[100, 300]], null)]);
  const result = engine.query({ x: 103, y: 204 }, options, draft);
  expect(result.point).toEqual({ x: 100, y: 200 }); expect(result.guides[1]?.featureId).toBeNull();
  const dense = index(Array.from({ length: 10_000 }, (_, i) => path([[100, 200]], i)));
  for (const maxCandidates of [6, 12, 96, 512]) {
    const bounded = dense.query({ x: 103, y: 204 }, alignmentGuidesOptions({ maxCandidates }, options), dense);
    expect(bounded.examinedCandidates).toBeLessThanOrEqual(maxCandidates); expect(bounded.limited).toBe(true);
  }
});

it('caps dense extension buckets and never falls back to a full edge scan', () => {
  const dense = index(Array.from({ length: 10_000 }, (_, i) => path([[10, 10], [100, 100 + i * 0.00001]], i)));
  const result = dense.query({ x: 600, y: 600 }, alignmentGuidesOptions({ horizontal: false, vertical: false, maxCandidates: 12 }, options));
  expect(result.examinedCandidates).toBeLessThanOrEqual(12); expect(result.limited).toBe(true); expect(result.point).not.toBeNull();
});

it('excludes moving vertices and every incident edge, retaining stationary rings and closing edges', () => {
  const engine = index([{ ...path([[100, 100], [200, 200], [300, 200]]), excluded: new Set([0, 1]) }]);
  expect(engine.query({ x: 102, y: 104 }, options).point).toBeNull();
  expect(engine.query({ x: 500, y: 500 }, options).point).toBeNull();
  const ring = index([{ ...path([[100, 100], [200, 100], [200, 200]], null), closed: true, ringIndex: 2 }]);
  const result = ring.query({ x: 304, y: 300 }, alignmentGuidesOptions({ horizontal: false, vertical: false }, options));
  expect(result.guides[0]).toMatchObject({ kind: 'extension', featureId: null, index: 2, ringIndex: 2 });
});

it('keeps multipart/hole addresses and typed IDs, and excludes whole selected features before indexing', () => {
  const data: GeometryFeatureCollection = { type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: null, geometry: { type: 'Point', coordinates: [100, 200] } },
    { type: 'Feature', id: '0', properties: null, geometry: { type: 'MultiPolygon', coordinates: [[
      [[10, 10], [50, 10], [50, 50], [10, 10]], [[20, 20], [30, 20], [30, 30], [20, 20]],
    ]] } },
  ] };
  const paths = alignmentPaths(data, new Set([0])); expect(paths).toHaveLength(2);
  expect(paths[1]).toMatchObject({ featureId: '0', partIndex: 0, ringIndex: 1, closed: true });
  expect(paths[1]?.coordinates).toHaveLength(3);
});

it('ignores offscreen/nonfinite sources and pointers and handles zero-length edges', () => {
  const engine = index([path([[100, 100], [100, 100]]), path([[2000, 300]]), path([[NaN, 100]])]);
  expect(engine.query({ x: 500, y: 304 }, options).point).toBeNull();
  expect(engine.query({ x: Infinity, y: 104 }, options).point).toBeNull();
  expect(engine.query({ x: -1, y: 104 }, options).point).toBeNull();
});

it.each([{ enabled: 1 }, { horizontal: null }, { vertical: 'yes' }, { extensions: undefined }, { distance: 0 },
  { distance: 33 }, { distance: NaN }, { distance: '8' }, { maxCandidates: 5 }, { maxCandidates: 513 }, { maxCandidates: 6.5 }, { unknown: true }])('validates option patches atomically: %j', patch => {
  const previous = alignmentGuidesOptions(); expect(() => alignmentGuidesOptions(patch as never, previous)).toThrow();
  expect(previous).toEqual(alignmentGuidesOptions());
});

it('returns at most four independent recent drawing references without scanning or mutating the draft', () => {
  const session = new DrawingSession(() => 'line'); session.start('LineString');
  for (let i = 0; i < 1000; i++) session.add([i / 100, 52]);
  const references = session.getAlignmentDrawPoints(); expect(references).toEqual([[0, 52], [9.97, 52], [9.98, 52], [9.99, 52]]);
  references[0]![0] = 100; expect(session.getDraft()[0]).toEqual([0, 52]);
});
