import { Map, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const errors: string[] = [];
const position = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const markerLayer = () => map.getStyle().layers.find(layer => layer.id.endsWith('-markers'))!.id;
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
async function place(x = 200, y = 180): Promise<string | number> {
  editor.draw('Point'); await click(x, y);
  await expect.poll(() => map.queryRenderedFeatures([x, y], { layers: [markerLayer()] }).length).toBeGreaterThan(0);
  return editor.exportGeoJSON().features.at(-1)!.id;
}
beforeEach(async () => {
  errors.length = 0;
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0 });
  map.on('error', event => { errors.push(event.error.message); });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  if (map.getCanvas().isConnected) await commands.vertexPointer('up', 650, 400);
  editor.destroy(); map.remove(); container.remove(); expect(errors).toEqual([]);
});

it('previews and places one marker per activation, then selects, deletes and restores its identity', async () => {
  const created = vi.fn(); editor.onCreate(created);
  editor.draw('Point'); await commands.vertexPointer('move', 200, 180);
  const draftId = Object.keys(map.getStyle().sources).find(id => id.endsWith('-draft'))!;
  await expect.poll(() => map.queryRenderedFeatures([200, 180], { layers: [draftId.replace(/-draft$/u, '-draft-marker')] }).length).toBeGreaterThan(0);
  expect(editor.exportGeoJSON().features).toHaveLength(0);
  await userEvent.keyboard('{Escape}'); expect(editor.getState().mode).toBe('idle'); expect(editor.getState().canUndo).toBe(false);
  const id = await place(); expect(created).toHaveBeenCalledOnce(); expect(editor.getState().mode).toBe('idle');
  await click(200, 180); expect(editor.getSelected()?.id).toBe(id); expect(editor.getState().featureCount).toBe(1);
  const saved = editor.exportGeoJSON();
  await userEvent.keyboard('{Delete}'); expect(editor.getState().featureCount).toBe(0);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(saved);
});

it('drags a marker with a visible synchronous preview, cancels safely and commits one history action', async () => {
  const id = await place(); editor.select(id); const original = editor.exportGeoJSON(); editor.clearHistory();
  const transaction = vi.fn(); editor.onTransaction(transaction);
  await commands.vertexPointer('down', 200, 180); await commands.vertexPointer('move', 260, 220);
  const overlay = () => container.querySelector('[data-geo-translation-preview] [data-geo-marker]');
  await expect.poll(() => Number(overlay()?.getAttribute('cx'))).toBeCloseTo(260, 5);
  expect(editor.exportGeoJSON()).toEqual(original);
  await userEvent.keyboard('{Escape}'); await commands.vertexPointer('up', 260, 220);
  expect(editor.exportGeoJSON()).toEqual(original); expect(transaction).not.toHaveBeenCalled();
  await commands.vertexPointer('down', 200, 180); await commands.vertexPointer('move', 260, 220); await commands.vertexPointer('up', 260, 220);
  expect(transaction).toHaveBeenCalledOnce(); expect(editor.getSelected()?.geometry.type).toBe('Point');
  const moved = editor.getSelected()!.geometry.coordinates as Coordinate;
  expect(map.project(moved).x).toBeCloseTo(260, 5); expect(map.project(moved).y).toBeCloseTo(220, 5);
  await expect.poll(() => overlay()).toBeNull(); expect(map.dragPan.isEnabled()).toBe(true);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(original);
});

it('snaps placement and vertex edits to other markers, excludes self, and enforces locks', async () => {
  const reference = await place(400, 200); editor.setLockedFeatureIds([reference]);
  editor.setSnapping({ enabled: true }); editor.setTracing({ enabled: true }); editor.setDrawingConstraints({ enabled: true });
  const id = await place(405, 204);
  expect(editor.exportGeoJSON().features[1]!.geometry).toEqual(editor.exportGeoJSON().features[0]!.geometry);
  editor.select(id); editor.editSelected(); editor.moveVertex(0, position(200, 180)); editor.finish();
  editor.editSelected(); await commands.vertexPointer('down', 200, 180); await commands.vertexPointer('move', 403, 202);
  await expect.poll(() => editor.getSnap()?.featureId).toBe(reference);
  await commands.vertexPointer('up', 403, 202);
  expect(editor.getDraft()).toEqual([editor.exportGeoJSON().features[0]!.geometry.coordinates]);
  editor.setLockedFeatureIds([reference, id]); expect(editor.getState().mode).toBe('idle');
  expect(editor.getSelected()?.geometry.coordinates).toEqual(position(200, 180));
  expect(editor.editSelected()).toBe(false); expect(editor.deleteSelected()).toBeNull();
});

it('restores marker styling and selection after a style reload, and cleans up on destroy/remount', async () => {
  const id = await place(); editor.select(id); const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  editor.setAppearance({ marker: { color: '#123456', radius: 11 }, selectedMarker: { color: '#abcdef' } });
  expect(() => editor.setAppearance({ marker: { radius: -1 } })).toThrow();
  const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(() => map.queryRenderedFeatures([200, 180], { layers: [markerLayer()] }).length).toBeGreaterThan(0);
  expect(map.getPaintProperty(markerLayer(), 'circle-color')).toEqual(['case', ['boolean', ['feature-state', 'selected'], false], '#abcdef', '#123456']);
  expect(editor.getState().dataRevision).toBe(revision); expect(editor.exportGeoJSON()).toEqual(before);
  editor.select(null); await click(200, 180); expect(editor.getSelected()?.id).toBe(id);
  editor.destroy(); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  editor = new GeometryEditor(map); await place(300, 250); expect(editor.getState().featureCount).toBe(1);
});

it('includes markers in rectangle selection with lines and polygons', async () => {
  const id = await place();
  editor.importGeoJSON({ type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [position(280, 180), position(350, 200)] } });
  const sourceId = Object.keys(map.getStyle().sources).find(key => key.endsWith('-features'))!;
  await expect.poll(() => map.queryRenderedFeatures({ layers: [sourceId] }).length).toBeGreaterThan(0);
  await userEvent.keyboard('{Shift>}'); await commands.vertexPointer('down', 150, 130); await commands.vertexPointer('move', 380, 240); await commands.vertexPointer('up', 380, 240); await userEvent.keyboard('{/Shift}');
  expect(new Set(editor.getState().selectedFeatureIds)).toEqual(new Set([id, 'line']));
});
