import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { DataLayerControl, EditorToolbar, GeometryEditor, type Coordinate, type GeometryFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor; let control: DataLayerControl;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] });
const at = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const polygon = (id: string | number, layer: string, left: number, top: number, right: number, bottom: number): GeometryFeature => ({ type: 'Feature', id, properties: { mapMasterLayer: layer }, geometry: { type: 'Polygon', coordinates: [[[left, top], [right, top], [right, bottom], [left, bottom], [left, top]].map(([x, y]) => at(x!, y!))] } });
const source = () => Object.keys(map.getStyle().sources).find(id => id.endsWith('-features'))!;
const data = async () => {
  const result = await map.getSource<GeoJSONSource>(source())!.getData();
  if (result.type !== 'FeatureCollection') throw new Error('Expected committed collection.'); return result.features;
};
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const field = (key: string) => container.querySelector<HTMLInputElement>(`[data-control-key="${key}"]`)!;
const select = (key: string) => container.querySelector<HTMLSelectElement>(`[data-control-key="${key}"]`)!;
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:800px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 15, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true }, dataLayers: { layers: [
    { id: 'reference', name: 'Reference', editable: false, selectable: false },
    { id: 'parcels', name: 'Parcels', style: { shape: { fillColor: '#008800' }, marker: { color: '#008800' } } },
    { id: 'notes', name: 'Notes', style: { shape: { fillColor: '#ff5500' } } }, { id: 'archive', name: 'Archive', visible: false },
  ] } });
  editor.importGeoJSON({ type: 'FeatureCollection', features: [polygon(0, 'parcels', 180, 160, 520, 390), polygon('0', 'notes', 300, 200, 640, 420),
    { type: 'Feature', id: 'parcel-point', properties: { mapMasterLayer: 'parcels' }, geometry: { type: 'Point', coordinates: at(400, 270) } },
    { type: 'Feature', id: 'parcel-label', properties: { mapMasterLayer: 'parcels', mapMasterText: { text: 'Parcel' } }, geometry: { type: 'Point', coordinates: at(210, 120) } },
    { type: 'Feature', id: 'reference', properties: { mapMasterLayer: 'reference' }, geometry: { type: 'LineString', coordinates: [at(550, 100), at(700, 100)] } },
    { type: 'Feature', id: 'hidden', properties: { mapMasterLayer: 'archive' }, geometry: { type: 'Point', coordinates: at(700, 400) } },
  ] }); editor.clearHistory();
  map.addControl(new EditorToolbar(editor, { tools: ['point', 'line', 'polygon', 'edit', 'duplicate', 'undo', 'redo'] }));
  control = new DataLayerControl(editor); map.addControl(control);
});
afterEach(async () => { await commands.vertexPointer('up', 750, 450); vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('orders complete native geometry groups by data layer and picks the front layer before lower-layer markers', async () => {
  await expect.poll(() => editor.queryFeatures({ x: 400, y: 270 })[0]?.id).toBe('0');
  await click(400, 270); expect(editor.getState().selectedFeatureId).toBe('0');
  const layers = map.getStyle().layers; const noteFill = layers.findIndex(layer => layer.id.endsWith('data-notes-fill')); const parcelMarker = layers.findIndex(layer => layer.id.endsWith('data-parcels-markers'));
  expect(noteFill).toBeGreaterThan(parcelMarker);
  editor.reorderDataLayers(['default', 'reference', 'notes', 'parcels', 'archive']);
  await expect.poll(() => editor.queryFeatures({ x: 400, y: 270 })[0]?.id).toBe('parcel-point');
  expect(editor.getState().canUndo).toBe(false); expect(editor.exportGeoJSON().features).toHaveLength(6);
});

it('uses layer styles as bases for per-feature overrides without modifying GeoJSON or invoking callbacks on selection', async () => {
  const before = editor.exportGeoJSON();
  await expect.poll(async () => String((await data()).find(feature => feature.id === 0)?.properties?.__geo_editor_style_shape_fillColor)).toBe('#008800');
  const resolver = vi.fn((feature: GeometryFeature) => feature.id === 0 ? { shape: { fillColor: '#123456' } } : undefined);
  editor.setStyling({ feature: resolver, selected: {} }); const calls = resolver.mock.calls.length; editor.select(0); editor.select(null); expect(resolver).toHaveBeenCalledTimes(calls);
  editor.updateDataLayer('parcels', { style: { shape: { fillColor: '#0000ff' }, marker: { color: '#00f' } } });
  await expect.poll(async () => String((await data()).find(feature => feature.id === 0)?.properties?.__geo_editor_style_shape_fillColor)).toBe('#123456');
  await expect.poll(async () => String((await data()).find(feature => feature.id === 'parcel-point')?.properties?.__geo_editor_style_marker_color)).toBe('#00f');
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
});

it('ignores a stale front-layer click without toggling a selected feature underneath it', async () => {
  await expect.poll(() => editor.queryFeatures({ x: 400, y: 270 })[0]?.id).toBe('0');
  const layers = map.getStyle().layers.filter(layer => 'source' in layer && layer.source === source()).map(layer => layer.id);
  const stale = map.queryRenderedFeatures([400, 270], { layers });
  editor.select('0'); editor.deleteSelection(); editor.select('parcel-point');
  const query = vi.spyOn(map, 'queryRenderedFeatures').mockReturnValue(stale);
  await userEvent.keyboard('{Shift>}'); await click(400, 270); await userEvent.keyboard('{/Shift}');
  expect(editor.getState().selectedFeatureIds).toEqual(['parcel-point']); query.mockRestore();
});

it('hides geometry, labels and picking immediately, cancels captured editing and preserves the stored data', async () => {
  const before = editor.exportGeoJSON(); editor.select(0); editor.editSelected();
  await commands.vertexPointer('down', 180, 160); await commands.vertexPointer('move', 210, 170);
  editor.updateDataLayer('parcels', { visible: false }); await commands.vertexPointer('up', 210, 170);
  expect(editor.getState().mode).toBe('idle'); expect(editor.getState().selectedFeatureIds).toEqual([]); expect(map.dragPan.isEnabled()).toBe(true);
  expect(editor.exportGeoJSON()).toEqual(before); expect(container.querySelector('.mm-text-marker')).toBeNull();
  await expect.poll(async () => (await data()).some(feature => feature.id === 0)).toBe(false);
  expect(editor.queryFeatures({ x: 200, y: 200 })).toEqual([]); expect(editor.getState().canUndo).toBe(false);
});

it('snaps to visible reference layers independently of editability, refreshes stationary pointers and excludes hidden/disabled references', async () => {
  editor.draw('LineString'); await click(100, 100); await commands.vertexPointer('move', 554, 104);
  await expect.poll(() => editor.getSnap()?.featureId).toBe('reference');
  editor.updateDataLayer('reference', { snapping: false }); await expect.poll(() => editor.getSnap()).toBeNull();
  editor.updateDataLayer('reference', { visible: false, snapping: true }); await expect.poll(() => editor.getSnap()).toBeNull();
  editor.updateDataLayer('reference', { visible: true }); await expect.poll(() => editor.getSnap()?.featureId).toBe('reference');
  expect(editor.getDraft()).toHaveLength(1); editor.cancel(); expect(editor.getState().canUndo).toBe(false);
});

it('applies active-layer selection to picking, lasso and programmatic selection, while exporting all layers', async () => {
  editor.selectMany([0, '0']); editor.setActiveDataLayer('parcels'); editor.setDataLayerSelectionScope('active'); expect(editor.getState().selectedFeatureIds).toEqual([0]);
  expect(() => editor.select('0')).toThrow();
  await expect.poll(() => editor.queryFeatures({ x: 400, y: 270 })[0]?.id).toBe('parcel-point');
  const ids = editor.selectByLasso([{ x: 100, y: 60 }, { x: 750, y: 60 }, { x: 750, y: 450 }, { x: 100, y: 450 }]);
  expect(new Set(ids)).toEqual(new Set([0, 'parcel-point', 'parcel-label'])); expect(editor.exportGeoJSON().features).toHaveLength(6);
  expect(editor.exportGeoJSON({ dataLayerId: 'archive' }).features.map(feature => feature.id)).toEqual(['hidden']);
});

it('draws in the active layer, retains home membership when copied, and restores membership moves with one Undo', async () => {
  editor.setActiveDataLayer('notes'); editor.draw('Point'); await click(200, 450); const created = editor.exportGeoJSON().features.at(-1)!;
  expect(created.properties?.mapMasterLayer).toBe('notes'); editor.setActiveDataLayer('parcels'); editor.select(created.id); editor.duplicateSelection([0.0001, 0]);
  expect(editor.exportGeoJSON().features.at(-1)?.properties?.mapMasterLayer).toBe('notes');
  const before = editor.exportGeoJSON(); const transaction = vi.fn(); editor.onTransaction(transaction); editor.moveFeaturesToDataLayer([created.id], 'parcels');
  expect(transaction).toHaveBeenCalledOnce(); expect(editor.getFeatureDataLayer(created.id)).toBe('parcels'); editor.undo(); expect(editor.exportGeoJSON()).toEqual(before);
});

it('exposes accessible active/visibility/lock/snap/order/move controls and preserves keyboard focus during updates', async () => {
  control.setCollapsed(false); expect(control.isCollapsed()).toBe(false);
  await userEvent.selectOptions(select('active'), 'parcels'); expect(editor.getActiveDataLayer()).toBe('parcels');
  const visible = field('notes:visible'); visible.focus(); await userEvent.keyboard(' '); expect(editor.getDataLayers().find(layer => layer.id === 'notes')?.visible).toBe(false); expect(document.activeElement).toBe(field('notes:visible'));
  await userEvent.keyboard(' '); expect(editor.getDataLayers().find(layer => layer.id === 'notes')?.visible).toBe(true);
  await userEvent.click(field('parcels:locked')); expect(editor.getActiveDataLayer()).toBe('default'); expect(editor.isFeatureLocked(0)).toBe(true);
  await userEvent.click(field('parcels:locked')); await userEvent.click(field('reference:snapping')); expect(editor.getDataLayers().find(layer => layer.id === 'reference')?.snapping).toBe(false);
  editor.select(0); editor.setLockedFeatureIds([0]); expect(field('move').disabled).toBe(true); editor.setLockedFeatureIds([]); expect(field('move').disabled).toBe(false); await userEvent.selectOptions(select('destination'), 'notes'); await userEvent.click(field('move')); expect(editor.getFeatureDataLayer(0)).toBe('notes'); editor.undo(); expect(editor.getFeatureDataLayer(0)).toBe('parcels');
  await userEvent.click(field('parcels:forward')); expect(editor.getDataLayers().findIndex(layer => layer.id === 'parcels')).toBeGreaterThan(editor.getDataLayers().findIndex(layer => layer.id === 'notes'));
});

it('rebuilds layer order/visibility/styles on style reload and removes all resources on destroy', async () => {
  editor.updateDataLayer('notes', { visible: false }); const before = editor.exportGeoJSON();
  const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(async () => (await data()).length).toBe(4);
  const noteFill = map.getStyle().layers.find(layer => layer.id.endsWith('data-notes-fill'))!; expect(map.getLayoutProperty(noteFill.id, 'visibility')).toBe('none');
  expect(editor.exportGeoJSON()).toEqual(before); editor.destroy(); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  map.removeControl(control); expect(container.querySelector('.mm-data-layers')).toBeNull();
});

it('keeps overlap stripes within a data layer and never mixes foreground/background colors', async () => {
  editor.setStyling({ overlap: { enabled: true } });
  const areaSource = Object.keys(map.getStyle().sources).find(id => id.endsWith('-styled-areas'))!;
  await expect.poll(async () => {
    const areas = await map.getSource<GeoJSONSource>(areaSource)!.getData(); return areas.type === 'FeatureCollection' && areas.features.length;
  }).toBe(2);
  const areas = await map.getSource<GeoJSONSource>(areaSource)!.getData();
  if (areas.type !== 'FeatureCollection') throw new Error('Expected styled regions');
  expect(areas.features.every(feature => feature.properties?.kind === 'single')).toBe(true);
  expect(new Set(areas.features.map(feature => feature.properties?.__geo_editor_data_layer as unknown))).toEqual(new Set(['parcels', 'notes']));
});
