import { Map, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type GeometryFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const errors: string[] = [];
const point = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const button = () => container.querySelector<HTMLButtonElement>('[data-geo-vertex-focus]')!;
const marker = () => container.querySelector<HTMLElement>('[data-geo-vertex-keyboard-marker]')!;
const message = () => container.querySelector('[data-geo-vertex-keyboard-status]')?.textContent;
const ring = (x: number, y: number, size: number) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]].map(([x, y]) => point(x!, y!));
function fixture(type = 'LineString'): void {
  const geometry = type === 'Polygon' ? { type, coordinates: [ring(130, 100, 210)] }
    : type === 'Point' ? { type, coordinates: point(200, 180) }
      : { type, coordinates: [point(130, 100), point(300, 130), point(400, 300)] };
  editor.importGeoJSON({ type: 'Feature', id: 'shape', properties: { name: 'Example' }, geometry });
  editor.clearHistory(); editor.select('shape'); editor.editSelected();
}
beforeEach(async () => {
  errors.length = 0; container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0 });
  map.on('error', event => { errors.push(event.error.message); });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true } });
});
afterEach(async () => {
  await userEvent.keyboard('{/ArrowRight}{/ArrowUp}{/ArrowLeft}{/Shift}');
  if (map.getCanvas().isConnected) await commands.vertexPointer('up', 650, 450);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); expect(errors).toEqual([]);
});

it('offers one Tab stop, navigates without changing data/selection and returns focus on cancellation', async () => {
  fixture(); const draft = editor.getDraft(); const before = editor.exportGeoJSON();
  expect(document.activeElement).toBe(map.getCanvas());
  await userEvent.keyboard('{Tab}'); expect(document.activeElement).toBe(button());
  expect(marker().hidden).toBe(false); expect(button().getAttribute('aria-describedby')).toBeTruthy();
  await userEvent.keyboard('{PageDown}'); expect(button().textContent).toContain('Vertex 2 of 3');
  await userEvent.keyboard('{End}'); expect(button().textContent).toContain('Vertex 3 of 3');
  await userEvent.keyboard('{PageDown}'); expect(button().textContent).toContain('Vertex 1 of 3');
  await userEvent.keyboard('{PageUp}'); expect(button().textContent).toContain('Vertex 3 of 3');
  expect(editor.getState().selectedVertexIndices).toEqual([]); expect(editor.getDraft()).toEqual(draft);
  expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}'); expect(marker().hidden).toBe(true);
  await userEvent.keyboard('{Tab}'); expect(document.activeElement).toBe(button()); expect(marker().hidden).toBe(false);
  await userEvent.keyboard('{Escape}'); expect(editor.getState().mode).toBe('idle'); expect(button()).toBeNull();
  expect(document.activeElement).toBe(map.getCanvas()); expect(editor.getState().canUndo).toBe(false);
});

it.each([6, 17])('moves the chosen vertex in screen pixels at zoom %s/bearing/pitch and saves once', async zoom => {
  map.jumpTo({ zoom, bearing: 28, pitch: 40 }); fixture();
  const original = editor.exportGeoJSON(); const center = map.getCenter().toArray(); const changed = vi.fn(); editor.onUpdate(changed);
  await userEvent.keyboard('{Home}'); expect(document.activeElement).toBe(button());
  const start = map.project(editor.getDraft()[0]!);
  await userEvent.keyboard('{ArrowRight}{Shift>}{ArrowUp}{/Shift}');
  const next = map.project(editor.getDraft()[0]!);
  expect(next.x - start.x).toBeCloseTo(1, 5); expect(next.y - start.y).toBeCloseTo(-10, 5);
  expect(map.getCenter().toArray()).toEqual(center); expect(editor.getSnap()).toBeNull();
  expect(editor.exportGeoJSON()).toEqual(original); expect(changed).not.toHaveBeenCalled();
  expect(message()).toContain('Movement previewed');
  await userEvent.keyboard('{Enter}'); expect(changed).toHaveBeenCalledOnce();
  const saved = editor.exportGeoJSON(); expect(saved).not.toEqual(original); expect(document.activeElement).toBe(map.getCanvas());
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getState().canUndo).toBe(false);
  editor.redo(); expect(editor.exportGeoJSON()).toEqual(saved);
});

it('toggles a group independently of focus and moves it by one geographic offset', async () => {
  fixture(); const original = editor.exportGeoJSON(); const draft = editor.getDraft();
  await userEvent.keyboard('{Home} {PageDown}{Shift>} {/Shift}');
  expect(editor.getState().selectedVertexIndices).toEqual([0, 1]);
  await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
  const moved = editor.getDraft();
  expect(moved[0]![0] - draft[0]![0]).toBeCloseTo(moved[1]![0] - draft[1]![0], 12);
  expect(moved[0]![1] - draft[0]![1]).toBeCloseTo(moved[1]![1] - draft[1]![1], 12);
  expect(moved[2]).toEqual(draft[2]);
  expect(editor.getState().selectedVertexIndices).toEqual([0, 1]);
  await userEvent.keyboard('{Shift>} {/Shift}'); expect(editor.getState().selectedVertexIndices).toEqual([0]);
  await userEvent.keyboard('{ArrowDown}'); expect(editor.getState().selectedVertexIndices).toEqual([1]);
  await userEvent.keyboard('{Escape}'); expect(editor.exportGeoJSON()).toEqual(original);
});

it('rolls back only a held movement on Escape, suppresses late repeats and keeps earlier released nudges', async () => {
  fixture(); await userEvent.keyboard('{Home}{ArrowDown}'); const earlier = editor.getDraft(); const selection = editor.getState().selectedVertexIndices;
  await userEvent.keyboard('{ArrowRight>}'); expect(editor.getDraft()).not.toEqual(earlier);
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('edit-line');
  await userEvent.keyboard('{Escape}'); expect(editor.getDraft()).toEqual(earlier); expect(editor.getState().selectedVertexIndices).toEqual(selection);
  button().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true, cancelable: true }));
  expect(editor.getDraft()).toEqual(earlier);
  await userEvent.keyboard('{/ArrowRight}{Enter}'); expect(editor.getState().mode).toBe('idle'); expect(editor.getState().canUndo).toBe(true);
});

it.each(['blur', 'focus', 'camera', 'resize', 'style', 'api', 'selection', 'pointer'] as const)('interrupts held movement on %s without overwriting later work', async reason => {
  fixture(); await userEvent.keyboard('{Home}{ArrowDown}'); const earlier = editor.getDraft();
  await userEvent.keyboard('{ArrowRight>}');
  if (reason === 'blur') window.dispatchEvent(new Event('blur'));
  if (reason === 'focus') map.getCanvas().focus();
  if (reason === 'camera') map.jumpTo({ bearing: 15 });
  if (reason === 'resize') map.fire('resize');
  if (reason === 'style') {
    const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); });
    map.setStyle(style(), { diff: false }); await loaded;
  }
  if (reason === 'api') editor.moveVertex(2, point(440, 310));
  if (reason === 'selection') editor.selectVertex(2);
  if (reason === 'pointer') { await commands.vertexPointer('down', 600, 100); await commands.vertexPointer('up', 600, 100); }
  expect(editor.getDraft()[0]).toEqual(earlier[0]);
  const interrupted = editor.getDraft(); await userEvent.keyboard('{/ArrowRight}'); expect(editor.getDraft()).toEqual(interrupted);
  expect(editor.getState().mode).toBe('edit-line'); expect(editor.getState().canUndo).toBe(false);
  if (reason === 'api') expect(interrupted[2]).toEqual(point(440, 310));
});

it('leaves typing, modifiers, composition and canvas arrow navigation alone', async () => {
  fixture(); const original = editor.getDraft();
  const input = document.createElement('input'); document.body.append(input); input.focus();
  await userEvent.keyboard('text{Home}{ArrowRight}'); expect(editor.getDraft()).toEqual(original); input.remove();
  button().focus();
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'isComposing']) {
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', [modifier]: true, bubbles: true, cancelable: true });
    button().dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  }
  expect(editor.getDraft()).toEqual(original);
  map.getCanvas().focus(); await userEvent.keyboard('{ArrowRight}'); expect(editor.getDraft()).toEqual(original);
});

it('preserves minimum counts, invalid draft feedback and recovery before saving', async () => {
  fixture('Polygon'); const original = editor.exportGeoJSON(); const draft = editor.getDraft();
  editor.moveVertex(0, draft[1]!); button().focus();
  expect(button().getAttribute('aria-invalid')).toBe('true');
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('edit-polygon'); expect(message()).toContain('Cannot save');
  editor.moveVertex(0, draft[0]!); await userEvent.keyboard('{Home} {Delete}'); expect(editor.getDraft()).toHaveLength(3);
  await userEvent.keyboard(' {Delete}'); expect(editor.getDraft()).toHaveLength(3); expect(message()).toContain('Cannot remove');
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('idle'); editor.undo(); expect(editor.exportGeoJSON()).toEqual(original);
});

it('supports markers, multipart lines and polygon holes in only the active draft', async () => {
  fixture('Point'); await userEvent.keyboard('{Home}{ArrowRight} {Delete}'); expect(editor.getDraft()).toHaveLength(1);
  await userEvent.keyboard('{Escape}');
  const features: GeometryFeature[] = [
    { type: 'Feature', id: 'multi', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[point(100, 100), point(200, 100)], [point(100, 200), point(200, 200)]] } },
    { type: 'Feature', id: 'holes', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[ring(80, 80, 200), ring(130, 130, 60)], [ring(400, 80, 150)]] } },
  ];
  editor.importGeoJSON({ type: 'FeatureCollection', features }); editor.clearHistory();
  const original = editor.exportGeoJSON();
  editor.select('multi'); editor.editSelected(0, 1); await userEvent.keyboard('{Home}{ArrowRight}{Enter}');
  const multi = editor.getSelected()!; expect(multi.geometry.type).toBe('MultiLineString');
  if (multi.geometry.type !== 'MultiLineString' || features[0]!.geometry.type !== 'MultiLineString') throw new Error('Expected lines');
  expect(multi.geometry.coordinates[0]).toEqual(features[0]!.geometry.coordinates[0]); editor.undo();
  editor.select('holes'); editor.editSelected(1, 0); await userEvent.keyboard('{Home}{ArrowRight}{Enter}');
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(original);
});

it('protects fixed shared endpoints and saves both polygons as one history action', async () => {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'a', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(100, 100, 200)] } },
    { type: 'Feature', id: 'b', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(300, 100, 200)] } },
  ] }); editor.clearHistory(); const original = editor.exportGeoJSON();
  editor.selectMany(['a', 'b']); editor.editSharedBoundary(); const endpoints = editor.getDraft();
  await userEvent.keyboard('{Home}{ArrowRight}'); expect(editor.getDraft()).toEqual(endpoints); expect(message()).toContain('Fixed endpoints');
  editor.insertVertex(1, point(300, 200)); await userEvent.keyboard('{Home}{PageDown}{ArrowRight}{Enter}');
  expect(editor.exportGeoJSON()).not.toEqual(original); editor.undo(); expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getState().canUndo).toBe(false);
});

it.each(['lock', 'cancel', 'destroy', 'remove'] as const)('cleans focus and held movement on %s', async reason => {
  fixture(); const original = editor.exportGeoJSON(); await userEvent.keyboard('{Home}{ArrowRight>}');
  if (reason === 'lock') editor.setLockedFeatureIds(['shape']);
  if (reason === 'cancel') editor.cancel();
  if (reason === 'destroy') editor.destroy();
  if (reason === 'remove') map.remove();
  expect(button()).toBeNull(); expect(marker()).toBeNull();
  await userEvent.keyboard('{/ArrowRight}'); expect(editor.exportGeoJSON()).toEqual(original);
});

it('keeps constant DOM size with many vertices and retains access to an offscreen point', async () => {
  const coordinates = Array.from({ length: 10000 }, (_, i) => point(100 + i / 100, 100 + i / 200));
  editor.importGeoJSON({ type: 'Feature', id: 'large', properties: {}, geometry: { type: 'LineString', coordinates } });
  editor.select('large'); editor.editSelected();
  expect(container.querySelectorAll('[data-geo-vertex-keyboard] button')).toHaveLength(1);
  await userEvent.keyboard('{End}'); expect(button().textContent).toContain('10000 of 10000');
  map.jumpTo({ center: [10, 50] }); expect(marker().hidden).toBe(true); expect(button().isConnected).toBe(true); expect(message()).toContain('Outside view');
});

it('coalesces repeated and simultaneous arrow keys into one cancellable movement', async () => {
  fixture(); await userEvent.keyboard('{Home}'); const original = editor.getDraft();
  await userEvent.keyboard('{ArrowRight>}');
  for (let i = 0; i < 4; i++) button().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true, cancelable: true }));
  await userEvent.keyboard('{ArrowUp>}');
  expect(map.project(editor.getDraft()[0]!).x - map.project(original[0]!).x).toBeCloseTo(5, 5);
  expect(map.project(editor.getDraft()[0]!).y - map.project(original[0]!).y).toBeCloseTo(-1, 5);
  await userEvent.keyboard('{/ArrowRight}{Escape}'); expect(editor.getDraft()).toEqual(original);
  await userEvent.keyboard('{/ArrowUp}{ArrowRight}'); expect(editor.getDraft()).not.toEqual(original);
});

it('rejects an out-of-bounds group atomically and allows motion back into range', async () => {
  map.jumpTo({ center: [179.999, 0], zoom: 5 });
  editor.importGeoJSON({ type: 'Feature', id: 'edge', properties: {}, geometry: { type: 'LineString', coordinates: [[179.9, 0], [180, 0.1]] } });
  editor.select('edge'); editor.editSelected(); editor.selectVertices([0, 1]); button().focus();
  const original = editor.getDraft(); await userEvent.keyboard('{ArrowRight}');
  expect(editor.getDraft()).toEqual(original);
  await userEvent.keyboard('{ArrowLeft}'); expect(editor.getDraft()[0]![0]).toBeLessThan(original[0]![0]);
  expect(editor.getDraft()[1]![0]).toBeLessThan(180);
});

it('switches from a captured mouse drag to keyboard focus without a late release changing the draft', async () => {
  fixture(); const original = editor.getDraft();
  await commands.vertexPointer('down', 130, 100); await commands.vertexPointer('move', 150, 120);
  await expect.poll(() => editor.getDraft()[0]).not.toEqual(original[0]);
  await userEvent.keyboard('{Home}'); expect(editor.getDraft()).toEqual(original);
  await commands.vertexPointer('up', 150, 120); expect(editor.getDraft()).toEqual(original);
  expect(map.dragPan.isEnabled()).toBe(true);
  await userEvent.keyboard('{ArrowRight}'); expect(map.project(editor.getDraft()[0]!).x).toBeCloseTo(131, 5);
});

it.each(['cancel', 'destroy'] as const)('tolerates synchronous host %s during a keyboard move', async action => {
  fixture(); const original = editor.exportGeoJSON(); await userEvent.keyboard('{Home}');
  let reacted = false;
  editor.onChange(() => {
    if (reacted) return; reacted = true;
    if (action === 'cancel') editor.cancel(); else editor.destroy();
  });
  await userEvent.keyboard('{ArrowRight}');
  expect(button()).toBeNull(); expect(editor.exportGeoJSON()).toEqual(original);
});
