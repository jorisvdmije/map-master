import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { project, unproject } from '../../src/core/mercator-transform.js';
import { GeometryEditor, type Coordinate, type LineFeature, type TransactionEvent } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] });
const sourceId = (suffix: string) => Object.keys(map.getStyle().sources).find((id) => id.endsWith(suffix))!;
const source = (suffix: string) => map.getSource<GeoJSONSource>(sourceId(suffix))!;
const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const draft = async () => {
  const data = await source('-draft').getData();
  if (data.type !== 'FeatureCollection') throw new Error('Expected collection'); return data.features;
};
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true } });
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { name: 'parcel', kind: 'vertex' }, geometry: { type: 'Polygon', coordinates: [[coordinate(100, 100), coordinate(220, 100), coordinate(220, 200), coordinate(100, 200), coordinate(100, 100)]] } },
    { type: 'Feature', id: '0', properties: null, geometry: { type: 'LineString', coordinates: [coordinate(300, 150), coordinate(400, 200)] } },
  ] }); editor.clearHistory(); editor.selectMany([0, '0']);
});
afterEach(async () => { if (map.getCanvas().isConnected) await commands.vertexPointer('up', 650, 400); vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('scales uniformly in map space, previews without uploads, and saves once with keyboard Undo/Redo', async () => {
  const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  const uploaded = vi.spyOn(source('-features'), 'setData'); const transaction = vi.fn(); const individual = vi.fn(); const history = vi.fn();
  editor.onTransaction(transaction); editor.onUpdate(individual); editor.onCreate(individual); editor.onDelete(individual); editor.onHistory(history);
  expect(editor.scaleSelection()).toBe(true); editor.setScaleFactor(2); const preview = editor.getScalePreview()!;
  const pivot = map.project(editor.getState().scalePivot!);
  const original = map.project((before.features[1] as LineFeature).geometry.coordinates[0]!);
  const rotated = map.project((preview.features[1] as LineFeature).geometry.coordinates[0]!);
  expect(rotated.x).toBeCloseTo(pivot.x + 2 * (original.x - pivot.x), 6);
  expect(rotated.y).toBeCloseTo(pivot.y + 2 * (original.y - pivot.y), 6);
  await expect.poll(draft).toHaveLength(3);
  expect((await draft()).filter((f) => f.geometry.type !== 'Point').map((f) => f.geometry)).toEqual(preview.features.map((f) => f.geometry));
  expect((await draft()).filter((f) => f.properties?.kind === 'transform-pivot')).toHaveLength(1);
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).toMatchObject({ editing: true, selected: true });
  await click(550, 350); await userEvent.keyboard('{Backspace}');
  expect(editor.getSnap()).toBeNull(); expect(editor.getDraft()).toEqual([]); expect(editor.getState().selectedFeatureIds).toEqual([0, '0']);
  expect(editor.exportGeoJSON()).toEqual(before); expect(uploaded).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}'); const after = editor.exportGeoJSON(); expect(after).toEqual(preview);
  expect(uploaded).toHaveBeenCalledOnce(); expect(transaction).toHaveBeenCalledOnce(); expect(individual).not.toHaveBeenCalled();
  expect(editor.getState()).toMatchObject({ mode: 'idle', dataRevision: revision + 1 }); await expect.poll(draft).toHaveLength(0);
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Control>}y{/Control}'); expect(editor.exportGeoJSON()).toEqual(after);
  expect(history.mock.calls[0]![0]).toMatchObject({ action: 'transaction', direction: 'undo' });
});
it('keeps preview/pivot stable through pan, bearing and style changes, then cancels exactly', async () => {
  const before = editor.exportGeoJSON(); editor.scaleSelection(); editor.setScaleFactor(0.7);
  const expected = editor.getScalePreview(); const pivot = editor.getState().scalePivot;
  map.jumpTo({ center: [4.896, 52.373], zoom: 14, bearing: 40 });
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(async () => (await draft()).filter((f) => f.geometry.type !== 'Point').map((f) => f.geometry)).toEqual(expected!.features.map((f) => f.geometry));
  expect(editor.getState().scalePivot).toEqual(pivot); expect(editor.getScalePreview()).toEqual(expected);
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).toMatchObject({ editing: true });
  map.getCanvas().focus(); await userEvent.keyboard('{Escape}'); expect(editor.exportGeoJSON()).toEqual(before);
  expect(editor.getState()).toMatchObject({ canUndo: false, scalePivot: null, scaleFactor: null });
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).not.toHaveProperty('editing');
  await expect.poll(draft).toHaveLength(0);
});
it('shows original geometry for rejected results, blocks Enter, and allows correction', async () => {
  editor.importGeoJSON({ type: 'Feature', id: 'edge', properties: null, geometry: { type: 'LineString', coordinates: [[179, 0], [180, 1]] } });
  editor.clearHistory(); editor.select('edge'); const before = editor.exportGeoJSON(); editor.scaleSelection([179, 0]); editor.setScaleFactor(2);
  expect(editor.getState()).toMatchObject({ scaleError: 'scale-out-of-bounds', canFinish: false });
  await expect.poll(draft).toHaveLength(1); expect((await draft())[0]!.geometry.type).toBe('Point');
  expect(map.getFeatureState({ source: sourceId('-features'), id: '"edge"' })).not.toHaveProperty('editing');
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('scale-features'); expect(editor.exportGeoJSON()).toEqual(before);
  editor.setScaleFactor(0.5); await userEvent.keyboard('{Enter}'); expect(editor.getState()).toMatchObject({ mode: 'idle', canUndo: true });
});
it('isolates listener snapshots and finish return value even when a listener changes selection', () => {
  editor.scaleSelection(); editor.setScaleFactor(1.25); const expected = editor.getScalePreview()!;
  editor.getScalePreview()!.features[0]!.geometry.coordinates.length = 0; editor.getState().scalePivot![0] = 100;
  editor.onTransaction((event) => { event.changes[0]!.after!.geometry.coordinates.length = 0; editor.select(null); });
  const observer = vi.fn<(event: TransactionEvent) => void>(); editor.onTransaction(observer);
  const result = editor.finish()!; expect(result).toEqual(expected.features[0]);
  expect(observer.mock.calls[0]![0].changes[0]!.after).toEqual(expected.features[0]);
  result.geometry.coordinates.length = 0; expect(editor.exportGeoJSON()).toEqual(expected);
});
it('keeps unchanged saves and cancelled edits out of history and restores gesture settings on teardown', async () => {
  const before = editor.exportGeoJSON(); const transaction = vi.fn(); editor.onTransaction(transaction);
  map.doubleClickZoom.disable(); map.dragPan.disable(); map.getCanvas().style.cursor = 'help';
  editor.scaleSelection(); editor.setScaleFactor(1); expect(editor.finish()).toEqual(before.features[0]);
  expect(editor.getState().canUndo).toBe(false); expect(transaction).not.toHaveBeenCalled();
  expect(map.getCanvas().style.cursor).toBe('help'); expect(map.doubleClickZoom.isEnabled()).toBe(false); expect(map.dragPan.isEnabled()).toBe(false);
  map.doubleClickZoom.enable(); editor.scaleSelection(); editor.setScaleFactor(1.5); editor.destroy();
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getScalePreview()).toBeNull(); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  expect(() => editor.scaleSelection()).toThrow('destroyed'); expect(() => editor.setScaleFactor(1)).toThrow('destroyed'); expect(() => editor.finishScale()).toThrow('destroyed');
  await new Promise((resolve) => requestAnimationFrame(resolve)); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  editor = new GeometryEditor(map); editor.importGeoJSON(before); editor.selectMany([0, '0']); editor.scaleSelection(); map.remove();
  expect(editor.getState()).toMatchObject({ mode: 'idle', scaleFactor: null, scalePivot: null });
});
it('does not intercept text entry outside the map and keeps ordinary vertex editing separate', async () => {
  editor.scaleSelection(); editor.setScaleFactor(1.5); const field = document.createElement('input'); document.body.append(field);
  try {
    field.focus(); await userEvent.keyboard('10{Backspace}{Enter}{Escape}'); expect(field.value).toBe('1'); expect(editor.getState().mode).toBe('scale-features');
    editor.cancel(); editor.select(0); editor.editSelected(); expect(() => editor.scaleSelection()).toThrow('Finish or cancel');
  } finally { field.remove(); }
});

const handle = (name = 'se') => container.querySelector<HTMLButtonElement>(`[data-geo-scale-handle="${name}"]`)!;
async function grip(name = 'se') {
  await expect.poll(() => handle(name)).not.toBeNull();
  return { x: parseFloat(handle(name).style.left), y: parseFloat(handle(name).style.top) };
}
function scaledPointer(start: { x: number; y: number }, x: number, y = x) {
  const p = project(map.unproject([start.x, start.y]).toArray()); const pivot = project(editor.getState().scalePivot!);
  return map.project(unproject([pivot[0] + (p[0] - pivot[0]) * x, pivot[1] + (p[1] - pivot[1]) * y]));
}
it.each([
  { name: 'se', x: 1.5, y: 1.5, bearing: 0, pitch: 0 },
  { name: 'e', x: 1.5, y: 1, bearing: 0, pitch: 0 },
  { name: 'n', x: 1, y: 0.5, bearing: 0, pitch: 0 },
  { name: 'nw', x: 1.5, y: 1.5, bearing: 35, pitch: 40 },
  { name: 'w', x: 1.5, y: 1, bearing: 35, pitch: 40 },
  { name: 's', x: 1, y: 0.5, bearing: 35, pitch: 40 },
])('drags $name at bearing $bearing and pitch $pitch, then commits one undoable selection change', async ({ name, x, y, bearing, pitch }) => {
  map.jumpTo({ bearing, pitch });
  const before = editor.exportGeoJSON(); const upload = vi.spyOn(source('-features'), 'setData'); const transaction = vi.fn(); editor.onTransaction(transaction);
  editor.scaleSelection(); const start = await grip(name); const end = scaledPointer(start, x, y);
  const camera = { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  await commands.vertexPointer('down', start.x, start.y); expect(map.dragPan.isEnabled()).toBe(false);
  await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(() => editor.getState().scaleFactorX).toBeCloseTo(x, 3);
  await expect.poll(() => editor.getState().scaleFactorY).toBeCloseTo(y, 3);
  expect(editor.exportGeoJSON()).toEqual(before); expect(upload).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('scale-features');
  await commands.vertexPointer('up', end.x, end.y);
  expect(map.dragPan.isEnabled()).toBe(true); expect(editor.getState().canUndo).toBe(false);
  expect({ center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }).toEqual(camera);
  const expected = editor.getScalePreview(); await userEvent.keyboard('{Enter}'); expect(editor.exportGeoJSON()).toEqual(expected);
  expect(transaction).toHaveBeenCalledOnce(); expect(upload).toHaveBeenCalledOnce(); expect(handle()).toBeNull();
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); editor.redo(); expect(editor.exportGeoJSON()).toEqual(expected);
});
it('preserves the current proportions in a corner drag after independent axis scaling', async () => {
  editor.scaleSelection(); editor.setScaleFactors(2, 0.5); const start = await grip(); const end = scaledPointer(start, 1.25);
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('up', end.x, end.y);
  expect(editor.getState().scaleFactorX).toBeCloseTo(2.5, 3); expect(editor.getState().scaleFactorY).toBeCloseTo(0.625, 3);
});
it('captures outside the map and ignores crossing the pivot without mirroring or collapsing', async () => {
  editor.scaleSelection(); const start = await grip('e'); const far = scaledPointer(start, 4, 1);
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', far.x, far.y);
  await expect.poll(() => editor.getState().scaleFactorX).toBeCloseTo(4, 3);
  const pivot = map.project(editor.getState().scalePivot!);
  await commands.vertexPointer('move', pivot.x - 50, pivot.y);
  expect(editor.getState().scaleFactorX).toBeCloseTo(4, 3);
  const end = scaledPointer(start, 0.5, 1); await commands.vertexPointer('up', end.x, end.y);
  expect(editor.getState().scaleFactorX).toBeCloseTo(0.5, 3); expect(editor.getState().scaleFactorY).toBe(1);
});
it.each(['Escape', 'blur', 'pointercancel', 'capture', 'camera', 'style'] as const)('rolls back only the active drag on %s and ignores late release', async reason => {
  editor.scaleSelection(); editor.setScaleFactors(1.2, 0.8); const original = editor.getScalePreview();
  const start = await grip(); const end = scaledPointer(start, 1.3);
  map.scrollZoom.disable();
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(() => editor.getState().scaleFactorX).toBeCloseTo(1.56, 3);
  if (reason === 'Escape') await userEvent.keyboard('{Escape}');
  if (reason === 'blur') window.dispatchEvent(new Event('blur'));
  if (reason === 'pointercancel' || reason === 'capture') {
    const type = reason === 'capture' ? 'lostpointercapture' : 'pointercancel';
    const event = new PointerEvent(type, { pointerId: 1, bubbles: true });
    handle().dispatchEvent(event);
  }
  if (reason === 'camera') map.jumpTo({ zoom: 14 });
  if (reason === 'style') {
    const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  }
  expect(editor.getState()).toMatchObject({ mode: 'scale-features', scaleFactorX: 1.2, scaleFactorY: 0.8 });
  expect(editor.getScalePreview()).toEqual(original); expect(map.dragPan.isEnabled()).toBe(true); expect(map.scrollZoom.isEnabled()).toBe(false);
  await commands.vertexPointer('up', end.x, end.y); expect(editor.getScalePreview()).toEqual(original);
  await userEvent.keyboard('{Escape}'); expect(editor.getState().mode).toBe('idle'); expect(handle()).toBeNull();
});
it('supports axis-specific keyboard controls, then numeric override and teardown during capture', async () => {
  editor.scaleSelection(); await grip('e'); handle('e').focus();
  await userEvent.keyboard('{ArrowRight}'); expect(editor.getState()).toMatchObject({ scaleFactorX: 1.01, scaleFactorY: 1 });
  handle('n').focus(); await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}'); expect(editor.getState().scaleFactorY).toBe(1.1);
  const start = await grip(); const end = scaledPointer(start, 1.5);
  await commands.vertexPointer('down', start.x, start.y); editor.setScaleFactors(2, 3);
  await commands.vertexPointer('up', end.x, end.y); expect(editor.getState()).toMatchObject({ scaleFactorX: 2, scaleFactorY: 3 });
  const next = await grip('n'); await commands.vertexPointer('down', next.x, next.y); editor.destroy();
  expect(handle()).toBeNull(); expect(map.dragPan.isEnabled()).toBe(true);
});
it('disables collapsed-axis handles and keeps numeric scaling available for a straight line', async () => {
  editor.importGeoJSON({ type: 'Feature', id: 'flat', properties: null, geometry: { type: 'LineString', coordinates: [coordinate(100, 150), coordinate(300, 150)] } });
  editor.select('flat'); editor.scaleSelection(); await grip();
  expect(handle('n').disabled).toBe(true); expect(handle('s').disabled).toBe(true); expect(handle('e').disabled).toBe(false);
  editor.setScaleFactors(1.5, 2); expect(editor.getState().canFinish).toBe(true);
});
