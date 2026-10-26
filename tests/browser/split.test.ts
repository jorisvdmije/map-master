import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type PolygonFeature, type SnapResult, type TransactionEvent } from '../../src/index.js';
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
it.each([true, false])('attaches to the selected shared edges with general snapping %s and leaves neighbours unchanged', async enabled => {
  const position = (x: number, y: number): Coordinate => map.unproject([x, y]).wrap().toArray();
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'left', properties: { name: 'left parcel' }, geometry: { type: 'Polygon', coordinates: [
      [[20, 100], [20, 350], [100, 350], [100, 200], [100, 100], [20, 100]].map(([x, y]) => position(x!, y!)),
    ] } },
    { type: 'Feature', id: 'right', properties: { name: 'right parcel' }, geometry: { type: 'Polygon', coordinates: [
      [[500, 100], [500, 200], [500, 350], [650, 350], [650, 100], [500, 100]].map(([x, y]) => position(x!, y!)),
    ] } },
  ] });
  editor.select(0); editor.clearHistory(); editor.setSnapping({ enabled });
  const before = editor.exportGeoJSON(); const snaps: (SnapResult | null)[] = [];
  editor.onSnap(snap => { snaps.push(snap); });
  const transaction = vi.fn<(event: TransactionEvent) => void>(); editor.onTransaction(transaction);
  editor.splitSelected(); await click(104, 200); await click(496, 200);
  // The neighbours have tempting vertices at the click locations; the target's
  // edge must win and the draft must land exactly on that edge.
  expect(snaps.filter(snap => snap !== null).every(snap => snap.featureId === 0)).toBe(true);
  const target = before.features[0] as PolygonFeature;
  expect(editor.getDraft().map(point => point[0])).toEqual([target.geometry.coordinates[0]![0]![0], target.geometry.coordinates[0]![2]![0]]);
  expect(editor.getState().canFinish).toBe(true); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Enter}');
  const saved = editor.exportGeoJSON(); expect(saved.features).toHaveLength(4);
  expect(saved.features.slice(1, 3)).toEqual(before.features.slice(1, 3));
  expect(transaction).toHaveBeenCalledOnce(); expect(transaction.mock.calls[0]![0].changes).toHaveLength(2);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  editor.redo(); expect(editor.exportGeoJSON()).toEqual(saved);
});
it('attaches to sloping edges after camera/style changes and cancels without saving', async () => {
  const ring: Coordinate[] = [[4.89,52.37],[4.90,52.371],[4.899,52.376],[4.889,52.375],[4.89,52.37]];
  editor.importGeoJSON({type:'Feature',id:'slope',properties:null,geometry:{type:'Polygon',coordinates:[ring]}});
  editor.select('slope'); editor.clearHistory(); const before = editor.exportGeoJSON(); editor.splitSelected();
  map.jumpTo({bearing:30,pitch:40});
  const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), {diff:false}); await loaded;
  for (const [a, b] of [[ring[0]!,ring[1]!],[ring[2]!,ring[3]!]]) {
    const point = map.project([(a![0]+b![0])/2,(a![1]+b![1])/2]); await click(point.x,point.y);
  }
  expect(editor.getState().canFinish).toBe(true);
  await userEvent.keyboard('{Escape}'); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
});
it('accepts corner attachments and permits Alt to bypass boundary attachment', async () => {
  editor.splitSelected(); await click(103,103); await click(497,347);
  expect(editor.getState().canFinish).toBe(true);
  const ring = (editor.getSelected() as PolygonFeature).geometry.coordinates[0]!;
  expect(editor.getDraft()).toEqual([ring[0],ring[2]]);
  editor.cancel(); editor.splitSelected();
  await userEvent.keyboard('{Alt>}'); await click(104,200); await click(496,200); await userEvent.keyboard('{/Alt}');
  expect(editor.getState()).toMatchObject({canFinish:false,splitError:'split-endpoints-inside'});
});
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
