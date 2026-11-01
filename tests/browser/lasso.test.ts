import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { EditorToolbar, GeometryEditor, type Coordinate, type FeatureId, type GeometryFeature, type LassoOptions } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const position = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const ring = (x: number, y: number, size: number): Coordinate[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]].map(([a, b]) => position(a!, b!));
const point = (id: FeatureId, x: number, y: number): GeometryFeature => ({ type: 'Feature', id, properties: { name: String(id) }, geometry: { type: 'Point', coordinates: position(x, y) } });
const load = (...features: GeometryFeature[]): void => { editor.importGeoJSON({ type: 'FeatureCollection', features }); editor.clearHistory(); };
const loop = (x: number, y: number, size: number) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];
const overlay = () => container.querySelector('[data-geo-lasso]');
const tool = () => container.querySelector<HTMLButtonElement>('[data-tool="lasso"]')!;
const choice = (name: string) => container.querySelector<HTMLSelectElement>(`[data-lasso="${name}"]`)!;
async function stroke(points: { x: number; y: number }[]): Promise<void> {
  await commands.vertexPointer('down', points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) await commands.vertexPointer('move', point.x, point.y);
  await commands.vertexPointer('up', points.at(-1)!.x, points.at(-1)!.y);
}

beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative;'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  await commands.touchContact('end', []); await commands.vertexPointer('up', 650, 450);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});

it('selects the actual freehand region, keeps the camera fixed and makes no geometry uploads or data/history changes', async () => {
  load(point(0, 160, 160), point('0', 260, 220));
  const before = editor.exportGeoJSON(); const center = map.getCenter().toArray();
  const source = map.getSource<GeoJSONSource>(Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!)!;
  const upload = vi.spyOn(source, 'setData'); const changed = vi.fn(); const data = vi.fn();
  editor.onChange(changed); editor.onDataChange(data);
  map.getCanvas().style.cursor = 'help';
  editor.lasso(); expect(changed).toHaveBeenCalledOnce();
  await commands.vertexPointer('down', 100, 100); await commands.vertexPointer('move', 300, 100);
  await expect.poll(overlay).not.toBeNull();
  expect(editor.lasso()).toBe(false); expect(overlay()).not.toBeNull();
  expect(editor.getState().selectedFeatureIds).toEqual([]); expect(changed).toHaveBeenCalledOnce();
  expect(map.dragPan.isEnabled()).toBe(false); expect(map.boxZoom.isEnabled()).toBe(false);
  await commands.vertexPointer('move', 100, 300); await commands.vertexPointer('up', 100, 300);
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: [0], canUndo: false, dataRevision: 1 });
  expect(changed).toHaveBeenCalledTimes(2); expect(data).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  expect(editor.exportGeoJSON()).toEqual(before); expect(overlay()).toBeNull();
  expect(map.getCenter().toArray()).toEqual(center); expect(map.getCanvas().style.cursor).toBe('help');
  expect(map.dragPan.isEnabled()).toBe(true); expect(map.boxZoom.isEnabled()).toBe(true); expect(map.doubleClickZoom.isEnabled()).toBe(true);
});

it('supports precise intersects/contains queries, whole multipart containment, typed IDs and empty polygon holes', () => {
  load(point(0, 120, 120), point('0', 180, 180),
    { type: 'Feature', id: 'line', properties: null, geometry: { type: 'LineString', coordinates: [position(50, 150), position(350, 150)] } },
    { type: 'Feature', id: 'parts', properties: null, geometry: { type: 'MultiPolygon', coordinates: [[ring(130, 130, 10)], [ring(450, 400, 20)]] } },
    { type: 'Feature', id: 'courtyard', properties: null, geometry: { type: 'Polygon', coordinates: [ring(400, 70, 240), ring(440, 110, 140)] } });
  expect(editor.selectByLasso(loop(100, 100, 100))).toEqual([0, '0', 'line', 'parts']);
  expect(editor.getState().selectedFeatureIds).toEqual([0, '0', 'line', 'parts']);
  expect(editor.selectByLasso(loop(100, 100, 100), { match: 'contains' })).toEqual([0, '0']);
  expect(editor.selectByLasso(loop(470, 150, 40))).toEqual([]);
  expect(editor.selectByLasso(loop(430, 150, 20))).toEqual(['courtyard']);
});

it('adds and subtracts from selection while leaving existing undo/redo entries intact', () => {
  load(point(0, 120, 120), point('0', 250, 120), point('other', 400, 120));
  editor.select('other'); editor.translateSelection([0.001, 0]);
  const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  editor.selectByLasso(loop(100, 100, 50), { operation: 'add' });
  expect(editor.getState().selectedFeatureIds).toEqual(['other', 0]);
  editor.selectByLasso(loop(230, 100, 50), { operation: 'add' });
  expect(editor.getState().selectedFeatureIds).toEqual(['other', 0, '0']);
  editor.selectByLasso(loop(100, 100, 50), { operation: 'subtract' });
  expect(editor.getState().selectedFeatureIds).toEqual(['other', '0']);
  editor.selectByLasso(loop(600, 400, 30), { operation: 'add' });
  expect(editor.getState().selectedFeatureIds).toEqual(['other', '0']);
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState()).toMatchObject({ dataRevision: revision, canUndo: true });
  expect(editor.undo()).toBe(true); expect(editor.getState().canRedo).toBe(true);
});

it.each([6, 17])('uses canvas CSS pixels with a scaled canvas, bearing and pitch at zoom %s', async (zoom) => {
  map.jumpTo({ zoom, bearing: 25, pitch: 30 }); load(point(0, 150, 150), point('outside', 350, 350));
  container.style.transformOrigin = 'top left'; container.style.transform = 'scale(.8)';
  editor.lasso({ match: 'contains' });
  await stroke(loop(100, 100, 100).map(({ x, y }) => ({ x: x * .8, y: y * .8 })));
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: [0] });
});

it('discards an unfinished stroke when options change, then applies the new selection operation', async () => {
  load(point(0, 150, 150), point('keep', 350, 350)); editor.selectMany(['keep', 0]);
  editor.lasso(); await commands.vertexPointer('down', 100, 100); await commands.vertexPointer('move', 200, 100);
  await expect.poll(overlay).not.toBeNull();
  editor.setLassoOptions({ operation: 'subtract', match: 'contains' });
  expect(overlay()).toBeNull(); expect(map.dragPan.isEnabled()).toBe(true);
  await commands.vertexPointer('up', 200, 100); expect(editor.getState().selectedFeatureIds).toEqual(['keep', 0]);
  await stroke(loop(100, 100, 100)); expect(editor.getState().selectedFeatureIds).toEqual(['keep']);
});

it('keeps a stroke across redundant same-size resize notifications', async () => {
  load(point(0, 150, 150)); editor.lasso();
  await commands.vertexPointer('down', 100, 100); await commands.vertexPointer('move', 200, 100);
  await expect.poll(overlay).not.toBeNull();
  map.resize();
  expect(overlay()).not.toBeNull(); expect(map.dragPan.isEnabled()).toBe(false);
  await commands.vertexPointer('move', 200, 200); await commands.vertexPointer('move', 100, 200);
  await commands.vertexPointer('up', 100, 200);
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: [0] });
});

it('exposes labelled toolbar choices, keyboard cancellation and responsive controls, including locked features', async () => {
  load(point(0, 150, 150)); editor.setLockedFeatureIds([0]);
  map.addControl(new EditorToolbar(editor, { tools: ['lasso', 'edit'] }));
  await userEvent.click(tool());
  expect(tool().getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector<HTMLButtonElement>('[data-primary]')!.hidden).toBe(true);
  await userEvent.selectOptions(choice('lassoOperation'), 'add'); await userEvent.selectOptions(choice('lassoMatch'), 'contains');
  expect(editor.getLassoOptions()).toEqual({ operation: 'add', match: 'contains' });
  container.style.width = '320px'; map.resize();
  const bounds = container.querySelector('.mm-toolbar-actions')!.getBoundingClientRect();
  expect(bounds.right).toBeLessThanOrEqual(map.getCanvas().getBoundingClientRect().right);
  choice('lassoMatch').focus(); await userEvent.keyboard('{Escape}');
  expect(editor.getState().mode).toBe('idle'); expect(tool().getAttribute('aria-pressed')).toBe('false');
  const resized = new Promise<void>((resolve) => { map.once('idle', () => { resolve(); }); });
  container.style.width = '700px'; map.resize(); await resized;
  editor.lasso({ operation: 'add', match: 'contains' }); await stroke(loop(115, 115, 70));
  expect(editor.getState().mode).toBe('idle');
  expect(editor.getState().selectedFeatureIds).toEqual([0]); expect(editor.isFeatureLocked(0)).toBe(true);
});

it('rejects self-crossing, short and invalid programmatic loops without clearing selection, and permits a corrected stroke', async () => {
  load(point(0, 150, 150)); editor.select(0);
  map.addControl(new EditorToolbar(editor, { tools: ['lasso'] }));
  editor.lasso(); const state = editor.getState();
  expect(() => editor.selectByLasso([{ x: NaN, y: 0 }])).toThrow(TypeError); expect(editor.getState()).toEqual(state);
  expect(() => editor.selectByLasso(loop(100, 100, 100), { match: 'bad' as LassoOptions['match'] })).toThrow(TypeError);
  await stroke([{ x: 300, y: 200 }, { x: 600, y: 450 }, { x: 300, y: 450 }, { x: 600, y: 200 }]);
  expect(editor.getState()).toMatchObject({ mode: 'select-lasso', selectedFeatureIds: [0], validationError: 'self-intersection', canFinish: false });
  expect(container.querySelector<HTMLElement>('.mm-toolbar-notice:not([hidden])')!.textContent).toContain('without crossing');
  expect(editor.finish()).toBeNull(); expect(editor.lasso()).toBe(false);
  await stroke([{ x: 300, y: 250 }, { x: 310, y: 250 }]);
  expect(editor.getState()).toMatchObject({ mode: 'select-lasso', selectedFeatureIds: [0], validationError: 'too-few-vertices' });
  await stroke(loop(400, 100, 100));
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: [], validationError: null });
});

it.each(['Escape', 'blur', 'pointercancel', 'lostpointercapture', 'style', 'camera', 'cancel', 'destroy', 'remove'] as const)(
  'cancels a pending stroke on %s, restores gesture settings and never changes data', async (reason) => {
    load(point(0, 150, 150)); editor.select(0); const before = editor.exportGeoJSON();
    map.dragPan.disable(); map.boxZoom.disable(); map.doubleClickZoom.disable(); map.getCanvas().style.touchAction = 'pan-y';
    let pointerId = -1; map.getCanvas().addEventListener('pointerdown', (event) => { pointerId = event.pointerId; }, { once: true, capture: true });
    editor.lasso(); await commands.vertexPointer('down', 100, 100); await commands.vertexPointer('move', 300, 100);
    await expect.poll(overlay).not.toBeNull();
    if (reason === 'Escape') await userEvent.keyboard('{Escape}');
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'pointercancel' || reason === 'lostpointercapture') map.getCanvas().dispatchEvent(new PointerEvent(reason, { pointerId }));
    if (reason === 'style') {
      const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
    }
    if (reason === 'camera') map.jumpTo({ zoom: 14 });
    if (reason === 'cancel') editor.cancel();
    if (reason === 'destroy') editor.destroy();
    if (reason === 'remove') map.remove();
    expect(overlay()).toBeNull(); expect(map.getCanvas().hasPointerCapture(pointerId)).toBe(false);
    if (reason !== 'remove') { expect(map.dragPan.isEnabled()).toBe(false); expect(map.boxZoom.isEnabled()).toBe(false); }
    expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
    if (reason !== 'remove' && reason !== 'destroy') {
      await commands.vertexPointer('up', 300, 100); expect(editor.getState().selectedFeatureIds).toEqual([0]);
      editor.cancel(); expect(map.getCanvas().style.touchAction).toBe('pan-y'); expect(map.doubleClickZoom.isEnabled()).toBe(false);
    }
  },
);

it('supports a real single-finger stroke and pen stroke, restoring touch behavior afterwards', async () => {
  load(point(0, 150, 150));
  editor.lasso();
  await commands.touchContact('start', [{ id: 1, x: 100, y: 100 }]);
  for (const { x, y } of loop(100, 100, 100).slice(1)) await commands.touchContact('move', [{ id: 1, x, y }]);
  await commands.touchContact('end', []);
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: [0] });
  expect(map.getCanvas().style.touchAction).toBe('');
  editor.lasso({ operation: 'subtract' });
  await commands.penContact('down', 100, 100);
  for (const { x, y } of loop(100, 100, 100).slice(1)) await commands.penContact('move', x, y);
  await commands.penContact('up', 100, 200);
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: [] });
});
