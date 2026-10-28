import { expect, it, vi } from 'vitest';
import polygonClipping from 'polygon-clipping';
import { DrawingSession } from '../src/core/drawing-session.js';
import { bufferFeatures } from '../src/core/buffer.js';
import { project } from '../src/core/mercator-transform.js';
import type { Coordinate, GeometryFeature, PolygonFeature } from '../src/index.js';

const radius = 6378137;
const at = (x: number, y: number): Coordinate => [x / radius * 180 / Math.PI, Math.atan(Math.sinh(y / radius)) * 180 / Math.PI];
const path = (points: number[][]): Coordinate[] => points.map(p => at(p[0]!, p[1]!));
const line: GeometryFeature = { type: 'Feature', id: 0, properties: { nested: { name: 'route' } }, geometry: { type: 'LineString', coordinates: path([[0, 0], [100, 0]]) } };
const polygon: PolygonFeature = { type: 'Feature', id: '0', properties: null, geometry: { type: 'Polygon', coordinates: [
  path([[200, 0], [300, 0], [300, 100], [200, 100], [200, 0]]),
  path([[230, 30], [230, 70], [270, 70], [270, 30], [230, 30]]),
] } };
function setup(features: GeometryFeature[] = [line, polygon], limit = 100) {
  const session = new DrawingSession(() => { throw new Error('No new IDs'); }, limit);
  session.importGeoJSON({ type: 'FeatureCollection', features }); session.clearHistory(); session.selectMany(features.map(f => f.id)); return session;
}
function planarRing(feature: GeometryFeature): Coordinate[] {
  if (feature.geometry.type !== 'Polygon') throw new Error('Expected polygon');
  return feature.geometry.coordinates[0]!.map(p => project(p).map(n => n * radius) as Coordinate);
}
function area(ring: Coordinate[]): number {
  return Math.abs(ring.slice(1).reduce((sum, p, i) => sum + ring[i]![0] * p[1] - p[0] * ring[i]![1], 0)) / 2;
}

it('buffers a segment with the expected radius, rounded ends and polygonal-circle area', () => {
  const session = setup([line]); expect(session.bufferSelection()).toBe(true);
  const ring = planarRing(session.getBufferPreview()!.features[0]!);
  expect(Math.min(...ring.map(p => p[0]))).toBeCloseTo(-10, 7);
  expect(Math.max(...ring.map(p => p[0]))).toBeCloseTo(110, 7);
  expect(Math.min(...ring.map(p => p[1]))).toBeCloseTo(-10, 7);
  expect(Math.max(...ring.map(p => p[1]))).toBeCloseTo(10, 7);
  expect(area(ring)).toBeCloseTo(100 * 20 + 16 * 100 * Math.sin(Math.PI / 16), 5);
  expect(ring[0]).toEqual(ring.at(-1));
});

it('keeps every rounded boundary within the declared disk approximation error on a diagonal segment', () => {
  const feature: GeometryFeature = { ...line, geometry: { type: 'LineString', coordinates: path([[0, 0], [100, 70]]) } };
  const ring = planarRing(bufferFeatures([feature], 10).preview![0]!);
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!; const b = ring[i]!;
    for (const fraction of [0, 0.5, 1]) {
      const x = a[0] + fraction * (b[0] - a[0]); const y = a[1] + fraction * (b[1] - a[1]);
      const t = Math.max(0, Math.min(1, (100 * x + 70 * y) / 14900));
      const distance = Math.hypot(x - t * 100, y - t * 70);
      expect(distance).toBeGreaterThanOrEqual(10 * Math.cos(Math.PI / 32) - 1e-7);
      expect(distance).toBeLessThanOrEqual(10 + 1e-7);
    }
  }
});

it('grows polygon exteriors, shrinks holes and fills them when the distance reaches their inradius', () => {
  const session = setup([polygon]); session.bufferSelection(10);
  const preview = session.getBufferPreview()!.features[0] as PolygonFeature;
  expect(preview.geometry.coordinates).toHaveLength(2);
  const hole = preview.geometry.coordinates[1]!.map(p => project(p).map(n => n * radius));
  expect(Math.min(...hole.map(p => p[0]!))).toBeCloseTo(240, 6);
  expect(Math.max(...hole.map(p => p[0]!))).toBeCloseTo(260, 6);
  session.setBufferDistance(21);
  expect((session.getBufferPreview()!.features[0] as PolygonFeature).geometry.coordinates).toHaveLength(1);
});

it('dissolves overlapping parts within a feature and retains disjoint parts as MultiPolygon', () => {
  const feature: GeometryFeature = { ...line, geometry: { type: 'MultiLineString', coordinates: [
    path([[0, 0], [100, 0]]), path([[0, 30], [100, 30]]),
  ] } };
  const session = setup([feature]); session.bufferSelection(10);
  expect(session.getBufferPreview()!.features[0]!.geometry.type).toBe('MultiPolygon');
  session.setBufferDistance(20); expect(session.getBufferPreview()!.features[0]!.geometry.type).toBe('Polygon');
});

it('keeps every disjoint part through batched overlay and buffers dense paths', () => {
  const coordinates = Array.from({ length: 70 }, (_, i) => path([[i * 100, 0], [i * 100 + 50, 0]]));
  const session = setup([{ ...line, geometry: { type: 'MultiLineString', coordinates } }]);
  session.bufferSelection(10); const geometry = session.getBufferPreview()!.features[0]!.geometry;
  expect(geometry.type).toBe('MultiPolygon'); expect(geometry.coordinates).toHaveLength(70);
  const dense = setup([{ ...line, geometry: { type: 'LineString', coordinates: path(Array.from({ length: 100 }, (_, i) => [i, 0])) } }]);
  dense.bufferSelection(10);
  expect(area(planarRing(dense.getBufferPreview()!.features[0]!))).toBeCloseTo(99 * 20 + 1600 * Math.sin(Math.PI / 16), 5);
});

it('uses the same projected width at high latitude and rejects buffers reaching the polar limit', () => {
  const y = project([0, 80])[1] * radius;
  const session = setup([{ ...line, geometry: { type: 'LineString', coordinates: path([[0, y], [100, y]]) } }]);
  session.bufferSelection(10); const ring = planarRing(session.getBufferPreview()!.features[0]!);
  expect(Math.max(...ring.map(p => p[1])) - Math.min(...ring.map(p => p[1]))).toBeCloseTo(20, 5);
  const edge = setup([{ ...line, geometry: { type: 'LineString', coordinates: path([[0, Math.PI * radius - 5], [100, Math.PI * radius - 5]]) } }]);
  edge.bufferSelection(10); expect(edge.state.bufferError).toBe('buffer-out-of-bounds');
});

it('handles unrepresentably small positive distances without throwing or partial changes', () => {
  const session = setup(); const before = session.exportGeoJSON();
  expect(() => session.bufferSelection(Number.MIN_VALUE)).not.toThrow();
  expect(session.state).toMatchObject({ canFinish: false, bufferError: 'buffer-invalid-result' });
  expect(session.finishBuffer()).toBeNull(); expect(session.exportGeoJSON()).toEqual(before);
});

it('supports concave polygons, self-crossing lines, repeated nonconsecutive points and closed lines', () => {
  for (const points of [ [[0, 0], [100, 100], [0, 100], [100, 0]], [[0, 0], [100, 0], [0, 0]], [[0, 0], [100, 0], [100, 100], [0, 0]] ]) {
    const session = setup([{ ...line, geometry: { type: 'LineString', coordinates: path(points) } }]);
    session.bufferSelection(10); expect(session.state.canFinish).toBe(true); expect(session.finishBuffer()!.changes).toHaveLength(1);
  }
  const session = setup([{ ...polygon, geometry: { type: 'Polygon', coordinates: [path([[0, 0], [100, 0], [100, 100], [50, 50], [0, 100], [0, 0]])] } }]);
  session.bufferSelection(10); expect(session.state.canFinish).toBe(true);
});

it('buffers MultiPolygon parts without merging independently selected features', () => {
  const first = polygon.geometry.coordinates[0]!;
  const session = setup([{ ...polygon, geometry: { type: 'MultiPolygon', coordinates: [[first], [first.map(([x, y]) => [x + at(110, 0)[0], y])]] } }, line]);
  session.bufferSelection(10); const preview = session.getBufferPreview()!;
  expect(preview.features).toHaveLength(2); expect(preview.features.map(f => f.id)).toEqual(['0', 0]);
  expect(preview.features[0]!.geometry.type).toBe('Polygon');
});

it('commits mixed selections atomically, retaining identities, properties, order and exact history', () => {
  const untouched: GeometryFeature = { ...line, id: 'untouched' };
  const session = setup([line, untouched, polygon]); session.selectMany(['0', 0]);
  const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  session.bufferSelection(10); const preview = session.getBufferPreview()!;
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.dataRevision).toBe(revision);
  expect(session.state).toMatchObject({ mode: 'buffer-features', bufferDistance: 10, bufferError: null, canFinish: true, canUndo: false });
  const event = session.finishBuffer()!; expect(event.changes).toHaveLength(2);
  const after = session.exportGeoJSON(); expect(after.features).toEqual([preview.features[1], before.features[1], preview.features[0]]);
  expect(after.features.map(f => f.properties)).toEqual(before.features.map(f => f.properties));
  expect(session.state).toMatchObject({ mode: 'idle', bufferDistance: null, bufferError: null, dataRevision: revision + 1 });
  expect(session.undo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(before);
  expect(session.redo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(after);
});

it('recomputes from frozen originals, isolates snapshots, and preserves Redo on cancel', () => {
  const session = setup(); session.bufferSelection(10); const expected = session.getBufferPreview();
  session.setBufferDistance(20); session.setBufferDistance(10); expect(session.getBufferPreview()).toEqual(expected);
  expect(session.setBufferDistance(10)).toBe(false);
  session.getBufferPreview()!.features[0]!.geometry.coordinates.length = 0;
  session.getBufferPreview()!.features[0]!.properties!['nested'] = null;
  expect(session.getBufferPreview()).toEqual(expected);
  const event = session.finishBuffer()!; event.changes[0]!.after!.geometry.coordinates.length = 0;
  expect(session.getSelection()).toEqual(expected!.features);
  session.undo(); const before = session.exportGeoJSON(); session.bufferSelection(); session.cancel();
  expect(session.state.canRedo).toBe(true); expect(session.exportGeoJSON()).toEqual(before);
});

it.each([NaN, Infinity, -Infinity, '5', null])('rejects malformed distance %s without altering the active preview', distance => {
  const session = setup(); session.bufferSelection(); const state = session.state; const before = session.getBufferPreview();
  expect(() => session.setBufferDistance(distance as number)).toThrow(TypeError);
  expect(session.state).toEqual(state); expect(session.getBufferPreview()).toEqual(before);
});
it.each([0, -0, -10])('rejects nonpositive distance %s even when inactive or already buffering', distance => {
  const session = setup(); expect(() => session.bufferSelection(distance)).toThrow(RangeError);
  expect(() => session.setBufferDistance(distance)).toThrow(RangeError);
  session.bufferSelection(); expect(() => session.bufferSelection(distance)).toThrow(RangeError);
});

it('rejects empty, polar, dateline-crossing and globally spread selections before entry', () => {
  expect(new DrawingSession(() => 'id').bufferSelection()).toBe(false);
  for (const coordinates of [[[0, 86], [1, 87]], [[179, 0], [-179, 1]], [[-100, 0], [0, 0], [100, 0]]] as Coordinate[][]) {
    const session = setup([{ ...line, geometry: { type: 'LineString', coordinates } }]);
    const before = session.state; expect(session.bufferSelection()).toBe(false); expect(session.state).toEqual(before);
  }
});

it('blocks the entire preview at world limits, keeps invalid review active, and permits correction', () => {
  const edge: GeometryFeature = { ...line, id: 'edge', geometry: { type: 'LineString', coordinates: [[179.9999, 0], [179.9999, 0.001]] } };
  const session = setup([line, edge]); const before = session.exportGeoJSON();
  session.bufferSelection(100);
  expect(session.state).toMatchObject({ canFinish: false, bufferError: 'buffer-out-of-bounds' });
  expect(session.getBufferPreview()).toBeNull(); expect(session.finishBuffer()).toBeNull();
  expect(session.state.mode).toBe('buffer-features'); expect(session.exportGeoJSON()).toEqual(before);
  session.setBufferDistance(1); expect(session.state.canFinish).toBe(true);
  session.setBufferDistance(Number.MAX_VALUE); expect(session.state.bufferError).toBe('buffer-out-of-bounds');
});

it('turns clipping failures and invalid output into diagnostics without partial changes', () => {
  const session = setup(); const before = session.exportGeoJSON();
  const union = vi.spyOn(polygonClipping, 'union');
  try {
    union.mockImplementation(() => { throw new Error('engine failure'); });
    session.bufferSelection(); expect(session.state.bufferError).toBe('buffer-failed');
    union.mockReturnValue([]); session.setBufferDistance(20); expect(session.state.bufferError).toBe('buffer-invalid-result');
    expect(session.finishBuffer()).toBeNull(); expect(session.exportGeoJSON()).toEqual(before);
  } finally { union.mockRestore(); }
  session.setBufferDistance(10); expect(session.state.canFinish).toBe(true);
});

it('locks competing commands, keeps drawing input inert, and supports disabled history', () => {
  const session = setup([line], 0); session.bufferSelection(); expect(session.bufferSelection()).toBe(false);
  expect(session.add([0, 0])).toBe(false); expect(session.removeLastDrawStep()).toBe(false); expect(session.finish()).toBeNull();
  for (const action of [() => session.start('LineString'), () => session.simplifySelection(), () => session.select(null),
    () => session.deleteSelection(), () => session.scaleSelection(), () => session.editSelected(), () => session.undo(),
    () => session.applyTransaction({ delete: [0] }), () => session.clearHistory()]) expect(action).toThrow();
  session.finishBuffer(); expect(session.state.canUndo).toBe(false);
  expect(session.getBufferPreview()).toBeNull(); expect(session.finishBuffer()).toBeNull(); expect(session.setBufferDistance(2)).toBe(false);
  session.start('LineString'); expect(() => session.bufferSelection()).toThrow('Finish or cancel');
});
