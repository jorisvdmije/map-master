import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, LineEditor } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [] });
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const triangle = async () => { await click(100, 100); await click(350, 100); await click(220, 300); };
const fillLayer = () => map.getStyle().layers.find((layer) => layer.id.endsWith('-fill') && !layer.id.endsWith('-draft-fill'))!.id;

beforeEach(async () => {
  container = document.createElement('div');
  container.style.cssText = 'width:700px;height:450px;position:relative;';
  document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(() => { editor.destroy(); map.remove(); container.remove(); });

it('shares the map ownership guard with the compatibility API', () => {
  expect(() => new LineEditor(map)).toThrow('Only one geometry editor');
});

it('previews polygon fill without committing, then closes the clicked ring with Enter', async () => {
  const created = vi.fn();
  editor.onCreate(created);
  editor.draw('Polygon');
  await click(100, 100); await click(350, 100);
  await userEvent.hover(map.getCanvas(), { position: { x: 220, y: 300 } });
  const draftId = Object.keys(map.getStyle().sources).find((id) => id.endsWith('-draft'))!;
  const draft = map.getSource<GeoJSONSource>(draftId)!;
  await expect.poll(async () => {
    const data = await draft.getData();
    return data.type === 'FeatureCollection' && data.features.some((feature) => feature.geometry.type === 'Polygon');
  }).toBe(true);
  expect(editor.exportGeoJSON().features).toHaveLength(0);
  expect(editor.finish()).toBeNull();
  await click(220, 300);
  await userEvent.keyboard('{Enter}');
  const feature = editor.exportGeoJSON().features[0];
  if (feature?.geometry.type !== 'Polygon') throw new Error('Expected a polygon');
  const ring = feature.geometry.coordinates[0]!;
  expect(ring).toHaveLength(4);
  expect(ring[0]).toEqual(ring.at(-1));
  expect(created).toHaveBeenCalledOnce();
  await expect.poll(() => map.queryRenderedFeatures([220, 160], { layers: [fillLayer()] }).length).toBeGreaterThan(0);
});

it.each([6, 17])('closes within 8 CSS pixels at zoom %s and emits only once', async (zoom) => {
  map.setZoom(zoom);
  const created = vi.fn();
  editor.onCreate(created);
  editor.draw('Polygon');
  await triangle();
  await click(105, 103);
  expect(editor.getState()).toMatchObject({ mode: 'idle', featureCount: 1 });
  expect(editor.finish()).toBeNull();
  expect(created).toHaveBeenCalledOnce();
  const feature = editor.exportGeoJSON().features[0];
  if (feature?.geometry.type !== 'Polygon') throw new Error('Expected a polygon');
  expect(feature.geometry.coordinates[0]).toHaveLength(4);
});

it('rejects a crossing ring on Enter or click-to-close and Escape preserves prior lines', async () => {
  editor.draw('LineString'); await click(100, 100); await click(350, 100); editor.finish();
  const saved = editor.exportGeoJSON();
  const created = vi.fn();
  editor.onCreate(created);
  editor.draw('Polygon');
  await click(100, 100); await click(350, 300); await click(100, 300); await click(350, 100);
  expect(editor.getState()).toMatchObject({ canFinish: false, validationError: 'self-intersection' });
  await userEvent.keyboard('{Enter}');
  await click(100, 100);
  expect(editor.getState().mode).toBe('draw-polygon');
  expect(editor.exportGeoJSON()).toEqual(saved);
  expect(created).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  expect(editor.getState().mode).toBe('idle');
  expect(editor.exportGeoJSON()).toEqual(saved);
  expect(map.doubleClickZoom.isEnabled()).toBe(true);
});

it('isolates nested event snapshots and restores mixed geometry after a style change', async () => {
  editor.onCreate((feature) => {
    if (feature.geometry.type === 'Polygon') feature.geometry.coordinates[0]!.length = 0;
  });
  const observed = vi.fn();
  editor.onCreate(observed);
  editor.draw('Polygon'); await triangle(); editor.finish();
  editor.draw('LineString'); await click(400, 200); await click(500, 300); editor.finish();
  const saved = editor.exportGeoJSON();
  expect(observed.mock.calls[0]?.[0]).toEqual(saved.features[0]);
  expect(saved.features.map((feature) => feature.geometry.type)).toEqual(['Polygon', 'LineString']);
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false });
  await loaded;
  await expect.poll(() => map.queryRenderedFeatures([220, 160], { layers: [fillLayer()] }).length).toBeGreaterThan(0);
  expect(editor.exportGeoJSON()).toEqual(saved);
  editor.destroy();
  expect(map.getStyle().layers).toEqual([]);
  expect(map.getStyle().sources).toEqual({});
});
