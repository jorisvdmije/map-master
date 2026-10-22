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
const renderedIds = () => map.queryRenderedFeatures({ layers: [sourceId()] }).map((feature) => feature.id);

async function draw(kind: GeometryType): Promise<GeometryFeature> {
  editor.draw(kind);
  if (kind === 'LineString') { await click(150, 100); await click(450, 100); }
  else { await click(100, 200); await click(400, 200); await click(250, 350); }
  const feature = editor.finish();
  if (!feature) throw new Error('Invalid test fixture');
  await expect.poll(renderedIds).toContain(feature.id);
  return feature;
}

beforeEach(async () => {
  container = document.createElement('div');
  container.style.cssText = 'width:700px;height:450px;position:relative;';
  document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it.each<GeometryType>(['LineString', 'Polygon'])('deletes selected %s once from data and rendering with one committed event', async (kind) => {
  const removed = await draw(kind);
  const survivor = await draw(kind === 'LineString' ? 'Polygon' : 'LineString');
  editor.select(removed.id);
  const onDelete = vi.fn();
  const onChange = vi.fn();
  const onCreate = vi.fn();
  editor.onDelete(onDelete); editor.onChange(onChange); editor.onCreate(onCreate);
  const source = map.getSource<GeoJSONSource>(sourceId())!;
  const upload = vi.spyOn(source, 'setData');
  expect(editor.deleteSelected()).toEqual(removed);
  expect(editor.deleteSelected()).toBeNull();
  expect(onDelete).toHaveBeenCalledExactlyOnceWith(removed);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ selectedFeatureId: null, featureCount: 1 }));
  expect(onCreate).not.toHaveBeenCalled();
  expect(upload).toHaveBeenCalledOnce();
  expect(editor.exportGeoJSON().features).toEqual([survivor]);
  expect(editor.getSelected()).toBeNull();
  expect(map.getFeatureState({ source: sourceId(), id: removed.id })).not.toMatchObject({ selected: true });
  await expect.poll(renderedIds).not.toContain(removed.id);
  expect(renderedIds()).toContain(survivor.id);
  await expect.poll(() => source.getData()).toMatchObject(editor.exportGeoJSON());
});

it.each(['Delete', 'Backspace'])('deletes using focused %s and ignores unrelated inputs and modified shortcuts', async (key) => {
  const feature = await draw('LineString');
  editor.select(feature.id);
  const input = document.createElement('input'); container.append(input); input.focus();
  await userEvent.keyboard(`{${key}}`);
  expect(editor.getSelected()?.id).toBe(feature.id);
  map.getCanvas().focus();
  await userEvent.keyboard(`{Control>}{${key}}{/Control}`);
  expect(editor.getSelected()?.id).toBe(feature.id);
  for (const flags of [{ repeat: true }, { isComposing: true }]) {
    map.getCanvas().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...flags }));
    expect(editor.getSelected()?.id).toBe(feature.id);
  }
  const prevented = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  prevented.preventDefault(); map.getCanvas().dispatchEvent(prevented);
  expect(editor.getSelected()?.id).toBe(feature.id);
  await userEvent.keyboard(`{${key}}`);
  expect(editor.exportGeoJSON().features).toEqual([]);
  const noSelection = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  map.getCanvas().dispatchEvent(noSelection);
  expect(noSelection.defaultPrevented).toBe(false);
});

it('does not delete during drawing or damage an unfinished draft', async () => {
  const feature = await draw('Polygon');
  editor.draw('LineString'); await click(100, 100);
  expect(() => editor.deleteSelected()).toThrow('Finish or cancel');
  await userEvent.keyboard('{Delete}{Backspace}');
  expect(editor.getState()).toMatchObject({ mode: 'draw-line', vertexCount: 1, featureCount: 1 });
  expect(editor.exportGeoJSON().features).toEqual([feature]);
  editor.cancel();
});

it('isolates deletion snapshots, supports unsubscribing, and commits before notifying observers', async () => {
  const feature = await draw('Polygon');
  editor.select(feature.id);
  const unsubscribed = vi.fn(); editor.onDelete(unsubscribed)();
  const observer = vi.fn();
  editor.onDelete((removed) => {
    expect(editor.getSelected()).toBeNull();
    expect(editor.exportGeoJSON().features).toEqual([]);
    expect(editor.deleteSelected()).toBeNull();
    if (removed.geometry.type === 'Polygon') removed.geometry.coordinates[0]!.length = 0;
  });
  editor.onDelete(observer);
  const result = editor.deleteSelected();
  expect(result).toEqual(feature);
  expect(observer).toHaveBeenCalledExactlyOnceWith(feature);
  expect(unsubscribed).not.toHaveBeenCalled();
  result!.geometry.coordinates.length = 0;
  expect(observer.mock.calls[0]?.[0]).toEqual(feature);
});

it('reports observer errors without interrupting deletion or later listeners', async () => {
  const feature = await draw('LineString');
  editor.select(feature.id);
  // Capture asynchronous error reporting so the deliberately broken observer
  // does not become an unhandled test-runner error.
  const queued = vi.spyOn(window, 'queueMicrotask').mockImplementation(() => {});
  editor.onDelete(() => { throw new Error('Broken observer'); });
  const next = vi.fn(); editor.onDelete(next);
  const change = vi.fn(); editor.onChange(change);
  expect(editor.deleteSelected()).toEqual(feature);
  expect(next).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledOnce();
  expect(editor.getState()).toMatchObject({ featureCount: 0, selectedFeatureId: null });
  expect(queued).toHaveBeenCalledOnce();
  const report = queued.mock.calls[0]?.[0];
  if (!report) throw new Error('Expected error report');
  expect(report).toThrow('Broken observer');
});

it('ignores stale rendered hits while MapLibre catches up after a deletion', async () => {
  const feature = await draw('LineString');
  const staleHits = map.queryRenderedFeatures([300, 100], { layers: [sourceId()] });
  editor.select(feature.id); editor.deleteSelected();
  const query = vi.spyOn(map, 'queryRenderedFeatures').mockReturnValue(staleHits);
  await click(300, 100);
  expect(editor.getSelected()).toBeNull();
  expect(editor.exportGeoJSON().features).toEqual([]);
  expect(() => editor.select(feature.id)).toThrow(RangeError);
  query.mockRestore();
});

it('keeps deleted geometry absent after style replacement and removes deletion listeners on teardown', async () => {
  const removed = await draw('Polygon');
  const survivor = await draw('LineString');
  editor.select(removed.id); editor.deleteSelected();
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(renderedIds).toContain(survivor.id);
  expect(renderedIds()).not.toContain(removed.id);
  expect(editor.exportGeoJSON().features).toEqual([survivor]);
  const stale = vi.fn(); editor.onDelete(stale);
  editor.select(survivor.id); editor.destroy();
  expect(stale).not.toHaveBeenCalled();
  expect(() => editor.deleteSelected()).toThrow('destroyed');
  expect(() => editor.onDelete(vi.fn())).toThrow('destroyed');
  expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(['host-background']);
  editor = new GeometryEditor(map);
  const fresh = await draw('LineString');
  editor.select(fresh.id); editor.deleteSelected();
  expect(stale).not.toHaveBeenCalled();
});
