import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate, VertexUpdate } from '../src/index.js';

function fixture(polygon = false) {
  const tool = new DrawingSession(() => 'a');
  tool.start(polygon ? 'Polygon' : 'LineString');
  const points: Coordinate[] = polygon ? [[0, 0], [4, 0], [4, 4], [0, 4]] : [[0, 0], [2, 1], [4, 0], [6, 1], [8, 0]];
  points.forEach(p => tool.add(p)); tool.finish(); tool.clearHistory(); tool.select('a'); tool.editSelected(); return tool;
}
it('selects unique indices in acquisition order, isolates state snapshots, and keeps the legacy primary index', () => {
  const tool = fixture(); tool.selectVertices([2, 0, 2]);
  expect(tool.state).toMatchObject({ selectedVertexIndices: [2, 0], selectedVertexIndex: 0 });
  tool.state.selectedVertexIndices.push(3); expect(tool.state.selectedVertexIndices).toEqual([2, 0]);
  expect(tool.selectVertices([2, 0])).toBe(false);
  expect(() => tool.selectVertices([0, 99])).toThrow(RangeError); expect(tool.state.selectedVertexIndices).toEqual([2, 0]);
  tool.selectVertex(2); expect(tool.state.selectedVertexIndices).toEqual([2]);
  tool.selectVertex(null); expect(tool.state.selectedVertexIndices).toEqual([]);
});
it.each([false, true])('moves selected vertices atomically, retains all other vertices, and saves one history entry (polygon=%s)', polygon => {
  const tool = fixture(polygon); const original = tool.exportGeoJSON(); const draft = tool.getDraft();
  tool.selectVertices([0, 1]); tool.translateSelectedVertices([0, -1]);
  expect(tool.getDraft()).toEqual(draft.map((p, i) => i < 2 ? [p[0], p[1] - 1] : p));
  expect(tool.exportGeoJSON()).toEqual(original); expect(tool.state.canFinish).toBe(true);
  tool.finish(); const after = tool.exportGeoJSON(); expect(tool.state.selectedVertexIndices).toEqual([]);
  tool.undo(); expect(tool.exportGeoJSON()).toEqual(original); expect(tool.state.canUndo).toBe(false);
  tool.redo(); expect(tool.exportGeoJSON()).toEqual(after);
});
it.each(([
  [{ index: 0, coordinate: [1, 1] }, { index: 99, coordinate: [1, 2] }],
  [{ index: 0, coordinate: [1, 1] }, { index: 1, coordinate: [181, 2] }],
  [{ index: 0, coordinate: [1, 1] }, { index: 0, coordinate: [2, 1] }],
  [{ index: 0, coordinate: [1, 1] }, { index: 1, coordinate: [NaN, 2] }],
] as VertexUpdate[][]).map(updates => ({ updates })))('rejects an entire invalid update batch without changing coordinates or selection: %j', ({ updates }) => {
  const tool = fixture(); tool.selectVertices([2, 3]); const draft = tool.getDraft(); const state = tool.state;
  expect(() => tool.moveVertices(updates)).toThrow(); expect(tool.getDraft()).toEqual(draft); expect(tool.state).toEqual(state);
});
it('keeps invalid topology repairable, isolates update arrays, and does not emit an intermediate duplicate-vertex state', () => {
  const tool = fixture(true); const draft = tool.getDraft();
  tool.moveVertices([{ index: 0, coordinate: draft[1]! }, { index: 1, coordinate: [5, 0] }]);
  expect(tool.state.canFinish).toBe(true);
  tool.moveVertices([{ index: 0, coordinate: [4, 4] }, { index: 1, coordinate: [5, 0] }]);
  expect(tool.state.validationError).toBe('duplicate-vertex'); expect(tool.finish()).toBeNull();
  const updates: VertexUpdate[] = [{ index: 0, coordinate: [0, -1] }, { index: 1, coordinate: [4, -1] }];
  tool.moveVertices(updates); updates[0]!.coordinate[0] = 99;
  expect(tool.getDraft()[0]).toEqual([0, -1]); expect(tool.state.canFinish).toBe(true);
});
it('removes the entire selection or none, clears stale indices after insertion/removal, and keeps no-op saves out of history', () => {
  const tool = fixture(); const original = tool.exportGeoJSON();
  tool.selectVertices([0, 1, 2, 3]); expect(tool.removeSelectedVertices()).toBe(false); expect(tool.getDraft()).toHaveLength(5);
  tool.selectVertices([1, 3]); expect(tool.removeSelectedVertices()).toBe(true); expect(tool.getDraft()).toEqual([[0, 0], [4, 0], [8, 0]]);
  expect(tool.state.selectedVertexIndices).toEqual([]); tool.insertVertex(1, [2, 0]); expect(tool.state.selectedVertexIndices).toEqual([1]);
  tool.cancel(); expect(tool.exportGeoJSON()).toEqual(original);
  tool.editSelected(); tool.selectVertices([0, 2]); expect(tool.translateSelectedVertices([0, 0])).toBe(false);
  tool.finish(); expect(tool.state.canUndo).toBe(false); expect(tool.exportGeoJSON()).toEqual(original);
});
it('limits groups to the active hole/component and restores the entire multipart feature with Undo', () => {
  const tool = new DrawingSession(() => 'a');
  const ring = (x: number, y: number, s: number): Coordinate[] => [[x,y],[x+s,y],[x+s,y+s],[x,y+s],[x,y]];
  tool.importGeoJSON({ type: 'Feature', id: 'multi', properties: { a: 1 }, geometry: { type: 'MultiPolygon', coordinates: [[ring(0,0,10), ring(2,2,3)], [ring(20,20,10)]] } });
  tool.select('multi'); tool.clearHistory(); const before = tool.exportGeoJSON();
  tool.editSelected(1, 0); tool.selectVertices([0, 1]); tool.translateSelectedVertices([0.2, 0.2]); tool.finish();
  const g = tool.exportGeoJSON().features[0]!.geometry; const old = before.features[0]!.geometry;
  if (g.type !== 'MultiPolygon' || old.type !== 'MultiPolygon') throw new Error('fixture');
  expect(g.coordinates[0]![0]).toEqual(old.coordinates[0]![0]); expect(g.coordinates[1]).toEqual(old.coordinates[1]);
  expect(g.coordinates[0]![1]).not.toEqual(old.coordinates[0]![1]); tool.undo(); expect(tool.exportGeoJSON()).toEqual(before);
});
it('keeps shared-boundary junctions fixed for a whole batch and revokes locked edit drafts', () => {
  const tool = new DrawingSession(() => 'a');
  tool.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'a', properties: null, geometry: { type: 'Polygon', coordinates: [[[0,0],[2,0],[2,1],[2,2],[0,2],[0,0]]] } },
    { type: 'Feature', id: 'b', properties: null, geometry: { type: 'Polygon', coordinates: [[[2,0],[4,0],[4,2],[2,2],[2,1],[2,0]]] } },
  ] });
  tool.selectMany(['a','b']); expect(tool.editSharedBoundary()).toBe(true); const draft = tool.getDraft();
  tool.selectVertices([0,1]); expect(tool.translateSelectedVertices([0.1,0])).toBe(false); expect(tool.getDraft()).toEqual(draft);
  expect(tool.removeSelectedVertices()).toBe(false); tool.setLockedFeatureIds(['a']);
  expect(tool.state).toMatchObject({ mode: 'idle', selectedVertexIndices: [] }); expect(() => tool.moveVertices([])).toThrow('Start editing');
});
