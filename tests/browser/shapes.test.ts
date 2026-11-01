import { Map, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type GeometryFeature, type PolygonFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const hover = (x: number, y: number) => userEvent.hover(map.getCanvas(), { position: { x, y } });
const at = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const frame = () => new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
const labels = () => [...container.querySelectorAll<HTMLElement>('.mm-measurement')].map((label) => label.textContent);
const square = (id: string, x: number, y: number, size = 100): PolygonFeature => ({ type: 'Feature', id, properties: { name: id },
  geometry: { type: 'Polygon', coordinates: [[at(x, y + size), at(x + size, y + size), at(x + size, y), at(x, y), at(x, y + size)]] },
});
const load = (...features: GeometryFeature[]) => { editor.importGeoJSON({ type: 'FeatureCollection', features }); editor.clearHistory(); };

beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative;';
  document.body.append(container);
  map = new Map({ container, center: [4.895, 52.372], zoom: 15, fadeDuration: 0,
    style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] } });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  await commands.vertexPointer('up', 690, 490);
  editor.destroy(); map.remove(); container.remove();
});

it('draws a rectangle from two clicks', async () => {
  const created = vi.fn(); editor.onCreate(created);
  editor.draw('Rectangle');
  expect(editor.getState().mode).toBe('draw-rectangle');
  await click(100, 100);
  expect(editor.getState().vertexCount).toBe(1);
  await click(300, 250);
  const feature = created.mock.calls[0]![0] as PolygonFeature;
  expect(editor.getState()).toMatchObject({ mode: 'idle', featureCount: 1 });
  const ring = feature.geometry.coordinates[0]!;
  expect(ring).toHaveLength(5);
  const [x, y] = ring.reduce(([minX, minY], [lng, lat]) => [Math.min(minX, lng), Math.min(minY, lat)], [Infinity, Infinity]);
  expect(map.project([x, y]).x).toBeCloseTo(100, 0);
  expect(map.project([x, y]).y).toBeCloseTo(250, 0);
});

it('draws a circle from its center and radius, and cancels with Escape', async () => {
  editor.draw('Circle');
  await click(300, 250);
  await userEvent.keyboard('{Escape}');
  expect(editor.getState()).toMatchObject({ mode: 'idle', featureCount: 0 });
  editor.draw('Circle');
  await click(300, 250);
  await click(380, 250);
  const [feature] = editor.exportGeoJSON().features;
  expect(feature!.geometry.type).toBe('Polygon');
  const ring = (feature as PolygonFeature).geometry.coordinates[0]!;
  expect(ring).toHaveLength(65);
  for (const point of ring) {
    const { x, y } = map.project(point);
    expect(Math.hypot(x - 300, y - 250)).toBeCloseTo(80, -0.5);
  }
});

it('draws a freehand polygon by dragging and does not select it with the trailing click', async () => {
  editor.draw('Freehand');
  expect(map.dragPan.isEnabled()).toBe(true);
  await commands.vertexPointer('down', 200, 150);
  expect(map.dragPan.isEnabled()).toBe(false);
  for (let step = 1; step <= 24; step++) {
    const angle = (step / 24) * Math.PI * 2;
    await commands.vertexPointer('move', 300 - 100 * Math.cos(angle), 150 + 80 * Math.sin(angle));
  }
  await commands.vertexPointer('up', 201, 151);
  expect(map.dragPan.isEnabled()).toBe(true);
  expect(editor.getState()).toMatchObject({ mode: 'idle', featureCount: 1, selectedFeatureIds: [] });
  const ring = (editor.exportGeoJSON().features[0] as PolygonFeature).geometry.coordinates[0]!;
  expect(ring.length).toBeGreaterThan(6);
  expect(ring.length).toBeLessThan(30);
  // A single click does not draw.
  editor.draw('Freehand');
  await click(400, 400);
  expect(editor.getState()).toMatchObject({ mode: 'draw-freehand', featureCount: 1 });
});

it('cuts features with a drawn polygon and adds polygon parts', async () => {
  load(square('a', 100, 100, 200), square('b', 400, 100));
  editor.drawCut();
  expect(editor.getState().mode).toBe('draw-cut');
  await click(180, 50); await click(220, 50); await click(220, 450); await click(180, 450);
  await click(180, 50);
  expect(editor.getState()).toMatchObject({ mode: 'idle', canUndo: true });
  expect(editor.getFeature('a')?.geometry.type).toBe('MultiPolygon');
  expect(editor.getFeature('b')?.geometry.type).toBe('Polygon');
  editor.undo();

  editor.select('b');
  expect(editor.drawPart()).toBe(true);
  await click(550, 300); await click(650, 300); await click(600, 400);
  expect(editor.finish()).toMatchObject({ id: 'b', geometry: { type: 'MultiPolygon' } });
  editor.select('b');
  expect(editor.explodeSelection()?.changes).toHaveLength(2);
  expect(editor.getState().selectedFeatureIds).toHaveLength(2);
  expect(editor.combineSelection()?.changes).toHaveLength(2);
  expect(editor.getFeature('b')?.geometry.type).toBe('MultiPolygon');
});

it('shows live measurements while drawing, editing and for the selection', async () => {
  load(square('a', 100, 100, 200));
  expect(labels()).toEqual([]);
  editor.setMeasurements({ enabled: true });
  expect(editor.getMeasurements()).toEqual({ enabled: true, units: 'metric', locale: 'en' });
  editor.select('a');
  expect(labels()).toHaveLength(1);
  expect(labels()[0]).toMatch(/ha|m²/);
  editor.select(null);
  expect(labels()).toEqual([]);

  editor.draw('LineString');
  await click(100, 400); await hover(400, 400); await frame();
  expect(labels()).toHaveLength(1);
  expect(labels()[0]).toMatch(/^\d+ m$/);
  editor.cancel();
  expect(labels()).toEqual([]);

  editor.draw('Circle');
  await click(500, 250); await hover(560, 250); await frame();
  expect(labels().some((text) => text?.includes('r '))).toBe(true);
  editor.cancel();

  editor.setMeasurements({ units: 'imperial', locale: 'nl' });
  editor.select('a');
  expect(labels()[0]).toMatch(/ac|ft²/);
  editor.editSelected(); await frame();
  expect(labels()).toHaveLength(1);
  editor.cancel();
  editor.setMeasurements({ enabled: false });
  expect(labels()).toEqual([]);
  expect(() => { editor.setMeasurements({ units: 'yards' as never }); }).toThrow(TypeError);
});

it('zooms to features and accepts a custom ID generator', async () => {
  editor.destroy();
  let next = 0;
  editor = new GeometryEditor(map, { createId: () => `parcel-${++next}` });
  expect(editor.zoomToFeatures()).toBe(false);
  editor.draw('Rectangle');
  await click(100, 100); await click(150, 150);
  expect(editor.exportGeoJSON().features[0]!.id).toBe('parcel-1');
  const zoom = map.getZoom();
  expect(editor.zoomToFeatures(undefined, { animate: false })).toBe(true);
  expect(map.getZoom()).toBeGreaterThan(zoom);
  editor.destroy();
  editor = new GeometryEditor(map, { createId: () => null as never });
  expect(() => editor.importGeoJSON({ type: 'Feature', properties: null, geometry: { type: 'Point', coordinates: [4.9, 52.37] } }))
    .toThrow('createId must return a string or finite number.');
  expect(editor.getState().featureCount).toBe(0);
  editor.destroy();
  expect(() => new GeometryEditor(map, { createId: 'id' as never })).toThrow('createId must be a function.');
  editor = new GeometryEditor(map);
});

it('moves the selection with the arrow keys instead of panning the map', async () => {
  load(square('a', 200, 200));
  const corner = () => map.project((editor.getFeature('a') as PolygonFeature).geometry.coordinates[0]![0]!);
  const before = corner();
  const center = map.getCenter().toArray();
  editor.select('a');
  map.getCanvas().focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(corner().x).toBeCloseTo(before.x + 1, 1);
  await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
  expect(corner().y).toBeCloseTo(before.y + 10, 1);
  expect(map.getCenter().toArray()).toEqual(center);
  expect(editor.getState().canUndo).toBe(true);
  editor.undo(); editor.undo();
  expect(corner().x).toBeCloseTo(before.x, 6);
  // Locked or unselected features leave the arrow keys to the map.
  editor.setLockedFeatureIds(['a']);
  const locked = editor.getFeature('a');
  await userEvent.keyboard('{ArrowRight}');
  expect(editor.getFeature('a')).toEqual(locked);
  expect(editor.getState().canUndo).toBe(false);
});

it('draws an ellipse and lets one-finger drags draw freehand', async () => {
  editor.draw('Ellipse');
  await click(300, 250); await click(420, 310);
  const ring = (editor.exportGeoJSON().features[0] as PolygonFeature).geometry.coordinates[0]!;
  const xs = ring.map((point) => map.project(point).x); const ys = ring.map((point) => map.project(point).y);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(240, -0.5);
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(120, -0.5);
  const canvas = map.getCanvas();
  const before = canvas.style.touchAction;
  editor.draw('Freehand');
  expect(canvas.style.touchAction).toBe('none');
  editor.cancel();
  expect(canvas.style.touchAction).toBe(before);
});

it('snaps to features of the application\'s own map layers', async () => {
  map.addSource('parcels', { type: 'geojson', data: { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [at(100, 300), at(500, 300)] } } });
  map.addLayer({ id: 'parcels', type: 'line', source: 'parcels' });
  await new Promise<void>((resolve) => { map.once('idle', () => { resolve(); }); });
  const snaps: (string | undefined)[] = [];
  editor.onSnap((snap) => { snaps.push(snap?.layer); });
  editor.setSnapping({ enabled: true, layers: ['parcels', 'missing-layer'] });
  expect(editor.getSnapping().layers).toEqual(['parcels', 'missing-layer']);
  editor.draw('LineString');
  await click(100, 308); await click(300, 200); await click(500, 293);
  expect(snaps).toContain('parcels');
  const line = editor.finish()!.geometry.coordinates as Coordinate[];
  expect(map.project(line[0]!).y).toBeCloseTo(300, 0);
  expect(map.project(line[2]!).x).toBeCloseTo(500, 0);
  expect(map.project(line[1]!).y).toBeCloseTo(200, 0);
  // Without the layer option, nothing snaps there.
  editor.setSnapping({ layers: [] });
  editor.draw('Point');
  await click(300, 306);
  expect(map.project((editor.exportGeoJSON().features[1]!.geometry.coordinates as Coordinate)).y).toBeCloseTo(306, 0);
});
