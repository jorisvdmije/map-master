import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import mapboxgl from 'mapbox-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import * as maplibre from '../../src/index.js';
import * as mapbox from '../../src/mapbox/index.js';
import type { Coordinate, GeometryFeatureCollection } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'mapbox-gl/dist/mapbox-gl.css';

setWorkerUrl(workerUrl);
const style = () => ({ version: 8 as const, sources: {}, layers: [
  { id: 'host-background', type: 'background' as const, paint: { 'background-color': '#edf1e9' } },
] });

// Run precisely the same expectations against actual WebGL maps and workers.
describe.each(['MapLibre 6.15.0', 'Mapbox 3.34.1'] as const)('%s adapter', renderer => {
  let container: HTMLDivElement;
  let map: MapLibreMap | mapboxgl.Map;
  let editor: maplibre.GeometryEditor;
  let toolbar: maplibre.EditorToolbar;
  let layers: maplibre.DataLayerControl;
  let errors: string[];
  const api = renderer.startsWith('Mapbox') ? mapbox : maplibre;
  const replaceStyle = () => {
    if (map instanceof MapLibreMap) map.setStyle(style(), { diff: false });
    else map.setStyle(style(), { diff: false, localFontFamily: null, localIdeographFontFamily: 'sans-serif' });
  };
  const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
  const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
  const committedIds = () => Object.keys(map.getStyle().sources).filter(id => id.endsWith('-features'));
  const visible = (id: string | number) => editor.queryFeatures({ x: 250, y: 220 }).some(feature => feature.id === id);
  const collection = (): GeometryFeatureCollection => ({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 7, properties: { name: 'Parcel', nested: { keep: true } }, geometry: { type: 'Polygon', coordinates: [
      [[160, 130], [370, 130], [370, 310], [160, 310], [160, 130]].map(([x, y]) => coordinate(x!, y!)),
    ] } },
    { type: 'Feature', id: '7', properties: { name: 'Path' }, geometry: { type: 'LineString', coordinates: [coordinate(440, 150), coordinate(580, 280)] } },
  ] });

  beforeEach(async () => {
    container = document.createElement('div'); container.style.cssText = 'width:760px;height:480px;position:relative;'; document.body.append(container);
    const options = { container, style: style(), center: [4.895, 52.372] as Coordinate, zoom: 13, fadeDuration: 0 };
    // testMode only suppresses token diagnostics for this isolated, offline style.
    // No Mapbox styles, tiles, telemetry, services or credentials are exercised.
    map = renderer.startsWith('Mapbox') ? new mapboxgl.Map({ ...options, testMode: true, accessToken: '', projection: 'mercator' }) : new MapLibreMap(options);
    errors = [];
    const onError = (event: { error: { message: string } }) => { errors.push(event.error.message); };
    if (map instanceof MapLibreMap) map.on('error', onError); else map.on('error', onError);
    await new Promise<void>(resolve => { if (map instanceof MapLibreMap) map.once('load', () => { resolve(); }); else map.once('load', () => { resolve(); }); });
    editor = new api.GeometryEditor(map, { snapping: { enabled: true } });
    toolbar = new api.EditorToolbar(editor, { tools: ['point', 'line', 'polygon', 'lasso', 'undo', 'redo'], collapsed: false });
    layers = new api.DataLayerControl(editor);
    map.addControl(toolbar, 'top-right'); map.addControl(layers, 'bottom-left');
  });
  afterEach(() => {
    editor.destroy(); map.remove(); container.remove(); expect(errors).toEqual([]);
  });

  it('shares the public API without loading the other renderer', () => {
    expect(mapbox.GeometryEditor).toBe(maplibre.GeometryEditor);
    expect(mapbox.EditorToolbar).toBe(maplibre.EditorToolbar);
    expect(() => new api.GeometryEditor(map)).toThrow('Only one geometry editor');
    expect(container.querySelector('.mm-toolbar')?.classList.contains('mapboxgl-ctrl')).toBe(true);
    expect(container.querySelector('.mm-toolbar')?.classList.contains('mm-toolbar--end')).toBe(true);
  });

  it('keeps long tool lists, action panels and data controls inside a small canvas', async () => {
    map.removeControl(toolbar);
    toolbar = new api.EditorToolbar(editor, { tools: api.EditorToolbar.allTools });
    map.addControl(toolbar, 'top-right');
    container.style.width = '260px'; container.style.height = '200px'; map.resize();
    await new Promise<void>(resolve => { queueMicrotask(resolve); });
    const inside = (node: Element) => {
      const box = node.getBoundingClientRect(); const canvas = map.getCanvas().getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(canvas.left - 1);
      expect(box.top).toBeGreaterThanOrEqual(canvas.top - 1);
      expect(box.right).toBeLessThanOrEqual(canvas.right + 1);
      expect(box.bottom).toBeLessThanOrEqual(canvas.bottom + 1);
    };
    inside(container.querySelector('.mm-toolbar')!);
    editor.drawText({ text: 'A responsive label' });
    inside(container.querySelector('.mm-toolbar-actions')!);
    editor.cancel();
    layers.setCollapsed(false);
    inside(container.querySelector('.mm-data-layers')!);
  });

  it('draws from toolbar and keyboard, validates and cancels without adding history', async () => {
    await userEvent.click(container.querySelector<HTMLButtonElement>('[data-tool="polygon"]')!);
    await click(160, 130); await click(370, 130);
    await userEvent.keyboard('{Enter}'); expect(editor.getState().featureCount).toBe(0);
    await click(280, 310); await userEvent.keyboard('{Enter}');
    const saved = editor.exportGeoJSON(); expect(saved.features[0]?.geometry.type).toBe('Polygon');
    await expect.poll(() => visible(saved.features[0]!.id)).toBe(true);
    editor.draw('LineString'); await click(500, 140); await userEvent.keyboard('{Escape}');
    expect(editor.exportGeoJSON()).toEqual(saved); expect(editor.undo()).toBe(true); expect(editor.exportGeoJSON().features).toEqual([]);
    expect(editor.redo()).toBe(true); expect(editor.exportGeoJSON()).toEqual(saved);
  });

  it('round-trips multipart geometry, holes and typed IDs; edits atomically with locks', () => {
    const data = collection(); const a = coordinate(160, 130); const b = coordinate(370, 310);
    data.features.push({ type: 'Feature', id: 'multi', properties: { retained: ['value'] }, geometry: { type: 'MultiLineString', coordinates: [[a, b], [coordinate(420, 350), coordinate(580, 350)]] } });
    const polygon = data.features[0]!;
    if (polygon.geometry.type === 'Polygon') polygon.geometry.coordinates.push([[210, 180], [210, 230], [280, 230], [280, 180], [210, 180]].map(([x, y]) => coordinate(x!, y!)));
    editor.importGeoJSON(data);
    // Import canonicalizes ring winding; subsequent round trips remain exact.
    data.features = editor.exportGeoJSON().features;
    expect(editor.exportGeoJSON()).toEqual(data);
    editor.select(7); editor.translateSelection([0.0002, 0.0001]); expect(editor.exportGeoJSON()).not.toEqual(data);
    expect(editor.undo()).toBe(true); expect(editor.exportGeoJSON()).toEqual(data);
    editor.setLockedFeatureIds([7]); expect(editor.translateSelection([0.001, 0])).toBeNull(); expect(editor.exportGeoJSON()).toEqual(data);
    editor.setLockedFeatureIds([]); expect(editor.redo()).toBe(true); expect(editor.undo()).toBe(true); expect(editor.exportGeoJSON()).toEqual(data);
  });

  it('snaps pointer drawing to reference geometry and cancels cleanly', async () => {
    editor.importGeoJSON(collection()); editor.clearHistory();
    editor.draw('LineString'); await click(80, 80);
    await userEvent.hover(map.getCanvas(), { position: { x: 164, y: 133 } });
    await expect.poll(() => editor.getSnap()?.featureId).toBe(7);
    await click(164, 133); expect(editor.getDraft().at(-1)).toEqual(coordinate(160, 130));
    editor.cancel(); expect(editor.getState().canUndo).toBe(false);
    expect(map.doubleClickZoom.isEnabled()).toBe(true);
  });

  it('previews and commits vertex pointer edits with exact Undo/Redo', async () => {
    editor.importGeoJSON(collection()); const original = editor.exportGeoJSON(); editor.select(7); editor.editSelected();
    await commands.vertexPointer('down', 160, 130); await commands.vertexPointer('move', 190, 155); await commands.vertexPointer('up', 190, 155);
    expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getDraft()[0]).not.toEqual(coordinate(160, 130));
    editor.finish(); const edited = editor.exportGeoJSON(); expect(edited).not.toEqual(original);
    expect(editor.undo()).toBe(true); expect(editor.exportGeoJSON()).toEqual(original);
    expect(editor.redo()).toBe(true); expect(editor.exportGeoJSON()).toEqual(edited); expect(map.dragPan.isEnabled()).toBe(true);
  });

  it('cancels a captured vertex drag and restores disabled host gestures', async () => {
    editor.importGeoJSON(collection()); editor.select(7); editor.editSelected(); map.dragPan.disable(); const draft = editor.getDraft();
    await commands.vertexPointer('down', 160, 130); await commands.vertexPointer('move', 190, 155); await userEvent.keyboard('{Escape}');
    await commands.vertexPointer('up', 190, 155);
    expect(editor.getDraft()).toEqual(draft); expect(map.dragPan.isEnabled()).toBe(false);
    editor.cancel(); expect(map.dragPan.isEnabled()).toBe(false);
  });

  it('moves selected geometry and hands the preview to the committed worker source', async () => {
    editor.importGeoJSON(collection()); const original = editor.exportGeoJSON(); editor.select(7);
    await expect.poll(() => visible(7)).toBe(true);
    const transaction = vi.fn(); editor.onTransaction(transaction);
    await userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), { sourcePosition: { x: 250, y: 220 }, targetPosition: { x: 280, y: 240 } });
    expect(editor.exportGeoJSON()).not.toEqual(original); expect(transaction).toHaveBeenCalledTimes(1);
    await expect.poll(() => container.querySelector('[data-geo-translation-preview]')).toBeNull();
    await expect.poll(() => visible(7)).toBe(true);
    expect(editor.undo()).toBe(true); expect(editor.exportGeoJSON()).toEqual(original);
  });

  it('selects through a lasso without changing geometry or history', () => {
    editor.importGeoJSON(collection()); editor.clearHistory(); const saved = editor.exportGeoJSON();
    const selected = editor.selectByLasso([{ x: 120, y: 90 }, { x: 400, y: 90 }, { x: 400, y: 340 }, { x: 120, y: 340 }]);
    expect(selected).toEqual([7]); expect(editor.getState().canUndo).toBe(false); expect(editor.exportGeoJSON()).toEqual(saved);
  });

  it('captures a lasso gesture and works without a MapLibre roll API', async () => {
    editor.importGeoJSON(collection()); editor.clearHistory(); editor.lasso();
    await commands.vertexPointer('down', 120, 90); await commands.vertexPointer('move', 400, 90);
    await commands.vertexPointer('move', 400, 340); await commands.vertexPointer('move', 120, 340); await commands.vertexPointer('up', 120, 90);
    expect(editor.getState().selectedFeatureIds).toEqual([7]); expect(editor.getState().canUndo).toBe(false); expect(map.dragPan.isEnabled()).toBe(true);
  });

  it('restores data layers, selection, labels and geofences after replacing the style', async () => {
    editor.addDataLayer({ id: 'parcels', style: { shape: { fillColor: '#008800' } } });
    editor.importGeoJSON(collection()); editor.select(7); editor.moveFeaturesToDataLayer([7], 'parcels');
    editor.drawText({ text: 'Entrance' }); await click(500, 350); editor.finish(); editor.select(7);
    editor.setGeofencing({ enabled: true, excluded: [{ id: 'outside', geometry: { type: 'Polygon', coordinates: [[coordinate(600, 380), coordinate(700, 380), coordinate(700, 450), coordinate(600, 450), coordinate(600, 380)]] } }] });
    const saved = editor.exportGeoJSON(); const loaded = new Promise<void>(resolve => { if (map instanceof MapLibreMap) map.once('style.load', () => { resolve(); }); else map.once('style.load', () => { resolve(); }); });
    replaceStyle(); await loaded;
    expect(editor.exportGeoJSON()).toEqual(saved); expect(editor.getState().selectedFeatureIds).toEqual([7]); expect(editor.getFeatureDataLayer(7)).toBe('parcels');
    await expect.poll(() => visible(7)).toBe(true); expect(committedIds()).toHaveLength(1);
    expect(container.querySelectorAll('.mm-text-marker')).toHaveLength(1);
    expect(map.getStyle().layers.some(layer => layer.id.startsWith('geo-geofencing-'))).toBe(true);
  });

  it('retains a draft across a style replacement and restores host gestures on cancel', async () => {
    editor.importGeoJSON(collection()); editor.select(7); editor.editSelected(); editor.moveVertex(0, coordinate(190, 155));
    const draft = editor.getDraft(); const saved = editor.exportGeoJSON();
    const loaded = new Promise<void>(resolve => { if (map instanceof MapLibreMap) map.once('style.load', () => { resolve(); }); else map.once('style.load', () => { resolve(); }); }); replaceStyle(); await loaded;
    expect(editor.getDraft()).toEqual(draft); expect(editor.exportGeoJSON()).toEqual(saved); expect(editor.getState().mode).toBe('edit-polygon');
    editor.cancel(); expect(map.dragPan.isEnabled()).toBe(true); expect(editor.exportGeoJSON()).toEqual(saved);
  });

  it('cleans up owned resources and event listeners and allows remounting', async () => {
    const stale = vi.fn(); editor.onCreate(stale); editor.draw('LineString'); await click(100, 100);
    editor.destroy(); editor.destroy(); map.removeControl(toolbar); map.removeControl(layers);
    expect(map.getStyle().layers.map(layer => layer.id)).toEqual(['host-background']); expect(Object.keys(map.getStyle().sources)).toEqual([]);
    expect(container.querySelector('.mm-toolbar')).toBeNull(); expect(map.doubleClickZoom.isEnabled()).toBe(true);
    editor = new api.GeometryEditor(map); editor.draw('Point'); await click(250, 220);
    expect(editor.getState().featureCount).toBe(1); expect(stale).not.toHaveBeenCalled();
  });

  it('destroys the editor when the host map is removed, even during a gesture', async () => {
    editor.importGeoJSON(collection()); editor.select(7); editor.editSelected();
    await commands.vertexPointer('down', 160, 130); await commands.vertexPointer('move', 190, 155); map.remove();
    await commands.vertexPointer('up', 190, 155); expect(() => editor.draw('Point')).toThrow('destroyed');
  });
});
