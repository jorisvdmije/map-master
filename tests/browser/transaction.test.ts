import { Map, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type FeatureTransaction, type LineFeature, type TransactionEvent } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const line = (id: string, y: number): LineFeature => ({ type: 'Feature', id, properties: { nested: { label: 'original' } },
  geometry: { type: 'LineString', coordinates: [map.unproject([100, y]).toArray(), map.unproject([500, y]).toArray()] },
});
const sourceId = () => Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!;
const renderedIds = () => [...new Set(map.queryRenderedFeatures({ layers: [sourceId()] }).map((feature) => feature.id))].sort();
const transaction = (): FeatureTransaction => ({ update: [line('a', 150)], delete: ['b'], create: [line('c', 300)] });
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, center: [4.895, 52.372], zoom: 13, fadeDuration: 0, style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] } });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true } });
  editor.importGeoJSON({ type: 'FeatureCollection', features: [line('a', 100), line('b', 200)] }); editor.clearHistory();
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('uploads once and notifies once after the whole batch, isolating observers and reporting their errors', () => {
  editor.select('b');
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId())!, 'setData');
  const changed = vi.fn(); editor.onChange(changed);
  const individual = vi.fn(); editor.onCreate(individual); editor.onUpdate(individual); editor.onDelete(individual); editor.onImport(individual);
  const ignored = vi.fn(); editor.onTransaction(ignored)();
  editor.onTransaction((event) => {
    expect(editor.getState()).toMatchObject({ dataRevision: 2, selectedFeatureId: null, featureCount: 2 });
    expect(editor.exportGeoJSON().features.map((feature) => feature.id)).toEqual(['a', 'c']);
    event.changes[0]!.after!.properties!.nested = null; event.changes.length = 0;
  });
  const queued = vi.spyOn(window, 'queueMicrotask').mockImplementation(() => {});
  editor.onTransaction(() => { throw new Error('Broken observer'); });
  const observed = vi.fn<(event: TransactionEvent) => void>(); editor.onTransaction(observed);
  const result = editor.applyTransaction(transaction())!;
  expect(observed).toHaveBeenCalledExactlyOnceWith(result); expect(result.changes).toHaveLength(3);
  expect(result.changes[0]!.after!.properties).toEqual({ nested: { label: 'original' } });
  result.changes[0]!.after!.properties = null;
  expect(observed.mock.calls[0]![0].changes[0]!.after!.properties).not.toBeNull();
  expect(upload).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce(); expect(queued).toHaveBeenCalledOnce();
  expect(individual).not.toHaveBeenCalled(); expect(ignored).not.toHaveBeenCalled();
});

it('shows the complete result, clears deleted selection and replays through real undo/redo shortcuts', async () => {
  const before = editor.exportGeoJSON(); editor.select('b');
  await expect.poll(renderedIds).toEqual(['"a"', '"b"']);
  editor.applyTransaction(transaction()); const after = editor.exportGeoJSON();
  await expect.poll(renderedIds).toEqual(['"a"', '"c"']); expect(editor.getSelected()).toBeNull();
  const history = vi.fn(); editor.onHistory(history); const event = vi.fn(); editor.onTransaction(event);
  map.getCanvas().focus(); await userEvent.keyboard('{Control>}z{/Control}');
  expect(editor.exportGeoJSON()).toEqual(before); await expect.poll(renderedIds).toEqual(['"a"', '"b"']);
  expect(history).toHaveBeenCalledWith(expect.objectContaining({ action: 'transaction', direction: 'undo' }));
  await userEvent.keyboard('{Control>}y{/Control}'); expect(editor.exportGeoJSON()).toEqual(after);
  await expect.poll(renderedIds).toEqual(['"a"', '"c"']); expect(event).not.toHaveBeenCalled();
  editor.draw('LineString'); await userEvent.hover(map.getCanvas(), { position: { x: 108, y: 155 } });
  await expect.poll(() => editor.getSnap()?.featureId).toBe('a');
  await userEvent.hover(map.getCanvas(), { position: { x: 108, y: 205 } });
  await expect.poll(() => editor.getSnap()).toBeNull();
});

it('does not render or notify on empty, unchanged, invalid, or active-draft transactions', async () => {
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId())!, 'setData');
  const changed = vi.fn(); editor.onChange(changed); const event = vi.fn(); editor.onTransaction(event);
  expect(editor.applyTransaction({})).toBeNull();
  expect(editor.applyTransaction({ update: [editor.exportGeoJSON().features[0]!] })).toBeNull();
  const input = transaction(); input.create![0]!.geometry.coordinates.length = 0;
  const before = editor.exportGeoJSON(); const state = editor.getState();
  expect(() => editor.applyTransaction(input)).toThrow(); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState()).toEqual(state);
  expect(changed).not.toHaveBeenCalled(); expect(event).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  editor.draw('Polygon'); await userEvent.click(map.getCanvas(), { position: { x: 400, y: 400 } }); const draft = editor.getDraft();
  expect(() => editor.applyTransaction(transaction())).toThrow('Finish or cancel'); expect(editor.getDraft()).toEqual(draft);
  expect(event).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
});

it('keeps surviving selection through replacement and cleans up subscribers on destroy/map removal', () => {
  editor.select('a'); editor.applyTransaction(transaction());
  expect(editor.getSelected()).toEqual(line('a', 150));
  expect(map.getFeatureState({ source: sourceId(), id: '"a"' })).toMatchObject({ selected: true });
  const event = vi.fn(); editor.onTransaction(event); const saved = editor.exportGeoJSON(); editor.destroy();
  expect(editor.exportGeoJSON()).toEqual(saved); expect(editor.getState().canUndo).toBe(false);
  expect(() => editor.applyTransaction({})).toThrow('destroyed'); expect(() => editor.onTransaction(vi.fn())).toThrow('destroyed');
  expect(event).not.toHaveBeenCalled(); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  editor = new GeometryEditor(map); map.remove(); expect(() => editor.applyTransaction({})).toThrow('destroyed');
});
