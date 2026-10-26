import { Map, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, type FeatureId } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
let map: Map; let editor: GeometryEditor; let container: HTMLDivElement;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] });
const hitIds = (x = 300, y = 240) => editor.queryFeatures({ x, y }).map(f => f.id);
const click = (x = 300, y = 240) => userEvent.click(map.getCanvas(), { position: { x, y } });
const coordinate = (x: number, y: number) => map.unproject([x, y]).toArray();
async function polygons(ids: FeatureId[] = ['bottom', 'top']) {
  const coordinates = [[100, 100], [500, 100], [500, 350], [100, 350], [100, 100]].map(([x, y]) => coordinate(x!, y!));
  editor.importGeoJSON({ type: 'FeatureCollection', features: ids.map(id => ({ type: 'Feature', id, properties: { name: String(id), nested: { value: 1 } },
    geometry: { type: 'Polygon', coordinates: [coordinates] } })) });
  await expect.poll(() => hitIds().length).toBe(ids.length);
  editor.clearHistory();
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('returns every overlap in picking order, deduplicates typed IDs and isolates snapshots without events or history', async () => {
  await polygons([1, '1']);
  const original = editor.exportGeoJSON(); const changed = vi.fn(); editor.onChange(changed);
  expect(hitIds()).toEqual(['1', 1]);
  expect(new Set(hitIds(100, 200))).toEqual(new Set([1, '1']));
  const hits = editor.queryFeatures({ x: 300, y: 240 });
  hits[0]!.properties!.name = 'Changed';
  hits[0]!.geometry.coordinates.length = 0;
  expect(editor.exportGeoJSON()).toEqual(original);
  expect(editor.getState()).toMatchObject({ selectedFeatureId: null, canUndo: false });
  expect(changed).not.toHaveBeenCalled();
  await click(); expect(editor.getSelected()?.id).toBe('1');
});

it('prioritizes markers and lines before interiors, excludes holes and host layers', async () => {
  await polygons();
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'line', properties: null, geometry: { type: 'LineString', coordinates: [coordinate(200, 240), coordinate(400, 240)] } },
    { type: 'Feature', id: 'marker', properties: null, geometry: { type: 'Point', coordinates: coordinate(300, 240) } },
  ] });
  await expect.poll(() => hitIds()).toEqual(['marker', 'line', 'top', 'bottom']);
  map.addSource('host', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coordinate(300, 240) } } });
  map.addLayer({ id: 'host', type: 'circle', source: 'host' });
  await expect.poll(() => map.queryRenderedFeatures({ layers: ['host'] }).length).toBeGreaterThan(0);
  expect(hitIds()).toEqual(['marker', 'line', 'top', 'bottom']);
  const hole = [[200, 180], [400, 180], [400, 300], [200, 300], [200, 180]].map(([x,y]) => coordinate(x!,y!));
  const feature = editor.exportGeoJSON().features[0]!;
  if (feature.geometry.type !== 'Polygon') throw new Error('Expected polygon');
  feature.geometry.coordinates.push(hole);
  editor.applyTransaction({ update: [feature] });
  await expect.poll(() => hitIds()).toEqual(['marker', 'line', 'top']);
});

it('ignores stale deleted hits, validates screen points, and disables queries during editing and after destroy', async () => {
  await polygons();
  const stale = map.queryRenderedFeatures([300, 240]);
  editor.select('top'); editor.deleteSelected();
  const query = vi.spyOn(map, 'queryRenderedFeatures').mockReturnValue(stale);
  expect(hitIds()).toEqual(['bottom']); query.mockRestore();
  expect(hitIds(-1, 240)).toEqual([]); expect(hitIds(701, 240)).toEqual([]);
  expect(() => hitIds(NaN)).toThrow(TypeError);
  editor.select('bottom'); editor.editSelected(); expect(hitIds()).toEqual([]); editor.cancel();
  editor.destroy(); expect(() => hitIds()).toThrow('destroyed');
});

it('lets a selected underlying shape drag through an overlap, cancels cleanly and saves one Undo', async () => {
  await polygons(); editor.select('bottom'); const original = editor.exportGeoJSON();
  await commands.vertexPointer('down', 300, 240); await commands.vertexPointer('move', 320, 260);
  await expect.poll(() => map.getCanvas().style.cursor).toBe('grabbing');
  expect(hitIds()).toEqual([]);
  await userEvent.keyboard('{Escape}'); await commands.vertexPointer('up', 320, 260);
  expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getState().canUndo).toBe(false);
  await userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), { sourcePosition: { x: 300, y: 240 }, targetPosition: { x: 320, y: 260 } });
  expect(editor.exportGeoJSON().features[0]).not.toEqual(original.features[0]);
  expect(editor.exportGeoJSON().features[1]).toEqual(original.features[1]);
  expect(editor.undo()).toBe(true); expect(editor.exportGeoJSON()).toEqual(original); expect(editor.undo()).toBe(false);
});

it('allows locked candidates to be selected and preserves results after bearing, pitch and style changes', async () => {
  await polygons(); editor.setLockedFeatureIds(['bottom']); editor.select('bottom');
  expect(editor.queryFeatures({ x: 300, y: 240 }).map(f => f.id)).toContain('bottom');
  const center = coordinate(300, 240);
  map.jumpTo({ bearing: 30, pitch: 35 });
  const point = map.project(center);
  await expect.poll(() => editor.queryFeatures(point).map(f => f.id)).toEqual(['top', 'bottom']);
  const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(() => editor.queryFeatures(point).map(f => f.id)).toEqual(['top', 'bottom']);
  expect(editor.getSelected()?.id).toBe('bottom');
});
