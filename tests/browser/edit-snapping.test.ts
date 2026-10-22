import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type GeometryFeature, type SnapResult } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

declare module 'vitest/browser' {
  interface BrowserCommands {
    vertexPointer(action: 'down' | 'move' | 'up', x: number, y: number): Promise<void>;
  }
}
setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).wrap().toArray();
const source = (suffix: string) => map.getSource<GeoJSONSource>(Object.keys(map.getStyle().sources).find((id) => id.endsWith(suffix))!)!;
const drag = (x: number, y: number, toX: number, toY: number) => userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), {
  sourcePosition: { x, y }, targetPosition: { x: toX, y: toY },
});
function setup(polygon = false): GeometryFeature[] {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { nested: { name: 'edited' } }, geometry: polygon
      ? { type: 'Polygon', coordinates: [[[400, 150], [600, 150], [600, 350], [400, 350], [400, 150]].map(([x, y]) => coordinate(x!, y!))] }
      : { type: 'LineString', coordinates: [coordinate(400, 150), coordinate(600, 150)] } },
    { type: 'Feature', id: '0', properties: { target: true }, geometry: { type: 'Polygon', coordinates: [
      [[100, 100], [100, 300], [300, 300], [300, 100], [100, 100]].map(([x, y]) => coordinate(x!, y!)),
    ] } },
  ] });
  editor.clearHistory(); editor.select(0); editor.editSelected();
  return editor.exportGeoJSON().features;
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true } });
});
afterEach(async () => {
  await commands.vertexPointer('up', 650, 400);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});

it.each([false, true])('snaps an edited vertex (polygon=%s), saves once, and replays exact geometry/properties', async (polygon) => {
  const original = setup(polygon);
  const update = vi.fn(); editor.onUpdate(update);
  const upload = vi.spyOn(source('-features'), 'setData');
  const center = map.getCenter().toArray();
  await commands.vertexPointer('down', 400, 150);
  await commands.vertexPointer('move', 308, 106);
  await expect.poll(() => editor.getSnap()).toMatchObject({ kind: 'vertex', featureId: '0', coordinate: coordinate(300, 100) });
  await expect.poll(() => editor.getDraft()).toContainEqual(coordinate(300, 100));
  await expect.poll(async () => JSON.stringify(await source('-draft').getData())).toContain('"kind":"snap"');
  expect(editor.exportGeoJSON().features).toEqual(original); expect(upload).not.toHaveBeenCalled();
  expect(map.getCenter().toArray()).toEqual(center); expect(map.dragPan.isEnabled()).toBe(false);
  await commands.vertexPointer('up', 308, 106);
  expect(editor.getSnap()).toBeNull(); expect(map.dragPan.isEnabled()).toBe(true);
  const saved = editor.finish(); expect(saved?.id).toBe(0); expect(saved?.properties).toEqual(original[0]!.properties);
  expect(upload).toHaveBeenCalledOnce(); expect(update).toHaveBeenCalledExactlyOnceWith(saved);
  expect(editor.exportGeoJSON().features[1]).toEqual(original[1]);
  editor.undo(); expect(editor.exportGeoJSON().features).toEqual(original);
  editor.redo(); expect(editor.exportGeoJSON().features).toEqual([saved, original[1]]);
});

it('snaps a newly inserted midpoint to an edge without changing the target', async () => {
  const original = setup();
  await drag(500, 150, 308, 200);
  expect(editor.getDraft()).toHaveLength(3);
  const point = map.project(editor.getDraft()[1]!);
  expect(point.x).toBeCloseTo(300, 5); expect(point.y).toBeCloseTo(200, 5);
  expect(editor.exportGeoJSON().features).toEqual(original);
  editor.finish(); expect(editor.exportGeoJSON().features[1]).toEqual(original[1]);
});

it('excludes the entire edited feature, including its old vertices and edges, and leaves API coordinates exact', async () => {
  setup();
  await drag(400, 150, 407, 155);
  expect(editor.getDraft()[0]).toEqual(coordinate(407, 155));
  await drag(407, 155, 550, 155);
  expect(editor.getDraft()[0]).toEqual(coordinate(550, 155));
  const exact = coordinate(308, 106);
  editor.moveVertex(0, exact); expect(editor.getDraft()[0]).toEqual(exact);
  editor.insertVertex(1, coordinate(308, 200)); expect(editor.getDraft()[1]).toEqual(coordinate(308, 200));
  expect(editor.getSnap()).toBeNull();
});

it('recalculates a stationary drag for Alt and live option changes, and permits Alt from gesture start', async () => {
  setup();
  await userEvent.keyboard('{Alt>}');
  await commands.vertexPointer('down', 400, 150);
  await commands.vertexPointer('move', 308, 106);
  await expect.poll(() => editor.getDraft()[0]).toEqual(coordinate(308, 106));
  expect(editor.getSnap()).toBeNull();
  await userEvent.keyboard('{/Alt}');
  await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  await expect.poll(() => editor.getDraft()[0]).toEqual(coordinate(300, 100));
  await userEvent.keyboard('{Alt>}');
  await expect.poll(() => editor.getSnap()).toBeNull();
  await expect.poll(() => editor.getDraft()[0]).toEqual(coordinate(308, 106));
  await userEvent.keyboard('{/Alt}');
  await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  editor.setSnapping({ vertices: false });
  await expect.poll(() => editor.getSnap()?.kind).toBe('edge');
  editor.setSnapping({ enabled: false });
  await expect.poll(() => editor.getSnap()).toBeNull();
  await expect.poll(() => editor.getDraft()[0]).toEqual(coordinate(308, 106));
  editor.setSnapping({ enabled: true, vertices: true });
  await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  await commands.vertexPointer('up', 208, 108);
  const released = map.project(editor.getDraft()[0]!);
  expect(released.x).toBeCloseTo(208, 5); expect(released.y).toBeCloseTo(100, 5);
});

it.each(['blur', 'pointercancel', 'lostpointercapture', 'style', 'cancel', 'destroy'] as const)('clears snapping and restores a dragged midpoint on %s', async (reason) => {
  const original = setup(); const draft = editor.getDraft();
  map.dragPan.disable();
  let pointerId = -1;
  map.getCanvas().addEventListener('pointerdown', (event) => { pointerId = event.pointerId; }, { once: true });
  await commands.vertexPointer('down', 500, 150);
  await commands.vertexPointer('move', 308, 106);
  await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  if (reason === 'blur') window.dispatchEvent(new Event('blur'));
  if (reason === 'pointercancel' || reason === 'lostpointercapture') map.getCanvas().dispatchEvent(new PointerEvent(reason, { pointerId }));
  if (reason === 'style') {
    const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
    map.setStyle(style(), { diff: false }); await loaded;
  }
  if (reason === 'cancel') editor.cancel();
  if (reason === 'destroy') editor.destroy();
  expect(editor.getSnap()).toBeNull(); expect(map.dragPan.isEnabled()).toBe(false);
  expect(editor.exportGeoJSON().features).toEqual(original);
  expect(editor.getDraft()).toEqual(reason === 'cancel' || reason === 'destroy' ? [] : draft);
  await commands.vertexPointer('up', 308, 106);
  expect(editor.getState().canUndo).toBe(false);
});

it('keeps invalid snapped polygons editable and cancellation preserves redo', async () => {
  setup(true); editor.cancel();
  editor.applyTransaction({ create: [{ type: 'Feature', id: 'extra', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] });
  editor.undo(); const original = editor.exportGeoJSON(); editor.editSelected();
  await drag(600, 350, 108, 306);
  expect(editor.getDraft()).toContainEqual(coordinate(100, 300));
  expect(editor.getState()).toMatchObject({ canFinish: false, validationError: 'self-intersection' });
  expect(editor.finish()).toBeNull(); expect(editor.getState().mode).toBe('edit-polygon');
  editor.cancel(); expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getState().canRedo).toBe(true);
});

it.each([6, 17])('refreshes a captured drag after camera changes at zoom %s with a CSS-pixel tolerance', async (zoom) => {
  setup(); const target = coordinate(300, 100);
  // Keep the tested vertex isolated even at zoom 6, where the square's corners
  // would otherwise all be within the tolerance and compete by distance.
  editor.cancel();
  editor.applyTransaction({ update: [{ type: 'Feature', id: '0', properties: {}, geometry: {
    type: 'LineString', coordinates: [target, [target[0] + 10, target[1]]],
  } }] });
  editor.editSelected();
  editor.setSnapping({ edges: false });
  await commands.vertexPointer('down', 400, 150); await commands.vertexPointer('move', 308, 106);
  await expect.poll(() => editor.getSnap()?.coordinate).toEqual(target);
  map.jumpTo({ center: target, zoom, bearing: 30, pitch: 40 });
  await expect.poll(() => editor.getSnap()).toBeNull();
  await commands.vertexPointer('move', 365, 225);
  await expect.poll(() => editor.getSnap()?.coordinate).toEqual(target);
  await expect.poll(() => editor.getDraft()[0]).toEqual(target);
  await commands.vertexPointer('move', 370, 225);
  await expect.poll(() => editor.getSnap()).toBeNull();
  editor.cancel();
});

it('reuses targets while dragging and excludes the next selected feature without a revision change', async () => {
  setup();
  await commands.vertexPointer('down', 400, 150); await commands.vertexPointer('move', 308, 106);
  await expect.poll(() => editor.getSnap()?.featureId).toBe('0');
  const project = vi.spyOn(map, 'project');
  await commands.vertexPointer('move', 309, 106);
  // Rendering projects draft handles; saved target vertices must not be reprojected.
  await expect.poll(() => editor.getSnap()?.distance).toBeCloseTo(Math.hypot(9, 6), 5);
  expect(project.mock.calls.some(([point]) => Array.isArray(point) && point[0] === coordinate(100, 300)[0] && point[1] === coordinate(100, 300)[1])).toBe(false);
  editor.cancel(); editor.select('0'); editor.editSelected();
  await commands.vertexPointer('up', 309, 106);
  await drag(300, 100, 407, 155);
  expect(editor.getDraft()).toContainEqual(coordinate(400, 150));
});

it('allows snap observers to cancel an active gesture without a late move or stale indicator', async () => {
  const original = setup(); const observed = vi.fn<(snap: SnapResult | null) => void>();
  editor.onSnap(observed); editor.onSnap((snap) => { if (snap) editor.cancel(); });
  await drag(400, 150, 308, 106);
  expect(observed).toHaveBeenCalled(); expect(editor.getState().mode).toBe('idle');
  expect(editor.getSnap()).toBeNull(); expect(editor.exportGeoJSON().features).toEqual(original);
  expect(map.dragPan.isEnabled()).toBe(true);
});
