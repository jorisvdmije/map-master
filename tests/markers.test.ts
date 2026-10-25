import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { GeoJSONImportError } from '../src/core/geojson-import.js';
import { FeatureLockedError } from '../src/core/feature-locks.js';
import { SnapIndex, snappingOptions } from '../src/core/snapping.js';
import { traceSource } from '../src/core/trace-boundary.js';
import type { Coordinate, FeatureId, PointFeature } from '../src/index.js';

const point = (id: FeatureId = 'marker', coordinates: Coordinate = [4, 52]): PointFeature => ({
  type: 'Feature', id, properties: { name: 'Meeting point', nested: { tags: ['a'] } }, geometry: { type: 'Point', coordinates },
});
const session = () => { let id = 0; return new DrawingSession(() => `point-${++id}`); };

it('creates exactly one position, cancels empty drafts and replays a stable identity', () => {
  const tool = session(); tool.start('Point');
  expect(tool.state).toMatchObject({ mode: 'draw-point', canFinish: false });
  expect(tool.finish()).toBeNull(); tool.cancel(); expect(tool.state.canUndo).toBe(false);
  tool.start('Point'); tool.add([4, 52]); tool.add([5, 53]);
  expect(tool.state).toMatchObject({ vertexCount: 1, canFinish: true });
  expect(tool.finish()).toMatchObject({ id: 'point-1', geometry: { type: 'Point', coordinates: [5, 53] } });
  const saved = tool.exportGeoJSON(); tool.undo(); expect(tool.state.featureCount).toBe(0);
  tool.redo(); expect(tool.exportGeoJSON()).toEqual(saved);
});

it.each([[], [4], [4, 52, 7], [[4, 52]], [181, 52], [4, -91], [NaN, 52], [Infinity, 52], ['4', 52], null])('rejects malformed marker coordinates atomically: %j', (coordinates) => {
  const tool = session(); tool.importGeoJSON(point()); const before = tool.exportGeoJSON();
  expect(() => tool.importGeoJSON({ type: 'FeatureCollection', features: [point('valid'), { ...point('bad'), geometry: { type: 'Point', coordinates } }] })).toThrow(GeoJSONImportError);
  expect(tool.exportGeoJSON()).toEqual(before);
});

it('round-trips numeric and string IDs, nested properties, and independent point snapshots', () => {
  const tool = session(); const original = point(0); const expected = structuredClone(original);
  const imported = tool.importGeoJSON({ type: 'FeatureCollection', features: [original, point('0')] });
  original.geometry.coordinates[0] = 9; imported.features[0]!.geometry.coordinates[0] = 20;
  tool.select(0); const selected = tool.getSelected()!; selected.geometry.coordinates[0] = 50;
  expect(tool.exportGeoJSON().features[0]).toEqual(expected);
  const other = session(); other.importGeoJSON(tool.exportGeoJSON()); expect(other.exportGeoJSON()).toEqual(tool.exportGeoJSON());
});

it('edits one position without adding/removing vertices, preserves identity, and supports cancel and no-op saves', () => {
  const tool = session(); tool.importGeoJSON(point()); tool.select('marker'); tool.clearHistory();
  tool.editSelected(); expect(tool.state.mode).toBe('edit-point');
  expect(tool.insertVertex(1, [6, 52])).toBe(false); expect(tool.removeVertex(0)).toBe(false);
  tool.moveVertex(0, [5, 53]); expect(tool.exportGeoJSON().features[0]).toEqual(point()); tool.cancel();
  tool.editSelected(); tool.finish(); expect(tool.state.canUndo).toBe(false);
  tool.editSelected(); tool.moveVertex(0, [5, 53]); tool.finish();
  expect(tool.getSelected()).toEqual(point('marker', [5, 53])); tool.undo(); expect(tool.getSelected()).toEqual(point());
  tool.redo(); expect(tool.getSelected()).toEqual(point('marker', [5, 53]));
});

it('moves, copies and deletes mixed selections atomically, with exact history and bounds validation', () => {
  const tool = session(); tool.importGeoJSON({ type: 'FeatureCollection', features: [point(), {
    type: 'Feature', id: 'line', properties: null, geometry: { type: 'LineString', coordinates: [[4, 52], [5, 52]] },
  }] }); tool.selectMany(['marker', 'line']); tool.clearHistory(); const before = tool.exportGeoJSON();
  expect(() => tool.translateSelection([180, 0])).toThrow(RangeError); expect(tool.exportGeoJSON()).toEqual(before);
  tool.translateSelection([1, 1]); expect(tool.getSelection()[0]).toEqual(point('marker', [5, 53]));
  tool.undo(); expect(tool.exportGeoJSON()).toEqual(before);
  tool.duplicateSelection([0.1, 0]); expect(tool.state.featureCount).toBe(4);
  expect(tool.getSelection()[0]?.id).not.toBe('marker');
  tool.deleteSelection(); expect(tool.exportGeoJSON()).toEqual(before);
  tool.undo(); expect(tool.state.featureCount).toBe(4);
});

it('applies locks to edits, transactions and replay, cancelling an active marker edit', () => {
  const tool = session(); tool.importGeoJSON(point()); tool.select('marker');
  tool.editSelected(); tool.moveVertex(0, [6, 52]); tool.setLockedFeatureIds(['marker']);
  expect(tool.state.mode).toBe('idle'); expect(tool.getSelected()).toEqual(point());
  expect(tool.editSelected()).toBe(false); expect(tool.deleteSelected()).toBeNull(); expect(tool.undo()).toBeNull();
  expect(() => tool.applyTransaction({ update: [point('marker', [5, 52])] })).toThrow(FeatureLockedError);
  tool.setLockedFeatureIds([]); tool.applyTransaction({ update: [point('marker', [5, 52])] });
  tool.undo(); expect(tool.getSelected()).toEqual(point());
});

it('snaps to a marker as a vertex, without phantom edges or a tracing boundary', () => {
  const index = new SnapIndex({ type: 'FeatureCollection', features: [point()] }, ([x, y]) => ({ x, y }));
  const query = (vertices: boolean, exclude: FeatureId | null = null) => index.query({ x: 5, y: 52 }, snappingOptions({ enabled: true, vertices }), ({ x, y }) => [x, y], exclude);
  expect(query(true)).toMatchObject({ kind: 'vertex', featureId: 'marker', index: 0, coordinate: [4, 52] });
  expect(query(false)).toBeNull(); expect(query(true, 'marker')).toBeNull();
  expect(traceSource(point(), { featureId: 'marker' })).toBeNull();
});

it('supports transformations and a circular buffer while keeping line/polygon-only tools unavailable', () => {
  const tool = session(); tool.importGeoJSON(point()); tool.select('marker');
  expect(tool.drawHole()).toBe(false); expect(tool.splitSelected()).toBe(false); expect(tool.offsetSelection()).toBe(false);
  expect(tool.rotateSelection([4, 51])).toBe(true); tool.setRotationAngle(90); expect(tool.getRotationPreview()?.features[0]?.geometry.type).toBe('Point'); tool.cancel();
  expect(tool.scaleSelection([4, 51])).toBe(true); tool.setScaleFactor(2); expect(tool.getScalePreview()?.features[0]?.geometry.type).toBe('Point'); tool.cancel();
  tool.simplifySelection(); tool.setSimplificationTolerance(100); expect(tool.getSimplificationPreview()?.features).toEqual([point()]); tool.cancel();
  tool.bufferSelection(10); expect(tool.getBufferPreview()?.features[0]?.geometry.type).toBe('Polygon');
  tool.finishBuffer(); tool.undo(); expect(tool.getSelected()).toEqual(point());
});
