import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { GeometryFeature, ShapeTemplate } from '../src/index.js';

const point = (id: string): GeometryFeature => ({ type: 'Feature', id, properties: { name: id }, geometry: { type: 'Point', coordinates: [1, 1] } });
const polygon = (): GeometryFeature => ({ type: 'Feature', id: 'polygon', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } });
function session(maxFeatures?: number, templates?: ShapeTemplate[]): DrawingSession {
  let sequence = 0;
  return new DrawingSession(() => `new-${++sequence}`, 100, [], templates, undefined, {}, maxFeatures);
}

it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid feature cap: %s', max => {
  expect(() => session(max)).toThrow('maxFeatures');
});

it('leaves the default unbounded and supports zero capacity', () => {
  const unlimited = session(); unlimited.importGeoJSON({ type: 'FeatureCollection', features: Array.from({ length: 10 }, (_, i) => point(String(i))) });
  expect(unlimited.canCreateFeatures(100_000)).toBe(true);
  const disabled = session(0);
  expect(disabled.canDrawInDataLayer()).toBe(false); expect(disabled.canCreateFeatures(0)).toBe(true);
  expect(() => disabled.importGeoJSON(point('a'))).toThrow('at most 0');
  expect(disabled.state).toMatchObject({ featureCount: 0, canUndo: false });
  for (const count of [-1, 0.5, NaN, Infinity]) expect(() => disabled.canCreateFeatures(count)).toThrow();
});

it('rejects oversized imports and mixed transactions atomically without consuming redo or selection', () => {
  const tool = session(2); tool.importGeoJSON(point('a')); tool.clearHistory();
  tool.applyTransaction({ create: [point('b')] }); tool.undo(); tool.select('a');
  const before = tool.exportGeoJSON(); const state = tool.state;
  expect(() => tool.importGeoJSON({ type: 'FeatureCollection', features: [point('c'), point('d')] })).toThrow('at most 2');
  expect(() => tool.applyTransaction({ update: [{ ...point('a'), properties: { changed: true } }], create: [point('c'), point('d')] })).toThrow('at most 2');
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state).toEqual(state);
  expect(tool.redo()).not.toBeNull(); expect(tool.state.featureCount).toBe(2);
  tool.selectMany(['a', 'b']); const full = tool.exportGeoJSON(); const fullState = tool.state;
  expect(tool.canDuplicateSelection()).toBe(false);
  expect(() => tool.duplicateSelection()).toThrow('at most 2');
  expect(tool.exportGeoJSON()).toEqual(full); expect(tool.state).toEqual(fullState);
});

it('allows replacements and editing at capacity and preserves exact history across the boundary', () => {
  const tool = session(2); tool.importGeoJSON({ type: 'FeatureCollection', features: [point('a'), point('b')] }); tool.clearHistory();
  const before = tool.exportGeoJSON();
  tool.applyTransaction({ delete: ['b'], create: [point('c')] }); expect(tool.state.featureCount).toBe(2);
  tool.undo(); expect(tool.exportGeoJSON()).toEqual(before); tool.redo(); tool.undo();
  tool.select('a'); tool.editSelected(); tool.moveVertex(0, [2, 2]);
  expect(tool.state.canFinish).toBe(true); expect(tool.finish()).not.toBeNull();
  tool.undo(); expect(tool.exportGeoJSON()).toEqual(before);
  tool.deleteSelected(); expect(tool.state.featureCount).toBe(1); expect(tool.canDrawInDataLayer()).toBe(true);
  tool.undo(); expect(tool.exportGeoJSON()).toEqual(before); expect(tool.canDrawInDataLayer()).toBe(false);
});

it('prevents point and text drafts from committing over capacity and permits drawing after deletion', () => {
  const tool = session(1); tool.importGeoJSON(point('a')); tool.clearHistory();
  const before = tool.exportGeoJSON();
  for (const text of [false, true]) {
    if (text) tool.startText({ text: 'label' }); else tool.start('Point');
    tool.add([3, 3]);
    expect(tool.state).toMatchObject({ canFinish: false, validationError: 'feature-limit' });
    expect(tool.finish()).toBeNull(); expect(tool.exportGeoJSON()).toEqual(before); tool.cancel();
  }
  tool.select('a'); tool.deleteSelected(); tool.start('Point'); tool.add([3, 3]);
  expect(tool.state).toMatchObject({ canFinish: true, validationError: null }); tool.finish();
  expect(tool.state.featureCount).toBe(1); tool.undo(); expect(tool.state.featureCount).toBe(0); tool.redo(); expect(tool.state.featureCount).toBe(1);
});

it('checks an entire template group before committing or allocating new feature IDs', () => {
  const group: ShapeTemplate = { id: 'group', label: 'Two points', data: { type: 'FeatureCollection', features: [point('first'), { ...point('second'), geometry: { type: 'Point', coordinates: [1.001, 1.001] } }] } };
  const tool = session(2, [group]); tool.importGeoJSON(point('existing')); tool.clearHistory();
  tool.startTemplate('group', { position: [4, 52] });
  expect(tool.getTemplatePreview()?.features).toHaveLength(2);
  expect(tool.state).toMatchObject({ canFinish: false, validationError: 'feature-limit' });
  expect(tool.finishTemplate()).toBeNull(); expect(tool.state.featureCount).toBe(1); tool.cancel();
  tool.select('existing'); tool.deleteSelected(); tool.startTemplate('group', { position: [4, 52] });
  expect(tool.finishTemplate()?.changes.map(change => change.after?.id)).toEqual(['new-1', 'new-2']);
  expect(tool.state.featureCount).toBe(2); tool.undo(); expect(tool.state.featureCount).toBe(0); tool.redo(); expect(tool.state.featureCount).toBe(2);
});

it('keeps a split preview uncommitted at capacity and rejects separating too many multipart features atomically', () => {
  const tool = session(1); tool.importGeoJSON(polygon()); tool.clearHistory(); tool.select('polygon'); tool.splitSelected(); tool.setSplitLine([[-1, 1], [3, 1]]);
  expect(tool.getSplitPreview()).not.toBeNull(); expect(tool.state).toMatchObject({ canFinish: false, validationError: 'feature-limit' });
  expect(tool.finishSplit()).toBeNull(); expect(tool.state.featureCount).toBe(1); tool.cancel();
  const available = session(2); available.importGeoJSON(polygon()); available.select('polygon'); available.splitSelected(); available.setSplitLine([[-1, 1], [3, 1]]);
  expect(available.state.canFinish).toBe(true); expect(available.finishSplit()?.changes).toHaveLength(2);
  expect(available.state.featureCount).toBe(2); available.undo(); expect(available.state.featureCount).toBe(1); available.redo(); expect(available.state.featureCount).toBe(2);
  const multipart = session(2);
  multipart.importGeoJSON({ type: 'Feature', id: 'multi', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]], [[4, 4], [5, 5]]] } });
  multipart.clearHistory(); multipart.select('multi'); const before = multipart.exportGeoJSON(); const state = multipart.state;
  expect(() => multipart.explodeSelection()).toThrow('at most 2');
  expect(multipart.exportGeoJSON()).toEqual(before); expect(multipart.state).toEqual(state);
  multipart.applyTransaction({ update: [{ type: 'Feature', id: 'multi', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] } }] });
  expect(multipart.explodeSelection()?.changes).toHaveLength(2); expect(multipart.state.featureCount).toBe(2);
  multipart.undo(); expect(multipart.state.featureCount).toBe(1); multipart.redo(); expect(multipart.state.featureCount).toBe(2);
});
