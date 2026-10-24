import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, LineEditor, type Coordinate, type LineFeature } from '../../src/index.js';
import { project } from '../../src/core/mercator-transform.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] });
const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).wrap().toArray();
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const hover = (x: number, y: number) => userEvent.hover(map.getCanvas(), { position: { x, y } });
const source = (suffix: string) => map.getSource<GeoJSONSource>(Object.keys(map.getStyle().sources).find(id => id.endsWith(suffix))!)!;
const preview = async () => {
  const data = await source('-draft').getData();
  if (data.type !== 'FeatureCollection') throw new Error('Expected collection');
  return data.features.find(f => f.geometry.type === 'LineString')?.geometry;
};
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { drawingConstraints: { enabled: true, angleStep: 90 } });
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('previews the constrained endpoint and commits it once with exact Undo/Redo', async () => {
  const uploaded = vi.spyOn(source('-features'), 'setData'); const created = vi.fn(); editor.onCreate(created);
  editor.draw('LineString'); await click(150, 150); const anchor = editor.getDraft()[0]!;
  await hover(350, 210);
  await expect.poll(preview).toMatchObject({ type: 'LineString' });
  const geometry = await preview(); if (geometry?.type !== 'LineString') throw new Error('Expected line');
  const endpoint = geometry.coordinates[1] as Coordinate;
  expect(map.project(endpoint).y).toBeCloseTo(150, 6);
  expect(map.project(endpoint).x).toBeCloseTo(150 + Math.hypot(200, 60), 6);
  expect(editor.getDraft()).toEqual([anchor]); expect(uploaded).not.toHaveBeenCalled();
  await click(350, 210); expect(editor.getDraft()[1]).toEqual(endpoint);
  await userEvent.keyboard('{Enter}'); const after = editor.exportGeoJSON();
  expect(created).toHaveBeenCalledOnce(); expect(uploaded).toHaveBeenCalledOnce();
  editor.undo(); expect(editor.exportGeoJSON().features).toEqual([]); editor.redo(); expect(editor.exportGeoJSON()).toEqual(after);
});
it('changes steps live, bypasses with Alt and reanchors after Backspace', async () => {
  editor.draw('LineString'); await click(150, 150); await hover(300, 250);
  editor.setDrawingConstraints({ angleStep: 45 });
  await expect.poll(async () => {
    const p = await preview(); return p?.type === 'LineString' ? map.project(p.coordinates[1] as Coordinate).y : 0;
  }).toBeGreaterThan(200);
  await userEvent.keyboard('{Alt>}');
  await expect.poll(preview).toEqual({ type: 'LineString', coordinates: [coordinate(150, 150), coordinate(300, 250)] });
  await click(300, 250); expect(editor.getDraft()[1]).toEqual(coordinate(300, 250)); await userEvent.keyboard('{/Alt}');
  await userEvent.keyboard('{Backspace}'); expect(editor.getDraft()).toEqual([coordinate(150, 150)]);
  editor.setDrawingConstraints({ angleStep: 90 }); await click(300, 250);
  expect(editor.getDraft()[1]![1]).toBe(editor.getDraft()[0]![1]);
  editor.setDrawingConstraints({ enabled: false }); await click(450, 300);
  expect(editor.getDraft()[2]).toEqual(coordinate(450, 300)); editor.cancel(); expect(editor.getState().canUndo).toBe(false);
});
it('keeps exact off-angle snapping and tracing ahead of constraints', async () => {
  const points = [coordinate(150, 150), coordinate(250, 190), coordinate(400, 250)];
  editor.importGeoJSON({ type: 'Feature', id: 'path', properties: null, geometry: { type: 'LineString', coordinates: points } });
  editor.clearHistory(); editor.setSnapping({ enabled: true });
  editor.draw('LineString'); await click(150, 150); await click(250, 190);
  expect(editor.getDraft()).toEqual(points.slice(0, 2)); editor.cancel();
  editor.setTracing({ enabled: true }); editor.draw('LineString'); await click(150, 150); await hover(400, 250);
  expect(editor.getTracePreview()).toEqual(points); await click(400, 250); expect(editor.getDraft()).toEqual(points);
  editor.cancel(); expect(editor.getState().canUndo).toBe(false);
});
it('closes polygons exactly even when the closing edge is off-angle, and supports hole drawing', async () => {
  editor.draw('Polygon'); await click(100, 100); await click(400, 120); await click(420, 350);
  await click(102, 102); expect(editor.getState().mode).toBe('idle');
  const triangle = editor.exportGeoJSON().features[0]!; expect(triangle.geometry.type).toBe('Polygon');
  editor.importGeoJSON({ type: 'Feature', id: 'outer', properties: null, geometry: { type: 'Polygon', coordinates: [
    [[50, 50], [650, 50], [650, 400], [50, 400], [50, 50]].map(p => coordinate(p[0]!, p[1]!)),
  ] } }); editor.select('outer'); editor.drawHole();
  await click(180, 180); await click(320, 200); await click(330, 300);
  const draft = editor.getDraft(); expect(draft[1]![1]).toBe(draft[0]![1]); expect(draft[2]![0]).toBe(draft[1]![0]);
  await click(180, 180); expect(editor.getState().mode).toBe('idle');
  const outer = editor.exportGeoJSON().features.find(f => f.id === 'outer')!;
  if (outer.geometry.type !== 'Polygon') throw new Error('Expected polygon'); expect(outer.geometry.coordinates).toHaveLength(2);
});
it('uses map-plane directions after bearing, pitch and style changes', async () => {
  map.jumpTo({ bearing: 35, pitch: 35 }); editor.draw('LineString'); await click(180, 180);
  const anchor = editor.getDraft()[0]!; await hover(400, 270);
  const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(preview).toMatchObject({ type: 'LineString' }); await click(400, 270);
  const [a, b] = editor.getDraft().map(project); const dx = b![0] - a![0]; const dy = b![1] - a![1];
  expect(Math.min(Math.abs(dx), Math.abs(dy))).toBeLessThan(1e-12); expect(Math.hypot(dx, dy)).toBeGreaterThan(0);
  expect(editor.getDraft()[0]).toEqual(anchor); expect(editor.getDrawingConstraints().enabled).toBe(true);
});
it('blocks unsupported constrained placement without data changes and allows Alt recovery', async () => {
  map.jumpTo({ center: [179, 0], zoom: 5 }); editor.draw('LineString');
  const a = map.project([179, 0]); const b = map.project([180, 0.8]);
  await click(a.x, a.y); await hover(b.x, b.y);
  await expect.poll(preview).toBeUndefined(); await click(b.x, b.y); expect(editor.getDraft()).toHaveLength(1);
  expect(editor.getState().canFinish).toBe(false); expect(editor.exportGeoJSON().features).toHaveLength(0);
  await userEvent.keyboard('{Alt>}'); await click(b.x, b.y); await userEvent.keyboard('{/Alt}');
  expect(editor.getDraft()).toHaveLength(2);
});
it('leaves splitting and explicit vertex edits unchanged', async () => {
  editor.importGeoJSON({ type: 'Feature', id: 'parcel', properties: null, geometry: { type: 'Polygon', coordinates: [
    [[150, 100], [500, 100], [500, 350], [150, 350], [150, 100]].map(p => coordinate(p[0]!, p[1]!)),
  ] } }); editor.select('parcel'); editor.splitSelected(); await click(100, 200); await click(550, 240);
  expect(editor.getDraft()).toEqual([coordinate(100, 200), coordinate(550, 240)]); editor.cancel();
  editor.editSelected(); editor.moveVertex(0, coordinate(170, 130)); expect(editor.getDraft()[0]).toEqual(coordinate(170, 130)); editor.cancel();
});
it('validates options atomically, isolates snapshots, and cleans up destruction and remount', async () => {
  const change = vi.fn(); editor.onChange(change);
  editor.setDrawingConstraints({ enabled: true }); expect(change).not.toHaveBeenCalled();
  expect(() => editor.setDrawingConstraints({ angleStep: 30 as 45, enabled: false })).toThrow(TypeError);
  expect(editor.getDrawingConstraints()).toEqual({ enabled: true, angleStep: 90 });
  editor.getDrawingConstraints().enabled = false; expect(editor.getDrawingConstraints().enabled).toBe(true);
  editor.draw('LineString'); await click(100, 100); await hover(250, 160); editor.destroy();
  expect(() => editor.setDrawingConstraints({ enabled: false })).toThrow('destroyed');
  expect(map.doubleClickZoom.isEnabled()).toBe(true); expect(editor.getState().mode).toBe('idle');
  expect(() => new GeometryEditor(map, { drawingConstraints: { angleStep: 1 as 45 } })).toThrow(TypeError);
  editor = new GeometryEditor(map); expect(editor.getDrawingConstraints()).toEqual({ enabled: false, angleStep: 45 });
  editor.draw('LineString'); await click(100, 100); await click(250, 160); expect(editor.getDraft()[1]).toEqual(coordinate(250, 160));
  editor.destroy(); const legacy = new LineEditor(map, { drawingConstraints: { enabled: true, angleStep: 90 } });
  try {
    legacy.startLine(); await click(100, 100); await click(250, 160);
    expect((legacy.finish() as LineFeature).geometry.coordinates[1]![1]).toBe(coordinate(100, 100)[1]);
    legacy.setDrawingConstraints({ enabled: false }); expect(legacy.getDrawingConstraints().enabled).toBe(false);
  } finally { legacy.destroy(); }
});
