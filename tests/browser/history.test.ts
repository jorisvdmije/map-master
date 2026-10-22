import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, LineEditor, type FeatureId, type HistoryEvent, type LineFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [
  { id: 'host-background', type: 'background', paint: { 'background-color': '#fff' } },
] });
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const sourceId = () => Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!;
const line = (id: FeatureId, y = 100): LineFeature => ({ type: 'Feature', id,
  properties: { nested: { label: 'original' } }, geometry: { type: 'LineString', coordinates: [map.unproject([100, y]).toArray(), map.unproject([500, y]).toArray()] },
});
const renderedIds = () => map.queryRenderedFeatures({ layers: [sourceId()] }).map((hit) => hit.id);
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });

beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;';
  document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('undoes and redoes drawing with Ctrl/Cmd+Z, Shift+Z, and Ctrl+Y while preserving IDs', async () => {
  editor.draw('LineString'); await click(100, 100); await click(500, 100); await userEvent.keyboard('{Enter}');
  const saved = editor.exportGeoJSON(); const id = saved.features[0]!.id;
  await expect.poll(renderedIds).toContain(JSON.stringify(id));
  await userEvent.keyboard('{Control>}z{/Control}');
  expect(editor.getState()).toMatchObject({ featureCount: 0, canRedo: true });
  await expect.poll(renderedIds).toEqual([]);
  await userEvent.keyboard('{Control>}{Shift>}Z{/Shift}{/Control}');
  expect(editor.exportGeoJSON()).toEqual(saved);
  await userEvent.keyboard('{Meta>}z{/Meta}'); expect(editor.getState().featureCount).toBe(0);
  await userEvent.keyboard('{Meta>}{Shift>}Z{/Shift}{/Meta}'); expect(editor.exportGeoJSON()).toEqual(saved);
  await userEvent.keyboard('{Control>}z{/Control}');
  await userEvent.keyboard('{Control>}y{/Control}');
  expect(editor.exportGeoJSON()).toEqual(saved);
  await expect.poll(renderedIds).toContain(JSON.stringify(id));
});

it('groups multiple real vertex drags into one saved history action and restores the selected shape', async () => {
  editor.importGeoJSON(line('editable')); editor.clearHistory(); editor.select('editable');
  const original = editor.exportGeoJSON();
  editor.editSelected();
  for (const [x, y, toX, toY] of [[100, 100, 120, 130], [500, 100, 450, 150]]) {
    await userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), {
      sourcePosition: { x: x!, y: y! }, targetPosition: { x: toX!, y: toY! },
    });
  }
  await userEvent.keyboard('{Control>}z{/Control}');
  expect(editor.getState()).toMatchObject({ mode: 'edit-line', canUndo: false });
  await userEvent.keyboard('{Enter}'); const edited = editor.exportGeoJSON();
  expect(edited).not.toEqual(original);
  expect(editor.undo()).toBe(true); expect(editor.exportGeoJSON()).toEqual(original);
  expect(editor.getState()).toMatchObject({ selectedFeatureId: 'editable', canUndo: false, canRedo: true });
  expect(map.getFeatureState({ source: sourceId(), id: '"editable"' })).toMatchObject({ selected: true });
  expect(editor.redo()).toBe(true); expect(editor.exportGeoJSON()).toEqual(edited);
  expect(map.dragPan.isEnabled()).toBe(true); expect(map.doubleClickZoom.isEnabled()).toBe(true);
});

it('restores deletion, preserves history through style replacement, and handles typed IDs in a batch', async () => {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [line(7), line('7', 250)] });
  const original = editor.exportGeoJSON();
  await expect.poll(renderedIds).toEqual(expect.arrayContaining(['7', '"7"']));
  editor.select(7); editor.deleteSelected(); editor.undo();
  expect(editor.exportGeoJSON()).toEqual(original);
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(renderedIds).toEqual(expect.arrayContaining(['7', '"7"']));
  expect(editor.redo()).toBe(true); await expect.poll(renderedIds).not.toContain('7');
  editor.undo(); editor.select('7'); editor.undo();
  expect(editor.getState()).toMatchObject({ featureCount: 0, selectedFeatureId: null });
  await expect.poll(renderedIds).toEqual([]);
  editor.redo(); expect(editor.exportGeoJSON()).toEqual(original);
  await expect.poll(renderedIds).toEqual(expect.arrayContaining(['7', '"7"']));
});

it('emits one isolated history event and one upload per batch, after data and state are updated', () => {
  const input = { type: 'FeatureCollection', features: [line(0), line('0', 200)] };
  editor.importGeoJSON(input);
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId())!, 'setData');
  const create = vi.fn(); const update = vi.fn(); const removed = vi.fn(); const imported = vi.fn(); const changed = vi.fn();
  editor.onCreate(create); editor.onUpdate(update); editor.onDelete(removed); editor.onImport(imported); editor.onChange(changed);
  const ignored = vi.fn(); editor.onHistory(ignored)();
  editor.onHistory((event) => {
    expect(editor.getState().dataRevision).toBe(event.direction === 'undo' ? 2 : 3);
    expect(editor.getState().featureCount).toBe(event.direction === 'undo' ? 0 : 2);
    const feature = event.changes[0]!.before ?? event.changes[0]!.after;
    (feature!.properties!.nested as { label: string }).label = 'mutated';
    event.changes.length = 0;
  });
  const queued = vi.spyOn(window, 'queueMicrotask').mockImplementation(() => {});
  editor.onHistory(() => { throw new Error('Broken history observer'); });
  const observed = vi.fn<(event: HistoryEvent) => void>(); editor.onHistory(observed);
  expect(editor.undo()).toBe(true);
  expect(observed).toHaveBeenCalledExactlyOnceWith({ direction: 'undo', action: 'import', changes: input.features.map((before) => ({ before, after: null })) });
  expect(upload).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce();
  expect(queued).toHaveBeenCalledOnce(); expect(ignored).not.toHaveBeenCalled();
  editor.redo(); expect(editor.exportGeoJSON()).toEqual(input);
  expect(observed).toHaveBeenLastCalledWith({ direction: 'redo', action: 'import', changes: input.features.map((after) => ({ before: null, after })) });
  expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(removed).not.toHaveBeenCalled(); expect(imported).not.toHaveBeenCalled();
});

it('ignores shortcuts outside map focus and unsupported modifiers, repeats, composition, and empty history', async () => {
  editor.importGeoJSON(line('a'));
  const input = document.createElement('input'); container.append(input); input.focus();
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.getState().featureCount).toBe(1);
  const canvas = map.getCanvas(); canvas.focus();
  for (const init of [
    { altKey: true }, { repeat: true }, { isComposing: true }, { metaKey: true },
  ]) {
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true, ...init });
    canvas.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  }
  const prevented = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });
  prevented.preventDefault(); canvas.dispatchEvent(prevented); expect(editor.getState().featureCount).toBe(1);
  editor.draw('Polygon');
  const active = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }); canvas.dispatchEvent(active);
  expect(active.defaultPrevented).toBe(false); expect(editor.getState().mode).toBe('draw-polygon');
  expect(() => editor.undo()).toThrow('Finish or cancel'); expect(() => editor.redo()).toThrow('Finish or cancel');
  editor.cancel(); editor.undo();
  const empty = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }); canvas.dispatchEvent(empty);
  expect(empty.defaultPrevented).toBe(false);
});

it('does no rendering or events for unavailable actions, and clearing history only changes availability', () => {
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId())!, 'setData');
  const event = vi.fn(); const change = vi.fn(); editor.onHistory(event); editor.onChange(change);
  expect(editor.undo()).toBe(false); expect(editor.redo()).toBe(false); editor.clearHistory();
  expect(upload).not.toHaveBeenCalled(); expect(event).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  editor.importGeoJSON(line('a')); const saved = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  upload.mockClear(); change.mockClear();
  editor.clearHistory();
  expect(editor.exportGeoJSON()).toEqual(saved); expect(editor.getState()).toMatchObject({ canUndo: false, canRedo: false, dataRevision: revision });
  expect(change).toHaveBeenCalledOnce(); expect(upload).not.toHaveBeenCalled(); expect(event).not.toHaveBeenCalled();
  editor.clearHistory(); expect(change).toHaveBeenCalledOnce();
});

it('validates history options before mounting resources and supports the legacy line editor', async () => {
  editor.destroy();
  expect(() => new GeometryEditor(map, { historyLimit: -1 })).toThrow(RangeError);
  expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(['host-background']);
  const legacy = new LineEditor(map, { historyLimit: 1 });
  try {
    const listener = vi.fn(); legacy.onHistory(listener);
    legacy.startLine(); await click(100, 100); await click(500, 100); legacy.finish();
    expect(legacy.undo()).toBe(true); expect(legacy.redo()).toBe(true); expect(listener).toHaveBeenCalledTimes(2);
    legacy.clearHistory(); expect(legacy.getState().canUndo).toBe(false);
  } finally { legacy.destroy(); }
  editor = new GeometryEditor(map, { historyLimit: 0 }); editor.importGeoJSON(line('disabled'));
  expect(editor.getState().canUndo).toBe(false); expect(editor.undo()).toBe(false);
});

it('clears history on destroy and map removal, preserves exported data, and rejects further history commands', () => {
  editor.importGeoJSON(line('a')); const saved = editor.exportGeoJSON(); const event = vi.fn(); editor.onHistory(event);
  editor.destroy();
  expect(editor.getState()).toMatchObject({ canUndo: false, canRedo: false });
  expect(editor.exportGeoJSON()).toEqual(saved); expect(event).not.toHaveBeenCalled();
  expect(() => editor.undo()).toThrow('destroyed'); expect(() => editor.redo()).toThrow('destroyed');
  expect(() => editor.clearHistory()).toThrow('destroyed'); expect(() => editor.onHistory(vi.fn())).toThrow('destroyed');
  editor = new GeometryEditor(map); editor.importGeoJSON(line('b')); map.remove();
  expect(editor.getState()).toMatchObject({ canUndo: false, canRedo: false });
});
