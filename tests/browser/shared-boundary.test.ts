import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type TransactionEvent } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] });
const sourceId = (suffix = '-features') => Object.keys(map.getStyle().sources).find((id) => id.endsWith(suffix))!;
const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).wrap().toArray();
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const drag = (x: number, y: number, toX: number, toY: number) => userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), {
  sourcePosition: { x, y }, targetPosition: { x: toX, y: toY },
});
const draft = async () => {
  const data = await map.getSource<GeoJSONSource>(sourceId('-draft'))!.getData();
  if (data.type !== 'FeatureCollection') throw new Error('Expected preview collection');
  return data.features;
};
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, center: [4.895, 52.372], zoom: 13, style: style(), fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true } });
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: null, geometry: { type: 'Polygon', coordinates: [
      [[100, 100], [350, 100], [350, 350], [100, 350], [100, 100]].map(([x, y]) => coordinate(x!, y!)),
    ] } },
    { type: 'Feature', id: '0', properties: { name: 'east' }, geometry: { type: 'Polygon', coordinates: [
      [[350, 100], [600, 100], [600, 350], [350, 350], [350, 100]].map(([x, y]) => coordinate(x!, y!)),
    ] } },
  ] }); editor.clearHistory(); editor.selectMany([0, '0']);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });
it('inserts/drags a common midpoint, previews both polygons, and saves one transaction with exact history', async () => {
  const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision; const center = map.getCenter().toArray();
  const transaction = vi.fn<(event: TransactionEvent) => void>(); const individual = vi.fn(); const history = vi.fn();
  editor.onTransaction(transaction); editor.onUpdate(individual); editor.onCreate(individual); editor.onDelete(individual); editor.onHistory(history);
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId())!, 'setData');
  expect(editor.editSharedBoundary()).toBe(true); await drag(350, 225, 410, 225);
  expect(editor.getDraft()).toHaveLength(3); expect(editor.getDraft()[1]![0]).toBeCloseTo(coordinate(410, 225)[0], 9);
  expect(map.getCenter().toArray()).toEqual(center); expect(map.dragPan.isEnabled()).toBe(true);
  expect(editor.exportGeoJSON()).toEqual(before); expect(upload).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  const preview = editor.getSharedBoundaryPreview()!;
  await expect.poll(async () => (await draft()).filter((feature) => feature.properties?.kind === 'shared-boundary-part').map((feature) => feature.geometry)).toEqual(preview.features.map((feature) => feature.geometry));
  for (const id of [0, '0']) expect(map.getFeatureState({ source: sourceId(), id: JSON.stringify(id) })).toMatchObject({ editing: true });
  await userEvent.keyboard('{Enter}'); const after = editor.exportGeoJSON(); expect(after).toEqual(preview);
  expect(transaction).toHaveBeenCalledOnce(); expect(transaction.mock.calls[0]![0].changes).toHaveLength(2);
  expect(upload).toHaveBeenCalledOnce(); expect(individual).not.toHaveBeenCalled();
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: [0, '0'], dataRevision: revision + 1 });
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Control>}y{/Control}'); expect(editor.exportGeoJSON()).toEqual(after); expect(history).toHaveBeenCalledTimes(2);
});
it('locks endpoints, deletes only internal shared points and exits no-op saves without a transaction', async () => {
  editor.editSharedBoundary(); const path = editor.getDraft(); const center = map.getCenter().toArray(); const transaction = vi.fn(); editor.onTransaction(transaction);
  await drag(350, 100, 400, 100); expect(editor.getDraft()).toEqual(path); expect(map.getCenter().toArray()).toEqual(center);
  await click(350, 225); expect(editor.getDraft()).toHaveLength(3); await userEvent.keyboard('{Delete}'); expect(editor.getDraft()).toEqual(path);
  editor.selectVertex(0); await userEvent.keyboard('{Backspace}'); expect(editor.getDraft()).toEqual(path);
  await userEvent.keyboard('{Enter}'); expect(editor.getState()).toMatchObject({ mode: 'idle', canUndo: false }); expect(transaction).not.toHaveBeenCalled();
});
it('excludes both saved polygons from snapping and supports third-feature snapping and Alt bypass', async () => {
  editor.importGeoJSON({ type: 'Feature', id: 'snap', properties: {}, geometry: { type: 'LineString', coordinates: [coordinate(430, 220), coordinate(440, 250)] } });
  editor.editSharedBoundary(); await drag(350, 225, 355, 220); expect(editor.getSnap()).toBeNull();
  expect(editor.getDraft()[1]![0]).toBeCloseTo(coordinate(355, 220)[0], 9); // No snap back to either saved shared edge.
  await drag(355, 220, 425, 220); expect(editor.getDraft()[1]).toEqual(coordinate(430, 220));
  await userEvent.keyboard('{Alt>}'); await drag(430, 220, 420, 215); await userEvent.keyboard('{/Alt}');
  expect(editor.getDraft()[1]![0]).toBeCloseTo(coordinate(420, 215)[0], 9);
});
it('shows invalid drafts, blocks saving, and restores both shapes on correction or cancellation', async () => {
  const before = editor.exportGeoJSON(); editor.editSharedBoundary(); await drag(350, 225, 650, 225);
  expect(editor.getState()).toMatchObject({ canFinish: false, sharedBoundaryError: 'shared-boundary-invalid-result' });
  expect(editor.getSharedBoundaryPreview()).toBeNull(); await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('edit-shared-boundary');
  await expect.poll(async () => (await draft()).filter((feature) => feature.geometry.type === 'Polygon').length).toBe(0);
  for (const id of [0, '0']) expect(map.getFeatureState({ source: sourceId(), id: JSON.stringify(id) })).not.toHaveProperty('editing');
  await drag(650, 225, 400, 225); expect(editor.getState().canFinish).toBe(true);
  await userEvent.keyboard('{Escape}'); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  expect(editor.getSharedBoundaryPreview()).toBeNull(); expect(map.doubleClickZoom.isEnabled()).toBe(true);
});
it('rolls back pointer cancellation and blur without leaving an inserted shared vertex', async () => {
  editor.editSharedBoundary(); const original = editor.getDraft();
  const interrupt = (event: PointerEvent): void => { map.getCanvas().dispatchEvent(new PointerEvent('pointercancel', { pointerId: event.pointerId })); };
  map.getCanvas().addEventListener('pointerdown', interrupt, { once: true }); await click(350, 225);
  expect(editor.getDraft()).toEqual(original); expect(map.dragPan.isEnabled()).toBe(true);
  await commands.vertexPointer('down', 350, 225); await commands.vertexPointer('move', 400, 225);
  window.dispatchEvent(new Event('blur')); await commands.vertexPointer('up', 400, 225);
  expect(editor.getDraft()).toEqual(original); expect(map.dragPan.isEnabled()).toBe(true);
});
it('rebuilds two previews across camera/style changes and isolates listener snapshots', async () => {
  editor.editSharedBoundary(); editor.insertVertex(1, coordinate(400, 225)); const expected = editor.getSharedBoundaryPreview();
  editor.getSharedBoundaryPreview()!.features[0].geometry.coordinates.length = 0;
  map.jumpTo({ bearing: 25, zoom: 14 });
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(async () => (await draft()).filter((f) => f.properties?.kind === 'shared-boundary-part').map((f) => f.geometry)).toEqual(expected!.features.map((f) => f.geometry));
  for (const id of [0, '0']) expect(map.getFeatureState({ source: sourceId(), id: JSON.stringify(id) })).toMatchObject({ editing: true });
  editor.onTransaction((event) => { event.changes[0]!.after!.geometry.coordinates.length = 0; editor.select(null); });
  const observer = vi.fn<(event: TransactionEvent) => void>(); editor.onTransaction(observer);
  const result = editor.finish()!; expect(result).toEqual(expected!.features[0]); expect(observer.mock.calls[0]![0].changes[0]!.after).toEqual(result);
  result.geometry.coordinates.length = 0; expect(editor.exportGeoJSON()).toEqual(expected);
});
it('cleans up during destruction/remount/map removal and restores prior gesture settings', async () => {
  const before = editor.exportGeoJSON(); map.doubleClickZoom.disable(); map.dragPan.disable(); map.getCanvas().style.cursor = 'help';
  editor.editSharedBoundary(); await drag(350, 225, 400, 225); editor.cancel();
  expect(map.dragPan.isEnabled()).toBe(false); expect(map.doubleClickZoom.isEnabled()).toBe(false); expect(map.getCanvas().style.cursor).toBe('help');
  map.doubleClickZoom.enable(); editor.editSharedBoundary(); editor.insertVertex(1, coordinate(400, 225)); editor.destroy();
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getSharedBoundaryPreview()).toBeNull(); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  expect(() => editor.editSharedBoundary()).toThrow('destroyed'); expect(() => editor.finishSharedBoundary()).toThrow('destroyed');
  await new Promise((resolve) => requestAnimationFrame(resolve)); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  editor = new GeometryEditor(map); editor.importGeoJSON(before); editor.selectMany([0, '0']); editor.editSharedBoundary(); map.remove();
  expect(editor.getState()).toMatchObject({ mode: 'idle', sharedBoundaryError: null });
});
