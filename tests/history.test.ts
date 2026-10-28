import { describe, expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { FeatureId, GeometryFeatureCollection, DrawGeometryType, LineFeature } from '../src/core/types.js';

const line = (id: FeatureId): LineFeature => ({ type: 'Feature', id,
  properties: { nested: { label: 'original' } }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
});
const batch = (...ids: FeatureId[]) => ({ type: 'FeatureCollection', features: ids.map(line) });
function session(limit?: number): DrawingSession { let id = 0; return new DrawingSession(() => `drawn-${++id}`, limit); }
function draw(tool: DrawingSession, kind: DrawGeometryType = 'LineString'): void {
  tool.start(kind); tool.add([0, 0]); tool.add([4, 0]);
  if (kind === 'Polygon') { tool.add([4, 4]); tool.add([0, 4]); }
  expect(tool.finish()).not.toBeNull();
}

describe('committed geometry history', () => {
  it.each<DrawGeometryType>(['LineString', 'Polygon'])('undoes and redoes a created %s without changing its ID', (kind) => {
    const tool = session(); draw(tool, kind); const saved = tool.exportGeoJSON();
    tool.select(saved.features[0]!.id);
    expect(tool.state).toMatchObject({ canUndo: true, canRedo: false, dataRevision: 1 });
    expect(tool.undo()).toEqual({ direction: 'undo', action: 'create', changes: [{ before: saved.features[0], after: null }] });
    expect(tool.state).toMatchObject({ canUndo: false, canRedo: true, featureCount: 0, selectedFeatureId: null, dataRevision: 2 });
    expect(tool.redo()).toEqual({ direction: 'redo', action: 'create', changes: [{ before: null, after: saved.features[0] }] });
    expect(tool.exportGeoJSON()).toEqual(saved);
    expect(tool.state).toMatchObject({ canUndo: true, canRedo: false, selectedFeatureId: null, dataRevision: 3 });
    draw(tool); expect(tool.exportGeoJSON().features[1]?.id).toBe('drawn-2');
  });

  it('restores deleted features to their original order with typed IDs and nested properties', () => {
    const tool = session(); tool.importGeoJSON(batch(0, '0', 'last')); tool.clearHistory();
    const saved = tool.exportGeoJSON();
    tool.select('0'); tool.deleteSelected(); tool.select('last');
    expect(tool.undo()?.action).toBe('delete');
    expect(tool.exportGeoJSON()).toEqual(saved); expect(tool.state.selectedFeatureId).toBe('last');
    expect(tool.redo()?.changes).toEqual([{ before: saved.features[1], after: null }]);
    expect(tool.exportGeoJSON().features.map((feature) => feature.id)).toEqual([0, 'last']);
    tool.undo(); tool.select('0'); tool.redo(); expect(tool.state.selectedFeatureId).toBeNull();
    tool.undo(); tool.select(0); tool.deleteSelected(); tool.undo(); expect(tool.exportGeoJSON()).toEqual(saved);
    tool.select('last'); tool.deleteSelected(); tool.undo(); expect(tool.exportGeoJSON()).toEqual(saved);
  });

  it.each<DrawGeometryType>(['LineString', 'Polygon'])('treats all saved %s vertex operations as one action', (kind) => {
    const tool = session(); draw(tool, kind); const original = tool.exportGeoJSON();
    tool.select(original.features[0]!.id); tool.clearHistory(); tool.editSelected();
    tool.moveVertex(0, [-1, 0]); tool.insertVertex(1, [2, -1]); tool.moveVertex(1, [2, -2]); tool.removeVertex(1);
    tool.finish(); const edited = tool.exportGeoJSON(); expect(edited).not.toEqual(original);
    expect(tool.undo()).toMatchObject({ action: 'edit', changes: [{ before: edited.features[0], after: original.features[0] }] });
    expect(tool.exportGeoJSON()).toEqual(original); expect(tool.undo()).toBeNull();
    expect(tool.state.selectedFeatureId).toBe(original.features[0]!.id);
    tool.redo(); expect(tool.exportGeoJSON()).toEqual(edited); expect(tool.redo()).toBeNull();
  });

  it('reverses a whole import once and clears selection only if that feature disappears', () => {
    const tool = session(); tool.importGeoJSON(line('baseline')); tool.clearHistory();
    tool.importGeoJSON(batch(7, '7', 'third')); const saved = tool.exportGeoJSON(); tool.select('baseline');
    expect(tool.undo()?.changes).toHaveLength(3);
    expect(tool.exportGeoJSON()).toEqual(batch('baseline')); expect(tool.state.selectedFeatureId).toBe('baseline');
    tool.redo(); expect(tool.exportGeoJSON()).toEqual(saved); tool.select(7); tool.undo();
    expect(tool.state.selectedFeatureId).toBeNull(); tool.redo(); expect(tool.state.selectedFeatureId).toBeNull();
  });

  it.each(['create', 'edit', 'delete', 'import'] as const)('discards redo only after a committed %s', (action) => {
    const tool = session(); tool.importGeoJSON(batch('a', 'b')); tool.clearHistory(); draw(tool); tool.undo();
    expect(tool.state.canRedo).toBe(true);
    if (action === 'create') draw(tool);
    if (action === 'import') tool.importGeoJSON(line('new'));
    if (action === 'delete') { tool.select('b'); tool.deleteSelected(); }
    if (action === 'edit') { tool.select('a'); tool.editSelected(); tool.moveVertex(0, [-1, 0]); tool.finish(); }
    expect(tool.state.canRedo).toBe(false); expect(tool.redo()).toBeNull();
    expect(tool.undo()?.action).toBe(action);
  });

  it('keeps redo after selection, failed actions, cancellations, empty imports, and unchanged saves', () => {
    const tool = session(); tool.importGeoJSON(line('base')); tool.clearHistory(); draw(tool); tool.undo();
    const revision = tool.state.dataRevision;
    tool.select('base'); tool.select(null); expect(tool.deleteSelected()).toBeNull();
    expect(() => tool.importGeoJSON(batch('base'))).toThrow(); tool.importGeoJSON(batch());
    tool.start('LineString'); tool.add([2, 2]); expect(tool.finish()).toBeNull(); tool.cancel();
    tool.select('base'); tool.editSelected(); tool.moveVertex(0, [-1, 0]); tool.cancel();
    tool.editSelected(); tool.moveVertex(0, [-1, 0]); tool.moveVertex(0, [0, 0]); tool.finish();
    expect(tool.state).toMatchObject({ dataRevision: revision, canUndo: false, canRedo: true });
    tool.redo(); expect(tool.state.featureCount).toBe(2);
  });

  it('protects active drafts and hides history availability until finish/cancel', () => {
    const tool = session(); draw(tool); draw(tool); tool.undo();
    for (const editing of [false, true]) {
      if (editing) { tool.select('drawn-1'); tool.editSelected(); } else tool.start('Polygon');
      const draft = tool.getDraft(); const state = tool.state; const saved = tool.exportGeoJSON();
      expect(state).toMatchObject({ canUndo: false, canRedo: false });
      for (const command of ['undo', 'redo', 'clearHistory'] as const) expect(() => tool[command]()).toThrow('Finish or cancel');
      expect(tool.state).toEqual(state); expect(tool.getDraft()).toEqual(draft); expect(tool.exportGeoJSON()).toEqual(saved);
      tool.cancel(); expect(tool.state).toMatchObject({ canUndo: true, canRedo: true });
    }
  });

  it('bounds history, keeps evicted data committed, and moves entries without consuming more capacity', () => {
    const tool = session(2); draw(tool); draw(tool); draw(tool);
    tool.undo(); tool.undo(); expect(tool.undo()).toBeNull();
    expect(tool.exportGeoJSON().features.map((feature) => feature.id)).toEqual(['drawn-1']);
    for (let i = 0; i < 4; i++) { tool.redo(); tool.redo(); expect(tool.redo()).toBeNull(); tool.undo(); tool.undo(); }
    expect(tool.state.featureCount).toBe(1); expect(tool.state.canRedo).toBe(true);
    const defaults = session(); for (let i = 0; i < 105; i++) draw(defaults);
    for (let i = 0; i < 100; i++) expect(defaults.undo()).not.toBeNull();
    expect(defaults.undo()).toBeNull(); expect(defaults.state.featureCount).toBe(5);
  });

  it('supports disabled history and explicit clearing without changing data, selection, or revision', () => {
    const disabled = session(0); draw(disabled); disabled.importGeoJSON(batch('a', 'b'));
    disabled.select('a'); disabled.deleteSelected(); disabled.select('b'); disabled.editSelected(); disabled.moveVertex(0, [-1, 0]); disabled.finish();
    expect(disabled.state).toMatchObject({ canUndo: false, canRedo: false, featureCount: 2 });
    expect(disabled.undo()).toBeNull(); expect(disabled.redo()).toBeNull();
    const tool = session(); tool.importGeoJSON(batch('a', 'b')); draw(tool); tool.undo(); tool.select('b');
    const data = tool.exportGeoJSON(); const revision = tool.state.dataRevision;
    expect(tool.clearHistory()).toBe(true); expect(tool.clearHistory()).toBe(false);
    expect(tool.exportGeoJSON()).toEqual(data);
    expect(tool.state).toMatchObject({ canUndo: false, canRedo: false, dataRevision: revision, selectedFeatureId: 'b' });
    expect(tool.undo()).toBeNull(); expect(tool.redo()).toBeNull();
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid history limit %s', (limit) => {
    expect(() => session(limit)).toThrow(RangeError);
  });

  it('isolates stored history from every public snapshot, including returned history changes', () => {
    const tool = session(); const input = line('a'); tool.importGeoJSON(input); tool.select('a');
    input.geometry.coordinates.length = 0;
    (input.properties!.nested as { label: string }).label = 'mutated';
    const saved = tool.exportGeoJSON();
    const deleted = tool.deleteSelected()!; deleted.geometry.coordinates.length = 0;
    const undone = tool.undo()!;
    undone.changes[0]!.after!.geometry.coordinates.length = 0;
    (undone.changes[0]!.after!.properties!.nested as { label: string }).label = 'history mutation';
    expect(tool.exportGeoJSON()).toEqual(saved);
    tool.redo(); tool.undo(); expect(tool.exportGeoJSON()).toEqual(saved);
    tool.undo(); tool.redo(); expect(tool.exportGeoJSON()).toEqual(saved);
  });

  it('round-trips a mixed operation sequence in exact collection order', () => {
    const tool = session(); const snapshots: GeometryFeatureCollection[] = [tool.exportGeoJSON()];
    for (let i = 0; i < 32; i++) {
      const current = tool.exportGeoJSON().features;
      if (i % 4 === 0) tool.importGeoJSON(batch(`import-${i}`, i));
      else if (i % 4 === 1) draw(tool, i % 8 === 1 ? 'Polygon' : 'LineString');
      else if (i % 4 === 2) {
        tool.select(current[1]!.id); tool.editSelected(); tool.moveVertex(0, [-1 - i, 0]); tool.finish();
      } else { tool.select(current[0]!.id); tool.deleteSelected(); }
      snapshots.push(tool.exportGeoJSON());
    }
    for (let i = snapshots.length - 2; i >= 0; i--) { expect(tool.undo()).not.toBeNull(); expect(tool.exportGeoJSON()).toEqual(snapshots[i]); }
    expect(tool.undo()).toBeNull();
    for (const snapshot of snapshots.slice(1)) { expect(tool.redo()).not.toBeNull(); expect(tool.exportGeoJSON()).toEqual(snapshot); }
    expect(tool.redo()).toBeNull();
  });
});
