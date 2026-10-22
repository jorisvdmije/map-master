import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type PolygonFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] });
const sourceId = (suffix: string) => Object.keys(map.getStyle().sources).find((id) => id.endsWith(suffix))!;
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const cut = () => [[50, 200], [550, 200]].map((point) => map.unproject(point as [number, number]).wrap().toArray());
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, center: [4.895, 52.372], zoom: 13, style: style(), fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true } });
  editor.importGeoJSON({ type: 'Feature', id: 0, properties: { name: 'parcel' }, geometry: { type: 'Polygon', coordinates: [
    [[100, 100], [100, 350], [500, 350], [500, 100], [100, 100]].map((point) => map.unproject(point as [number, number]).wrap().toArray()),
  ] } }); editor.clearHistory(); editor.select(0);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });
it('draws and previews a cut, commits once with Enter, and restores both parts using keyboard history', async () => {
  const original = editor.exportGeoJSON(); const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId('-features'))!, 'setData');
  const transaction = vi.fn(); editor.onTransaction(transaction); const individual = vi.fn(); editor.onCreate(individual); editor.onUpdate(individual);
  editor.splitSelected(); await click(50, 200); await click(550, 200);
  expect(editor.getState()).toMatchObject({ canFinish: true, mode: 'split-polygon', featureCount: 1 });
  expect(editor.exportGeoJSON()).toEqual(original); expect(upload).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  await expect.poll(async () => JSON.stringify(await map.getSource<GeoJSONSource>(sourceId('-draft'))!.getData())).toContain('split-part');
  expect(map.getFeatureState({ source: sourceId('-features'), id: '0' })).toMatchObject({ editing: true });
  const preview = editor.getSplitPreview()!;
  await userEvent.keyboard('{Enter}');
  const saved = editor.exportGeoJSON(); expect(saved.features).toHaveLength(2);
  expect(saved.features[0]!.geometry).toEqual(preview.retained); expect(saved.features[1]!.geometry).toEqual(preview.created);
  expect(saved.features[0]!.id).toBe(0); expect(saved.features[1]!.id).not.toBe(0);
  expect(transaction).toHaveBeenCalledOnce(); expect(individual).not.toHaveBeenCalled(); expect(upload).toHaveBeenCalledOnce();
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureId: 0 }); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(original);
  await userEvent.keyboard('{Control>}y{/Control}'); expect(editor.exportGeoJSON()).toEqual(saved);
});
it('keeps invalid cuts uncommitted, corrects with Backspace and restores the original on Escape', async () => {
  const original = editor.exportGeoJSON(); editor.splitSelected(); await click(50, 200); await click(300, 200);
  expect(editor.getState().splitError).toBe('split-endpoints-inside'); await userEvent.keyboard('{Enter}');
  expect(editor.getState().mode).toBe('split-polygon'); expect(editor.exportGeoJSON()).toEqual(original);
  await userEvent.keyboard('{Backspace}'); expect(editor.getDraft()).toHaveLength(1);
  await click(550, 200); expect(editor.getState().canFinish).toBe(true);
  await userEvent.keyboard('{Escape}'); expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureId: 0, canUndo: false });
  expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getSplitPreview()).toBeNull();
  expect(map.getFeatureState({ source: sourceId('-features'), id: '0' })).not.toHaveProperty('editing');
});
it('preserves preview through camera/style changes and isolates public/event snapshots', async () => {
  editor.splitSelected(); editor.setSplitLine(cut()); const expected = editor.getSplitPreview()!;
  const external = editor.getSplitPreview()!; external.created.coordinates.length = 0;
  map.jumpTo({ zoom: 14, bearing: 20 });
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(async () => JSON.stringify(await map.getSource<GeoJSONSource>(sourceId('-draft'))!.getData())).toContain('split-part');
  expect(editor.getSplitPreview()).toEqual(expected);
  editor.onTransaction((event) => { event.changes[1]!.after!.geometry.coordinates.length = 0; });
  const observed = vi.fn(); editor.onTransaction(observed);
  const event = editor.finishSplit()!; expect(observed).toHaveBeenCalledExactlyOnceWith(event);
  (event.changes[1]!.after as PolygonFeature).geometry.coordinates[0]!.length = 0;
  expect(editor.exportGeoJSON().features[1]!.geometry).toEqual(expected.created);
});
it('restores gesture settings and cancels pending previews on destroy or map removal', async () => {
  map.doubleClickZoom.disable(); editor.splitSelected(); editor.setSplitLine(cut()); editor.cancel(); expect(map.doubleClickZoom.isEnabled()).toBe(false);
  map.doubleClickZoom.enable(); editor.splitSelected(); editor.setSplitLine(cut());
  const saved = editor.exportGeoJSON(); const transaction = vi.fn(); editor.onTransaction(transaction); editor.destroy();
  expect(editor.exportGeoJSON()).toEqual(saved); expect(editor.getSplitPreview()).toBeNull(); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  await new Promise((resolve) => requestAnimationFrame(resolve)); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  expect(transaction).not.toHaveBeenCalled(); expect(() => editor.splitSelected()).toThrow('destroyed'); expect(() => editor.finishSplit()).toThrow('destroyed');
  editor = new GeometryEditor(map); editor.importGeoJSON(saved); editor.select(0); editor.splitSelected(); editor.setSplitLine(cut()); map.remove();
  expect(editor.getState().mode).toBe('idle'); expect(editor.getSplitPreview()).toBeNull();
});
