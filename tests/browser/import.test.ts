import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, GeoJSONImportError, type Coordinate, type FeatureId, type GeometryFeatureCollection, type LineFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [
  { id: 'host-background', type: 'background', paint: { 'background-color': '#fff' } },
] });
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const sourceId = () => Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!;
const point = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const line = (id: FeatureId, y: number): LineFeature => ({ type: 'Feature', id,
  properties: { nested: { label: 'original' }, __geo_editor_id: 'user-property' },
  geometry: { type: 'LineString', coordinates: [point(100, y), point(500, y)] },
});
const renderedIds = () => map.queryRenderedFeatures({ layers: [sourceId()] }).map((hit) => hit.id);

beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;';
  document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('keeps number/string IDs distinct in picking, highlight, edit, deletion, and style restoration', async () => {
  const input: GeometryFeatureCollection = { type: 'FeatureCollection', features: [line(7, 100), line('7', 250)] };
  editor.importGeoJSON(input);
  await expect.poll(renderedIds).toEqual(expect.arrayContaining(['7', '"7"']));
  await userEvent.click(map.getCanvas(), { position: { x: 300, y: 100 } });
  expect(editor.getSelected()?.id).toBe(7);
  expect(map.getFeatureState({ source: sourceId(), id: '7' })).toMatchObject({ selected: true });
  expect(map.getFeatureState({ source: sourceId(), id: '"7"' })).not.toMatchObject({ selected: true });
  await userEvent.click(map.getCanvas(), { position: { x: 300, y: 250 } });
  expect(editor.getSelected()?.id).toBe('7');
  expect(map.getFeatureState({ source: sourceId(), id: '7' })).not.toMatchObject({ selected: true });
  expect(map.getFeatureState({ source: sourceId(), id: '"7"' })).toMatchObject({ selected: true });
  editor.editSelected(); editor.moveVertex(0, point(130, 270));
  expect(editor.finish()).toMatchObject({ id: '7', properties: input.features[1]!.properties });
  editor.select(7); editor.deleteSelected(); editor.select('7');
  const saved = editor.exportGeoJSON();
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(renderedIds).toContain('"7"');
  expect(renderedIds()).not.toContain('7');
  expect(map.getFeatureState({ source: sourceId(), id: '"7"' })).toMatchObject({ selected: true });
  expect(editor.exportGeoJSON()).toEqual(saved);
  expect(saved.features[0]?.properties?.__geo_editor_id).toBe('user-property');
});

it('uploads once and emits one isolated import event after the whole batch is committed', () => {
  editor.importGeoJSON(line('existing', 50)); editor.select('existing');
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId())!, 'setData');
  const create = vi.fn(); const update = vi.fn(); const removed = vi.fn(); const change = vi.fn();
  editor.onCreate(create); editor.onUpdate(update); editor.onDelete(removed); editor.onChange(change);
  const ignored = vi.fn(); editor.onImport(ignored)();
  const queued = vi.spyOn(window, 'queueMicrotask').mockImplementation(() => {});
  editor.onImport(() => { throw new Error('Broken import observer'); });
  editor.onImport((value) => {
    expect(editor.getState()).toMatchObject({ featureCount: 3, selectedFeatureId: 'existing', dataRevision: 2 });
    expect(editor.exportGeoJSON().features.map((feature) => feature.id)).toEqual(['existing', 'a', 'b']);
    (value.features[0]!.properties!.nested as { label: string }).label = 'changed';
    value.features.length = 0;
  });
  const observer = vi.fn<(collection: GeometryFeatureCollection) => void>(); editor.onImport(observer);
  const input = { type: 'FeatureCollection', features: [line('a', 100), line('b', 200)] };
  const returned = editor.importGeoJSON(input);
  expect(observer).toHaveBeenCalledExactlyOnceWith(input);
  expect(returned).toEqual(input);
  expect(upload).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(removed).not.toHaveBeenCalled();
  expect(ignored).not.toHaveBeenCalled(); expect(queued).toHaveBeenCalledOnce();
  returned.features[0]!.geometry.coordinates.length = 0;
  expect(editor.exportGeoJSON().features[1]).toEqual(input.features[0]);
});

it('keeps failures and empty imports inert, guards active interactions, and rejects use after destroy', () => {
  editor.importGeoJSON(line('existing', 50)); editor.select('existing');
  const saved = editor.exportGeoJSON(); const state = editor.getState(); const camera = map.getCenter().toArray();
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId())!, 'setData');
  const imported = vi.fn(); const change = vi.fn(); editor.onImport(imported); editor.onChange(change);
  const invalid = { type: 'FeatureCollection', features: [line('new', 100), line('existing', 200)] };
  expect(() => editor.importGeoJSON(invalid)).toThrow(GeoJSONImportError);
  editor.importGeoJSON({ type: 'FeatureCollection', features: [] });
  expect(editor.exportGeoJSON()).toEqual(saved); expect(editor.getState()).toEqual(state);
  expect(map.getCenter().toArray()).toEqual(camera);
  expect(upload).not.toHaveBeenCalled(); expect(imported).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  editor.editSelected(); expect(() => editor.importGeoJSON(line('edit', 100))).toThrow('Finish or cancel'); editor.cancel();
  editor.draw('Polygon'); expect(() => editor.importGeoJSON(line('draw', 100))).toThrow('Finish or cancel'); editor.cancel();
  editor.destroy();
  expect(() => editor.importGeoJSON(line('dead', 100))).toThrow('destroyed');
  expect(() => editor.onImport(vi.fn())).toThrow('destroyed');
  expect(editor.exportGeoJSON()).toEqual(saved);
});
