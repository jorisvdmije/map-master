import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type EditorState, type FeatureId, type GeometryType } from '../../src/index.js';
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
const state = (id: FeatureId): unknown => map.getFeatureState({ source: sourceId(), id: JSON.stringify(id) });
const width = (x: number, y: number): unknown => {
  const layer = map.queryRenderedFeatures([x, y], { layers: [sourceId()] })[0]?.layer;
  return layer?.type === 'line' ? layer.paint?.['line-width'] : undefined;
};

async function draw(kind: GeometryType, points: [number, number][]): Promise<FeatureId> {
  editor.draw(kind);
  for (const [x, y] of points) await click(x, y);
  const feature = editor.finish();
  if (!feature) throw new Error('Invalid test geometry');
  await expect.poll(() => map.queryRenderedFeatures({ layers: [sourceId()] }).map((hit) => hit.id)).toContain(JSON.stringify(feature.id));
  return feature.id;
}
const polygon = () => draw('Polygon', [[100, 100], [500, 100], [500, 350], [100, 350]]);
const line = () => draw('LineString', [[200, 220], [400, 220]]);

beforeEach(async () => {
  container = document.createElement('div');
  container.style.cssText = 'width:700px;height:450px;position:relative;';
  document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(() => { editor.destroy(); map.remove(); container.remove(); });

it.each([6, 17])('selects nearby lines before polygon interiors and deselects empty space at zoom %s', async (zoom) => {
  map.setZoom(zoom);
  const polygonId = await polygon();
  const lineId = await line();
  const saved = editor.exportGeoJSON();
  await click(300, 225);
  expect(editor.getSelected()?.id).toBe(lineId);
  await expect.poll(() => width(300, 220)).toBe(6);
  await click(300, 290);
  expect(editor.getSelected()?.id).toBe(polygonId);
  expect(state(lineId)).not.toMatchObject({ selected: true });
  expect(state(polygonId)).toMatchObject({ selected: true });
  await click(650, 400);
  expect(editor.getSelected()).toBeNull();
  expect(editor.exportGeoJSON()).toEqual(saved);
  expect(state(polygonId)).not.toMatchObject({ selected: true });
});

it('chooses the topmost polygon where interiors overlap', async () => {
  await polygon();
  const top = await polygon();
  await click(300, 290);
  expect(editor.getSelected()?.id).toBe(top);
});

it('updates presentation and state once without re-uploading or changing feature data', async () => {
  const id = await line();
  const saved = editor.exportGeoJSON();
  const source = map.getSource<GeoJSONSource>(sourceId())!;
  const upload = vi.spyOn(source, 'setData');
  const created = vi.fn();
  const changed = vi.fn<(value: EditorState) => void>();
  editor.onCreate(created);
  editor.onChange((value) => { value.selectedFeatureId = 'changed'; });
  editor.onChange(changed);
  const unsubscribed = vi.fn();
  editor.onChange(unsubscribed)();
  editor.select(id);
  editor.select(id);
  await click(300, 220);
  expect(changed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ selectedFeatureId: id }));
  expect(() => editor.select('missing')).toThrow(RangeError);
  expect(editor.getSelected()?.id).toBe(id);
  editor.select(null);
  expect(changed).toHaveBeenCalledTimes(2);
  expect(created).not.toHaveBeenCalled();
  expect(unsubscribed).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(editor.exportGeoJSON()).toEqual(saved);
  await expect.poll(() => source.getData()).toMatchObject(saved);
  upload.mockRestore();
});

it('clears selection with focused Escape but ignores other inputs and modified shortcuts', async () => {
  const id = await line();
  editor.select(id);
  const input = document.createElement('input');
  container.append(input);
  input.focus();
  await userEvent.keyboard('{Escape}');
  expect(editor.getSelected()?.id).toBe(id);
  map.getCanvas().focus();
  await userEvent.keyboard('{Control>}{Escape}{/Control}');
  expect(editor.getSelected()?.id).toBe(id);
  await userEvent.keyboard('{Escape}');
  expect(editor.getSelected()).toBeNull();
  expect(map.doubleClickZoom.isEnabled()).toBe(true);
});

it('starts drawing with no selection and never selects or loses a draft when clicking existing shapes', async () => {
  const id = await polygon();
  editor.select(id);
  editor.draw('LineString');
  expect(editor.getSelected()).toBeNull();
  expect(state(id)).not.toMatchObject({ selected: true });
  await click(300, 220);
  expect(editor.getState()).toMatchObject({ mode: 'draw-line', vertexCount: 1, selectedFeatureId: null });
  expect(() => editor.select(id)).toThrow('Finish or cancel');
  expect(() => editor.select(null)).toThrow('Finish or cancel');
  expect(editor.getState().vertexCount).toBe(1);
  await userEvent.keyboard('{Escape}');
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureId: null });
});

it('ignores modified clicks and drag pan, and excludes host geometry from picking', async () => {
  const id = await line();
  editor.select(id);
  await userEvent.keyboard('{Shift>}');
  await click(650, 400);
  await userEvent.keyboard('{/Shift}');
  expect(editor.getSelected()?.id).toBe(id);
  await userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), {
    sourcePosition: { x: 550, y: 300 }, targetPosition: { x: 600, y: 350 },
  });
  map.stop();
  expect(editor.getSelected()?.id).toBe(id);
  const position = map.unproject([600, 100]);
  map.addSource('host-marker', { type: 'geojson', data: {
    type: 'Feature', id: 'host', properties: {}, geometry: { type: 'Point', coordinates: [position.lng, position.lat] },
  } });
  map.addLayer({ id: 'host-marker', type: 'circle', source: 'host-marker', paint: { 'circle-radius': 10 } });
  await expect.poll(() => map.queryRenderedFeatures([600, 100], { layers: ['host-marker'] }).length).toBeGreaterThan(0);
  await click(600, 100);
  expect(editor.getSelected()).toBeNull();
});

it('restores selection after style replacement and clears it on destroy/remount', async () => {
  const id = await line();
  editor.select(id);
  const saved = editor.exportGeoJSON();
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false });
  await loaded;
  expect(editor.getSelected()?.id).toBe(id);
  await expect.poll(() => width(300, 220)).toBe(6);
  expect(state(id)).toMatchObject({ selected: true });
  editor.destroy();
  expect(editor.getSelected()).toBeNull();
  expect(editor.exportGeoJSON()).toEqual(saved);
  expect(() => editor.select(id)).toThrow('destroyed');
  expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(['host-background']);
  expect(map.getStyle().sources).toEqual({});
  editor = new GeometryEditor(map);
  expect(editor.getState()).toMatchObject({ selectedFeatureId: null, featureCount: 0 });
});
