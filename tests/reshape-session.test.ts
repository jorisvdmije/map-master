import { afterEach, expect, it, vi } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import * as transaction from '../src/core/transaction.js';
import * as reshape from '../src/core/reshape-polygon.js';
import type { Coordinate, PolygonFeature, ReshapeSide } from '../src/index.js';
const polygon: PolygonFeature = { type: 'Feature', id: 0, properties: { nested: { name: 'parcel' } },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
};
const path: Coordinate[] = [[2, 0], [3, -2], [4, 0]];
function session(): DrawingSession {
  const tool = new DrawingSession(() => { throw new Error('Reshape must not allocate IDs'); });
  tool.importGeoJSON(polygon); tool.clearHistory(); tool.select(0); return tool;
}
afterEach(() => { vi.restoreAllMocks(); });
it('previews without modifying data and commits one update preserving ID, properties and order', () => {
  const tool = session(); tool.importGeoJSON({ ...polygon, id: '0', properties: null }); tool.clearHistory();
  const before = tool.exportGeoJSON(); const revision = tool.state.dataRevision;
  expect(tool.reshapeSelected()).toBe(true); expect(tool.reshapeSelected()).toBe(false);
  expect(tool.state).toMatchObject({ mode: 'reshape-polygon', reshapeError: 'reshape-too-few-points', reshapeSide: 'shorter', canFinish: false });
  for (const point of path) tool.add(point);
  const preview = tool.getReshapePreview(); expect(preview).not.toBeNull(); expect(tool.exportGeoJSON()).toEqual(before);
  expect(tool.state).toMatchObject({ canFinish: true, canUndo: false, canRedo: false, validationError: null, splitError: null, dataRevision: revision });
  expect(tool.finish()).toBeNull(); const event = tool.finishReshape()!;
  expect(event.changes).toEqual([{ before: before.features[0], after: { ...before.features[0], geometry: preview } }]);
  const after = tool.exportGeoJSON(); expect(after.features[1]).toEqual(before.features[1]);
  expect(tool.state).toMatchObject({ mode: 'idle', selectedFeatureId: 0, featureCount: 2, dataRevision: revision + 1, reshapeError: null, reshapeSide: null });
  event.changes[0]!.after!.properties!.nested = null; event.changes[0]!.after!.geometry.coordinates.length = 0;
  expect(tool.exportGeoJSON()).toEqual(after); expect(tool.getReshapePreview()).toBeNull(); expect(tool.finishReshape()).toBeNull();
  expect(tool.undo()?.action).toBe('transaction'); expect(tool.exportGeoJSON()).toEqual(before);
  expect(tool.redo()?.action).toBe('transaction'); expect(tool.exportGeoJSON()).toEqual(after);
});
it('switches boundary choice without saving, corrects the path and cancels without losing Redo', () => {
  const tool = session(); tool.translateSelection([1, 1]); tool.undo(); const before = tool.exportGeoJSON();
  tool.reshapeSelected(); tool.setReshapePath(path); const shorter = tool.getReshapePreview();
  expect(tool.setReshapeSide('longer')).toBe(true); expect(tool.setReshapeSide('longer')).toBe(false);
  expect(tool.getReshapePreview()).not.toEqual(shorter); tool.setReshapeSide('shorter'); expect(tool.getReshapePreview()).toEqual(shorter);
  tool.removeReshapePoint(); expect(tool.state).toMatchObject({ canFinish: false, reshapeError: 'reshape-endpoints-off-boundary' });
  expect(tool.finishReshape()).toBeNull(); tool.add(path[2]!); expect(tool.getReshapePreview()).toEqual(shorter);
  tool.cancel(); expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.canRedo).toBe(true);
  expect(tool.getDraft()).toEqual([]); tool.reshapeSelected(); expect(tool.state.reshapeSide).toBe('shorter');
  expect(tool.removeReshapePoint()).toBe(false); tool.cancel(); expect(tool.redo()).not.toBeNull();
});
it('requires exactly one single-ring Polygon and refuses entry during another tool', () => {
  const tool = session();
  tool.importGeoJSON({ type: 'FeatureCollection', features: [
    { ...polygon, id: 'hole', geometry: { type: 'Polygon', coordinates: [...polygon.geometry.coordinates, [[2, 2], [2, 4], [4, 4], [4, 2], [2, 2]]] } },
    { ...polygon, id: 'multi', geometry: { type: 'MultiPolygon', coordinates: [polygon.geometry.coordinates] } },
    { ...polygon, id: 'line', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
  ] });
  for (const selection of [[], [0, 'hole'], ['hole'], ['multi'], ['line']]) {
    tool.selectMany(selection); const state = tool.state; expect(tool.reshapeSelected()).toBe(false); expect(tool.state).toEqual(state);
  }
  tool.select(0); tool.start('Polygon'); expect(() => tool.reshapeSelected()).toThrow('Finish or cancel'); tool.cancel();
  tool.select(0); tool.editSelected(); expect(() => tool.reshapeSelected()).toThrow('Finish or cancel');
});
it('rejects malformed API paths and side changes atomically and isolates snapshots', () => {
  const tool = session(); expect(() => tool.setReshapePath(path)).toThrow('Start reshaping');
  expect(() => tool.setReshapeSide('longer')).toThrow('Start reshaping'); expect(() => tool.removeReshapePoint()).toThrow('Start reshaping');
  tool.reshapeSelected(); const input = structuredClone(path); tool.setReshapePath(input); input[0]![0] = 100;
  const preview = tool.getReshapePreview(); tool.getReshapePreview()!.coordinates.length = 0; tool.getDraft()[0]![0] = 100;
  for (const invalid of [null, [[0, 0], [NaN, 1]], [[0, 0], [181, 1]], [[0, 0], [1, 91]], [[0, 0], [1, 2, 3]]]) {
    expect(() => tool.setReshapePath(invalid as Coordinate[])).toThrow(); expect(tool.getDraft()).toEqual(path);
  }
  expect(() => tool.setReshapeSide('invalid' as ReshapeSide)).toThrow(TypeError);
  expect(tool.getReshapePreview()).toEqual(preview); expect(tool.state.reshapeSide).toBe('shorter');
});
it('locks data, selection and other tools for the entire review', () => {
  const tool = session(); tool.reshapeSelected(); tool.setReshapePath(path); const preview = tool.getReshapePreview();
  for (const action of [() => tool.start('LineString'), () => tool.start('Polygon'), () => tool.select(null), () => tool.selectMany([0]),
    () => tool.toggleSelection(0), () => tool.editSelected(), () => tool.splitSelected(), () => tool.drawHole(), () => tool.deleteHole(1),
    () => tool.unionSelection(), () => tool.differenceSelection(), () => tool.intersectionSelection(), () => tool.deleteSelected(),
    () => tool.deleteSelection(), () => tool.translateSelection([1, 1]), () => tool.duplicateSelection(), () => tool.undo(), () => tool.redo(),
    () => tool.clearHistory(), () => tool.importGeoJSON(polygon), () => tool.applyTransaction({})]) expect(action).toThrow('Finish or cancel');
  expect(tool.getReshapePreview()).toEqual(preview); expect(tool.getDraft()).toEqual(path);
});
it('keeps an invalid route visible until correction or cancellation, without committing it', () => {
  const tool = session(); const before = tool.exportGeoJSON(); tool.reshapeSelected(); tool.setReshapePath([[0, 3], [11, 3], [10, 4]]);
  expect(tool.state).toMatchObject({ canFinish: false, reshapeError: 'reshape-boundary-touch' });
  expect(tool.finishReshape()).toBeNull(); expect(tool.getReshapePreview()).toBeNull(); expect(tool.exportGeoJSON()).toEqual(before);
  tool.cancel(); expect(tool.state.canUndo).toBe(false);
});
it('validates the final transaction before any data/history mutation', () => {
  const tool = session(); tool.reshapeSelected(); tool.setReshapePath(path);
  const before = tool.exportGeoJSON(); const state = tool.state; const preview = tool.getReshapePreview();
  vi.spyOn(transaction, 'prepareTransaction').mockImplementationOnce(() => { throw new Error('Rejected result'); });
  expect(() => tool.finishReshape()).toThrow('Rejected result');
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state).toEqual(state); expect(tool.getReshapePreview()).toEqual(preview);
  expect(tool.finishReshape()).not.toBeNull();
});
it('caches validation and preserves null properties', () => {
  const tool = session(); tool.applyTransaction({ update: [{ ...polygon, properties: null }] });
  tool.reshapeSelected(); const calculate = vi.spyOn(reshape, 'reshapePolygon'); tool.setReshapePath(path);
  for (let i = 0; i < 20; i++) { expect(tool.state.canFinish).toBe(true); tool.getReshapePreview(); }
  expect(calculate).toHaveBeenCalledOnce(); tool.finishReshape(); expect(tool.exportGeoJSON().features[0]!.properties).toBeNull();
});
