import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { EditorToolbar, GeometryEditor, GeofencingError, type Coordinate, type GeofenceArea } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] });
const at = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const area = (id: string, left: number, top: number, right: number, bottom: number): GeofenceArea => ({ id, geometry: { type: 'Polygon', coordinates: [[[left, top], [right, top], [right, bottom], [left, bottom], [left, top]].map(([x, y]) => at(x!, y!))] } });
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const button = (tool: string) => container.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)!;
const notice = () => container.querySelector<HTMLElement>('.mm-geofencing-notice')!;
const fences = () => Object.keys(map.getStyle().sources).filter(id => id.startsWith('geo-geofencing-'));
const committed = () => Object.keys(map.getStyle().sources).find(id => id.endsWith('-features'))!;
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 15, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { geofencing: { enabled: true, allowed: [area('park', 80, 60, 620, 390)], excluded: [area('pond', 380, 160, 480, 260)] }, keyboardShortcuts: { geofencing: [{ key: 'f' }] } });
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { name: 'marker' }, geometry: { type: 'Point', coordinates: at(200, 220) } },
    { type: 'Feature', id: '0', properties: { nested: { keep: ['yes'] } }, geometry: { type: 'LineString', coordinates: [at(120, 330), at(300, 330)] } },
  ] }); editor.clearHistory();
  map.addControl(new EditorToolbar(editor, { tools: ['point', 'line', 'rectangle', 'edit', 'scale', 'geofencing', 'undo', 'redo'] }));
});
afterEach(async () => { await commands.vertexPointer('up', 650, 400); vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('keeps a rejected marker draft visible with actionable feedback and commits only after a valid placement', async () => {
  const before = editor.exportGeoJSON(); const change = vi.fn(); editor.onDataChange(change);
  await userEvent.click(button('point')); await click(660, 100);
  expect(editor.getState()).toMatchObject({ mode: 'draw-point', canFinish: false, geofencingViolations: [{ featureId: null, code: 'outside-allowed-area', areaIds: ['park'] }] });
  expect(notice().hidden).toBe(false); expect(notice().textContent).toContain('park'); expect(editor.exportGeoJSON()).toEqual(before); expect(change).not.toHaveBeenCalled();
  await click(220, 120); expect(editor.getState().mode).toBe('idle'); expect(editor.exportGeoJSON().features).toHaveLength(3); expect(change).toHaveBeenCalledOnce();
  expect(notice().hidden).toBe(true); editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); editor.redo(); expect(editor.exportGeoJSON().features).toHaveLength(3);
});

it('preserves invalid edit and transform previews, disables saving, and restores exact history after correction', () => {
  const before = editor.exportGeoJSON(); editor.select(0); editor.editSelected(); editor.moveVertex(0, at(430, 220));
  expect(editor.getState().canFinish).toBe(false); expect(notice().textContent).toContain('pond'); expect(notice().hidden).toBe(false);
  expect(editor.getDraft()).toEqual([at(430, 220)]); expect(editor.finish()).toBeNull(); expect(editor.exportGeoJSON()).toEqual(before);
  expect(container.querySelector<HTMLButtonElement>('[data-primary]')!.disabled).toBe(true);
  editor.moveVertex(0, at(240, 230)); editor.finish(); const after = editor.exportGeoJSON(); editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); editor.redo(); expect(editor.exportGeoJSON()).toEqual(after);
  editor.select('0'); editor.scaleSelection(); editor.setScaleFactor(10); expect(editor.getScalePreview()).not.toBeNull(); expect(editor.getState().canFinish).toBe(false);
  expect(editor.finishScale()).toBeNull(); expect(editor.getState().mode).toBe('scale-features'); editor.setScaleFactor(1); expect(editor.getState().canFinish).toBe(true); editor.cancel();
});

it('rejects a captured whole-feature drag and keyboard move without committing or panning the map', async () => {
  editor.select(0); const before = editor.exportGeoJSON(); const center = map.getCenter().toArray();
  await expect.poll(() => map.isSourceLoaded(committed())).toBe(true);
  await commands.vertexPointer('down', 200, 220); await commands.vertexPointer('move', 430, 220);
  await expect.poll(() => editor.getState().geofencingViolations[0]?.code).toBe('intersects-excluded-area'); expect(notice().hidden).toBe(false);
  await commands.vertexPointer('up', 430, 220); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false); expect(map.getCenter().toArray()).toEqual(center);
  editor.applyTransaction({ update: [{ ...before.features[0]!, geometry: { type: 'Point', coordinates: at(615, 220) } }] }); editor.clearHistory();
  const nearBoundary = editor.exportGeoJSON(); map.getCanvas().focus(); await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
  expect(editor.exportGeoJSON()).toEqual(nearBoundary); expect(editor.getState().geofencingViolations[0]?.code).toBe('outside-allowed-area'); expect(editor.getState().canUndo).toBe(false);
});

it('toggles policy with the toolbar/keyboard, preserves its configuration and rebuilds overlays on style reload', async () => {
  const before = editor.exportGeoJSON(); expect(fences()).toHaveLength(1); expect(button('geofencing').getAttribute('aria-pressed')).toBe('true');
  const data = await map.getSource<GeoJSONSource>(fences()[0]!)!.getData(); expect(data.type).toBe('FeatureCollection');
  await userEvent.click(button('geofencing')); expect(fences()).toHaveLength(0); expect(editor.getGeofencing().allowed).toHaveLength(1);
  map.getCanvas().focus(); await userEvent.keyboard('f'); expect(fences()).toHaveLength(1); expect(editor.getGeofencing().enabled).toBe(true);
  const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  expect(fences()).toHaveLength(1); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  editor.destroy(); expect(Object.keys(map.getStyle().sources)).toEqual([]);
});

it('rejects mixed programmatic batches and blocked Undo with diagnostics, then re-enables history after a policy change', () => {
  const before = editor.exportGeoJSON(); editor.select(0);
  expect(() => editor.importGeoJSON({ type: 'FeatureCollection', features: [{ ...before.features[0]!, id: 'valid' }, { ...before.features[0]!, id: 'invalid', geometry: { type: 'Point', coordinates: at(650, 220) } }] })).toThrow(GeofencingError);
  expect(() => editor.applyTransaction({ delete: ['0'], update: [{ ...before.features[0]!, geometry: { type: 'Point', coordinates: at(650, 220) } }] })).toThrow(GeofencingError);
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().selectedFeatureIds).toEqual([0]);
  editor.applyTransaction({ update: [{ ...before.features[0]!, geometry: { type: 'Point', coordinates: at(550, 220) } }] });
  editor.setGeofencing({ allowed: [area('east-only', 500, 60, 620, 390)] }); expect(editor.getState().canUndo).toBe(false);
  expect(editor.getHistoryGeofencingViolations('undo')[0]?.featureId).toBe(0); expect(editor.undo()).toBe(false); expect(button('undo').title).toContain('east-only');
  editor.setGeofencing({ allowed: [area('park', 80, 60, 620, 390)] }); expect(editor.undo()).toBe(true); expect(editor.exportGeoJSON()).toEqual(before);
});

it('keeps a rejected rectangle visible, accepts a corrected opposite corner and does not let Alt bypass fencing', async () => {
  await userEvent.click(button('rectangle')); await click(250, 300); await userEvent.keyboard('{Alt>}'); await click(660, 350); await userEvent.keyboard('{/Alt}');
  expect(editor.getState().mode).toBe('draw-rectangle'); expect(editor.getState().canFinish).toBe(false);
  const source = Object.keys(map.getStyle().sources).find(id => id.endsWith('-draft'))!;
  await expect.poll(async () => {
    const data = await map.getSource<GeoJSONSource>(source)!.getData(); return data.type === 'FeatureCollection' && data.features.some(feature => feature.geometry.type === 'Polygon');
  }).toBe(true);
  await userEvent.keyboard('{Alt>}'); await click(300, 350); await userEvent.keyboard('{/Alt}');
  expect(editor.getState().mode).toBe('idle'); expect(editor.exportGeoJSON().features).toHaveLength(3); expect(editor.getState().canUndo).toBe(true);
});

it('updates policy atomically during editing, retains the draft and keeps invalid configuration from interrupting it', () => {
  editor.select(0); editor.editSelected(); editor.moveVertex(0, at(250, 220)); const draft = editor.getDraft();
  expect(() => editor.setGeofencing({ allowed: [area('same', 80, 60, 620, 390), area('same', 80, 60, 620, 390)] })).toThrow(); expect(editor.getDraft()).toEqual(draft);
  editor.setGeofencing({ allowed: [area('small', 80, 60, 220, 390)] }); expect(editor.getState().canFinish).toBe(false); expect(editor.getDraft()).toEqual(draft);
  editor.setGeofencing({ enabled: false }); expect(editor.getState().canFinish).toBe(true); expect(editor.getDraft()).toEqual(draft); editor.cancel(); expect(editor.getState().canUndo).toBe(false);
});
