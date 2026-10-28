import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, LineEditor, type PolygonFeature, type SnapResult } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const source = (suffix: string) => map.getSource<GeoJSONSource>(Object.keys(map.getStyle().sources).find((id) => id.endsWith(suffix))!)!;
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const hover = (x: number, y: number) => userEvent.hover(map.getCanvas(), { position: { x, y } });
const square = (): PolygonFeature => ({ type: 'Feature', id: 'target', properties: { preserved: true }, geometry: { type: 'Polygon', coordinates: [
  [[100, 100], [100, 300], [300, 300], [300, 100], [100, 100]].map((point) => map.unproject(point as [number, number]).toArray()),
] } });

beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true } }); editor.importGeoJSON(square()); editor.clearHistory();
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('previews and commits exact vertices and edge points, with unchanged targets and one undo action', async () => {
  const original = editor.exportGeoJSON().features[0]!;
  const coordinate = (original as PolygonFeature).geometry.coordinates[0]![0]!;
  const upload = vi.spyOn(source('-features'), 'setData');
  editor.draw('Polygon');
  await hover(106, 105);
  await expect.poll(() => editor.getSnap()).toMatchObject({ kind: 'vertex', featureId: 'target', coordinate });
  await expect.poll(async () => JSON.stringify(await source('-draft').getData())).toContain('"kind":"snap"');
  expect(editor.getState().dataRevision).toBe(1); expect(upload).not.toHaveBeenCalled();
  await click(106, 105); expect(editor.getDraft()[0]).toEqual(coordinate);
  await hover(200, 109);
  await expect.poll(() => editor.getSnap()?.kind).toBe('edge');
  const edge = editor.getSnap()!.coordinate;
  expect(map.project(edge).x).toBeCloseTo(200, 5); expect(map.project(edge).y).toBeCloseTo(100, 5);
  await click(200, 109); expect(editor.getDraft()[1]).toEqual(edge);
  await click(450, 220); const created = editor.finish() as PolygonFeature;
  expect(created.geometry.coordinates[0]).toContainEqual(coordinate); expect(created.geometry.coordinates[0]).toContainEqual(edge);
  expect(editor.exportGeoJSON().features[0]).toEqual(original); expect(upload).toHaveBeenCalledOnce(); expect(editor.getSnap()).toBeNull();
  editor.undo(); expect(editor.exportGeoJSON().features).toEqual([original]);
  editor.redo(); expect(editor.exportGeoJSON().features).toEqual([original, created]);
});

it('resolves clicks afresh, prioritizes vertices, and closes at the draft start without adding a corner', async () => {
  editor.draw('Polygon');
  await hover(200, 105); await expect.poll(() => editor.getSnap()?.kind).toBe('edge');
  await click(117, 101); // Vertex wins even though the edge is closer.
  expect(editor.getDraft()[0]).toEqual(square().geometry.coordinates[0]![0]);
  await click(450, 100); await click(450, 300);
  await hover(112, 105);
  await expect.poll(() => editor.getSnap()).toMatchObject({ kind: 'vertex', featureId: null, index: 0 });
  await click(112, 105);
  expect(editor.getState().mode).toBe('idle');
  const feature = editor.exportGeoJSON().features[1] as PolygonFeature;
  expect(feature.geometry.coordinates[0]).toHaveLength(4);
});

it('temporarily bypasses snapping with Alt and clears the marker on leave, blur, and cancel', async () => {
  editor.draw('LineString'); await hover(108, 106);
  await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  await userEvent.keyboard('{Alt>}'); await expect.poll(() => editor.getSnap()).toBeNull();
  await click(108, 106); expect(editor.getDraft()[0]).toEqual(map.unproject([108, 106]).wrap().toArray());
  await userEvent.keyboard('{/Alt}'); await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  await userEvent.unhover(map.getCanvas()); await expect.poll(() => editor.getSnap()).toBeNull();
  await hover(108, 106); await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  window.dispatchEvent(new Event('blur')); expect(editor.getSnap()).toBeNull();
  await hover(109, 106); await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  editor.cancel(); expect(editor.getSnap()).toBeNull();
  await expect.poll(async () => JSON.stringify(await source('-draft').getData())).not.toContain('"kind":"snap"');
  expect(editor.getState()).toMatchObject({ featureCount: 1, canUndo: false });
});

it('applies toggles immediately, validates atomically, and isolates event/getter snapshots', async () => {
  const ignored = vi.fn(); editor.onSnap(ignored)();
  editor.onSnap((snap) => { if (snap) snap.coordinate[0] = 99; });
  const observed = vi.fn<(snap: SnapResult | null) => void>(); editor.onSnap(observed);
  editor.draw('LineString'); await hover(108, 106);
  await expect.poll(() => observed.mock.calls.length).toBe(1);
  expect(observed.mock.calls[0]![0]!.coordinate[0]).not.toBe(99);
  editor.getSnap()!.coordinate[0] = 99; editor.getSnapping().enabled = false;
  expect(editor.getSnap()!.coordinate[0]).not.toBe(99); expect(editor.getSnapping().enabled).toBe(true);
  await hover(109, 106); await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(observed).toHaveBeenCalledOnce(); expect(ignored).not.toHaveBeenCalled();
  editor.setSnapping({ vertices: false }); expect(editor.getSnap()?.kind).toBe('edge');
  editor.setSnapping({ enabled: false }); expect(editor.getSnap()).toBeNull();
  await click(109, 106); expect(editor.getDraft()[0]).toEqual(map.unproject([109, 106]).wrap().toArray());
  const before = editor.getSnapping(); expect(() => editor.setSnapping({ distance: 0, enabled: true })).toThrow(RangeError);
  expect(editor.getSnapping()).toEqual(before);
  editor.setSnapping({ enabled: true, vertices: true, edges: false });
  await hover(200, 108); await expect.poll(() => editor.getSnap()).toBeNull();
  expect(editor.getState().dataRevision).toBe(1);
});

it('keeps tolerance in CSS pixels through zoom/rotation/pitch and invalidates projected candidates', async () => {
  const target = square().geometry.coordinates[0]![0]!;
  editor.draw('LineString'); await hover(108, 106); await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  const project = vi.spyOn(map, 'project');
  await hover(110, 106); await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(project).not.toHaveBeenCalled();
  editor.cancel(); editor.select('target'); editor.deleteSelected();
  editor.importGeoJSON({ type: 'Feature', id: 'isolated', properties: {}, geometry: { type: 'LineString', coordinates: [target, [target[0] + 10, target[1]]] } });
  editor.draw('LineString');
  editor.setSnapping({ edges: false });
  for (const zoom of [6, 17]) {
    map.jumpTo({ center: target, zoom, bearing: 30, pitch: 40 });
    await hover(365, 225); await expect.poll(() => editor.getSnap()?.coordinate).toEqual(target);
    await hover(370, 225); await expect.poll(() => editor.getSnap()).toBeNull();
  }
  expect(project).toHaveBeenCalled();
});

it('rebuilds targets after deletion, undo, edits and import; ignores draft and host geometries', async () => {
  editor.draw('LineString'); await hover(108, 105); await expect.poll(() => editor.getSnap()?.featureId).toBe('target'); editor.cancel();
  editor.select('target'); editor.deleteSelected();
  editor.draw('LineString'); await hover(108, 105); await expect.poll(() => editor.getSnap()).toBeNull(); editor.cancel();
  editor.undo(); editor.select('target'); editor.editSelected(); editor.moveVertex(0, map.unproject([50, 50]).toArray()); editor.finish();
  editor.draw('LineString'); await hover(55, 55); await expect.poll(() => editor.getSnap()?.coordinate).toEqual(map.unproject([50, 50]).toArray()); editor.cancel();
  editor.importGeoJSON({ type: 'Feature', id: 7, properties: {}, geometry: { type: 'LineString', coordinates: [[500, 100], [600, 100]].map((p) => map.unproject(p as [number, number]).toArray()) } });
  map.addSource('host', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [map.unproject([500, 300]).toArray(), map.unproject([600, 300]).toArray()] } } });
  map.addLayer({ id: 'host', type: 'line', source: 'host' });
  editor.draw('LineString'); await hover(550, 108); await expect.poll(() => editor.getSnap()).toMatchObject({ featureId: 7, kind: 'edge' });
  await click(500, 300); await hover(505, 305); await expect.poll(() => editor.getSnap()).toBeNull();
});

it('restores the indicator after style replacement and cleans up pending frames/listeners on destroy', async () => {
  editor.draw('LineString'); await hover(108, 105); await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(async () => JSON.stringify(await source('-draft').getData())).toContain('"kind":"snap"');
  const listener = vi.fn(); editor.onSnap(listener); editor.destroy();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' })); window.dispatchEvent(new Event('blur'));
  expect(listener).not.toHaveBeenCalled(); expect(editor.getSnap()).toBeNull();
  expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(['background']);
  expect(() => editor.setSnapping({ enabled: true })).toThrow('destroyed'); expect(() => editor.onSnap(vi.fn())).toThrow('destroyed');
});

it('keeps the library opt-in, validates before mounting, and exposes snapping on the line facade', async () => {
  editor.destroy();
  expect(() => new GeometryEditor(map, { snapping: { distance: -1 } })).toThrow(RangeError);
  expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(['background']);
  editor = new GeometryEditor(map); editor.importGeoJSON(square()); editor.draw('LineString');
  await click(108, 105); expect(editor.getSnap()).toBeNull(); expect(editor.getDraft()[0]).toEqual(map.unproject([108, 105]).wrap().toArray());
  editor.destroy();
  const legacy = new LineEditor(map, { snapping: { enabled: true } });
  try {
    legacy.startLine(); await click(100, 100); await click(300, 100); legacy.finish();
    legacy.startLine(); await hover(108, 105);
    await expect.poll(() => legacy.getSnap()?.kind).toBe('vertex');
    const event = vi.fn(); legacy.onSnap(event); legacy.setSnapping({ enabled: false });
    expect(legacy.getSnapping().enabled).toBe(false); expect(event).toHaveBeenCalledWith(null);
  } finally { legacy.destroy(); }
});
