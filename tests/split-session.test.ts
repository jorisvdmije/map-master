import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate, PolygonFeature } from '../src/index.js';
const polygon: PolygonFeature = { type: 'Feature', id: 0, properties: { nested: { name: 'parcel' } },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
};
function session(createId = () => 'new'): DrawingSession {
  const tool = new DrawingSession(createId); tool.importGeoJSON(polygon); tool.clearHistory(); tool.select(0); return tool;
}
const cut: Coordinate[] = [[-1, 3], [11, 3]];
it('previews without modifying exports, IDs or history, then commits one mixed transaction', () => {
  let allocations = 0; const tool = session(() => { allocations++; return 'new'; }); const original = tool.exportGeoJSON();
  expect(tool.splitSelected()).toBe(true); expect(tool.splitSelected()).toBe(false);
  expect(tool.state).toMatchObject({ mode: 'split-polygon', splitError: 'split-too-few-points', canFinish: false, selectedFeatureId: 0 });
  tool.add(cut[0]!); tool.add(cut[1]!);
  expect(tool.state).toMatchObject({ mode: 'split-polygon', splitError: null, canFinish: true, canUndo: false });
  expect(tool.getSplitPreview()).not.toBeNull(); expect(allocations).toBe(0); expect(tool.exportGeoJSON()).toEqual(original);
  const event = tool.finishSplit()!; expect(event.changes).toHaveLength(2);
  expect(event.changes[0]!.before).toEqual(polygon); expect(event.changes[0]!.after!.id).toBe(0);
  expect(event.changes[1]!.before).toBeNull(); expect(event.changes[1]!.after!.id).toBe('new'); expect(allocations).toBe(1);
  expect(tool.state).toMatchObject({ mode: 'idle', selectedFeatureId: 0, featureCount: 2, dataRevision: 2, splitError: null });
  const saved = tool.exportGeoJSON();
  expect(saved.features[0]!.properties).toEqual(polygon.properties); expect(saved.features[1]!.properties).toEqual(polygon.properties);
  expect(tool.undo()?.action).toBe('transaction'); expect(tool.exportGeoJSON()).toEqual(original);
  expect(tool.redo()?.changes).toEqual(event.changes); expect(tool.exportGeoJSON()).toEqual(saved); expect(allocations).toBe(1);
});
it('cancels without clearing redo and lets Backspace/API remove invalid segments', () => {
  const tool = session(); tool.applyTransaction({ create: [{ ...polygon, id: 'other' }] }); tool.undo();
  tool.splitSelected(); tool.setSplitLine(cut); tool.add([5, 3]);
  expect(tool.state.splitError).toBe('split-self-intersection'); expect(tool.finishSplit()).toBeNull();
  expect(tool.removeSplitPoint()).toBe(true); expect(tool.state.canFinish).toBe(true);
  const before = tool.exportGeoJSON(); tool.cancel(); expect(tool.exportGeoJSON()).toEqual(before);
  expect(tool.state.canRedo).toBe(true); expect(tool.getSplitPreview()).toBeNull(); expect(tool.getDraft()).toEqual([]);
  tool.redo(); expect(tool.state.featureCount).toBe(2);
});
it('keeps input and preview snapshots independent and rejects invalid API positions atomically', () => {
  const tool = session(); tool.splitSelected(); const input = structuredClone(cut); tool.setSplitLine(input);
  input[0]![0] = 90; tool.getSplitPreview()!.created.coordinates.length = 0;
  expect(tool.getDraft()).toEqual(cut); expect(tool.getSplitPreview()!.created.coordinates).toHaveLength(1);
  for (const input of [ [[0, 0], [Infinity, 1]], [[0, 0], [1, 2, 3]], null ]) {
    expect(() => tool.setSplitLine(input as Coordinate[])).toThrow(); expect(tool.getDraft()).toEqual(cut);
  }
  tool.finishSplit(); expect(tool.state.featureCount).toBe(2);
});
it('protects selection, draft and history against competing commands during splitting', () => {
  const tool = session(); tool.splitSelected(); tool.setSplitLine(cut);
  for (const action of [() => tool.select(null), () => tool.start('LineString'), () => tool.editSelected(), () => tool.deleteSelected(),
    () => tool.undo(), () => tool.redo(), () => tool.clearHistory(), () => tool.importGeoJSON(polygon), () => tool.applyTransaction({})]) {
    expect(action).toThrow('Finish or cancel');
  }
  expect(tool.state.canFinish).toBe(true); expect(tool.finish()).toBeNull(); expect(tool.getDraft()).toEqual(cut);
});
it('requires a selected polygon and handles ID allocation failure without losing the preview', () => {
  const empty = new DrawingSession(() => 'new'); expect(empty.splitSelected()).toBe(false);
  empty.importGeoJSON({ type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } });
  empty.select('line'); expect(empty.splitSelected()).toBe(false); expect(() => empty.setSplitLine(cut)).toThrow('Start splitting');
  const tool = session(() => 'existing'); tool.importGeoJSON({ ...polygon, id: 'existing' }); tool.select(0); tool.splitSelected(); tool.setSplitLine(cut);
  const saved = tool.exportGeoJSON(); expect(() => tool.finishSplit()).toThrow('unique feature ID');
  expect(tool.exportGeoJSON()).toEqual(saved); expect(tool.state.canFinish).toBe(true); tool.cancel();
});
