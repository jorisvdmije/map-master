import { Map, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { GeometryEditor, type Coordinate } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const errors: string[] = [];
const point = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const finger = (x: number, y: number, id = 1) => ({ id, x, y });
const touch = (action: 'start' | 'move', x: number, y: number) => commands.touchContact(action, [finger(x, y)]);
const end = () => commands.touchContact('end', []);
function fixture(type: 'LineString' | 'Polygon' | 'Point' = 'LineString'): void {
  const geometry = type === 'Polygon' ? { type, coordinates: [[[130, 100], [430, 100], [430, 300], [130, 300], [130, 100]].map(([x, y]) => point(x!, y!))] }
    : type === 'Point' ? { type, coordinates: point(130, 100) }
      : { type, coordinates: [point(130, 100), point(430, 100), point(430, 300)] };
  editor.importGeoJSON({ type: 'Feature', id: 'shape', properties: { name: 'Example' }, geometry });
  editor.clearHistory(); editor.select('shape'); editor.editSelected();
}
beforeEach(async () => {
  errors.length = 0;
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0 });
  map.on('error', event => { errors.push(event.error.message); });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  try {
    await commands.touchContact('cancel', []);
    if (map.getCanvas().isConnected) await commands.penContact('up', 650, 450);
  } finally { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); }
  expect(errors).toEqual([]);
});

it.each(['touch', 'pen'] as const)('moves a corner with %s, preserves contact offset and saves once', async kind => {
  fixture('Polygon'); const original = editor.exportGeoJSON(); const draft = editor.getDraft();
  const center = map.getCenter().toArray(); const updates = vi.fn(); editor.onUpdate(updates);
  const input = async (action: 'down' | 'move' | 'up', x: number, y: number) => kind === 'pen'
    ? commands.penContact(action, x, y) : action === 'up' ? end() : touch(action === 'down' ? 'start' : 'move', x, y);
  const offset = kind === 'touch' ? 18 : 10;
  await input('down', 130 + offset, 100);
  expect(editor.getState().selectedVertexIndices).toEqual([0]); expect(editor.getDraft()).toEqual(draft);
  await input('move', 160 + offset, 120);
  await expect.poll(() => map.project(editor.getDraft()[0]!).x).toBeCloseTo(160, 4);
  await input('up', 160 + offset, 120);
  expect(map.project(editor.getDraft()[0]!).y).toBeCloseTo(120, 4);
  expect(map.getCenter().toArray()).toEqual(center); expect(map.dragPan.isEnabled()).toBe(true);
  expect(editor.exportGeoJSON()).toEqual(original); expect(updates).not.toHaveBeenCalled();
  editor.finish(); const saved = editor.exportGeoJSON(); expect(saved).not.toEqual(original); expect(updates).toHaveBeenCalledOnce();
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getState().canUndo).toBe(false);
  editor.redo(); expect(editor.exportGeoJSON()).toEqual(saved);
});

it('treats small touch jitter as a selection and adds a midpoint on a tap', async () => {
  fixture(); const draft = editor.getDraft(); const clicks = vi.fn(); map.on('click', clicks);
  await touch('start', 148, 100); await touch('move', 150, 101); await end();
  expect(editor.getDraft()).toEqual(draft); expect(editor.getState().selectedVertexIndices).toEqual([0]);
  await touch('start', 280, 118); await end();
  expect(editor.getDraft()).toHaveLength(4); expect(map.project(editor.getDraft()[1]!).x).toBeCloseTo(280, 4);
  expect(map.project(editor.getDraft()[1]!).y).toBeCloseTo(100, 4); expect(clicks).not.toHaveBeenCalled();
  editor.cancel(); expect(editor.getState().canUndo).toBe(false);
});

it('chooses the nearest corner before a midpoint in crowded targets', async () => {
  editor.importGeoJSON({ type: 'Feature', id: 'close', properties: {}, geometry: { type: 'LineString', coordinates: [point(130, 100), point(150, 100), point(400, 250)] } });
  editor.select('close'); editor.editSelected();
  await touch('start', 148, 100); await end();
  expect(editor.getState().selectedVertexIndices).toEqual([1]); expect(editor.getDraft()).toHaveLength(3);
});

it('moves an existing group and snaps its anchor without changing other features', async () => {
  fixture(); editor.cancel();
  editor.importGeoJSON({ type: 'Feature', id: 'target', properties: {}, geometry: { type: 'Point', coordinates: point(200, 200) } });
  editor.select('shape'); editor.editSelected(); editor.selectVertices([0, 1]); editor.setSnapping({ enabled: true });
  const original = editor.exportGeoJSON(); const draft = editor.getDraft();
  await touch('start', 145, 100); await touch('move', 220, 204);
  await expect.poll(() => editor.getSnap()?.featureId).toBe('target'); await end();
  const moved = editor.getDraft(); expect(moved[0]).toEqual(point(200, 200));
  expect(moved[1]![0] - draft[1]![0]).toBeCloseTo(moved[0]![0] - draft[0]![0], 12); expect(moved[2]).toEqual(draft[2]);
  expect(editor.exportGeoJSON()).toEqual(original); editor.cancel();
});

it.each([450, 750])('rolls back on a second finger at x=%s, including outside the canvas', async secondX => {
  fixture(); const draft = editor.getDraft(); const center = map.getCenter().toArray(); const zoom = map.getZoom();
  await touch('start', 130, 100); await touch('move', 170, 120);
  await expect.poll(() => editor.getDraft()).not.toEqual(draft);
  await commands.touchContact('start', [finger(170, 120), finger(secondX, 350, 2)]);
  expect(editor.getDraft()).toEqual(draft); expect(editor.getState().selectedVertexIndices).toEqual([]);
  await commands.touchContact('move', [finger(200, 150), finger(secondX + 30, 380, 2)]); await end();
  expect(editor.getDraft()).toEqual(draft); expect(map.getCenter().toArray()).toEqual(center); expect(map.getZoom()).toBe(zoom);
  await touch('start', 130, 100); await touch('move', 150, 110); await end();
  expect(map.project(editor.getDraft()[0]!).x).toBeCloseTo(150, 4);
});

it('keeps two-finger gestures that start off handles available to the map', async () => {
  fixture(); const draft = editor.getDraft(); const zoom = map.getZoom();
  await commands.touchContact('start', [finger(250, 380), finger(450, 380, 2)]);
  await commands.touchContact('move', [finger(210, 380), finger(490, 380, 2)]);
  await commands.touchContact('move', [finger(170, 380), finger(530, 380, 2)]); await end();
  await expect.poll(() => map.getZoom()).not.toBe(zoom); expect(editor.getDraft()).toEqual(draft);
});

it('rolls back pen movement when a finger lands and consumes that contact sequence', async () => {
  fixture(); const draft = editor.getDraft(); const center = map.getCenter().toArray();
  await commands.penContact('down', 130, 100); await commands.penContact('move', 160, 130);
  await expect.poll(() => editor.getDraft()).not.toEqual(draft);
  await touch('start', 500, 350); expect(editor.getDraft()).toEqual(draft);
  await touch('move', 550, 400); await end(); await commands.penContact('up', 180, 150);
  expect(editor.getDraft()).toEqual(draft); expect(map.getCenter().toArray()).toEqual(center);
});

it('preserves CSS-scaled input offsets and captures release outside the canvas', async () => {
  fixture(); const draft = editor.getDraft(); container.style.transformOrigin = 'top left'; container.style.transform = 'scale(0.8)';
  await touch('start', 148 * 0.8, 100 * 0.8); await touch('move', 178 * 0.8, 120 * 0.8); await end();
  expect(map.project(editor.getDraft()[0]!).x).toBeCloseTo(160, 4);
  expect(map.project(editor.getDraft()[0]!).y).toBeCloseTo(120, 4);
  editor.cancel(); editor.editSelected(); container.style.transform = '';
  await commands.penContact('down', 130, 100); await commands.penContact('move', 730, 130); await commands.penContact('up', 750, 150);
  expect(map.project(editor.getDraft()[0]!).x).toBeCloseTo(750, 4); expect(map.dragPan.isEnabled()).toBe(true);
  editor.cancel(); editor.editSelected(); expect(editor.getDraft()).toEqual(draft);
});

it('leaves edge/background drags to map panning and preserves disabled map handlers', async () => {
  fixture(); const draft = editor.getDraft(); const center = map.getCenter().toArray();
  await touch('start', 200, 100); await touch('move', 240, 120); await touch('move', 270, 140); await end();
  await expect.poll(() => map.getCenter().toArray()).not.toEqual(center); expect(editor.getDraft()).toEqual(draft);
  map.stop(); map.dragPan.disable(); map.touchZoomRotate.disable(); map.touchPitch.disable();
  const p = map.project(editor.getDraft()[0]!);
  await touch('start', p.x, p.y); await touch('move', p.x + 20, p.y + 20); await end();
  expect(map.dragPan.isEnabled()).toBe(false); expect(map.touchZoomRotate.isEnabled()).toBe(false); expect(map.touchPitch.isEnabled()).toBe(false);
});

it.each(['cancel', 'capture', 'blur', 'camera', 'resize', 'style', 'api', 'lock', 'destroy', 'remove'] as const)('cleans up a touch drag on %s and rejects late movement', async reason => {
  fixture(); const original = editor.exportGeoJSON(); const draft = editor.getDraft();
  // Remember the real browser pointer id for capture-loss testing.
  let pointerId = 0; map.getCanvas().addEventListener('pointerdown', event => { pointerId = event.pointerId; }, { once: true });
  await touch('start', 130, 100); await touch('move', 160, 130);
  await expect.poll(() => editor.getDraft()).not.toEqual(draft);
  if (reason === 'cancel') await commands.touchContact('cancel', []);
  if (reason === 'capture') map.getCanvas().releasePointerCapture(pointerId);
  if (reason === 'blur') window.dispatchEvent(new Event('blur'));
  if (reason === 'camera') map.jumpTo({ bearing: 10 });
  if (reason === 'resize') map.fire('resize');
  if (reason === 'style') {
    const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); });
    map.setStyle(style(), { diff: false }); await loaded;
  }
  if (reason === 'api') editor.moveVertex(2, point(460, 320));
  if (reason === 'lock') editor.setLockedFeatureIds(['shape']);
  if (reason === 'destroy') editor.destroy();
  if (reason === 'remove') map.remove();
  if (reason !== 'cancel' && reason !== 'remove') await touch('move', 180, 150);
  await end();
  expect(editor.exportGeoJSON()).toEqual(original);
  if (!['lock', 'destroy', 'remove'].includes(reason)) {
    // API mutation follows the existing mouse contract: it retains the accepted
    // movement, then applies the new command, and rejects subsequent input.
    expect(editor.getDraft()[0]).toEqual(reason === 'api' ? point(160, 130) : draft[0]);
    if (reason === 'api') expect(editor.getDraft()[2]).toEqual(point(460, 320));
  }
  if (reason !== 'remove') expect(map.dragPan.isEnabled()).toBe(true);
});

it('rolls back an inserted midpoint on touch cancellation', async () => {
  fixture(); const draft = editor.getDraft();
  await touch('start', 280, 100); await touch('move', 280, 140);
  expect(editor.getDraft()).toHaveLength(4); await commands.touchContact('cancel', []);
  expect(editor.getDraft()).toEqual(draft); expect(editor.getState().selectedVertexIndices).toEqual([]);
});

it('supports a marker, polygon hole and active multipart component', async () => {
  fixture('Point'); await touch('start', 130, 100); await touch('move', 160, 130); await end(); editor.finish();
  const marker = editor.getSelected()!.geometry; if (marker.type !== 'Point') throw new Error('Expected point');
  expect(map.project(marker.coordinates).x).toBeCloseTo(160, 4);
  editor.importGeoJSON({ type: 'Feature', id: 'multi', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[point(130, 100), point(430, 100)], [point(130, 200), point(430, 200)]] } });
  editor.select('multi'); editor.editSelected(0, 1); const original = editor.exportGeoJSON();
  await touch('start', 130, 200); await touch('move', 150, 220); await end(); editor.finish();
  const geometry = editor.getSelected()!.geometry; if (geometry.type !== 'MultiLineString') throw new Error('Expected multiline');
  expect(geometry.coordinates[0]).toEqual([point(130, 100), point(430, 100)]); expect(map.project(geometry.coordinates[1]![0]!).x).toBeCloseTo(150, 4);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(original);
  const ring = (x: number, y: number, width: number) => [[x, y], [x + width, y], [x + width, y + width], [x, y + width], [x, y]].map(([x, y]) => point(x!, y!));
  editor.importGeoJSON({ type: 'Feature', id: 'hole', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(80, 60, 340), ring(160, 140, 100)] } });
  editor.select('hole'); const before = editor.getSelected()!; editor.editSelected(1);
  await touch('start', 160, 140); await touch('move', 170, 150); await end(); editor.finish();
  const result = editor.getSelected()!.geometry;
  if (result.type !== 'Polygon' || before.geometry.type !== 'Polygon') throw new Error('Expected polygon');
  expect(result.coordinates[0]).toEqual(before.geometry.coordinates[0]);
  expect(result.coordinates[1]).not.toEqual(before.geometry.coordinates[1]);
  editor.undo(); expect(editor.getSelected()).toEqual(before);
});

it('does not turn pen hover, barrel-button or secondary input into editing', () => {
  fixture(); const draft = editor.getDraft(); const bounds = map.getCanvas().getBoundingClientRect();
  for (const options of [{ button: 2, isPrimary: true }, { button: 5, isPrimary: true }, { button: 0, isPrimary: false }]) {
    map.getCanvas().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 90, clientX: bounds.x + 130, clientY: bounds.y + 100, ...options }));
    map.getCanvas().dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'pen', pointerId: 90 }));
  }
  map.getCanvas().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'pen', clientX: bounds.x + 180, clientY: bounds.y + 150 }));
  expect(editor.getDraft()).toEqual(draft); expect(editor.getState().selectedVertexIndices).toEqual([]);
});

it.each(['cancel', 'destroy'] as const)('tolerates host %s from a synchronous touch selection callback', async action => {
  fixture(); const original = editor.exportGeoJSON(); let reacted = false;
  editor.onChange(() => { if (!reacted) { reacted = true; if (action === 'cancel') editor.cancel(); else editor.destroy(); } });
  await touch('start', 130, 100); await touch('move', 170, 150); await end();
  expect(editor.exportGeoJSON()).toEqual(original); expect(map.dragPan.isEnabled()).toBe(true);
});

it('protects shared endpoints and keeps invalid polygon drafts repairable', async () => {
  const ring = (x: number) => [[x, 100], [x + 200, 100], [x + 200, 300], [x, 300], [x, 100]].map(([x, y]) => point(x!, y!));
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'a', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(100)] } },
    { type: 'Feature', id: 'b', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(300)] } },
  ] });
  editor.selectMany(['a', 'b']); editor.editSharedBoundary(); const boundary = editor.getDraft();
  await touch('start', 300, 100); await touch('move', 330, 110); await end(); expect(editor.getDraft()).toEqual(boundary);
  editor.cancel(); editor.select('a'); editor.editSelected();
  await touch('start', 100, 100); await touch('move', 300, 300); await end();
  expect(editor.getState().canFinish).toBe(false); expect(editor.finish()).toBeNull();
  editor.cancel();
});
