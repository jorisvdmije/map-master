import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, LineEditor, type Coordinate, type FeatureId, type TransactionEvent } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const sourceId = () => Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!;
const source = () => map.getSource<GeoJSONSource>(sourceId())!;
const marker = (id: FeatureId): unknown => map.getFeatureState({ source: sourceId(), id: JSON.stringify(id) });
const position = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
async function fixture(): Promise<void> {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { nested: { name: 'polygon' } }, geometry: { type: 'Polygon', coordinates: [
      [[100, 100], [300, 100], [300, 300], [100, 300], [100, 100]].map(([x, y]) => position(x!, y!)),
    ] } },
    { type: 'Feature', id: '0', properties: { name: 'line' }, geometry: { type: 'LineString', coordinates: [position(350, 180), position(450, 180)] } },
    { type: 'Feature', id: 'far', properties: null, geometry: { type: 'LineString', coordinates: [position(500, 100), position(600, 100)] } },
  ] });
  editor.clearHistory(); editor.selectMany(['0', 0]);
  await expect.poll(() => map.queryRenderedFeatures({ layers: [sourceId()] }).length).toBeGreaterThanOrEqual(3);
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  await commands.vertexPointer('up', 650, 400); await userEvent.keyboard('{/Shift}');
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});

it('duplicates a mixed group with one upload/transaction, isolated events and copies selected before callbacks', async () => {
  await fixture(); const before = editor.exportGeoJSON(); const upload = vi.spyOn(source(), 'setData');
  const changed = vi.fn(); const created = vi.fn(); const updated = vi.fn();
  editor.onChange(changed); editor.onCreate(created); editor.onUpdate(updated);
  const ignored = vi.fn(); editor.onTransaction(ignored)();
  editor.onTransaction((event) => {
    expect(editor.getState().selectedFeatureIds).toEqual(event.changes.map((change) => change.after!.id));
    expect(editor.getState().featureCount).toBe(5);
    event.changes[0]!.after!.properties!.name = 'mutated'; event.changes.length = 0;
  });
  const queued = vi.spyOn(window, 'queueMicrotask').mockImplementation(() => {});
  editor.onTransaction(() => { throw new Error('Broken observer'); });
  const observed = vi.fn<(event: TransactionEvent) => void>(); editor.onTransaction(observed);
  const event = editor.duplicateSelection([0.001, -0.001])!;
  expect(upload).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce(); expect(observed).toHaveBeenCalledOnce();
  expect(queued).toHaveBeenCalledOnce(); expect(ignored).not.toHaveBeenCalled();
  expect(created).not.toHaveBeenCalled(); expect(updated).not.toHaveBeenCalled();
  const copies = event.changes.map((change) => change.after!);
  expect(observed.mock.calls[0]![0]).toEqual(event);
  expect(new Set(copies.map((feature) => feature.id)).size).toBe(2);
  expect(copies.map((feature) => feature.properties)).toEqual([before.features[1]!.properties, before.features[0]!.properties]);
  expect(editor.exportGeoJSON().features.slice(0, 3)).toEqual(before.features);
  for (const id of [0, '0']) expect(marker(id)).not.toMatchObject({ selected: true });
  for (const feature of copies) expect(marker(feature.id)).toMatchObject({ selected: true });
  await expect.poll(() => source().getData()).toMatchObject({ features: editor.exportGeoJSON().features.map(({ id, geometry }) => ({ id, geometry })) });
  const saved = editor.exportGeoJSON();
  map.getCanvas().focus(); await userEvent.keyboard('{Control>}z{/Control}');
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().selectedFeatureIds).toEqual([]);
  expect(editor.getState().canUndo).toBe(false);
  await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}'); expect(editor.exportGeoJSON()).toEqual(saved);
  expect(editor.getState().selectedFeatureIds).toEqual([]);
});

it('keeps duplicates selected through style changes and drags only the copies', async () => {
  await fixture(); const before = editor.exportGeoJSON(); editor.duplicateSelection(); const copied = editor.exportGeoJSON();
  const ids = editor.getState().selectedFeatureIds;
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(() => source().getData()).toMatchObject({ features: copied.features.map(({ id, geometry }) => ({ id, geometry })) });
  for (const id of ids) expect(marker(id)).toMatchObject({ selected: true });
  await expect.poll(() => map.queryRenderedFeatures({ layers: [sourceId()] }).length).toBeGreaterThanOrEqual(5);
  await userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), { sourcePosition: { x: 200, y: 200 }, targetPosition: { x: 240, y: 250 } });
  expect(editor.exportGeoJSON()).not.toEqual(copied);
  expect(editor.exportGeoJSON().features.slice(0, 3)).toEqual(before.features);
  expect(editor.getState().selectedFeatureIds).toEqual(ids);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(copied);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before);
});

it.each(['move', 'rectangle'] as const)('cancels an active %s before duplication and ignores its later release', async (gesture) => {
  await fixture(); const before = editor.exportGeoJSON();
  if (gesture === 'rectangle') await userEvent.keyboard('{Shift>}');
  await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('move', 250, 250);
  const event = editor.duplicateSelection()!;
  const after = editor.exportGeoJSON(); expect(after.features.slice(0, 3)).toEqual(before.features);
  expect(event.changes.map((change) => change.after!.geometry)).toEqual([before.features[1]!.geometry, before.features[0]!.geometry]);
  await commands.vertexPointer('up', 250, 250); await userEvent.keyboard('{/Shift}');
  expect(editor.exportGeoJSON()).toEqual(after);
  expect(editor.getState().selectedFeatureIds).toEqual(event.changes.map((change) => change.after!.id));
  expect(map.dragPan.isEnabled()).toBe(true); expect(map.boxZoom.isEnabled()).toBe(true);
  expect(map.getCanvasContainer().querySelector('[data-geo-selection-box]')).toBeNull();
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
});

it('does not render or notify for an empty selection or invalid duplication', async () => {
  await fixture(); const before = editor.exportGeoJSON(); const state = editor.getState();
  const upload = vi.spyOn(source(), 'setData'); const transaction = vi.fn(); const changed = vi.fn();
  editor.onTransaction(transaction); editor.onChange(changed);
  expect(() => editor.duplicateSelection([180, 0])).toThrow();
  expect(editor.getState()).toEqual(state); expect(editor.exportGeoJSON()).toEqual(before);
  expect(changed).not.toHaveBeenCalled(); editor.select(null); changed.mockClear();
  expect(editor.duplicateSelection()).toBeNull();
  expect(upload).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  editor.destroy(); expect(() => editor.duplicateSelection()).toThrow('destroyed');
});

it('exposes duplication and transaction events on the LineEditor facade', async () => {
  editor.destroy(); const legacy = new LineEditor(map);
  try {
    legacy.startLine();
    for (const x of [100, 200]) await userEvent.click(map.getCanvas(), { position: { x, y: 100 } });
    const line = legacy.finish()!; legacy.select(line.id); legacy.clearHistory();
    const observed = vi.fn(); legacy.onTransaction(observed);
    const event = legacy.duplicateSelection()!;
    expect(event.changes).toHaveLength(1); expect(observed).toHaveBeenCalledOnce();
    expect(legacy.getSelected()).toEqual({ ...line, id: event.changes[0]!.after!.id });
    legacy.undo(); expect(legacy.exportGeoJSON().features).toEqual([line]);
  } finally { legacy.destroy(); }
});
