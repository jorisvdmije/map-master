import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { geometryParts } from '../../src/core/geometry.js';
import { rotateFeatures } from '../../src/core/rotation.js';
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
afterEach(async () => {
  if (map.getCanvas().isConnected) await commands.vertexPointer('up', 650, 400);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});

it('rotates clockwise in map space, previews without uploads, and saves once with keyboard Undo/Redo', async () => {
  const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  const uploaded = vi.spyOn(source('-features'), 'setData'); const transaction = vi.fn(); const individual = vi.fn(); const history = vi.fn();
  editor.onTransaction(transaction); editor.onUpdate(individual); editor.onCreate(individual); editor.onDelete(individual); editor.onHistory(history);
  expect(editor.rotateSelection()).toBe(true); editor.setRotationAngle(90); const preview = editor.getRotationPreview()!;
  const pivot = map.project(editor.getState().rotationPivot!);
  const original = map.project((before.features[1] as LineFeature).geometry.coordinates[0]!);
  const rotated = map.project((preview.features[1] as LineFeature).geometry.coordinates[0]!);
  expect(rotated.x).toBeCloseTo(pivot.x - (original.y - pivot.y), 6);
  expect(rotated.y).toBeCloseTo(pivot.y + (original.x - pivot.x), 6);
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
  const before = editor.exportGeoJSON(); editor.rotateSelection(); editor.setRotationAngle(-30);
  const expected = editor.getRotationPreview(); const pivot = editor.getState().rotationPivot;
  map.jumpTo({ center: [4.896, 52.373], zoom: 14, bearing: 40 });
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(async () => (await draft()).filter((f) => f.geometry.type !== 'Point').map((f) => f.geometry)).toEqual(expected!.features.map((f) => f.geometry));
  expect(editor.getState().rotationPivot).toEqual(pivot); expect(editor.getRotationPreview()).toEqual(expected);
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).toMatchObject({ editing: true });
  map.getCanvas().focus(); await userEvent.keyboard('{Escape}'); expect(editor.exportGeoJSON()).toEqual(before);
  expect(editor.getState()).toMatchObject({ canUndo: false, rotationPivot: null, rotationAngle: null });
  for (const id of ['0', '"0"']) expect(map.getFeatureState({ source: sourceId('-features'), id })).not.toHaveProperty('editing');
  await expect.poll(draft).toHaveLength(0);
});
it('shows original geometry for rejected results, blocks Enter, and allows correction', async () => {
  editor.importGeoJSON({ type: 'Feature', id: 'edge', properties: null, geometry: { type: 'LineString', coordinates: [[179, 0], [180, 1]] } });
  editor.clearHistory(); editor.select('edge'); const before = editor.exportGeoJSON(); editor.rotateSelection([179, 0]); editor.setRotationAngle(90);
  expect(editor.getState()).toMatchObject({ rotationError: 'rotation-out-of-bounds', canFinish: false });
  await expect.poll(draft).toHaveLength(1); expect((await draft())[0]!.geometry.type).toBe('Point');
  expect(map.getFeatureState({ source: sourceId('-features'), id: '"edge"' })).not.toHaveProperty('editing');
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('rotate-features'); expect(editor.exportGeoJSON()).toEqual(before);
  editor.setRotationAngle(-90); await userEvent.keyboard('{Enter}'); expect(editor.getState()).toMatchObject({ mode: 'idle', canUndo: true });
});
it('isolates listener snapshots and finish return value even when a listener changes selection', () => {
  editor.rotateSelection(); editor.setRotationAngle(25); const expected = editor.getRotationPreview()!;
  editor.getRotationPreview()!.features[0]!.geometry.coordinates.length = 0; editor.getState().rotationPivot![0] = 100;
  editor.onTransaction((event) => { event.changes[0]!.after!.geometry.coordinates.length = 0; editor.select(null); });
  const observer = vi.fn<(event: TransactionEvent) => void>(); editor.onTransaction(observer);
  const result = editor.finish()!; expect(result).toEqual(expected.features[0]);
  expect(observer.mock.calls[0]![0].changes[0]!.after).toEqual(expected.features[0]);
  result.geometry.coordinates.length = 0; expect(editor.exportGeoJSON()).toEqual(expected);
});
it('keeps unchanged saves and cancelled edits out of history and restores gesture settings on teardown', async () => {
  const before = editor.exportGeoJSON(); const transaction = vi.fn(); editor.onTransaction(transaction);
  map.doubleClickZoom.disable(); map.dragPan.disable(); map.getCanvas().style.cursor = 'help';
  editor.rotateSelection(); editor.setRotationAngle(360); expect(editor.finish()).toEqual(before.features[0]);
  expect(editor.getState().canUndo).toBe(false); expect(transaction).not.toHaveBeenCalled();
  expect(map.getCanvas().style.cursor).toBe('help'); expect(map.doubleClickZoom.isEnabled()).toBe(false); expect(map.dragPan.isEnabled()).toBe(false);
  map.doubleClickZoom.enable(); editor.rotateSelection(); editor.setRotationAngle(45); editor.destroy();
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getRotationPreview()).toBeNull(); expect(map.doubleClickZoom.isEnabled()).toBe(true);
  expect(() => editor.rotateSelection()).toThrow('destroyed'); expect(() => editor.setRotationAngle(0)).toThrow('destroyed'); expect(() => editor.finishRotation()).toThrow('destroyed');
  await new Promise((resolve) => requestAnimationFrame(resolve)); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  editor = new GeometryEditor(map); editor.importGeoJSON(before); editor.selectMany([0, '0']); editor.rotateSelection(); map.remove();
  expect(editor.getState()).toMatchObject({ mode: 'idle', rotationAngle: null, rotationPivot: null });
});
it('does not intercept text entry outside the map and keeps ordinary vertex editing separate', async () => {
  editor.rotateSelection(); editor.setRotationAngle(15); const field = document.createElement('input'); document.body.append(field);
  try {
    field.focus(); await userEvent.keyboard('10{Backspace}{Enter}{Escape}'); expect(field.value).toBe('1'); expect(editor.getState().mode).toBe('rotate-features');
    editor.cancel(); editor.select(0); editor.editSelected(); expect(() => editor.rotateSelection()).toThrow('Finish or cancel');
  } finally { field.remove(); }
});

const handle = () => container.querySelector<HTMLButtonElement>('[data-geo-rotation-handle]')!;
const box = () => container.querySelector<SVGRectElement>('[data-geo-rotation-box]')!;
async function grip(): Promise<{ x: number; y: number }> {
  await expect.poll(handle).not.toBeNull();
  return { x: parseFloat(handle().style.left), y: parseFloat(handle().style.top) };
}
function rotatedPointer(start: { x: number; y: number }, degrees: number) {
  const point = rotateFeatures([{ type: 'Feature', id: 'pointer', properties: null,
    geometry: { type: 'Point', coordinates: coordinate(start.x, start.y) } }], degrees, editor.getState().rotationPivot!)[0]!;
  if (point.geometry.type !== 'Point') throw new Error('Expected pointer point');
  return map.project(point.geometry.coordinates);
}
function boundsMatch(): boolean {
  const preview = editor.getRotationPreview(); if (!preview || !box()) return false;
  const points = preview.features.flatMap(feature => geometryParts(feature.geometry).flatMap(part =>
    (part.type === 'Point' ? [part.coordinates] : part.type === 'Polygon' ? part.coordinates.flat() : part.coordinates).map(p => map.project(p))));
  const xs = points.map(p => p.x); const ys = points.map(p => p.y);
  const expected = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  return Object.entries(expected).every(([key, value]) => Math.abs(Number(box().getAttribute(key)) - value) < 0.001)
    && !box().hasAttribute('transform');
}

it.each([{ bearing: 0, pitch: 0 }, { bearing: 35, pitch: 40 }])('drags in Mercator space at camera %j with an axis-aligned frame and a single explicit commit', async camera => {
  map.jumpTo(camera);
  const before = editor.exportGeoJSON(); const transaction = vi.fn(); editor.onTransaction(transaction);
  const upload = vi.spyOn(source('-features'), 'setData');
  const cameraBefore = { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  editor.rotateSelection(); editor.setRotationAngle(45); const expected = editor.getRotationPreview(); editor.setRotationAngle(0);
  const start = await grip(); const end = rotatedPointer(start, 45);
  await commands.vertexPointer('down', start.x, start.y);
  expect(map.dragPan.isEnabled()).toBe(false); expect(map.scrollZoom.isEnabled()).toBe(false);
  await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(() => editor.getState().rotationAngle).toBeCloseTo(45, 3);
  await expect.poll(boundsMatch).toBe(true);
  expect(editor.exportGeoJSON()).toEqual(before); expect(upload).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('rotate-features');
  await commands.vertexPointer('up', end.x, end.y);
  expect(editor.getState().rotationAngle).toBeCloseTo(45, 3);
  expect(editor.getState().mode).toBe('rotate-features'); expect(editor.getState().canUndo).toBe(false);
  expect(map.dragPan.isEnabled()).toBe(true); expect(map.scrollZoom.isEnabled()).toBe(true);
  expect({ center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }).toEqual(cameraBefore);
  // Use exact numeric 45° to compare coordinate snapshots, avoiding mouse subpixel roundoff.
  editor.setRotationAngle(45); expect(editor.getRotationPreview()).toEqual(expected);
  await userEvent.keyboard('{Enter}'); expect(editor.exportGeoJSON()).toEqual(expected);
  expect(transaction).toHaveBeenCalledOnce(); expect(upload).toHaveBeenCalledOnce();
  expect(handle()).toBeNull(); editor.undo(); expect(editor.exportGeoJSON()).toEqual(before);
});

it('snaps with Shift without another pointer move and restores the unsnapped angle on keyup', async () => {
  editor.rotateSelection(); const start = await grip(); const end = rotatedPointer(start, 22);
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(() => editor.getState().rotationAngle).toBeCloseTo(22, 3);
  await userEvent.keyboard('{Shift>}'); expect(editor.getState().rotationAngle).toBe(15);
  await userEvent.keyboard('{/Shift}'); expect(editor.getState().rotationAngle).toBeCloseTo(22, 3);
  await userEvent.keyboard('{Shift>}'); await commands.vertexPointer('up', end.x, end.y); await userEvent.keyboard('{/Shift}');
  expect(editor.getState().rotationAngle).toBe(15);
});

it('Escape restores only the current drag, then a second Escape cancels the session without a late release', async () => {
  editor.rotateSelection(); editor.setRotationAngle(20); const before = editor.exportGeoJSON();
  const start = await grip(); const end = rotatedPointer(start, 40);
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(() => editor.getState().rotationAngle).toBeCloseTo(60, 3);
  await userEvent.keyboard('{Escape}');
  expect(editor.getState()).toMatchObject({ mode: 'rotate-features', rotationAngle: 20, canUndo: false });
  await commands.vertexPointer('up', end.x, end.y); expect(editor.getState().rotationAngle).toBe(20);
  await userEvent.keyboard('{Escape}'); expect(editor.getState().mode).toBe('idle');
  expect(editor.exportGeoJSON()).toEqual(before); expect(handle()).toBeNull();
});

it.each(['blur', 'pointercancel', 'lostcapture', 'camera', 'style'])('rolls back an interrupted drag on %s and restores disabled map settings', async interruption => {
  map.dragPan.disable(); map.scrollZoom.disable(); map.dragRotate.disable();
  editor.rotateSelection(); editor.setRotationAngle(10); const start = await grip(); const end = rotatedPointer(start, 25);
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(() => editor.getState().rotationAngle).toBeCloseTo(35, 3);
  if (interruption === 'blur') window.dispatchEvent(new Event('blur'));
  if (interruption === 'pointercancel' || interruption === 'lostcapture') {
    // Chromium mouse pointer ID is 1; use the actual capture owner to verify it.
    expect(handle().hasPointerCapture(1)).toBe(true);
    if (interruption === 'lostcapture') handle().releasePointerCapture(1);
    else window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
  }
  if (interruption === 'camera') map.jumpTo({ bearing: 20 });
  if (interruption === 'style') {
    const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); });
    map.setStyle(style(), { diff: false }); await loaded;
  }
  await expect.poll(() => editor.getState().rotationAngle).toBe(10);
  await commands.vertexPointer('up', end.x, end.y);
  expect(map.dragPan.isEnabled()).toBe(false); expect(map.scrollZoom.isEnabled()).toBe(false); expect(map.dragRotate.isEnabled()).toBe(false);
  expect(map.keyboard.isEnabled()).toBe(true); expect(editor.getState().canUndo).toBe(false);
});

it('rebuilds bounds after camera/resize and follows appearance without changing geometry', async () => {
  editor.rotateSelection(); editor.setRotationAngle(37); await grip(); await expect.poll(boundsMatch).toBe(true);
  const preview = editor.getRotationPreview(); const pivot = editor.getState().rotationPivot;
  map.jumpTo({ bearing: 70, pitch: 45, zoom: 14 }); container.style.width = '600px'; map.resize();
  editor.setAppearance({ selected: { lineColor: '#ff00ff' } });
  await expect.poll(boundsMatch).toBe(true); await expect.poll(() => box().getAttribute('stroke')).toBe('#ff00ff');
  expect(editor.getRotationPreview()).toEqual(preview); expect(editor.getState().rotationPivot).toEqual(pivot);
});

it('provides keyboard angle control on the handle and preserves numeric API edits during a drag', async () => {
  editor.rotateSelection(); await grip(); handle().focus();
  await userEvent.keyboard('{ArrowRight}{Shift>}{ArrowLeft}{/Shift}'); expect(editor.getState().rotationAngle).toBe(-14);
  const start = await grip(); const end = rotatedPointer(start, 35);
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', end.x, end.y);
  editor.setRotationAngle(80); await commands.vertexPointer('up', end.x, end.y);
  expect(editor.getState().rotationAngle).toBe(80);
  handle().focus(); await userEvent.keyboard('{Enter}'); expect(editor.getState()).toMatchObject({ mode: 'idle', canUndo: true });
});

it.each(['lock', 'destroy', 'remove'])('cleans up an active rotation gesture on %s', async reason => {
  const before = editor.exportGeoJSON(); editor.rotateSelection(); const start = await grip(); const end = rotatedPointer(start, 30);
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', end.x, end.y);
  if (reason === 'lock') editor.setLockedFeatureIds([0]);
  if (reason === 'destroy') editor.destroy();
  if (reason === 'remove') map.remove();
  expect(container.querySelector('[data-geo-rotation]')).toBeNull();
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState()).toMatchObject({ mode: 'idle', canUndo: false });
  if (reason !== 'remove') { expect(map.dragPan.isEnabled()).toBe(true); expect(map.keyboard.isEnabled()).toBe(true); }
});

it('keeps click-only gestures unchanged and captures exact release outside the canvas', async () => {
  editor.rotateSelection(); editor.setRotationAngle(23); const start = await grip();
  await userEvent.keyboard('{Shift>}'); await commands.vertexPointer('down', start.x, start.y);
  await commands.vertexPointer('up', start.x, start.y); await userEvent.keyboard('{/Shift}');
  expect(editor.getState().rotationAngle).toBe(23);
  const next = await grip(); const pivot = map.project(editor.getState().rotationPivot!);
  const end = { x: 745, y: 310 };
  const expected = 23 + (Math.atan2(end.y - pivot.y, end.x - pivot.x) - Math.atan2(next.y - pivot.y, next.x - pivot.x)) * 180 / Math.PI;
  await commands.vertexPointer('down', next.x, next.y);
  await commands.vertexPointer('up', end.x, end.y);
  const normalized = ((expected + 180) % 360 + 360) % 360 - 180;
  expect(editor.getState().rotationAngle).toBeCloseTo(normalized, 3);
  expect(editor.getState()).toMatchObject({ mode: 'rotate-features', canUndo: false });
});

it('keeps the handle usable for a point and crosses the signed-angle boundary without jumping', async () => {
  editor.importGeoJSON({ type: 'Feature', id: 'point', properties: null, geometry: { type: 'Point', coordinates: coordinate(350, 250) } });
  editor.clearHistory(); editor.select('point'); const before = editor.exportGeoJSON();
  editor.rotateSelection(); const start = await grip();
  expect(parseFloat(handle().style.top)).toBeLessThan(250);
  await commands.vertexPointer('down', start.x, start.y);
  for (const angle of [80, 170, 190, 270]) {
    const end = rotatedPointer(start, angle); await commands.vertexPointer('move', end.x, end.y);
    await expect.poll(() => editor.getState().rotationAngle).toBeCloseTo(angle > 180 ? angle - 360 : angle, 3);
  }
  const end = rotatedPointer(start, 270); await commands.vertexPointer('up', end.x, end.y);
  editor.finishRotation(); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
});
