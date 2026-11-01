import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { VertexPinError } from '../src/core/vertex-pins.js';
import type { Coordinate, GeometryFeature, GeometryFeatureCollection } from '../src/core/types.js';

const point = (id: string | number, coordinate: Coordinate = [2, 0]): GeometryFeature => ({ type: 'Feature', id, properties: { name: String(id) }, geometry: { type: 'Point', coordinates: coordinate } });
const fixture: GeometryFeatureCollection = { type: 'FeatureCollection', features: [
  { type: 'Feature', id: 0, properties: null, geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } },
  { type: 'Feature', id: '0', properties: { nested: { keep: [1, null] } }, geometry: { type: 'Polygon', coordinates: [[[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]] } },
  point('marker'),
  { type: 'Feature', id: 'line', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[2, 0], [3, -1]], [[-1, -1], [2, 0]]] } },
] };
const targets = [{ featureId: 0, index: 1 }, { featureId: '0', index: 0 }, { featureId: 'marker', index: 0 }, { featureId: 'line', index: 0 }];
function setup(limit = 100) {
  let next = 0;
  const session = new DrawingSession(() => `new-${next++}`, limit);
  session.importGeoJSON(fixture); session.clearHistory(); session.selectMany([0, '0', 'marker', 'line']); return session;
}

it('pins four features, previews atomic movement without mutating committed data and saves exact one-step history', () => {
  const session = setup(); const unpinned = session.exportGeoJSON();
  expect(session.pinVertices(targets)?.changes).toHaveLength(4);
  const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  expect(session.getPinnedVertices()[0]?.vertices).toHaveLength(5);
  session.select(0); session.editSelected(); session.moveVertex(1, [2.5, -0.5]);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state).toMatchObject({ canFinish: true, pinningError: null, dataRevision: revision });
  const preview = session.getPinnedPreview()!; expect(preview.features).toHaveLength(4);
  expect(preview.features[2]?.geometry).toEqual({ type: 'Point', coordinates: [2.5, -0.5] });
  expect(preview.features[3]?.geometry).toEqual({ type: 'MultiLineString', coordinates: [[[2.5, -0.5], [3, -1]], [[-1, -1], [2.5, -0.5]]] });
  expect(session.finish()?.id).toBe(0);
  const after = session.exportGeoJSON(); expect(after).toEqual(preview);
  expect(after.features[1]?.properties?.nested).toEqual({ keep: [1, null] });
  const undone = session.undo(); expect(undone?.action).toBe('transaction'); expect(undone?.changes).toHaveLength(4); expect(session.exportGeoJSON()).toEqual(before);
  session.undo(); expect(session.exportGeoJSON()).toEqual(unpinned); expect(session.getPinnedVertices()).toEqual([]);
  session.redo(); session.redo(); expect(session.exportGeoJSON()).toEqual(after);
});

it('toolbar-style pinning connects all exact shared positions once and unpinning removes complete touched groups', () => {
  const session = setup(); expect(session.canPinSharedVertices()).toBe(true);
  expect(session.pinSharedVertices()?.changes).toHaveLength(4); expect(session.getPinnedVertices()).toHaveLength(2);
  const pinned = session.exportGeoJSON(); const revision = session.state.dataRevision;
  expect(session.pinSharedVertices()).toBeNull(); expect(session.state.dataRevision).toBe(revision);
  session.select('marker'); expect(session.canUnpinSelection()).toBe(true);
  expect(session.unpinSelection()?.changes).toHaveLength(4); expect(session.getPinnedVertices()).toHaveLength(1);
  session.undo(); expect(session.exportGeoJSON()).toEqual(pinned);
  session.unpinVertices([{ featureId: 0, index: 2 }]); expect(session.getPinnedVertices()).toHaveLength(1);
});

it('uses an explicit degree tolerance, aligns to the first vertex, merges existing groups and rejects distant/malformed targets atomically', () => {
  const session = setup(); session.importGeoJSON(point('near', [2.00001, 0]));
  const before = session.exportGeoJSON();
  expect(() => session.pinVertices([{ featureId: 'near', index: 0 }, ...targets])).toThrow('tolerance'); expect(session.exportGeoJSON()).toEqual(before);
  session.pinVertices(targets); const group = session.getPinnedVertices()[0]!.id;
  const event = session.pinVertices([{ featureId: 'near', index: 0 }, { featureId: 'marker', index: 0 }], { tolerance: 0.00002 });
  expect(event?.changes).toHaveLength(5); expect(session.getPinnedVertices()).toHaveLength(1); expect(session.getPinnedVertices()[0]?.id).toBe(group);
  expect(session.getPinnedVertices()[0]?.coordinate).toEqual([2.00001, 0]);
  const pinned = session.exportGeoJSON();
  for (const operation of [() => session.pinVertices(targets, { tolerance: NaN }), () => session.pinVertices(targets, { tolerance: 2 }),
    () => session.pinVertices([{ featureId: 0, index: 1 }, { featureId: 0, index: 2 }]),
    () => session.pinVertices([{ featureId: 0, index: 1 }, { featureId: '0', index: 99 }])]) expect(operation).toThrow();
  expect(session.exportGeoJSON()).toEqual(pinned);
});

it('blocks an invalid follower while leaving the primary valid, allows correction and supports cancellation/no-op saves', () => {
  const session = setup(); session.pinVertices(targets); session.clearHistory(); const before = session.exportGeoJSON();
  session.select('marker'); session.editSelected(); session.moveVertex(0, [4, 2]);
  expect(session.state).toMatchObject({ validationError: null, pinningError: 'pin-invalid-result', canFinish: false });
  expect(session.getPinnedPreview()).toBeNull(); expect(session.finish()).toBeNull(); expect(session.exportGeoJSON()).toEqual(before);
  session.moveVertex(0, [2.5, -0.5]); expect(session.state).toMatchObject({ canFinish: true, pinningError: null });
  session.cancel(); expect(session.exportGeoJSON()).toEqual(before); expect(session.state.canUndo).toBe(false);
  session.editSelected(); session.finish(); expect(session.state).toMatchObject({ mode: 'idle', canUndo: false });
});

it('honors locked followers, cancels when host locks change and blocks group history until unlocked', () => {
  const session = setup(); session.pinVertices(targets); const before = session.exportGeoJSON();
  session.setLockedFeatureIds(['0']); session.select('marker'); session.editSelected(); session.moveVertex(0, [2.5, -0.5]);
  expect(session.state).toMatchObject({ canFinish: false, pinningError: 'pin-locked' }); session.cancel();
  expect(() => session.unpinSelection()).toThrow(VertexPinError); expect(session.state.canUndo).toBe(false);
  session.setLockedFeatureIds([]); session.editSelected(); session.moveVertex(0, [2.5, -0.5]); session.setLockedFeatureIds(['line']);
  expect(session.state.mode).toBe('idle'); expect(session.exportGeoJSON()).toEqual(before);
  session.setLockedFeatureIds([]); session.undo(); expect(session.getPinnedVertices()).toEqual([]);
});

it('keeps links stable through insertion, refuses deletion of linked vertices and returns current addresses after winding normalization', () => {
  const session = setup(); session.pinVertices(targets); session.select(0); session.editSelected();
  expect(session.removeVertex(1)).toBe(false); session.insertVertex(1, [1, -1]);
  session.moveVertex(2, [2.5, -0.5]); expect(session.getPinnedPreview()).not.toBeNull(); session.finish();
  expect(session.getPinnedVertices()[0]?.vertices.find(vertex => vertex.featureId === 0)?.index).toBe(2);
  session.editSelected(); session.removeVertex(1); session.moveVertex(1, [2.6, -0.6]); session.finish();
  expect(session.getPinnedVertices()[0]?.vertices.find(vertex => vertex.featureId === 0)?.index).toBe(1);
});

it('addresses holes and multipart components, and moves from a marker back into both correctly', () => {
  const session = new DrawingSession(() => 'unused');
  session.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'area', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [
      [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
      [[[5, 0], [10, 0], [10, 5], [5, 5], [5, 0]], [[6, 1], [6, 2], [7, 2], [7, 1], [6, 1]]],
    ] } }, point('hole', [6, 1]),
  ] });
  session.pinVertices([{ featureId: 'area', partIndex: 1, ringIndex: 1, index: 0 }, { featureId: 'hole', index: 0 }]);
  session.select('area'); session.editSelected(1, 1); session.moveVertex(0, [5.8, 0.8]); session.finish();
  expect(session.getFeature('hole')?.geometry.coordinates).toEqual([5.8, 0.8]);
  expect(session.getPinnedVertices()[0]?.vertices).toContainEqual({ featureId: 'area', partIndex: 1, ringIndex: 1, index: 0 });
});

it('round-trips metadata, rejects conflicts and invalid metadata before any mutation and allows deletion with dormant remaining membership', () => {
  const session = setup(); session.pinVertices(targets); const saved = session.exportGeoJSON();
  const restored = new DrawingSession(() => 'unused'); restored.importGeoJSON(JSON.parse(JSON.stringify(saved)));
  expect(restored.getPinnedVertices()).toEqual(session.getPinnedVertices());
  const malformed = structuredClone(saved); malformed.features[0]!.properties!.mapMasterPins = [{ id: 'bad', coordinate: [50, 50] }];
  expect(() => restored.applyTransaction({ update: [malformed.features[0]!] })).toThrow('existing vertex'); expect(restored.exportGeoJSON()).toEqual(saved);
  const replacement = structuredClone(saved.features[2]!); replacement.geometry = { type: 'Point', coordinates: [3, 0] };
  replacement.properties!.mapMasterPins = [{ id: session.getPinnedVertices()[0]!.id, coordinate: [3, 0] }];
  expect(() => restored.applyTransaction({ update: [replacement] })).toThrow(VertexPinError); expect(restored.exportGeoJSON()).toEqual(saved);
  restored.applyTransaction({ delete: [0, '0', 'line'] }); expect(restored.getPinnedVertices()[0]?.vertices).toHaveLength(1);
  restored.select('marker'); restored.editSelected(); restored.moveVertex(0, [3, 0]); restored.finish();
  expect(restored.getPinnedVertices()[0]?.coordinate).toEqual([3, 0]); restored.undo(); restored.undo(); expect(restored.exportGeoJSON()).toEqual(saved);
});

it('detaches duplicates, isolates all snapshots and keeps disabled history disabled', () => {
  const session = setup(0); session.pinVertices(targets); const saved = session.exportGeoJSON();
  session.getPinnedVertices()[0]!.coordinate[0] = 80; expect(session.exportGeoJSON()).toEqual(saved);
  session.select('marker'); session.duplicateSelection([1, 0]);
  expect(session.exportGeoJSON().features.at(-1)?.properties?.mapMasterPins).toBeUndefined();
  expect(session.getPinnedVertices()[0]?.vertices).toHaveLength(5);
  session.select('marker'); session.editSelected(); session.moveVertex(0, [2.5, -0.5]);
  session.getPinnedPreview()!.features.length = 0; expect(session.getPinnedPreview()?.features).toHaveLength(4);
  session.finish(); expect(session.state.canUndo).toBe(false);
});

it('translates whole selections with unselected followers, rejects invalid/locked followers and restores one transaction', () => {
  const session = setup(); session.pinVertices(targets); session.clearHistory(); session.select('marker');
  const before = session.exportGeoJSON(); const preview = session.previewTranslation([0.2, -0.2]);
  expect(preview).toHaveLength(4); expect(session.exportGeoJSON()).toEqual(before);
  const result = session.translateSelection([0.2, -0.2]); expect(result?.changes).toHaveLength(4);
  expect(session.getPinnedVertices()[0]?.coordinate).toEqual([2.2, -0.2]); session.undo(); expect(session.exportGeoJSON()).toEqual(before);
  session.setLockedFeatureIds(['line']); expect(() => session.translateSelection([0.2, -0.2])).toThrow(VertexPinError);
  session.setLockedFeatureIds([]); expect(() => session.translateSelection([2, 2])).toThrow(); expect(session.exportGeoJSON()).toEqual(before);
  expect(session.state.canRedo).toBe(true);
});

it('rejects a conflicting imported group and malformed metadata with the exact input path, preserving selection/history', () => {
  const session = setup(); session.pinVertices(targets); const before = session.exportGeoJSON(); const id = session.getPinnedVertices()[0]!.id;
  const imported = point('conflicting', [9, 9]); imported.properties!.mapMasterPins = [{ id, coordinate: [9, 9] }];
  expect(() => session.importGeoJSON(imported)).toThrow(VertexPinError); expect(session.exportGeoJSON()).toEqual(before);
  const malformed = point('malformed'); malformed.properties!.mapMasterPins = [{ id: 'bad', coordinate: [8, 8] }];
  expect(() => session.importGeoJSON({ type: 'FeatureCollection', features: [point('valid'), malformed] })).toThrow('$.features[1].properties.mapMasterPins');
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.selectedFeatureIds).toEqual([0, '0', 'marker', 'line']);
});

it('rejects conflicting commands during editing without dropping the draft, and preserves redo through cancellation', () => {
  const session = setup(); session.pinVertices(targets); session.undo(); const original = session.exportGeoJSON();
  session.redo(); session.select('marker'); session.editSelected(); session.moveVertex(0, [2.5, -0.5]); const draft = session.getDraft();
  for (const operation of [() => session.pinVertices(targets), () => session.pinSharedVertices(), () => session.unpinVertices(targets), () => session.unpinSelection()]) expect(operation).toThrow('Finish or cancel');
  expect(session.getDraft()).toEqual(draft); session.cancel(); session.undo(); expect(session.exportGeoJSON()).toEqual(original);
  session.select('marker'); session.editSelected(); session.cancel(); expect(session.state.canRedo).toBe(true);
});

it('merges two existing groups including unselected members and rejects null tolerances/indices', () => {
  const session = setup();
  session.pinVertices([targets[0]!, targets[2]!]); session.pinVertices([targets[1]!, targets[3]!]);
  const before = session.exportGeoJSON(); expect(session.getPinnedVertices()).toHaveLength(2);
  session.select('marker'); expect(session.pinVertices([targets[2]!, targets[1]!])?.changes).toHaveLength(2);
  expect(session.getPinnedVertices()).toHaveLength(1); expect(session.getPinnedVertices()[0]?.vertices).toHaveLength(5);
  session.undo(); expect(session.exportGeoJSON()).toEqual(before);
  // @ts-expect-error null is not an optional numeric tolerance
  expect(() => session.pinVertices(targets, { tolerance: null })).toThrow();
  // @ts-expect-error null is not a component index
  expect(() => session.pinVertices([{ featureId: 'marker', index: 0, partIndex: null }, targets[0]!])).toThrow();
  expect(session.exportGeoJSON()).toEqual(before);
});
