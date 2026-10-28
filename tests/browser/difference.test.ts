import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate } from '../../src/index.js';
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
  editor.differenceSelection(); const preview = editor.getDifferencePreview()!.geometry!;
  await expect.poll(draft).toHaveLength(1); expect((await draft())[0]!.geometry).toEqual(preview);
  expect(map.getFeatureState({ source: sourceId('-features'), id: '0' })).toMatchObject({ editing: true, selected: true });
  expect(map.getFeatureState({ source: sourceId('-features'), id: '"0"' })).toMatchObject({ selected: true });
  expect(map.getFeatureState({ source: sourceId('-features'), id: '"0"' })).not.toHaveProperty('editing');
  await click(500, 100); await userEvent.keyboard('{Backspace}');
  expect(editor.getDraft()).toEqual([]); expect(editor.getSnap()).toBeNull(); expect(editor.getState().selectedFeatureIds).toEqual([0, '0']);
  expect(editor.exportGeoJSON()).toEqual(before); expect(uploaded).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}');
  const after = editor.exportGeoJSON(); expect(after.features).toEqual([{ ...before.features[0], geometry: preview }, before.features[1]]);
  expect(uploaded).toHaveBeenCalledOnce(); expect(transaction).toHaveBeenCalledOnce(); expect(individual).not.toHaveBeenCalled();
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: [0, '0'], dataRevision: revision + 1 });
  await expect.poll(draft).toHaveLength(0); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Control>}y{/Control}'); expect(editor.exportGeoJSON()).toEqual(after);
  expect(history).toHaveBeenCalledTimes(2); expect(history.mock.calls[0]![0]).toMatchObject({ action: 'transaction', direction: 'undo' });
});

it('restores all originals on Escape and retains camera/style-independent preview without mutating snapshots', async () => {
  editor.selectMany([0, '0']); const before = editor.exportGeoJSON(); editor.differenceSelection(); const expected = editor.getDifferencePreview()!.geometry;
  editor.getDifferencePreview()!.geometry!.coordinates.length = 0;
  map.jumpTo({ zoom: 14, bearing: 20 });
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(draft).toHaveLength(1); expect((await draft())[0]!.geometry).toEqual(expected);
  expect(map.getFeatureState({ source: sourceId('-features'), id: '0' })).toMatchObject({ editing: true, selected: true });
  expect(map.getFeatureState({ source: sourceId('-features'), id: '"0"' })).toMatchObject({ selected: true });
  expect(map.getFeatureState({ source: sourceId('-features'), id: '"0"' })).not.toHaveProperty('editing');
  map.getCanvas().focus(); await userEvent.keyboard('{Escape}');
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState()).toMatchObject({ canUndo: false, selectedFeatureIds: [0, '0'] });
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).not.toHaveProperty('editing');
  await expect.poll(draft).toHaveLength(0);
});

it('deletes a fully covered target on confirmation, keeps its cutter visible and restores the target with Undo', async () => {
  const target = editor.exportGeoJSON().features[0]!;
  editor.applyTransaction({ update: [{ ...target, id: '0' }] }); editor.clearHistory(); editor.selectMany([0, '0']);
  const before = editor.exportGeoJSON(); const transaction = vi.fn(); editor.onTransaction(transaction);
  editor.differenceSelection(); expect(editor.getDifferencePreview()).toEqual({ geometry: null });
  expect(editor.getState().canFinish).toBe(true);
  await expect.poll(() => map.getFeatureState({ source: sourceId('-features'), id: '0' }) as unknown).toMatchObject({ editing: true });
  expect(map.getFeatureState({ source: sourceId('-features'), id: '"0"' })).not.toHaveProperty('editing'); await expect.poll(draft).toHaveLength(0);
  expect(editor.finish()).toBeNull(); expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: ['0'], featureCount: 1 });
  expect(transaction).toHaveBeenCalledOnce(); expect(editor.exportGeoJSON().features).toEqual([before.features[1]]);
  expect(editor.undo()).toBe(true); expect(editor.exportGeoJSON()).toEqual(before);
});

it('exits no-op review without upload, transaction or revision and preserves Redo even with reentrant listeners', async () => {
  editor.select('0'); editor.translateSelection([0.05, 0]); editor.clearHistory();
  editor.translateSelection([0.01, 0]); editor.undo(); editor.selectMany([0, '0']);
  const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  const upload = vi.spyOn(source('-features'), 'setData'); const transaction = vi.fn(); const changed = vi.fn();
  editor.onTransaction(transaction); editor.onChange(changed); editor.differenceSelection(); await expect.poll(draft).toHaveLength(1);
  editor.onChange((state) => { if (state.mode === 'idle' && state.selectedFeatureIds.length) editor.select(null); });
  expect(editor.finish()).toEqual(before.features[0]);
  expect(editor.getState()).toMatchObject({ mode: 'idle', dataRevision: revision, canRedo: true });
  expect(editor.exportGeoJSON()).toEqual(before); expect(upload).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalled(); await expect.poll(draft).toHaveLength(0); expect(map.doubleClickZoom.isEnabled()).toBe(true);
});

it('keeps an unsupported touching-hole result visible and uncommitted until cancellation', async () => {
  const polygon = (id: number, coordinates: Coordinate[]) => ({ type: 'Feature' as const, id, properties: null,
    geometry: { type: 'Polygon' as const, coordinates: [coordinates] } });
  editor.applyTransaction({ delete: ['0'], update: [polygon(0, [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])], create: [
    polygon(1, [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]),
    polygon(2, [[3, 3], [5, 3], [5, 5], [3, 5], [3, 3]]),
  ] }); editor.clearHistory(); editor.selectMany([0, 1, 2]); const before = editor.exportGeoJSON();
  editor.differenceSelection(); expect(editor.getState()).toMatchObject({ differenceError: 'difference-invalid-result', canFinish: false });
  expect(editor.finishDifference()).toBeNull(); await userEvent.keyboard('{Enter}');
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().mode).toBe('difference-polygons');
  await expect.poll(draft).toHaveLength(0);
  for (const id of ['0', '1', '2']) expect(map.getFeatureState({ source: sourceId('-features'), id })).not.toHaveProperty('editing');
  await userEvent.keyboard('{Escape}'); expect(editor.getState().canUndo).toBe(false);
});

it('renders multipart subtraction and cleans up on cancel, destroy, remount and map removal', async () => {
  editor.applyTransaction({ update: [{ type: 'Feature', id: '0', properties: null,
    geometry: { type: 'Polygon', coordinates: [ring(160, 40, 60).map(([x, y], index) => index === 2 || index === 3 ? [x, map.unproject([0, 340]).lat] : [x, y])] } }] });
  editor.selectMany([0, '0']); map.getCanvas().style.cursor = 'help'; map.doubleClickZoom.disable(); editor.differenceSelection();
  expect(editor.getDifferencePreview()?.geometry?.type).toBe('MultiPolygon'); await expect.poll(draft).toHaveLength(1);
  expect((await draft())[0]!.geometry.type).toBe('MultiPolygon'); editor.cancel();
  expect(map.doubleClickZoom.isEnabled()).toBe(false); expect(map.getCanvas().style.cursor).toBe('help');
  map.doubleClickZoom.enable(); editor.differenceSelection(); const before = editor.exportGeoJSON(); editor.destroy();
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getDifferencePreview()).toBeNull(); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  expect(() => editor.differenceSelection()).toThrow('destroyed'); expect(() => editor.finishDifference()).toThrow('destroyed');
  await new Promise((resolve) => requestAnimationFrame(resolve)); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  editor = new GeometryEditor(map); editor.importGeoJSON(before); editor.selectMany([0, '0']); editor.differenceSelection(); map.remove();
  expect(editor.getState().mode).toBe('idle'); expect(editor.getDifferencePreview()).toBeNull();
});
