import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type PolygonFeature, type TransactionEvent } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] });
const sourceId = (suffix: string) => Object.keys(map.getStyle().sources).find((id) => id.endsWith(suffix))!;
const source = (suffix: string) => map.getSource<GeoJSONSource>(sourceId(suffix))!;
const ring = (x: number, y: number, size: number): Coordinate[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]
  .map(([x, y]) => map.unproject([x!, y!]).toArray());
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const draft = async () => {
  const data = await source('-draft').getData();
  if (data.type !== 'FeatureCollection') throw new Error('Expected preview collection');
  return data.features;
};
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true } });
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { name: 'west' }, geometry: { type: 'Polygon', coordinates: [ring(80, 80, 200)] } },
    { type: 'Feature', id: '0', properties: { name: 'east' }, geometry: { type: 'Polygon', coordinates: [ring(220, 180, 200)] } },
  ] }); editor.clearHistory();
  await expect.poll(() => map.queryRenderedFeatures([100, 100], { layers: [sourceId('-features').replace(/-features$/, '-fill')] }).length).toBeGreaterThan(0);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('selects by Shift+click, previews without uploads, and commits once with Enter and exact keyboard undo/redo', async () => {
  await click(100, 100); await userEvent.keyboard('{Shift>}'); await click(400, 350); await userEvent.keyboard('{/Shift}');
  expect(editor.getState().selectedFeatureIds).toEqual([0, '0']);
  const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  const uploaded = vi.spyOn(source('-features'), 'setData');
  const transaction = vi.fn(); const individual = vi.fn(); const history = vi.fn();
  editor.onTransaction(transaction); editor.onCreate(individual); editor.onUpdate(individual); editor.onDelete(individual); editor.onHistory(history);
  editor.unionSelection(); const preview = editor.getUnionPreview()!;
  await expect.poll(draft).toHaveLength(1); expect((await draft())[0]!.geometry).toEqual(preview);
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).toMatchObject({ editing: true, selected: true });
  await click(500, 100); await userEvent.keyboard('{Backspace}');
  expect(editor.getDraft()).toEqual([]); expect(editor.getSnap()).toBeNull(); expect(editor.getState().selectedFeatureIds).toEqual([0, '0']);
  expect(editor.exportGeoJSON()).toEqual(before); expect(uploaded).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}');
  const after = editor.exportGeoJSON(); expect(after.features).toEqual([{ ...before.features[0], geometry: preview }]);
  expect(uploaded).toHaveBeenCalledOnce(); expect(transaction).toHaveBeenCalledOnce(); expect(individual).not.toHaveBeenCalled();
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: [0], dataRevision: revision + 1 });
  await expect.poll(draft).toHaveLength(0); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Control>}y{/Control}'); expect(editor.exportGeoJSON()).toEqual(after);
  expect(history).toHaveBeenCalledTimes(2); expect(history.mock.calls[0]![0]).toMatchObject({ action: 'transaction', direction: 'undo' });
});

it('restores all originals on Escape and retains camera/style-independent preview without mutating snapshots', async () => {
  editor.selectMany([0, '0']); const before = editor.exportGeoJSON(); editor.unionSelection(); const expected = editor.getUnionPreview();
  editor.getUnionPreview()!.coordinates.length = 0;
  map.jumpTo({ zoom: 14, bearing: 20 });
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(draft).toHaveLength(1); expect((await draft())[0]!.geometry).toEqual(expected);
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).toMatchObject({ editing: true, selected: true });
  map.getCanvas().focus(); await userEvent.keyboard('{Escape}');
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState()).toMatchObject({ canUndo: false, selectedFeatureIds: [0, '0'] });
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).not.toHaveProperty('editing');
  await expect.poll(draft).toHaveLength(0);
});

it('keeps invalid point-contact unions uncommitted and shows the originals', async () => {
  editor.applyTransaction({ update: [
    { type: 'Feature', id: 0, properties: null, geometry: { type: 'Polygon', coordinates: [ring(80, 80, 200)] } },
    { type: 'Feature', id: '0', properties: null, geometry: { type: 'Polygon', coordinates: [ring(280, 280, 100)] } },
  ] }); editor.clearHistory(); editor.selectMany([0, '0']); const before = editor.exportGeoJSON();
  editor.unionSelection(); expect(editor.getState()).toMatchObject({ unionError: 'union-invalid-result', canFinish: false });
  await userEvent.keyboard('{Enter}'); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().mode).toBe('union-polygons');
  await expect.poll(draft).toHaveLength(0);
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).not.toHaveProperty('editing');
  await userEvent.keyboard('{Escape}'); expect(editor.getState().canUndo).toBe(false);
});

it('returns the retained feature for a deletion-only union even when a listener clears selection, and isolates events', () => {
  const retained: PolygonFeature = { type: 'Feature', id: 0, properties: null,
    geometry: { type: 'Polygon', coordinates: [[[4.88, 52.37], [4.89, 52.37], [4.89, 52.38], [4.88, 52.38], [4.88, 52.37]]] } };
  editor.applyTransaction({ update: [retained, { ...retained, id: '0' }] }); editor.selectMany([0, '0']);
  editor.onTransaction((event) => { event.changes[0]!.before!.geometry.coordinates.length = 0; editor.select(null); });
  const observed = vi.fn<(event: TransactionEvent) => void>(); editor.onTransaction(observed); editor.unionSelection();
  expect(editor.finish()).toEqual(retained);
  expect(observed.mock.calls[0]![0].changes).toHaveLength(1);
  expect(observed.mock.calls[0]![0].changes[0]!.before!.geometry.coordinates).toEqual(retained.geometry.coordinates);
  expect(editor.exportGeoJSON().features).toEqual([retained]);
});

it('renders a disjoint MultiPolygon preview and cleans up on destroy, remount and map removal', async () => {
  editor.select('0'); editor.translateSelection([0.02, 0]); editor.selectMany([0, '0']);
  map.getCanvas().style.cursor = 'help'; map.doubleClickZoom.disable(); editor.unionSelection();
  expect(editor.getUnionPreview()?.type).toBe('MultiPolygon'); await expect.poll(draft).toHaveLength(1);
  expect((await draft())[0]!.geometry.type).toBe('MultiPolygon'); editor.cancel();
  expect(map.doubleClickZoom.isEnabled()).toBe(false); expect(map.getCanvas().style.cursor).toBe('help');
  map.doubleClickZoom.enable(); editor.unionSelection(); const before = editor.exportGeoJSON(); editor.destroy();
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getUnionPreview()).toBeNull(); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  expect(() => editor.unionSelection()).toThrow('destroyed'); expect(() => editor.finishUnion()).toThrow('destroyed');
  await new Promise((resolve) => requestAnimationFrame(resolve)); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  editor = new GeometryEditor(map); editor.importGeoJSON(before); editor.selectMany([0, '0']); editor.unionSelection(); map.remove();
  expect(editor.getState().mode).toBe('idle'); expect(editor.getUnionPreview()).toBeNull();
});
