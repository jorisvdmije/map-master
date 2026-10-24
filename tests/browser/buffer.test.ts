import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type TransactionEvent } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] });
const sourceId = (suffix: string) => Object.keys(map.getStyle().sources).find((id) => id.endsWith(suffix))!;
const source = (suffix: string) => map.getSource<GeoJSONSource>(sourceId(suffix))!;
const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const draft = async () => {
  const data = await source('-draft').getData();
  if (data.type !== 'FeatureCollection') throw new Error('Expected collection'); return data.features;
};
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true } });
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { name: 'parcel', kind: 'vertex' }, geometry: { type: 'Polygon', coordinates: [[coordinate(100, 100), coordinate(160, 100.2), coordinate(220, 100), coordinate(220, 200), coordinate(100, 200), coordinate(100, 100)]] } },
    { type: 'Feature', id: '0', properties: null, geometry: { type: 'LineString', coordinates: [coordinate(300, 150), coordinate(350, 175.2), coordinate(400, 200)] } },
  ] }); editor.clearHistory(); editor.selectMany([0, '0']);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('buffers selected geometry, previews without uploads, and saves once with keyboard Undo/Redo', async () => {
  const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  const uploaded = vi.spyOn(source('-features'), 'setData'); const transaction = vi.fn(); const individual = vi.fn(); const history = vi.fn();
  editor.onTransaction(transaction); editor.onUpdate(individual); editor.onCreate(individual); editor.onDelete(individual); editor.onHistory(history);
  expect(editor.bufferSelection()).toBe(true); editor.setBufferDistance(5); const preview = editor.getBufferPreview()!;
  expect(preview.features.every(f => f.geometry.type === 'Polygon')).toBe(true);
  expect(preview.features.map(f => f.properties)).toEqual(before.features.map(f => f.properties));
  await expect.poll(draft).toHaveLength(2);
  expect((await draft()).map((f) => f.geometry)).toEqual(preview.features.map((f) => f.geometry));
  expect((await draft()).every((f) => f.geometry.type !== 'Point')).toBe(true);
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).toMatchObject({ editing: true, selected: true });
  await click(550, 350); await userEvent.keyboard('{Backspace}');
  expect(editor.getSnap()).toBeNull(); expect(editor.getDraft()).toEqual([]); expect(editor.getState().selectedFeatureIds).toEqual([0, '0']);
  expect(editor.exportGeoJSON()).toEqual(before); expect(uploaded).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}'); const after = editor.exportGeoJSON(); expect(after).toEqual(preview);
  expect(uploaded).toHaveBeenCalledOnce(); expect(transaction).toHaveBeenCalledOnce(); expect(individual).not.toHaveBeenCalled();
  expect(editor.getState()).toMatchObject({ mode: 'idle', dataRevision: revision + 1 }); await expect.poll(draft).toHaveLength(0);
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Control>}y{/Control}'); expect(editor.exportGeoJSON()).toEqual(after);
  expect(history.mock.calls[0]![0]).toMatchObject({ action: 'transaction', direction: 'undo' });
});
it('keeps preview stable through pan, bearing and style changes, then cancels exactly', async () => {
  const before = editor.exportGeoJSON(); editor.bufferSelection(); editor.setBufferDistance(5);
  const expected = editor.getBufferPreview();
  map.jumpTo({ center: [4.896, 52.373], zoom: 14, bearing: 40 });
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(async () => (await draft()).filter((f) => f.geometry.type !== 'Point').map((f) => f.geometry)).toEqual(expected!.features.map((f) => f.geometry));
  expect(editor.getBufferPreview()).toEqual(expected);
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).toMatchObject({ editing: true });
  map.getCanvas().focus(); await userEvent.keyboard('{Escape}'); expect(editor.exportGeoJSON()).toEqual(before);
  expect(editor.getState()).toMatchObject({ canUndo: false, bufferDistance: null });
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).not.toHaveProperty('editing');
  await expect.poll(draft).toHaveLength(0);
});
it('shows original geometry for rejected results, blocks Enter, and allows correction', async () => {
  const before = editor.exportGeoJSON(); editor.bufferSelection(); editor.setBufferDistance(100000000);
  expect(editor.getState()).toMatchObject({ bufferError: 'buffer-out-of-bounds', canFinish: false });
  await expect.poll(draft).toHaveLength(0);
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).not.toHaveProperty('editing');
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('buffer-features'); expect(editor.exportGeoJSON()).toEqual(before);
  editor.setBufferDistance(5); await userEvent.keyboard('{Enter}'); expect(editor.getState()).toMatchObject({ mode: 'idle', canUndo: true });
});
it('isolates listener snapshots and finish return value even when a listener changes selection', () => {
  editor.bufferSelection(); editor.setBufferDistance(5); const expected = editor.getBufferPreview()!;
  editor.getBufferPreview()!.features[0]!.geometry.coordinates.length = 0;
  editor.onTransaction((event) => { event.changes[0]!.after!.geometry.coordinates.length = 0; editor.select(null); });
  const observer = vi.fn<(event: TransactionEvent) => void>(); editor.onTransaction(observer);
  const result = editor.finish()!; expect(result).toEqual(expected.features[0]);
  expect(observer.mock.calls[0]![0].changes[0]!.after).toEqual(expected.features[0]);
  result.geometry.coordinates.length = 0; expect(editor.exportGeoJSON()).toEqual(expected);
});
it('restores gesture settings on cancel, destruction and map removal', async () => {
  const before = editor.exportGeoJSON(); const transaction = vi.fn(); editor.onTransaction(transaction);
  map.doubleClickZoom.disable(); map.dragPan.disable(); map.getCanvas().style.cursor = 'help';
  editor.bufferSelection(); editor.cancel();
  expect(editor.getState().canUndo).toBe(false); expect(transaction).not.toHaveBeenCalled();
  expect(map.getCanvas().style.cursor).toBe('help'); expect(map.doubleClickZoom.isEnabled()).toBe(false); expect(map.dragPan.isEnabled()).toBe(false);
  map.doubleClickZoom.enable(); editor.bufferSelection(); editor.setBufferDistance(5); editor.destroy();
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getBufferPreview()).toBeNull(); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  expect(() => editor.bufferSelection()).toThrow('destroyed'); expect(() => editor.setBufferDistance(1)).toThrow('destroyed'); expect(() => editor.finishBuffer()).toThrow('destroyed');
  await new Promise((resolve) => requestAnimationFrame(resolve)); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  editor = new GeometryEditor(map); editor.importGeoJSON(before); editor.selectMany([0, '0']); editor.bufferSelection(); map.remove();
  expect(editor.getState()).toMatchObject({ mode: 'idle', bufferDistance: null });
});
it('does not intercept text entry outside the map and keeps ordinary vertex editing separate', async () => {
  editor.bufferSelection(); editor.setBufferDistance(5); const field = document.createElement('input'); document.body.append(field);
  try {
    field.focus(); await userEvent.keyboard('10{Backspace}{Enter}{Escape}'); expect(field.value).toBe('1'); expect(editor.getState().mode).toBe('buffer-features');
    editor.cancel(); editor.select(0); editor.editSelected(); expect(() => editor.bufferSelection()).toThrow('Finish or cancel');
  } finally { field.remove(); }
});
