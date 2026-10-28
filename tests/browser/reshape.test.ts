import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type TransactionEvent } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] });
const sourceId = (suffix: string) => Object.keys(map.getStyle().sources).find((id) => id.endsWith(suffix))!;
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).wrap().toArray();
const route = (): Coordinate[] => [coordinate(200, 350), coordinate(300, 300), coordinate(400, 350)];
const draft = async () => {
  const data = await map.getSource<GeoJSONSource>(sourceId('-draft'))!.getData();
  if (data.type !== 'FeatureCollection') throw new Error('Expected preview collection');
  return data.features;
};
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, center: [4.895, 52.372], zoom: 13, style: style(), fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: false } });
  editor.importGeoJSON({ type: 'Feature', id: 0, properties: { name: 'parcel' }, geometry: { type: 'Polygon', coordinates: [
    [[100, 100], [100, 350], [500, 350], [500, 100], [100, 100]].map((point) => map.unproject(point as [number, number]).wrap().toArray()),
  ] } }); editor.clearHistory(); editor.select(0);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });
it('attaches a mouse route to the target with snapping off, reviews and commits one update with keyboard Undo/Redo', async () => {
  const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId('-features'))!, 'setData');
  const transaction = vi.fn<(event: TransactionEvent) => void>(); const individual = vi.fn(); const history = vi.fn();
  editor.onTransaction(transaction); editor.onCreate(individual); editor.onUpdate(individual); editor.onDelete(individual); editor.onHistory(history);
  editor.reshapeSelected(); await click(300, 200); expect(editor.getDraft()).toEqual([]); // First point must attach.
  await click(200, 355); expect(editor.getSnap()).toMatchObject({ kind: 'edge', featureId: 0 });
  expect(editor.getDraft()[0]![1]).toBe(coordinate(0, 350)[1]);
  await click(300, 300); expect(editor.getState().canFinish).toBe(false); await click(400, 355);
  expect(editor.getState()).toMatchObject({ mode: 'reshape-polygon', canFinish: true, reshapeSide: 'shorter', reshapeError: null });
  expect(editor.exportGeoJSON()).toEqual(before); expect(upload).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  await expect.poll(async () => (await draft()).some((f) => f.properties?.kind === 'reshape')).toBe(true);
  expect(map.getFeatureState({ source: sourceId('-features'), id: '0' })).toMatchObject({ editing: true });
  const preview = editor.getReshapePreview(); const clicked = editor.getDraft();
  await click(600, 400); expect(editor.getDraft()).toEqual(clicked); // Review is frozen until correction.
  await userEvent.keyboard('{Enter}'); const after = editor.exportGeoJSON();
  expect(after.features).toEqual([{ ...before.features[0], geometry: preview }]);
  expect(transaction).toHaveBeenCalledOnce(); expect(transaction.mock.calls[0]![0].changes).toHaveLength(1);
  expect(upload).toHaveBeenCalledOnce(); expect(individual).not.toHaveBeenCalled();
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureId: 0, featureCount: 1, dataRevision: revision + 1 });
  expect(map.doubleClickZoom.isEnabled()).toBe(true); await expect.poll(draft).toHaveLength(0);
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Control>}y{/Control}'); expect(editor.exportGeoJSON()).toEqual(after);
  expect(history).toHaveBeenCalledTimes(2);
});
it('switches sides, reopens review with Backspace and cancels via Escape without changing the original', async () => {
  const before = editor.exportGeoJSON(); editor.reshapeSelected(); editor.setReshapePath(route()); const shorter = editor.getReshapePreview();
  editor.setReshapeSide('longer'); expect(editor.getReshapePreview()).not.toEqual(shorter);
  editor.setReshapeSide('shorter'); expect(editor.getReshapePreview()).toEqual(shorter);
  await userEvent.keyboard('{Backspace}'); expect(editor.getDraft()).toHaveLength(2); expect(editor.getState().canFinish).toBe(false);
  await expect.poll(() => map.getFeatureState({ source: sourceId('-features'), id: '0' }) as unknown).not.toHaveProperty('editing');
  await click(400, 350); expect(editor.getState().canFinish).toBe(true);
  await userEvent.keyboard('{Escape}'); expect(editor.exportGeoJSON()).toEqual(before);
  expect(editor.getState()).toMatchObject({ mode: 'idle', canUndo: false, selectedFeatureId: 0, reshapeSide: null });
  expect(editor.getReshapePreview()).toBeNull(); await expect.poll(draft).toHaveLength(0);
});
it('rejects extra boundary contacts and leaves the original visible while the invalid route is corrected', async () => {
  const before = editor.exportGeoJSON(); editor.reshapeSelected();
  editor.setReshapePath([coordinate(100, 200), coordinate(550, 200), coordinate(500, 250)]);
  expect(editor.getState()).toMatchObject({ canFinish: false, reshapeError: 'reshape-boundary-touch' });
  expect(editor.finishReshape()).toBeNull(); await userEvent.keyboard('{Enter}');
  expect(editor.getState().mode).toBe('reshape-polygon'); expect(editor.exportGeoJSON()).toEqual(before);
  await expect.poll(async () => (await draft()).some((f) => f.geometry.type === 'LineString')).toBe(true);
  expect(map.getFeatureState({ source: sourceId('-features'), id: '0' })).not.toHaveProperty('editing');
  editor.setReshapePath(route()); expect(editor.getState().canFinish).toBe(true); editor.cancel();
});
it('restores camera/style-independent previews and isolates public and event snapshots', async () => {
  editor.reshapeSelected(); editor.setReshapePath(route()); const expected = editor.getReshapePreview();
  editor.getReshapePreview()!.coordinates.length = 0;
  map.jumpTo({ zoom: 14, bearing: 20 });
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(async () => (await draft()).find((f) => f.properties?.kind === 'reshape')?.geometry).toEqual(expected);
  expect(map.getFeatureState({ source: sourceId('-features'), id: '0' })).toMatchObject({ editing: true });
  editor.onTransaction((event) => { event.changes[0]!.after!.geometry.coordinates.length = 0; editor.select(null); });
  const observed = vi.fn<(event: TransactionEvent) => void>(); editor.onTransaction(observed);
  const feature = editor.finish()!; expect(feature.geometry).toEqual(expected); expect(observed.mock.calls[0]![0].changes[0]!.after!.geometry).toEqual(expected);
  feature.geometry.coordinates.length = 0; expect(editor.exportGeoJSON().features[0]!.geometry).toEqual(expected);
});
it('keeps target-only attachments available with Alt and refreshes them after camera changes', async () => {
  // An unrelated vertex is closer than the target edge; attachment must still use the target.
  editor.importGeoJSON({ type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [coordinate(200, 355), coordinate(300, 380)] } });
  editor.setSnapping({ enabled: true }); editor.reshapeSelected();
  await userEvent.keyboard('{Alt>}'); await click(200, 355); await userEvent.keyboard('{/Alt}');
  expect(editor.getSnap()?.featureId).toBe(0); expect(editor.getDraft()[0]![1]).toBe(coordinate(0, 350)[1]);
  const middle = coordinate(300, 300); const end = coordinate(400, 350);
  map.jumpTo({ bearing: 15 });
  const mid = map.project(middle); await click(mid.x, mid.y); const last = map.project(end); await click(last.x, last.y);
  expect(editor.getState().canFinish).toBe(true); expect(editor.getSnap()?.featureId).toBe(0);
});
it('cleans up after cancel, destroy, remount and map removal and restores owned gesture settings', async () => {
  map.getCanvas().style.cursor = 'help'; map.doubleClickZoom.disable();
  editor.reshapeSelected(); editor.setReshapePath(route()); editor.cancel();
  expect(map.doubleClickZoom.isEnabled()).toBe(false); expect(map.getCanvas().style.cursor).toBe('help');
  map.doubleClickZoom.enable(); editor.reshapeSelected(); editor.setReshapePath(route());
  const before = editor.exportGeoJSON(); editor.destroy();
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getReshapePreview()).toBeNull(); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  expect(() => editor.reshapeSelected()).toThrow('destroyed'); expect(() => editor.finishReshape()).toThrow('destroyed');
  expect(() => editor.setReshapeSide('longer')).toThrow('destroyed');
  await new Promise((resolve) => requestAnimationFrame(resolve)); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  editor = new GeometryEditor(map); editor.importGeoJSON(before); editor.select(0); editor.reshapeSelected(); editor.setReshapePath(route()); map.remove();
  expect(editor.getState().mode).toBe('idle'); expect(editor.getReshapePreview()).toBeNull();
});
