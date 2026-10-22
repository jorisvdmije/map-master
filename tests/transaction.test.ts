import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { FeatureId, FeatureTransaction, GeometryFeatureCollection, LineFeature } from '../src/index.js';

const line = (id: FeatureId, x = 0): LineFeature => ({ type: 'Feature', id,
  properties: { nested: { label: 'original', list: [1, true, null] } }, geometry: { type: 'LineString', coordinates: [[x, 0], [x + 1, 1]] },
});
function session(ids: FeatureId[] = ['a', 'b', 'c', 'd', 'e'], limit?: number): DrawingSession {
  const tool = new DrawingSession(() => 'drawn', limit);
  tool.importGeoJSON({ type: 'FeatureCollection', features: ids.map((id) => line(id)) }); tool.clearHistory(); return tool;
}

it('commits mixed changes once and restores exact ordering across repeated undo/redo', () => {
  const tool = session(); const before = tool.exportGeoJSON(); tool.select('c');
  const result = tool.applyTransaction({ delete: ['e', 'b', 'a'], update: [line('c', 3)], create: [line(7), line('7')] })!;
  const after = tool.exportGeoJSON();
  expect(after.features.map((feature) => feature.id)).toEqual(['c', 'd', 7, '7']);
  expect(result.changes.map(({ before, after }) => [before?.id, after?.id])).toEqual([
    ['c', 'c'], ['e', undefined], ['b', undefined], ['a', undefined], [undefined, 7], [undefined, '7'],
  ]);
  expect(tool.state).toMatchObject({ selectedFeatureId: 'c', dataRevision: 2, canUndo: true, canRedo: false });
  for (let i = 0; i < 3; i++) {
    const undo = tool.undo()!; expect(undo.action).toBe('transaction');
    expect(undo.changes).toEqual(result.changes.map(({ before, after }) => ({ before: after, after: before })));
    expect(tool.exportGeoJSON()).toEqual(before); expect(tool.undo()).toBeNull();
    expect(tool.redo()?.changes).toEqual(result.changes); expect(tool.exportGeoJSON()).toEqual(after); expect(tool.redo()).toBeNull();
  }
});

it('treats a full replacement, complete deletion and subsequent creation as separate atomic actions', () => {
  const tool = session([0, '0']); const initial = tool.exportGeoJSON(); tool.select(0);
  tool.applyTransaction({ delete: ['0', 0], create: [line('new')] });
  expect(tool.state.selectedFeatureId).toBeNull(); expect(tool.exportGeoJSON().features.map((feature) => feature.id)).toEqual(['new']);
  tool.undo(); expect(tool.exportGeoJSON()).toEqual(initial); expect(tool.state.selectedFeatureId).toBeNull(); tool.redo();
  tool.applyTransaction({ update: [{ type: 'Feature', id: 'new', properties: null, geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 2], [2, 0], [0, 0]]] } }] });
  expect(tool.exportGeoJSON().features[0]).toMatchObject({ id: 'new', properties: null, geometry: { type: 'Polygon' } });
  tool.undo(); expect(tool.exportGeoJSON().features[0]).toEqual(line('new'));
  tool.applyTransaction({ delete: ['new'] }); expect(tool.state.featureCount).toBe(0);
  tool.undo(); expect(tool.exportGeoJSON().features[0]).toEqual(line('new'));
});

it('preserves data, selection, revision and redo on a late validation failure', () => {
  const tool = session(); tool.applyTransaction({ create: [line('undo-me')] }); tool.undo(); tool.select('b');
  const before = tool.exportGeoJSON(); const state = tool.state;
  const invalid = line('invalid'); invalid.geometry.coordinates = [[0, 0], [0, 0]];
  expect(() => tool.applyTransaction({ update: [line('a', 3)], delete: ['b'], create: [line('new'), invalid] })).toThrow('$.create[1].geometry.coordinates');
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state).toEqual(state);
  expect(tool.redo()?.action).toBe('transaction'); expect(tool.state.featureCount).toBe(6);
});

it.each([
  null, [], { replace: [] }, { create: null }, { update: undefined }, { delete: [NaN] },
  { create: [line('a')] }, { update: [line('missing')] }, { delete: ['missing'] },
  { create: [line('new'), line('new')] }, { update: [line('a'), line('a')] }, { delete: ['b', 'b'] },
  { update: [line('a')], delete: ['a'] }, { delete: ['a'], create: [line('a')] },
  { create: [{ ...line('new'), id: undefined }] }, { create: [{ ...line('new'), id: Infinity }] },
  { update: [{ type: 'FeatureCollection', id: 'a', features: [line('hidden')] }] },
])('rejects invalid/conflicting transaction %# without changing the store', (input) => {
  const tool = session(); const before = tool.exportGeoJSON(); const state = tool.state;
  expect(() => tool.applyTransaction(input as unknown as FeatureTransaction)).toThrow();
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state).toEqual(state);
});

it('ignores normalized unchanged updates and empty transactions without discarding redo', () => {
  const tool = session(); tool.applyTransaction({ create: [line('new')] }); tool.undo();
  const state = tool.state;
  const unchanged = line('a'); unchanged.properties = { nested: { list: [1, true, null], label: 'original' } };
  for (const input of [{}, { create: [], update: [], delete: [] }, { update: [unchanged] }]) {
    expect(tool.applyTransaction(input)).toBeNull(); expect(tool.state).toEqual(state);
  }
  const changed = line('a'); changed.properties = { nested: { list: [true, 1, null], label: 'original' } };
  expect(tool.applyTransaction({ update: [unchanged, line('b', 2)] })?.changes).toHaveLength(1);
  expect(tool.state.canRedo).toBe(false);
  expect(tool.applyTransaction({ update: [changed] })?.changes).toHaveLength(1);
});

it('isolates caller inputs, return values and history snapshots including nested properties', () => {
  const tool = session(); const create = line('new'); const update = line('a', 2);
  const result = tool.applyTransaction({ create: [create], update: [update] })!; const saved = tool.exportGeoJSON();
  create.geometry.coordinates.length = 0; update.properties!.nested = null;
  result.changes[0]!.before!.properties = null; result.changes[0]!.after!.geometry.coordinates.length = 0;
  result.changes.length = 0;
  expect(tool.exportGeoJSON()).toEqual(saved);
  tool.undo(); const replay = tool.redo()!; replay.changes[0]!.after!.properties = null;
  tool.undo(); tool.redo(); expect(tool.exportGeoJSON()).toEqual(saved);
});

it('protects active drafts and respects disabled/bounded history', () => {
  const tool = session();
  for (const editing of [false, true]) {
    if (editing) { tool.select('a'); tool.editSelected(); } else { tool.start('LineString'); tool.add([2, 2]); }
    const state = tool.state; const draft = tool.getDraft();
    expect(() => tool.applyTransaction({ delete: ['a'] })).toThrow('Finish or cancel');
    expect(tool.state).toEqual(state); expect(tool.getDraft()).toEqual(draft); tool.cancel();
  }
  const disabled = session(['a'], 0); disabled.applyTransaction({ create: [line('b')], delete: ['a'] });
  expect(disabled.undo()).toBeNull(); expect(disabled.state.featureCount).toBe(1);
  const bounded = session(['a'], 1); bounded.applyTransaction({ create: [line('b'), line('c')] }); bounded.applyTransaction({ delete: ['a', 'c'] });
  bounded.undo(); expect(bounded.state.featureCount).toBe(3); expect(bounded.undo()).toBeNull();
});

it('round-trips many mixed transactions with nonordered deletions and preserves every intermediate snapshot', () => {
  const tool = session(); const snapshots: GeometryFeatureCollection[] = [tool.exportGeoJSON()];
  for (let i = 0; i < 30; i++) {
    const current = tool.exportGeoJSON().features;
    tool.applyTransaction({ update: [line(current[1]!.id, i + 2)],
      delete: [current.at(-1)!.id, current[0]!.id], create: [line(`new-${i}`), line(i)],
    }); snapshots.push(tool.exportGeoJSON());
  }
  for (let i = snapshots.length - 2; i >= 0; i--) { tool.undo(); expect(tool.exportGeoJSON()).toEqual(snapshots[i]); }
  for (const snapshot of snapshots.slice(1)) { tool.redo(); expect(tool.exportGeoJSON()).toEqual(snapshot); }
});
