import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { FeatureLockedError, GeometryEditor, LineEditor, type Coordinate, type FeatureId } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const errors: string[] = [];
const sourceId = () => Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!;
const position = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const border = () => container.querySelector('[data-geo-draft-border] [data-geo-border]');
async function fixture(): Promise<void> {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: {}, geometry: { type: 'Polygon', coordinates: [
      [[100, 100], [300, 100], [300, 300], [100, 300], [100, 100]].map(([x, y]) => position(x!, y!)),
    ] } },
    { type: 'Feature', id: '0', properties: {}, geometry: { type: 'LineString', coordinates: [position(350, 180), position(450, 180)] } },
  ] });
  editor.clearHistory(); editor.select(0);
  await expect.poll(() => map.queryRenderedFeatures({ layers: [sourceId()] }).length).toBeGreaterThanOrEqual(2);
}
beforeEach(async () => {
  errors.length = 0;
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0 });
  map.on('error', (event) => { errors.push(event.error.message); });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  if (map.getCanvas().isConnected) await commands.vertexPointer('up', 650, 400);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
  expect(errors).toEqual([]);
});

it('enforces API and keyboard locks without uploads or mutation events, leaving selection and snapping available', async () => {
  await fixture(); const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId())!, 'setData');
  const changed = vi.fn(); const transaction = vi.fn(); const deleted = vi.fn();
  editor.onChange(changed); editor.onTransaction(transaction); editor.onDelete(deleted);
  editor.setLockedFeatureIds([0]); editor.setLockedFeatureIds([0, 0]);
  expect(changed).toHaveBeenCalledOnce(); expect(upload).not.toHaveBeenCalled();
  expect(editor.editSelected()).toBe(false); expect(editor.deleteSelected()).toBeNull();
  map.getCanvas().focus(); await userEvent.keyboard('{Delete}');
  editor.selectMany(['0', 0]); await userEvent.keyboard('{Backspace}');
  expect(editor.deleteSelection()).toBeNull(); expect(editor.translateSelection([0.001, 0])).toBeNull();
  expect(() => editor.applyTransaction({ delete: ['0', 0] })).toThrow(FeatureLockedError);
  expect(transaction).not.toHaveBeenCalled(); expect(deleted).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().dataRevision).toBe(revision);
  editor.select(null); await userEvent.click(map.getCanvas(), { position: { x: 200, y: 200 } });
  expect(editor.getState().selectedFeatureIds).toEqual([0]);
  editor.setSnapping({ enabled: true }); editor.draw('LineString');
  await userEvent.click(map.getCanvas(), { position: { x: 550, y: 350 } });
  await commands.vertexPointer('move', 104, 102);
  await expect.poll(() => editor.getSnap()?.featureId).toBe(0);
  expect(editor.getSnap()?.kind).toBe('vertex');
  editor.cancel(); editor.select('0'); expect(editor.editSelected()).toBe(true); editor.cancel();
});

it('prevents moving a locked mixed selection by pointer and cancels an in-flight translation on locking', async () => {
  await fixture(); editor.selectMany([0, '0']); const before = editor.exportGeoJSON();
  const event = vi.fn(); editor.onTransaction(event);
  await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('move', 240, 240);
  await expect.poll(() => container.querySelector('[data-geo-translation-preview]')).not.toBeNull();
  editor.setLockedFeatureIds(['0']);
  expect(container.querySelector('[data-geo-translation-preview]')).toBeNull();
  expect(map.dragPan.isEnabled()).toBe(true);
  await commands.vertexPointer('up', 260, 260);
  expect(event).not.toHaveBeenCalled(); expect(editor.exportGeoJSON()).toEqual(before);
  map.dragPan.disable(); // Hold the camera still to isolate editor movement.
  await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('move', 250, 250);
  expect(container.querySelector('[data-geo-translation-preview]')).toBeNull();
  await commands.vertexPointer('up', 250, 250);
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
});

it('locks during a real vertex drag, discards the draft and releases capture without stale commits', async () => {
  await fixture(); const before = editor.exportGeoJSON(); editor.editSelected();
  await expect.poll(() => border()).not.toBeNull();
  await commands.vertexPointer('down', 100, 100); await commands.vertexPointer('move', 120, 130);
  await expect.poll(() => editor.getDraft()[0]).not.toEqual(position(100, 100));
  editor.setLockedFeatureIds([0]);
  expect(editor.getState().mode).toBe('idle'); expect(border()).toBeNull();
  expect(map.dragPan.isEnabled()).toBe(true); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  await commands.vertexPointer('up', 160, 160);
  expect(editor.finish()).toBeNull(); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  editor.setLockedFeatureIds([]); expect(editor.editSelected()).toBe(true); editor.cancel();
});

it('validates locks before interrupting drafts and preserves unrelated drafts and history across style replacement', async () => {
  await fixture(); editor.editSelected(); editor.moveVertex(1, position(320, 90));
  const draft = editor.getDraft(); const state = editor.getState();
  expect(() => editor.setLockedFeatureIds([0, false] as unknown as FeatureId[])).toThrow(TypeError);
  expect(editor.getState()).toEqual(state); expect(editor.getDraft()).toEqual(draft);
  editor.setLockedFeatureIds(['0']); expect(editor.getDraft()).toEqual(draft);
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(() => border()).not.toBeNull();
  expect(editor.isFeatureLocked('0')).toBe(true); expect(editor.getDraft()).toEqual(draft);
  editor.finish(); editor.setLockedFeatureIds([0, '0']);
  expect(editor.getState().canUndo).toBe(false); expect(editor.undo()).toBe(false);
  map.getCanvas().focus(); await userEvent.keyboard('{Control>}z{/Control}');
  expect(editor.getState().canUndo).toBe(false);
  editor.setLockedFeatureIds(['0']); expect(editor.undo()).toBe(true);
  editor.setLockedFeatureIds([0, '0']); expect(editor.getState().canRedo).toBe(false); expect(editor.redo()).toBe(false);
  editor.setLockedFeatureIds(['0']); expect(editor.redo()).toBe(true);
});

it('accepts constructor locks for imported references, isolates snapshots, and forwards through the legacy facade', async () => {
  editor.destroy();
  expect(() => new GeometryEditor(map, { lockedFeatureIds: [NaN] })).toThrow(TypeError);
  expect(Object.keys(map.getStyle().sources)).toEqual([]);
  const ids: FeatureId[] = [0]; editor = new GeometryEditor(map, { lockedFeatureIds: ids }); ids.push('0');
  await fixture(); editor.getLockedFeatureIds().push('0');
  expect(editor.isFeatureLocked('0')).toBe(false); expect(editor.editSelected()).toBe(false);
  editor.destroy();
  expect(editor.getLockedFeatureIds()).toEqual([0]); expect(() => editor.setLockedFeatureIds([])).toThrow('destroyed');
  const legacy = new LineEditor(map, { lockedFeatureIds: ['0'] });
  try {
    legacy.startLine();
    await userEvent.click(map.getCanvas(), { position: { x: 350, y: 180 } });
    await userEvent.click(map.getCanvas(), { position: { x: 450, y: 180 } });
    const feature = legacy.finish()!; legacy.select(feature.id); legacy.setLockedFeatureIds([feature.id]);
    expect(legacy.getLockedFeatureIds()).toEqual([feature.id]); expect(legacy.isFeatureLocked(feature.id)).toBe(true);
    expect(legacy.editSelected()).toBe(false); expect(legacy.deleteSelected()).toBeNull();
    legacy.setLockedFeatureIds([]); expect(legacy.editSelected()).toBe(true); legacy.cancel();
  } finally { legacy.destroy(); }
  editor = new GeometryEditor(map); expect(editor.getLockedFeatureIds()).toEqual([]);
});
