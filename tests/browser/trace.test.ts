import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] });
const sourceId = (suffix: string) => Object.keys(map.getStyle().sources).find((id) => id.endsWith(suffix))!;
const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).wrap().toArray();
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const hover = (x: number, y: number) => userEvent.hover(map.getCanvas(), { position: { x, y } });
const preview = async () => {
  const data = await map.getSource<GeoJSONSource>(sourceId('-draft'))!.getData();
  if (data.type !== 'FeatureCollection') throw new Error('Expected preview collection');
  return data.features.find((f) => f.geometry.type === 'LineString')?.geometry;
};
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, center: [4.895, 52.372], zoom: 13, style: style(), fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true }, tracing: { enabled: true } });
  editor.importGeoJSON({ type: 'Feature', id: 0, properties: { name: 'parcel' }, geometry: { type: 'Polygon', coordinates: [
    [[100, 100], [100, 350], [500, 350], [500, 100], [100, 100]].map((point) => coordinate(point[0]!, point[1]!)),
  ] } }); editor.clearHistory();
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });
it('previews and inserts the source corners, emits one creation and supports exact Undo/Redo', async () => {
  const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId('-features'))!, 'setData');
  const create = vi.fn(); const history = vi.fn(); const transaction = vi.fn();
  editor.onCreate(create); editor.onHistory(history); editor.onTransaction(transaction);
  editor.draw('LineString'); await click(300, 355); const start = editor.getDraft()[0]!;
  await hover(505, 230);
  await expect.poll(() => editor.getTracePreview()?.length).toBe(3);
  const route = editor.getTracePreview()!;
  expect(route[1]).toEqual(coordinate(500, 350));
  editor.getTracePreview()![0]![0] = 90; expect(editor.getTracePreview()).toEqual(route);
  await expect.poll(preview).toEqual({ type: 'LineString', coordinates: route });
  expect(editor.getDraft()).toEqual([start]); expect(editor.getState().canFinish).toBe(false);
  expect(editor.getState().dataRevision).toBe(revision); expect(editor.exportGeoJSON()).toEqual(before); expect(upload).not.toHaveBeenCalled();
  await click(505, 230); expect(editor.getDraft()).toEqual(route); expect(editor.getState().canFinish).toBe(true);
  await userEvent.keyboard('{Enter}'); expect(create).toHaveBeenCalledOnce(); expect(upload).toHaveBeenCalledOnce(); expect(transaction).not.toHaveBeenCalled();
  const after = editor.exportGeoJSON(); expect(after.features[0]).toEqual(before.features[0]); expect(after.features[1]!.geometry.coordinates).toEqual(route);
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Control>}y{/Control}'); expect(editor.exportGeoJSON()).toEqual(after); expect(history).toHaveBeenCalledTimes(2);
});
it('switches ring routes before a click and Backspace removes the whole traced section', async () => {
  editor.draw('LineString'); await click(300, 350); await hover(500, 230);
  const shorter = editor.getTracePreview()!; expect(shorter).toHaveLength(3);
  editor.setTracing({ side: 'longer' }); const longer = editor.getTracePreview()!; expect(longer).toHaveLength(5);
  await expect.poll(preview).toEqual({ type: 'LineString', coordinates: longer });
  await click(500, 230); expect(editor.getDraft()).toEqual(longer);
  await userEvent.keyboard('{Backspace}'); expect(editor.getDraft()).toEqual([shorter[0]]);
  expect(editor.getState().canFinish).toBe(false); editor.setTracing({ side: 'shorter' });
  await click(500, 230); expect(editor.getDraft()).toEqual(shorter); await userEvent.keyboard('{Escape}');
  expect(editor.getState()).toMatchObject({ mode: 'idle', canUndo: false }); expect(editor.getTracePreview()).toBeNull();
});
it('supports Alt bypass, snapping/tracing toggles and free segments without inserting corners', async () => {
  editor.draw('LineString'); await click(300, 350); await hover(500, 230); expect(editor.getTracePreview()).toHaveLength(3);
  await userEvent.keyboard('{Alt>}'); await expect.poll(() => editor.getTracePreview()).toBeNull();
  await click(500, 230); expect(editor.getDraft()).toHaveLength(2); await userEvent.keyboard('{/Alt}');
  editor.cancel(); editor.draw('LineString'); await click(300, 350);
  editor.setTracing({ enabled: false }); await click(500, 230); expect(editor.getDraft()).toHaveLength(2);
  editor.cancel(); editor.setTracing({ enabled: true }); editor.draw('LineString'); await click(300, 350);
  editor.setSnapping({ enabled: false }); await hover(500, 230); expect(editor.getTracePreview()).toBeNull();
  await click(500, 230); expect(editor.getDraft()).toHaveLength(2);
  expect(() => editor.setTracing({ side: 'invalid' as 'shorter' })).toThrow(); expect(editor.getTracing().side).toBe('shorter');
});
it('does not jump between source features, rings or multipart components', async () => {
  editor.importGeoJSON({ type: 'Feature', id: 'lines', properties: null, geometry: { type: 'MultiLineString', coordinates: [
    [coordinate(200, 200), coordinate(300, 180), coordinate(400, 200)],
    [coordinate(200, 250), coordinate(300, 270), coordinate(400, 250)],
  ] } });
  editor.draw('LineString'); await click(200, 200); await hover(400, 250); expect(editor.getTracePreview()).toBeNull();
  await click(400, 250); expect(editor.getDraft()).toHaveLength(2);
  await click(200, 250); expect(editor.getDraft().slice(-2)).toEqual([coordinate(300, 270), coordinate(200, 250)]);
  await click(100, 100); expect(editor.getDraft()).toHaveLength(5);
});
it('traces polygon closure, validates the result and removes the trace as one step through the API', async () => {
  editor.draw('Polygon'); await click(300, 350); await click(500, 230); await click(600, 150);
  // Reattach before closing. The closing click follows the boundary from here back to the first point.
  await click(100, 230); await hover(300, 350);
  expect(editor.getTracePreview()).toHaveLength(3); await click(300, 350);
  expect(editor.getState().mode).toBe('idle'); expect(editor.exportGeoJSON().features).toHaveLength(2);
  editor.draw('LineString'); expect(editor.traceBoundary({ featureId: 0 }, coordinate(300, 350), coordinate(500, 230))).toBe(true);
  expect(editor.removeLastDrawStep()).toBe(true); expect(editor.getDraft()).toEqual([]);
});
it('refreshes projected acquisition after camera/style changes and cleans up after destruction/remount', async () => {
  const start = coordinate(300, 350); const end = coordinate(500, 230);
  editor.draw('LineString'); await click(300, 350);
  map.jumpTo({ bearing: 25 }); const endpoint = map.project(end); await hover(endpoint.x, endpoint.y);
  await expect.poll(() => editor.getTracePreview()?.length).toBe(3); const expected = editor.getTracePreview();
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(preview).toEqual({ type: 'LineString', coordinates: expected });
  await click(endpoint.x, endpoint.y); expect(editor.getDraft()[0]).toEqual(start);
  editor.destroy(); expect(editor.getTracePreview()).toBeNull(); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  expect(() => editor.setTracing({ enabled: true })).toThrow('destroyed'); expect(() => editor.traceBoundary({ featureId: 0 }, start, end)).toThrow('destroyed');
  await new Promise((resolve) => requestAnimationFrame(resolve)); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  editor = new GeometryEditor(map); expect(editor.getTracing()).toEqual({ enabled: false, side: 'shorter' });
  editor.draw('LineString'); map.remove(); expect(editor.getState().mode).toBe('idle');
});

it('traces oblique edges after planar projection and isolates hole-ring acquisition', async () => {
  const a = coordinate(180, 160); const b = coordinate(330, 190); const c = coordinate(400, 300);
  editor.importGeoJSON({ type: 'Feature', id: 'diagonal', properties: null, geometry: { type: 'LineString', coordinates: [a, b, c] } });
  editor.draw('LineString'); await click(240, 172); const start = editor.getDraft()[0]!;
  await click(400, 300); expect(editor.getDraft()).toEqual([start, b, c]); editor.cancel();
  editor.importGeoJSON({ type: 'Feature', id: 'hole-source', properties: null, geometry: { type: 'Polygon', coordinates: [
    [[20, 20], [20, 430], [680, 430], [680, 20], [20, 20]].map(([x, y]) => coordinate(x!, y!)),
    [[220, 220], [380, 220], [380, 310], [220, 310], [220, 220]].map(([x, y]) => coordinate(x!, y!)),
  ] } });
  editor.draw('LineString'); await click(300, 310); expect(editor.getSnap()).toMatchObject({ featureId: 'hole-source', ringIndex: 1 });
  await click(380, 250); expect(editor.getDraft()).toHaveLength(3); expect(editor.getDraft()[1]).toEqual(coordinate(380, 310));
  await hover(680, 250); expect(editor.getTracePreview()).toBeNull();
});
