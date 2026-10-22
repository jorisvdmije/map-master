import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type GeometryFeature, type GeometryType } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [
  { id: 'host-background', type: 'background', paint: { 'background-color': '#fff' } },
] });
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const sourceId = () => Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!;
const drag = (x: number, y: number, toX: number, toY: number) => userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), {
  sourcePosition: { x, y }, targetPosition: { x: toX, y: toY },
});
async function draw(kind: GeometryType): Promise<GeometryFeature> {
  editor.draw(kind);
  const points = kind === 'LineString' ? [[100, 100], [300, 100], [500, 100]]
    : [[100, 150], [450, 150], [450, 350], [100, 350]];
  for (const [x, y] of points) await click(x!, y!);
  const feature = editor.finish();
  if (!feature) throw new Error('Invalid test fixture');
  await expect.poll(() => map.queryRenderedFeatures({ layers: [sourceId()] }).map((hit) => hit.id)).toContain(feature.id);
  editor.select(feature.id);
  return feature;
}

beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;';
  document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it.each([6, 17])('drags a vertex at zoom %s without panning or changing committed data until Save', async (zoom) => {
  map.setZoom(zoom);
  const original = await draw('LineString');
  const center = map.getCenter().toArray();
  const update = vi.fn(); const create = vi.fn(); const removed = vi.fn();
  editor.onUpdate(update); editor.onCreate(create); editor.onDelete(removed);
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId())!, 'setData');
  expect(editor.editSelected()).toBe(true);
  await drag(100, 100, 130, 180);
  expect(map.getCenter().toArray()).toEqual(center);
  expect(map.dragPan.isEnabled()).toBe(true);
  const position = map.unproject([130, 180]);
  expect(editor.getDraft()[0]?.[0]).toBeCloseTo(position.lng, 6);
  expect(editor.getDraft()[0]?.[1]).toBeCloseTo(position.lat, 6);
  expect(editor.exportGeoJSON().features).toEqual([original]);
  expect(upload).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}');
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureId: original.id, selectedVertexIndex: null, dataRevision: 2 });
  expect(update).toHaveBeenCalledOnce(); expect(create).not.toHaveBeenCalled(); expect(removed).not.toHaveBeenCalled();
  expect(editor.exportGeoJSON().features[0]?.id).toBe(original.id);
  expect(upload).toHaveBeenCalledOnce();
});

it('inserts at a midpoint and removes a selected vertex without deleting the feature', async () => {
  const original = await draw('LineString'); editor.editSelected();
  await click(200, 100);
  expect(editor.getState()).toMatchObject({ vertexCount: 4, selectedVertexIndex: 1 });
  await userEvent.keyboard('{Delete}');
  expect(editor.getState()).toMatchObject({ vertexCount: 3, selectedVertexIndex: null, featureCount: 1 });
  await click(300, 100); await userEvent.keyboard('{Backspace}');
  expect(editor.getState().vertexCount).toBe(2);
  await click(100, 100); await userEvent.keyboard('{Delete}');
  expect(editor.getState().vertexCount).toBe(2);
  expect(editor.exportGeoJSON().features).toEqual([original]);
  expect(editor.finish()?.id).toBe(original.id);
});

it('inserts on a polygon closing edge and exports a closed ring with the original identity', async () => {
  const original = await draw('Polygon'); editor.editSelected();
  // Saving normalizes winding, so derive the closing segment from the saved draft.
  const first = map.project(editor.getDraft()[0]!);
  const last = map.project(editor.getDraft().at(-1)!);
  const x = (first.x + last.x) / 2; const y = (first.y + last.y) / 2;
  await click(x, y);
  expect(editor.getState()).toMatchObject({ vertexCount: 5, selectedVertexIndex: 4 });
  await drag(x, y, x, y - 30);
  const result = editor.finish();
  if (result?.geometry.type !== 'Polygon') throw new Error('Expected polygon');
  expect(result.id).toBe(original.id);
  expect(result.geometry.coordinates[0]).toHaveLength(6);
  expect(result.geometry.coordinates[0]?.[0]).toEqual(result.geometry.coordinates[0]?.at(-1));
});

it('rejects invalid polygon saves and Escape restores exact original geometry and gestures', async () => {
  const original = await draw('Polygon');
  map.doubleClickZoom.disable(); map.dragPan.disable(); map.getCanvas().style.cursor = 'help';
  editor.editSelected();
  await drag(450, 150, 80, 300);
  expect(editor.getState()).toMatchObject({ canFinish: false, validationError: 'self-intersection' });
  await userEvent.keyboard('{Enter}');
  expect(editor.getState().mode).toBe('edit-polygon');
  expect(editor.exportGeoJSON().features).toEqual([original]);
  await userEvent.keyboard('{Escape}');
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureId: original.id });
  expect(editor.exportGeoJSON().features).toEqual([original]);
  expect(map.getCanvas().style.cursor).toBe('help');
  expect(map.doubleClickZoom.isEnabled()).toBe(false); expect(map.dragPan.isEnabled()).toBe(false);
  expect(map.getFeatureState({ source: sourceId(), id: original.id })).not.toMatchObject({ editing: true });
});

it('rolls back a cancelled midpoint gesture and releases pointer capture and pan', async () => {
  await draw('LineString'); editor.editSelected();
  const before = editor.getDraft();
  const interrupt = (event: PointerEvent): void => {
    map.getCanvas().dispatchEvent(new PointerEvent('pointercancel', { pointerId: event.pointerId }));
  };
  map.getCanvas().addEventListener('pointerdown', interrupt, { once: true });
  await click(200, 100);
  expect(editor.getDraft()).toEqual(before);
  expect(editor.getState().selectedVertexIndex).toBeNull();
  expect(map.dragPan.isEnabled()).toBe(true);
  await drag(100, 100, 130, 180);
  expect(editor.getDraft()).not.toEqual(before);
});

it('rolls back a gesture on window blur and does not continue moving after focus returns', async () => {
  await draw('LineString'); editor.editSelected();
  const before = editor.getDraft();
  map.getCanvas().addEventListener('pointerdown', () => {
    map.getCanvas().addEventListener('pointermove', () => { window.dispatchEvent(new Event('blur')); }, { once: true });
  }, { once: true });
  await drag(100, 100, 130, 180);
  expect(editor.getDraft()).toEqual(before);
  expect(map.dragPan.isEnabled()).toBe(true);
  await userEvent.hover(map.getCanvas(), { position: { x: 350, y: 300 } });
  expect(editor.getDraft()).toEqual(before);
});

it('keeps idle gestures available away from handles and does not intercept shortcuts outside the map', async () => {
  await draw('LineString'); editor.editSelected();
  const before = editor.getDraft();
  const center = map.getCenter().toArray();
  await drag(550, 300, 600, 350); map.stop();
  expect(map.getCenter().toArray()).not.toEqual(center);
  expect(editor.getDraft()).toEqual(before);
  editor.selectVertex(1);
  const input = document.createElement('input'); container.append(input); input.focus();
  await userEvent.keyboard('{Delete}{Enter}{Escape}');
  expect(editor.getState()).toMatchObject({ mode: 'edit-line', vertexCount: 3 });
  map.getCanvas().focus();
  await userEvent.keyboard('{Control>}{Delete}{/Control}');
  expect(editor.getState().vertexCount).toBe(3);
});

it('emits isolated update snapshots only for a changed save', async () => {
  const original = await draw('Polygon'); const updates = vi.fn<(feature: GeometryFeature) => void>();
  const removed = vi.fn(); editor.onUpdate(removed)();
  editor.onUpdate((feature) => { feature.geometry.coordinates.length = 0; });
  editor.onUpdate(updates);
  editor.editSelected(); editor.finish();
  expect(updates).not.toHaveBeenCalled();
  editor.editSelected(); editor.moveVertex(0, [4.89, 52.37]); editor.cancel();
  expect(updates).not.toHaveBeenCalled();
  editor.editSelected();
  const coordinate = editor.getDraft()[0]!;
  editor.moveVertex(0, [coordinate[0] - 0.001, coordinate[1]]);
  const result = editor.finish();
  expect(updates).toHaveBeenCalledExactlyOnceWith(result);
  expect(updates.mock.calls[0]?.[0].id).toBe(original.id);
  expect(editor.exportGeoJSON().features[0]).toEqual(result);
  expect(removed).not.toHaveBeenCalled();
});

it('preserves an edit across style replacement and cancels on destroy without an update event', async () => {
  const original = await draw('LineString'); editor.editSelected();
  const point = editor.getDraft()[0]!; editor.moveVertex(0, [point[0], point[1] - 0.001]);
  const edited = editor.getDraft(); const update = vi.fn(); editor.onUpdate(update);
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false }); await loaded;
  expect(editor.getDraft()).toEqual(edited);
  expect(map.getFeatureState({ source: sourceId(), id: original.id })).toMatchObject({ editing: true });
  const draftId = Object.keys(map.getStyle().sources).find((id) => id.endsWith('-draft'))!;
  await expect.poll(async () => {
    const data = await map.getSource<GeoJSONSource>(draftId)!.getData();
    return data.type === 'FeatureCollection' ? data.features.length : 0;
  }).toBeGreaterThan(3);
  editor.destroy();
  expect(editor.exportGeoJSON().features).toEqual([original]);
  expect(update).not.toHaveBeenCalled();
  expect(map.dragPan.isEnabled()).toBe(true); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(['host-background']);
  expect(() => editor.editSelected()).toThrow('destroyed');
  expect(() => editor.moveVertex(0, [0, 0])).toThrow('destroyed');
  expect(() => editor.onUpdate(vi.fn())).toThrow('destroyed');
});
