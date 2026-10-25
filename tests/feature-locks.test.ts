import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { FeatureLockedError, type FeatureId, type LineFeature, type PolygonFeature } from '../src/index.js';

const line = (id: FeatureId, x = 0): LineFeature => ({ type: 'Feature', id, properties: { name: 'Route' },
  geometry: { type: 'LineString', coordinates: [[x, 0], [x + 1, 1]] } });
const polygon = (id: FeatureId, x = 0): PolygonFeature => ({ type: 'Feature', id, properties: {},
  geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 2, 0], [x + 2, 2], [x, 2], [x, 0]]] } });
function fixture(): DrawingSession {
  let id = 0;
  const tool = new DrawingSession(() => `copy-${++id}`);
  tool.importGeoJSON({ type: 'FeatureCollection', features: [line(0), line('0'), polygon('a'), polygon('b', 2)] });
  tool.clearHistory(); return tool;
}

it('keeps typed host locks isolated from data, selection and history, including initial imports', () => {
  const ids: FeatureId[] = [0, 'missing', 0];
  const tool = new DrawingSession(() => 'new', 100, ids);
  ids.push('0');
  tool.importGeoJSON({ type: 'FeatureCollection', features: [line(0), line('0')] });
  tool.clearHistory(); tool.select(0);
  const before = tool.exportGeoJSON(); const state = tool.state;
  expect(tool.getLockedFeatureIds()).toEqual([0, 'missing']);
  tool.getLockedFeatureIds().push('0');
  expect(tool.isFeatureLocked('0')).toBe(false);
  expect(tool.setLockedFeatureIds(['missing', 0])).toBe(false);
  expect(tool.deleteSelected()).toBeNull(); expect(tool.editSelected()).toBe(false);
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state).toEqual(state);
  tool.setLockedFeatureIds([]); expect(tool.deleteSelected()?.id).toBe(0);
  expect(tool.undo()).not.toBeNull(); expect(tool.exportGeoJSON()).toEqual(before);
});

it.each([null, {}, 'a', [NaN], [Infinity], [true], [null], [undefined], [1, {}]])('rejects invalid locks %j atomically', (value) => {
  const tool = fixture(); tool.select('a'); tool.editSelected(); tool.moveVertex(1, [3, 0]);
  const state = tool.state; const draft = tool.getDraft();
  expect(() => tool.setLockedFeatureIds(value as FeatureId[])).toThrow(TypeError);
  expect(tool.getLockedFeatureIds()).toEqual([]); expect(tool.state).toEqual(state); expect(tool.getDraft()).toEqual(draft);
  expect(() => new DrawingSession(() => 'new', 100, value as FeatureId[])).toThrow(TypeError);
});

it('rejects the entire explicit transaction with a typed error and preserves redo', () => {
  const tool = fixture(); tool.applyTransaction({ create: [line('new')] }); tool.undo();
  tool.setLockedFeatureIds([0]); tool.selectMany(['0', 0]);
  const state = tool.state; const before = tool.exportGeoJSON();
  for (const change of [{ delete: ['0', 0], create: [line('created')] }, { update: [line('0', 4), line(0, 4)] },
    { update: [{ ...line(0), properties: { name: 'Changed' } }] }]) {
    let caught: unknown;
    try { tool.applyTransaction(change); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(FeatureLockedError); expect((caught as FeatureLockedError).featureId).toBe(0);
    expect(tool.state).toEqual(state); expect(tool.exportGeoJSON()).toEqual(before);
  }
  expect(tool.applyTransaction({ update: [line(0)] })).toBeNull(); // unchanged values do not write
  expect(tool.redo()).not.toBeNull();
});

it('blocks mixed selection commands atomically while permitting independent copies', () => {
  const tool = fixture(); tool.selectMany(['0', 0]); tool.setLockedFeatureIds([0]);
  const before = tool.exportGeoJSON(); const state = tool.state;
  expect(tool.translateSelection([1, 1])).toBeNull(); expect(tool.deleteSelection()).toBeNull();
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state).toEqual(state);
  const copies = tool.duplicateSelection([3, 3])!;
  expect(copies.changes).toHaveLength(2);
  expect(tool.exportGeoJSON().features.slice(0, 4)).toEqual(before.features);
  expect(tool.state.selectedFeatureIds.every((id) => !tool.isFeatureLocked(id))).toBe(true);
  tool.undo(); expect(tool.exportGeoJSON()).toEqual(before);
});

it.each(['editSelected', 'drawHole', 'splitSelected', 'reshapeSelected', 'rotateSelection', 'scaleSelection',
  'simplifySelection', 'offsetSelection', 'bufferSelection', 'unionSelection', 'intersectionSelection', 'editSharedBoundary'] as const)('prevents entry into %s for locked mutation targets', (method) => {
  const tool = fixture(); tool.setLockedFeatureIds([0, 'a']);
  tool.selectMany(method === 'unionSelection' || method === 'intersectionSelection' || method === 'editSharedBoundary' ? ['b', 'a'] : method === 'offsetSelection' ? [0] : ['a']);
  const state = tool.state;
  expect(tool[method]()).toBe(false); expect(tool.state).toEqual(state);
});

it.each(['editSelected', 'drawHole', 'splitSelected', 'reshapeSelected', 'rotateSelection', 'scaleSelection',
  'simplifySelection', 'offsetSelection', 'bufferSelection', 'unionSelection', 'intersectionSelection', 'editSharedBoundary', 'differenceSelection'] as const)('cancels active %s when its target is locked, preserving geometry and selection', (method) => {
  const tool = fixture();
  const multiple = ['unionSelection', 'intersectionSelection', 'editSharedBoundary', 'differenceSelection'].includes(method);
  const id = method === 'offsetSelection' ? 0 : 'a';
  tool.selectMany(multiple ? ['a', 'b'] : [id]);
  const before = tool.exportGeoJSON(); const state = tool.state;
  expect(tool[method]()).toBe(true);
  tool.setLockedFeatureIds([id]);
  expect(tool.state.mode).toBe('idle'); expect(tool.state.selectedFeatureIds).toEqual(state.selectedFeatureIds);
  expect(tool.state.dataRevision).toBe(state.dataRevision); expect(tool.state.canUndo).toBe(false);
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.getDraft()).toEqual([]);
});

it('keeps locked cutters available for subtraction and cancels only on target locking', () => {
  const tool = fixture(); tool.importGeoJSON(polygon('cut', 1)); tool.clearHistory();
  tool.setLockedFeatureIds(['cut']); tool.selectMany(['a', 'cut']);
  expect(tool.differenceSelection()).toBe(true);
  const preview = tool.getDifferencePreview();
  tool.setLockedFeatureIds(['cut', 'b']);
  expect(tool.state.mode).toBe('difference-polygons'); expect(tool.getDifferencePreview()).toEqual(preview);
  const cutter = tool.exportGeoJSON().features.find((feature) => feature.id === 'cut');
  expect(tool.finishDifference()).not.toBeNull();
  expect(tool.exportGeoJSON().features.find((feature) => feature.id === 'cut')).toEqual(cutter);
  expect(tool.undo()).not.toBeNull();
  tool.setLockedFeatureIds(['a']); expect(tool.differenceSelection()).toBe(false);
});

it('preserves new drawings and tracing to locked references when locks change', () => {
  const tool = fixture(); tool.start('LineString'); tool.add([0, 0]);
  tool.setLockedFeatureIds(['a']); expect(tool.state.mode).toBe('draw-line');
  expect(tool.traceBoundary({ featureId: 'a' }, [0, 0], [2, 2])).toBe(true);
  expect(tool.finish()).not.toBeNull();
});

it('preserves unrelated editing and prevents removal of locked interior rings', () => {
  const tool = fixture(); tool.select('a'); tool.editSelected(); tool.moveVertex(1, [3, 0]);
  const draft = tool.getDraft(); tool.setLockedFeatureIds(['b']);
  expect(tool.getDraft()).toEqual(draft); expect(tool.state.mode).toBe('edit-polygon'); tool.cancel();
  const hole = polygon('hole'); hole.geometry.coordinates.push([[0.5, 0.5], [0.5, 1], [1, 1], [1, 0.5], [0.5, 0.5]]);
  tool.importGeoJSON(hole); tool.select('hole'); tool.clearHistory(); tool.setLockedFeatureIds(['hole']);
  const before = tool.exportGeoJSON();
  expect(tool.deleteHole(1)).toBeNull(); expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.canUndo).toBe(false);
});

it('blocks history without consuming or skipping entries, and unlock restores exact undo/redo', () => {
  const tool = fixture(); const before = tool.exportGeoJSON();
  tool.applyTransaction({ update: [line(0, 4), line('0', 4)] }); const after = tool.exportGeoJSON();
  tool.setLockedFeatureIds([0]);
  for (let i = 0; i < 3; i++) { expect(tool.state.canUndo).toBe(false); expect(tool.undo()).toBeNull(); }
  expect(tool.exportGeoJSON()).toEqual(after);
  tool.setLockedFeatureIds([]); expect(tool.state.canUndo).toBe(true); tool.undo();
  expect(tool.exportGeoJSON()).toEqual(before);
  tool.setLockedFeatureIds(['0']); expect(tool.state.canRedo).toBe(false); expect(tool.redo()).toBeNull();
  tool.setLockedFeatureIds([]); expect(tool.state.canRedo).toBe(true); tool.redo(); expect(tool.exportGeoJSON()).toEqual(after);
});

it('protects history restoration of missing locked IDs and imported locked data', () => {
  const tool = fixture(); tool.select(0); tool.deleteSelected(); tool.setLockedFeatureIds([0]);
  expect(tool.state.canUndo).toBe(false); expect(tool.undo()).toBeNull();
  tool.setLockedFeatureIds([]); tool.undo(); tool.setLockedFeatureIds([0]);
  expect(tool.state.canRedo).toBe(false); expect(tool.redo()).toBeNull();
  tool.setLockedFeatureIds(['ref']); tool.importGeoJSON(line('ref'));
  expect(tool.state.canUndo).toBe(false); expect(tool.undo()).toBeNull();
  tool.setLockedFeatureIds([]); expect(tool.undo()).not.toBeNull();
});
