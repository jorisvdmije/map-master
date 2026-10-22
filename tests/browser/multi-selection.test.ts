import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, LineEditor, type Coordinate, type EditorState, type FeatureId, type TransactionEvent } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const sourceId = () => Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!;
const source = () => map.getSource<GeoJSONSource>(sourceId())!;
const marker = (id: FeatureId): unknown => map.getFeatureState({ source: sourceId(), id: JSON.stringify(id) });
const box = () => map.getCanvasContainer().querySelector('[data-geo-selection-box]');
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const drag = (x: number, y: number, endX: number, endY: number) => userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), {
  sourcePosition: { x, y }, targetPosition: { x: endX, y: endY },
});
const position = ([x, y]: [number, number]): Coordinate => map.unproject([x, y]).wrap().toArray();
async function fixture(): Promise<void> {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { nested: { name: 'polygon' } }, geometry: { type: 'Polygon', coordinates: [
      [[100, 100], [300, 100], [300, 300], [100, 300], [100, 100]].map((p) => position(p as [number, number])),
    ] } },
    { type: 'Feature', id: '0', properties: { name: 'crossing line' }, geometry: { type: 'LineString', coordinates: [position([50, 180]), position([450, 180])] } },
    { type: 'Feature', id: 'far', properties: null, geometry: { type: 'LineString', coordinates: [position([500, 100]), position([600, 100])] } },
  ] });
  editor.clearHistory();
  await expect.poll(() => map.queryRenderedFeatures({ layers: [sourceId()] }).length).toBeGreaterThanOrEqual(3);
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  await commands.vertexPointer('up', 650, 400); await userEvent.keyboard('{/Shift}');
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});

it('replaces on click, toggles on Shift+click, ignores empty Shift+click, and clears on empty click/Escape', async () => {
  await fixture(); const saved = editor.exportGeoJSON();
  await click(200, 250); expect(editor.getState().selectedFeatureIds).toEqual([0]);
  await userEvent.keyboard('{Shift>}');
  await click(350, 180); expect(editor.getState().selectedFeatureIds).toEqual([0, '0']);
  expect(editor.getSelected()).toBeNull(); expect(marker(0)).toMatchObject({ selected: true }); expect(marker('0')).toMatchObject({ selected: true });
  await click(200, 250); expect(editor.getState().selectedFeatureIds).toEqual(['0']);
  expect(marker(0)).not.toMatchObject({ selected: true });
  await click(650, 400); expect(editor.getState().selectedFeatureIds).toEqual(['0']);
  await userEvent.keyboard('{/Shift}');
  await click(550, 100); expect(editor.getState().selectedFeatureIds).toEqual(['far']);
  expect(marker('0')).not.toMatchObject({ selected: true });
  editor.selectMany([0, '0']); await userEvent.keyboard('{Escape}'); expect(editor.getSelection()).toEqual([]);
  editor.selectMany([0, '0']); await click(650, 400); expect(editor.getSelection()).toEqual([]);
  expect(editor.exportGeoJSON()).toEqual(saved); expect(editor.getState()).toMatchObject({ canUndo: false, dataRevision: 1 });
});

it.each([6, 17])('adds intersecting rendered shapes at zoom %s, including a containing polygon and line with both endpoints outside', async (zoom) => {
  map.jumpTo({ zoom, bearing: 25, pitch: 30 }); await fixture();
  editor.select('far'); const changed = vi.fn(); editor.onChange(changed);
  const upload = vi.spyOn(source(), 'setData');
  const center = map.getCenter().toArray(); const originalZoom = map.getZoom();
  await userEvent.keyboard('{Shift>}');
  await commands.vertexPointer('down', 250, 250); await commands.vertexPointer('move', 150, 150);
  expect(box()).not.toBeNull(); expect(editor.getState().selectedFeatureIds).toEqual(['far']);
  expect(changed).not.toHaveBeenCalled(); expect(map.dragPan.isEnabled()).toBe(false); expect(map.boxZoom.isEnabled()).toBe(false);
  // Releasing Shift before the mouse does not turn a box into an ordinary click.
  await userEvent.keyboard('{/Shift}'); await commands.vertexPointer('up', 150, 150);
  expect(editor.getState().selectedFeatureIds).toHaveLength(3);
  expect(new Set(editor.getState().selectedFeatureIds)).toEqual(new Set(['far', 0, '0']));
  expect(changed).toHaveBeenCalledOnce(); expect(upload).not.toHaveBeenCalled(); expect(box()).toBeNull();
  expect(map.getCenter().toArray()).toEqual(center); expect(map.getZoom()).toBe(originalZoom);
  expect(map.dragPan.isEnabled()).toBe(true); expect(map.boxZoom.isEnabled()).toBe(true);
  await userEvent.keyboard('{Shift>}'); await drag(150, 150, 250, 250); await userEvent.keyboard('{/Shift}');
  expect(changed).toHaveBeenCalledOnce();
});

it('uses exact typed-ID snapshots, diffs highlights without uploading geometry, and guards single-feature tools', async () => {
  await fixture(); const upload = vi.spyOn(source(), 'setData');
  const set = vi.spyOn(map, 'setFeatureState'); const remove = vi.spyOn(map, 'removeFeatureState');
  const first = vi.fn<(state: EditorState) => void>(); editor.onChange((state) => { state.selectedFeatureIds.length = 0; }); editor.onChange(first);
  editor.selectMany([0, '0', 0]); editor.selectMany([0, '0']);
  expect(set).toHaveBeenCalledTimes(2); expect(remove).not.toHaveBeenCalled(); expect(first).toHaveBeenCalledOnce();
  expect(first.mock.calls[0]![0].selectedFeatureIds).toEqual([0, '0']);
  editor.getSelection()[0]!.geometry.coordinates.length = 0; editor.getState().selectedFeatureIds.length = 0;
  expect(editor.getSelection()).toHaveLength(2); expect(editor.getSelection()[0]!.geometry.coordinates.length).toBeGreaterThan(0);
  expect(() => editor.selectMany(['far', 'missing'])).toThrow(); expect(editor.getState().selectedFeatureIds).toEqual([0, '0']);
  expect(editor.editSelected()).toBe(false); expect(editor.splitSelected()).toBe(false);
  expect(() => editor.deleteSelected()).toThrow('deleteSelection');
  editor.toggleSelection(0); expect(remove).toHaveBeenCalledOnce(); expect(set).toHaveBeenCalledTimes(2);
  expect(editor.getSelected()?.id).toBe('0'); expect(upload).not.toHaveBeenCalled();
});

it('deletes a group with one upload/transaction and restores data/order with one keyboard Undo', async () => {
  await fixture(); const saved = editor.exportGeoJSON(); editor.selectMany(['0', 0]);
  const deleted = vi.fn(); const changed = vi.fn(); const observed = vi.fn<(event: TransactionEvent) => void>();
  editor.onDelete(deleted); editor.onChange(changed);
  editor.onTransaction((event) => { event.changes.length = 0; }); editor.onTransaction(observed);
  const upload = vi.spyOn(source(), 'setData');
  const input = document.createElement('input'); container.append(input); input.focus();
  await userEvent.keyboard('{Delete}'); expect(editor.getSelection()).toHaveLength(2);
  map.getCanvas().focus(); await userEvent.keyboard('{Delete}');
  expect(editor.exportGeoJSON().features).toEqual([saved.features[2]]);
  expect(editor.getState()).toMatchObject({ selectedFeatureIds: [], selectedFeatureId: null, dataRevision: 2 });
  expect(upload).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce(); expect(deleted).not.toHaveBeenCalled();
  expect(observed).toHaveBeenCalledOnce(); expect(observed.mock.calls[0]![0].changes).toHaveLength(2);
  expect(marker(0)).not.toMatchObject({ selected: true }); expect(marker('0')).not.toMatchObject({ selected: true });
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(saved);
  expect(editor.getSelection()).toEqual([]); expect(editor.getState().canUndo).toBe(false);
  await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}'); expect(editor.exportGeoJSON().features).toEqual([saved.features[2]]);
});

it.each(['Escape', 'blur', 'pointercancel', 'lostpointercapture', 'style', 'camera', 'cancel', 'destroy'] as const)(
  'cancels the rectangle on %s and restores pre-existing gesture settings', async (reason) => {
    await fixture(); editor.selectMany([0, 'far']); map.dragPan.disable(); map.boxZoom.disable();
    let pointerId = -1;
    map.getCanvas().addEventListener('pointerdown', (event) => { pointerId = event.pointerId; }, { once: true });
    await userEvent.keyboard('{Shift>}'); await commands.vertexPointer('down', 150, 150); await commands.vertexPointer('move', 250, 250);
    expect(box()).not.toBeNull();
    if (reason === 'Escape') await userEvent.keyboard('{Escape}');
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'pointercancel' || reason === 'lostpointercapture') map.getCanvas().dispatchEvent(new PointerEvent(reason, { pointerId }));
    if (reason === 'style') {
      const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
      map.setStyle(style(), { diff: false }); await loaded;
      expect(marker(0)).toMatchObject({ selected: true }); expect(marker('far')).toMatchObject({ selected: true });
    }
    if (reason === 'camera') map.jumpTo({ zoom: 14 });
    if (reason === 'cancel') editor.cancel();
    if (reason === 'destroy') editor.destroy();
    expect(box()).toBeNull(); expect(map.dragPan.isEnabled()).toBe(false); expect(map.boxZoom.isEnabled()).toBe(false);
    expect(map.getCanvas().hasPointerCapture(pointerId)).toBe(false);
    await commands.vertexPointer('up', 250, 250); await userEvent.keyboard('{/Shift}');
    expect(editor.getState().selectedFeatureIds).toEqual(reason === 'destroy' ? [] : [0, 'far']);
    expect(editor.getState().canUndo).toBe(false);
  },
);

it('ignores stale hits and host layers, preserves an empty rectangle selection, and aborts on API mutations', async () => {
  await fixture();
  const stale = map.queryRenderedFeatures({ layers: [sourceId()] });
  editor.selectMany([0, '0']); editor.deleteSelection(); editor.select('far');
  const query = vi.spyOn(map, 'queryRenderedFeatures').mockReturnValue(stale);
  await userEvent.keyboard('{Shift>}'); await drag(150, 150, 250, 250); await click(200, 250); await userEvent.keyboard('{/Shift}');
  expect(editor.getState().selectedFeatureIds).toEqual(['far']); query.mockRestore();
  map.addSource('host', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: {
    type: 'LineString', coordinates: [position([100, 350]), position([300, 350])],
  } } }); map.addLayer({ id: 'host', source: 'host', type: 'line' });
  await userEvent.keyboard('{Shift>}'); await drag(80, 330, 320, 380); await userEvent.keyboard('{/Shift}');
  expect(editor.getState().selectedFeatureIds).toEqual(['far']);
  await userEvent.keyboard('{Shift>}'); await commands.vertexPointer('down', 480, 80); await commands.vertexPointer('move', 620, 120);
  editor.draw('LineString'); expect(box()).toBeNull(); expect(editor.getState().selectedFeatureIds).toEqual([]);
  await commands.vertexPointer('up', 620, 120); await userEvent.keyboard('{/Shift}');
  expect(editor.getDraft()).toEqual([]); editor.cancel();
});

it('preserves normal pan, ignores other modifiers, and leaves drawing/editing/splitting selections protected', async () => {
  await fixture(); editor.selectMany([0, '0']);
  await userEvent.keyboard('{Control>}{Shift>}'); await click(550, 100); await userEvent.keyboard('{/Shift}{/Control}');
  expect(editor.getState().selectedFeatureIds).toEqual([0, '0']);
  const center = map.getCenter().toArray(); await drag(550, 300, 600, 350); map.stop();
  expect(map.getCenter().toArray()).not.toEqual(center); expect(editor.getState().selectedFeatureIds).toEqual([0, '0']);
  for (const mode of ['draw', 'edit', 'split']) {
    editor.select(0);
    if (mode === 'draw') editor.draw('LineString'); else if (mode === 'edit') editor.editSelected(); else editor.splitSelected();
    const before = editor.getState();
    await userEvent.keyboard('{Shift>}'); await click(350, 180); await userEvent.keyboard('{/Shift}');
    expect(box()).toBeNull(); expect(editor.getState()).toEqual(before);
    expect(() => editor.selectMany([0, '0'])).toThrow('Finish or cancel'); editor.cancel();
  }
});

it('exposes the multi-selection contract and transaction events on the LineEditor facade', async () => {
  editor.destroy(); const legacy = new LineEditor(map);
  try {
    for (const y of [100, 200]) { legacy.startLine(); await click(100, y); await click(300, y); legacy.finish(); }
    const saved = legacy.exportGeoJSON(); const ids = saved.features.map((feature) => feature.id);
    legacy.selectMany(ids); expect(legacy.getSelection()).toEqual(saved.features); expect(legacy.getSelected()).toBeNull();
    const event = vi.fn(); legacy.onTransaction(event); legacy.deleteSelection();
    expect(event).toHaveBeenCalledOnce(); legacy.undo(); expect(legacy.exportGeoJSON()).toEqual(saved);
    legacy.toggleSelection(ids[0]!); expect(legacy.getSelected()?.id).toBe(ids[0]);
  } finally { legacy.destroy(); }
});
