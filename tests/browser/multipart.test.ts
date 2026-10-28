import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type MultiLineFeature, type MultiPolygonFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const sourceId = () => Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!;
const draftSource = () => map.getSource<GeoJSONSource>(Object.keys(map.getStyle().sources).find((id) => id.endsWith('-draft'))!)!;
const point = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const ring = (x: number, y: number, size: number): Coordinate[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]].map(([a, b]) => point(a!, b!));
const saved = () => editor.exportGeoJSON();
const polygons = () => saved().features[0] as MultiPolygonFeature;
const lines = () => saved().features[1] as MultiLineFeature;
async function ready(): Promise<void> {
  await expect.poll(() => map.queryRenderedFeatures([100, 100], { layers: [sourceId().replace(/-features$/, '-fill')] }).length).toBeGreaterThan(0);
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:600px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { name: 'gardens' }, geometry: { type: 'MultiPolygon', coordinates: [[ring(80, 80, 180)], [ring(360, 80, 180), ring(400, 120, 60)]] } },
    { type: 'Feature', id: '0', properties: null, geometry: { type: 'MultiLineString', coordinates: [[point(80, 400), point(260, 400)], [point(360, 400), point(540, 400), point(540, 480)]] } },
  ] });
  editor.clearHistory(); await ready();
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('selects whole multipart features from any component, leaves gaps and holes empty and deduplicates rectangle hits', async () => {
  for (const x of [100, 380]) {
    await userEvent.click(map.getCanvas(), { position: { x, y: 100 } }); expect(editor.getState().selectedFeatureIds).toEqual([0]);
    expect(map.getFeatureState({ source: sourceId(), id: '0' })).toMatchObject({ selected: true });
  }
  for (const x of [310, 430]) {
    await userEvent.click(map.getCanvas(), { position: { x, y: 150 } }); expect(editor.getSelected()).toBeNull();
  }
  await userEvent.keyboard('{Shift>}');
  await userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), { sourcePosition: { x: 50, y: 50 }, targetPosition: { x: 580, y: 300 } });
  await userEvent.keyboard('{/Shift}'); expect(editor.getState().selectedFeatureIds).toEqual([0]);
  for (const x of [100, 380]) {
    await userEvent.click(map.getCanvas(), { position: { x, y: 400 } }); expect(editor.getSelected()?.id).toBe('0');
  }
});

it('edits the second polygon part with a full preview after style reload, one upload/event and exact undo', async () => {
  editor.select(0); const before = saved(); const updated = vi.fn(); editor.onUpdate(updated); editor.editSelected(0, 1);
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(async () => {
    const data = await draftSource().getData();
    return data.type === 'FeatureCollection' ? data.features.filter((f) => f.geometry.type === 'Polygon').length : 0;
  }).toBe(2);
  const preview = await draftSource().getData();
  if (preview.type !== 'FeatureCollection') throw new Error('Expected preview');
  expect(preview.features.filter((f) => f.geometry.type === 'Point' && f.properties?.kind === 'vertex')).toHaveLength(4);
  expect(map.getFeatureState({ source: sourceId(), id: '0' })).toMatchObject({ editing: true, selected: true });
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId())!, 'setData');
  await userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), { sourcePosition: { x: 360, y: 80 }, targetPosition: { x: 340, y: 70 } });
  expect(saved()).toEqual(before); map.getCanvas().focus(); await userEvent.keyboard('{Enter}');
  expect(updated).toHaveBeenCalledOnce(); expect(upload).toHaveBeenCalledOnce();
  expect(polygons().geometry.coordinates[0]).toEqual((before.features[0] as MultiPolygonFeature).geometry.coordinates[0]);
  expect(polygons().geometry.coordinates[1]![1]).toEqual((before.features[0] as MultiPolygonFeature).geometry.coordinates[1]![1]);
  expect(polygons().geometry.coordinates[1]![0]![0]![0]).toBeCloseTo(point(340, 70)[0]);
  const after = saved(); editor.undo(); expect(saved()).toEqual(before); editor.redo(); expect(saved()).toEqual(after);
});

it('keeps invalid component edits pending and cancels hole edits without changing committed geometry', async () => {
  editor.select(0); const before = saved(); const updated = vi.fn(); editor.onUpdate(updated);
  editor.editSelected(0, 1); editor.moveVertex(0, point(150, 150));
  expect(editor.getState().canFinish).toBe(false); expect(editor.finish()).toBeNull(); expect(saved()).toEqual(before);
  map.getCanvas().focus(); await userEvent.keyboard('{Escape}');
  editor.editSelected(1, 1);
  await userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), { sourcePosition: { x: 400, y: 120 }, targetPosition: { x: 390, y: 110 } });
  editor.cancel(); expect(saved()).toEqual(before); expect(updated).not.toHaveBeenCalled();
  expect(editor.getState()).toMatchObject({ activePartIndex: null, activeRingIndex: null, canUndo: false });
});

it('draws a hole on the second polygon part and preserves other parts through finish and hole deletion', async () => {
  editor.select(0); const before = saved(); editor.drawHole(1);
  for (const [x, y] of [[470, 200], [510, 200], [510, 240], [470, 240]]) await userEvent.click(map.getCanvas(), { position: { x: x!, y: y! } });
  await userEvent.click(map.getCanvas(), { position: { x: 470, y: 200 } });
  expect(editor.getState().mode).toBe('idle'); expect(polygons().geometry.coordinates[1]).toHaveLength(3);
  expect(polygons().geometry.coordinates[0]).toEqual((before.features[0] as MultiPolygonFeature).geometry.coordinates[0]);
  editor.deleteHole(2, 1); expect(saved()).toEqual(before); editor.undo(); expect(polygons().geometry.coordinates[1]).toHaveLength(3);
  editor.undo(); expect(saved()).toEqual(before);
});

it('edits the second line part, snaps to nonfirst polygon rings and excludes all parts of the active feature', async () => {
  editor.setSnapping({ enabled: true }); editor.draw('LineString');
  await userEvent.click(map.getCanvas(), { position: { x: 402, y: 122 } });
  expect(editor.getSnap()).toMatchObject({ featureId: 0, partIndex: 1, ringIndex: 1, kind: 'vertex' }); editor.cancel();
  editor.select('0'); const before = saved(); editor.editSelected(0, 1);
  await userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), { sourcePosition: { x: 360, y: 400 }, targetPosition: { x: 100, y: 402 } });
  expect(editor.getSnap()).toBeNull(); expect(editor.getDraft()[0]![1]).toBeCloseTo(point(100, 402)[1]);
  editor.finish(); expect(lines().geometry.type).toBe('MultiLineString'); expect(lines().geometry.coordinates[0]).toEqual((before.features[1] as MultiLineFeature).geometry.coordinates[0]);
  editor.undo(); expect(saved()).toEqual(before);
});

it('moves all components by dragging a nonfirst part, then duplicates and deletes the entire feature', async () => {
  editor.select(0); const before = saved();
  await userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), { sourcePosition: { x: 380, y: 100 }, targetPosition: { x: 390, y: 110 } });
  expect(polygons().geometry.coordinates[0]).not.toEqual((before.features[0] as MultiPolygonFeature).geometry.coordinates[0]);
  expect(polygons().geometry.coordinates[1]).not.toEqual((before.features[0] as MultiPolygonFeature).geometry.coordinates[1]);
  editor.undo(); expect(saved()).toEqual(before);
  const event = editor.duplicateSelection([0.001, 0])!; expect(event.changes).toHaveLength(1);
  expect((editor.getSelected() as MultiPolygonFeature).geometry.coordinates).toHaveLength(2);
  editor.deleteSelected(); expect(saved()).toEqual(before); editor.undo(); expect(editor.getState().featureCount).toBe(3);
  editor.undo(); expect(saved()).toEqual(before);
});
