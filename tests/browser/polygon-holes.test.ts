import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type PolygonFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const sourceId = () => Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!;
const draft = () => map.getSource<GeoJSONSource>(Object.keys(map.getStyle().sources).find((id) => id.endsWith('-draft'))!)!;
const position = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const ring = (x: number, y: number, size: number): Coordinate[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]].map(([a, b]) => position(a!, b!));
const saved = () => editor.exportGeoJSON().features[0] as PolygonFeature;
async function ready(): Promise<void> {
  await expect.poll(() => map.queryRenderedFeatures([110, 110], { layers: [sourceId().replace(/-features$/, '-fill')] }).length).toBeGreaterThan(0);
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:600px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
  editor.importGeoJSON({ type: 'Feature', id: 0, properties: { label: 'garden' }, geometry: { type: 'Polygon', coordinates: [ring(80, 80, 440), ring(180, 180, 120)] } });
  editor.select(0); editor.clearHistory(); await ready();
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('picks the filled area and hole outline, but leaves the interior of a hole empty', async () => {
  await userEvent.click(map.getCanvas(), { position: { x: 240, y: 240 } }); expect(editor.getSelected()).toBeNull();
  await userEvent.click(map.getCanvas(), { position: { x: 180, y: 240 } }); expect(editor.getSelected()?.id).toBe(0);
  editor.select(null); await userEvent.click(map.getCanvas(), { position: { x: 110, y: 110 } }); expect(editor.getSelected()?.id).toBe(0);
});

it('draws a hole with keyboard finish, one update/upload, exact history and a complete preview after style reload', async () => {
  const before = saved(); const updated = vi.fn(); const created = vi.fn(); editor.onUpdate(updated); editor.onCreate(created);
  editor.drawHole();
  for (const [x, y] of [[350, 350], [450, 350], [450, 450], [350, 450]]) await userEvent.click(map.getCanvas(), { position: { x: x!, y: y! } });
  expect(editor.getState()).toMatchObject({ mode: 'draw-hole', activeRingIndex: 2, canFinish: true }); expect(saved()).toEqual(before);
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(async () => JSON.stringify(await draft().getData())).toContain('Polygon');
  const preview = await draft().getData();
  if (preview.type !== 'FeatureCollection') throw new Error('Expected preview collection.');
  const geometry = preview.features.find((feature) => feature.geometry?.type === 'Polygon')?.geometry;
  if (geometry?.type !== 'Polygon') throw new Error('Expected polygon preview.');
  expect(geometry.coordinates).toHaveLength(3);
  expect(map.getFeatureState({ source: sourceId(), id: '0' })).toMatchObject({ editing: true });
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId())!, 'setData');
  map.getCanvas().focus(); await userEvent.keyboard('{Enter}');
  expect(updated).toHaveBeenCalledOnce(); expect(created).not.toHaveBeenCalled(); expect(upload).toHaveBeenCalledOnce();
  expect(saved().geometry.coordinates).toHaveLength(3); expect(saved().id).toBe(0); expect(saved().properties).toEqual(before.properties);
  const after = saved(); editor.undo(); expect(saved()).toEqual(before); editor.redo(); expect(saved()).toEqual(after);
  editor.drawHole(); await userEvent.click(map.getCanvas(), { position: { x: 550, y: 550 } }); await userEvent.keyboard('{Escape}'); expect(saved()).toEqual(after);
});

it('edits only the chosen hole through handles, keeps the exterior in preview and prevents invalid saves', async () => {
  const before = saved(); editor.editSelected(1);
  await userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), { sourcePosition: { x: 180, y: 180 }, targetPosition: { x: 160, y: 160 } });
  expect(editor.getDraft()[0]![0]).toBeCloseTo(position(160, 160)[0]); expect(saved()).toEqual(before);
  const result = editor.finish() as PolygonFeature; expect(result.geometry.coordinates[0]).toEqual(before.geometry.coordinates[0]); expect(result.geometry.coordinates[1]).not.toEqual(before.geometry.coordinates[1]);
  editor.undo(); expect(saved()).toEqual(before); editor.editSelected(1); editor.moveVertex(0, position(50, 50));
  expect(editor.getState().canFinish).toBe(false); expect(editor.finish()).toBeNull(); editor.cancel(); expect(saved()).toEqual(before);
});

it('snaps drawing to hole corners and edges, but excludes its own polygon while editing or adding holes', async () => {
  editor.setSnapping({ enabled: true }); editor.draw('LineString');
  await userEvent.click(map.getCanvas(), { position: { x: 183, y: 183 } });
  expect(editor.getSnap()).toMatchObject({ featureId: 0, ringIndex: 1, kind: 'vertex' }); expect(editor.getDraft()[0]).toEqual(saved().geometry.coordinates[1]![0]);
  await userEvent.click(map.getCanvas(), { position: { x: 240, y: 182 } }); expect(editor.getSnap()).toMatchObject({ ringIndex: 1, kind: 'edge' }); editor.cancel();
  editor.select(0); editor.drawHole(); await userEvent.click(map.getCanvas(), { position: { x: 183, y: 183 } }); expect(editor.getSnap()).toBeNull(); editor.cancel();
});

it('deletes a hole through one transaction and keeps selected copies and translated rings independent', () => {
  const before = saved(); const transaction = vi.fn(); editor.onTransaction(transaction);
  editor.deleteHole(1); expect(transaction).toHaveBeenCalledOnce(); expect(saved().geometry.coordinates).toHaveLength(1);
  editor.undo(); expect(saved()).toEqual(before); editor.duplicateSelection([0.001, 0.001]);
  const copy = editor.getSelected() as PolygonFeature; expect(copy.geometry.coordinates).toHaveLength(2);
  editor.translateSelection([0.001, 0]); expect(saved()).toEqual(before); editor.undo(); expect(editor.getSelected()).toEqual(copy);
});
