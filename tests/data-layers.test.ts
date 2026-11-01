import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { DataLayerError, featureDataLayerId, type DataLayerDefinition } from '../src/core/data-layers.js';
import type { Coordinate, GeometryFeature, GeometryFeatureCollection } from '../src/core/types.js';

const point = (id: string | number, layerId?: string, coordinate: Coordinate = [2, 2]): GeometryFeature => ({ type: 'Feature', id, properties: layerId === undefined ? null : { name: String(id), mapMasterLayer: layerId }, geometry: { type: 'Point', coordinates: coordinate } });
const collection = (...features: GeometryFeature[]): GeometryFeatureCollection => ({ type: 'FeatureCollection', features });
const definitions: DataLayerDefinition[] = [{ id: 'parcels', name: 'Parcels', style: { shape: { fillColor: '#008800' } } }, { id: 'notes', name: 'Notes' }, { id: 'reference', editable: false, selectable: false }, { id: 'archive', visible: false }];
function setup() {
  let next = 0; const session = new DrawingSession(() => `created-${++next}`);
  session.setDataLayers(definitions); session.importGeoJSON(collection(point(0), point('0', 'parcels'), point('note', 'notes'), point('reference', 'reference'), point('hidden', 'archive'))); session.clearHistory(); return session;
}

it('preserves legacy GeoJSON and default drawing behavior without layer configuration', () => {
  const session = new DrawingSession(() => 'new'); const feature = point(0); session.importGeoJSON(feature);
  expect(session.exportGeoJSON()).toEqual(collection(feature)); expect(session.getFeatureDataLayer(0)).toBe('default');
  expect(session.state).toMatchObject({ activeDataLayerId: 'default', dataLayerRevision: 0, dataLayerSelectionScope: 'all' });
  session.start('Point'); session.add([3, 3]); expect(session.finish()?.properties).toEqual({});
});

it('isolates definitions and applies policy changes without feature history or a data revision', () => {
  const session = setup(); const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  const layers = session.getDataLayers(); layers[1]!.style.shape!.fillColor = '#ff0000'; expect(session.getDataLayers()[1]?.style.shape?.fillColor).toBe('#008800');
  session.updateDataLayer('parcels', { name: '<Parcel>', locked: true }); session.reorderDataLayers(['default', 'notes', 'parcels', 'reference', 'archive']);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.dataRevision).toBe(revision); expect(session.state.canUndo).toBe(false);
  expect(session.getDataLayers().map(layer => layer.id)).toEqual(['default', 'notes', 'parcels', 'reference', 'archive']);
});

it('draws and places templates in the active layer, while duplicates keep their home layer', () => {
  const session = setup(); session.setActiveDataLayer('notes'); session.start('LineString'); session.add([1, 1]); session.add([3, 1]);
  const line = session.finish()!; expect(featureDataLayerId(line)).toBe('notes');
  session.startTemplate('arrow', { position: [3, 3], size: 100 }); const placed = session.finishTemplate()!;
  expect(placed.changes.every(change => change.after && featureDataLayerId(change.after) === 'notes')).toBe(true);
  session.select('0'); session.duplicateSelection([0.1, 0.1]); expect(featureDataLayerId(session.exportGeoJSON().features.at(-1)!)).toBe('parcels');
});

it('imports membership exactly, defaults unassigned imports to the active layer and supports an explicit target override', () => {
  const session = setup(); session.setActiveDataLayer('notes');
  session.importGeoJSON(point('unassigned')); expect(session.getFeatureDataLayer('unassigned')).toBe('notes');
  session.importGeoJSON(point('retained', 'parcels')); expect(session.getFeatureDataLayer('retained')).toBe('parcels');
  session.importGeoJSON(point('overridden', 'parcels'), { dataLayerId: 'notes' }); expect(session.getFeatureDataLayer('overridden')).toBe('notes');
  expect(session.exportGeoJSON({ dataLayerId: 'archive' }).features.map(feature => feature.id)).toEqual(['hidden']);
  expect(session.exportGeoJSON({ visibleOnly: true }).features.some(feature => feature.id === 'hidden')).toBe(false);
  const restored = new DrawingSession(() => 'unused'); restored.setDataLayers(session.getDataLayers()); restored.importGeoJSON(session.exportGeoJSON()); expect(restored.exportGeoJSON()).toEqual(session.exportGeoJSON());
});

it('rejects unknown or malformed memberships before mutating any part of a batch', () => {
  const session = setup(); session.select('0'); const before = session.exportGeoJSON(); const state = session.state;
  expect(() => session.importGeoJSON(collection(point('good', 'notes'), point('bad', 'missing')))).toThrow(DataLayerError);
  const malformed = point('malformed'); malformed.properties = { mapMasterLayer: 7 };
  expect(() => session.importGeoJSON(malformed)).toThrow('mapMasterLayer');
  expect(() => session.applyTransaction({ update: [point('0', 'notes')], delete: ['note'], create: [point('bad', 'missing')] })).toThrow(DataLayerError);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state).toEqual(state);
});

it('moves membership in one transaction and restores exact IDs, properties and selection scope on Undo/Redo', () => {
  const session = setup(); session.selectMany([0, '0']); const before = session.exportGeoJSON();
  expect(session.moveFeaturesToDataLayer([0, '0'], 'notes')?.changes).toHaveLength(2); const after = session.exportGeoJSON();
  expect(session.getFeatureDataLayer(0)).toBe('notes'); expect(session.getFeatureDataLayer('0')).toBe('notes');
  expect(session.undo()?.action).toBe('transaction'); expect(session.exportGeoJSON()).toEqual(before); session.redo(); expect(session.exportGeoJSON()).toEqual(after);
  session.setDataLayerSelectionScope('active'); expect(session.state.selectedFeatureIds).toEqual([]);
  session.setActiveDataLayer('notes'); session.selectMany([0, '0']); session.moveFeaturesToDataLayer([0], 'parcels'); expect(session.state.selectedFeatureIds).toEqual(['0']);
});

it.each([{ visible: false }, { locked: true }, { editable: false }])('blocks mutations and history for a layer with policy %j', policy => {
  const session = setup(); session.select('0'); session.applyTransaction({ update: [point('0', 'parcels', [3, 3])] });
  const before = session.exportGeoJSON(); const revision = session.state.dataRevision; session.updateDataLayer('parcels', policy);
  expect(session.isFeatureLocked('0')).toBe(true); expect(session.state.canUndo).toBe(false); expect(session.undo()).toBeNull();
  expect(session.getHistoryDataLayerIssues('undo')[0]?.layerId).toBe('parcels');
  expect(() => session.applyTransaction({ update: [point('0', 'notes')] })).toThrow(DataLayerError);
  expect(() => session.applyTransaction({ delete: ['0'] })).toThrow(DataLayerError);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.dataRevision).toBe(revision);
  session.updateDataLayer('parcels', { visible: true, locked: false, editable: true }); expect(session.undo()).not.toBeNull();
});

it('allows initial host imports into reference/hidden layers and keeps them out of editing and reference searches as configured', () => {
  const session = setup(); expect(session.getVisibleGeoJSON().features.map(feature => feature.id)).toEqual([0, '0', 'note', 'reference']);
  expect(session.getSnappingGeoJSON().features.map(feature => feature.id)).toContain('reference'); expect(session.isFeatureSnappable('hidden')).toBe(false);
  expect(() => session.select('reference')).toThrow(DataLayerError); expect(() => session.select('hidden')).toThrow(DataLayerError);
  session.updateDataLayer('reference', { selectable: true }); session.select('reference'); expect(session.editSelected()).toBe(false); expect(session.deleteSelection()).toBeNull();
  expect(session.canDuplicateSelection()).toBe(false); expect(() => session.duplicateSelection()).toThrow(DataLayerError);
  session.updateDataLayer('reference', { snapping: false }); expect(session.isFeatureSnappable('reference')).toBe(false);
});

it('restricts all selection paths to active/visible/selectable layers and prunes previous selections atomically', () => {
  const session = setup(); session.selectMany([0, '0', 'note']); session.setActiveDataLayer('parcels'); session.setDataLayerSelectionScope('active');
  expect(session.state.selectedFeatureIds).toEqual(['0']); expect(() => session.selectMany(['0', 'note'])).toThrow(); expect(session.state.selectedFeatureIds).toEqual(['0']);
  session.startLasso(); session.finishLasso([0, '0', 'note', 'hidden']); expect(session.state.selectedFeatureIds).toEqual(['0']);
  expect(() => session.toggleSelection('note')).toThrow(); session.updateDataLayer('parcels', { selectable: false }); expect(session.state.selectedFeatureIds).toEqual([]);
  session.setDataLayerSelectionScope('all'); session.select('note'); session.updateDataLayer('notes', { visible: false }); expect(session.state.selectedFeatureIds).toEqual([]);
});

it('cancels drafts when a mutation target becomes inaccessible but preserves unrelated edits and prevents active-target changes mid-draft', () => {
  const session = setup(); session.select('0'); session.editSelected(); session.moveVertex(0, [4, 3]); const draft = session.getDraft();
  session.updateDataLayer('notes', { visible: false }); expect(session.getDraft()).toEqual(draft); expect(session.state.mode).toBe('edit-point');
  expect(() => session.setActiveDataLayer('parcels')).toThrow('Finish or cancel'); session.updateDataLayer('parcels', { locked: true }); expect(session.state.mode).toBe('idle');
  expect(() => session.setActiveDataLayer('notes')).toThrow(DataLayerError);
});

it('cancels new drawings if the active target is disabled, falls back to another writable layer, and supports a read-only document', () => {
  const session = setup(); session.setActiveDataLayer('parcels'); session.start('Polygon'); session.add([1, 1]);
  session.updateDataLayer('parcels', { editable: false }); expect(session.state.mode).toBe('idle'); expect(session.getActiveDataLayer()).toBe('default');
  session.setDataLayers(session.getDataLayers().map(layer => ({ ...layer, editable: false }))); expect(session.getActiveDataLayer()).toBeNull(); expect(session.canDrawInDataLayer()).toBe(false);
  expect(() => session.start('Point')).toThrow(DataLayerError); expect(() => session.startTemplate()).toThrow(DataLayerError);
});

it('keeps layer permissions on linked followers, cancels when a hidden participant changes policy, and blocks partial linked commits', () => {
  const session = setup(); session.pinVertices([{ featureId: '0', index: 0 }, { featureId: 'note', index: 0 }]); session.select('0'); session.editSelected(); session.moveVertex(0, [3, 3]);
  session.updateDataLayer('notes', { locked: true }); expect(session.state.mode).toBe('idle');
  session.editSelected(); session.moveVertex(0, [3, 3]); expect(session.state.canFinish).toBe(false); expect(session.finish()).toBeNull(); session.cancel();
  expect(() => session.translateSelection([1, 1])).toThrow(); session.updateDataLayer('notes', { locked: false }); session.editSelected(); session.moveVertex(0, [3, 3]); expect(session.finish()).not.toBeNull();
});

it('retains home membership in split, combine and explode operations even when another drawing target is active', () => {
  const session = setup(); const geometry = { type: 'Polygon' as const, coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]] as Coordinate[]] };
  session.importGeoJSON({ type: 'Feature', id: 'parcel', properties: { mapMasterLayer: 'parcels' }, geometry }); session.setActiveDataLayer('notes'); session.select('parcel'); session.splitSelected(); session.setSplitLine([[-1, 2], [5, 2]]);
  const event = session.finishSplit()!; expect(event.changes).toHaveLength(2); expect(event.changes.every(change => change.after && featureDataLayerId(change.after) === 'parcels')).toBe(true);
  session.undo(); session.importGeoJSON({ type: 'Feature', id: 'parts', properties: { mapMasterLayer: 'parcels' }, geometry: { type: 'MultiLineString', coordinates: [[[1, 1], [2, 2]], [[4, 4], [5, 5]]] } });
  session.select('parts'); const exploded = session.explodeSelection()!; expect(exploded.changes.every(change => change.after && featureDataLayerId(change.after) === 'parcels')).toBe(true);
  session.combineSelection(); expect(session.getSelected()?.properties?.mapMasterLayer).toBe('parcels');
});

it('validates configuration atomically, refuses populated/default removal and can explain history after an empty layer is removed', () => {
  const session = setup(); const before = session.getDataLayers(); const state = session.state;
  for (const change of [() => session.setDataLayers([{ id: 'x' }, { id: 'x' }]), () => session.updateDataLayer('notes', { style: { marker: { color: 'red' } } }), () => session.reorderDataLayers(['default']), () => session.removeDataLayer('parcels'), () => session.removeDataLayer('default')]) expect(change).toThrow();
  expect(session.getDataLayers()).toEqual(before); expect(session.state).toEqual(state);
  session.addDataLayer({ id: 'temporary' }); session.importGeoJSON(point('temp', 'temporary')); session.select('temp'); session.deleteSelection(); session.removeDataLayer('temporary');
  expect(session.state.canUndo).toBe(false); expect(session.getHistoryDataLayerIssues('undo')[0]?.code).toBe('unknown-layer'); session.addDataLayer({ id: 'temporary' }); expect(session.undo()).not.toBeNull();
});
