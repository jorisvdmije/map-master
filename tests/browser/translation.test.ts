import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, LineEditor, type Coordinate, type FeatureId, type TransactionEvent } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const sourceId = () => Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!;
const source = () => map.getSource<GeoJSONSource>(sourceId())!;
const marker = (id: FeatureId): unknown => map.getFeatureState({ source: sourceId(), id: JSON.stringify(id) });
const position = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const drag = (x: number, y: number, endX: number, endY: number) => userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), {
  sourcePosition: { x, y }, targetPosition: { x: endX, y: endY },
});
async function fixture(): Promise<void> {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { nested: { name: 'polygon' } }, geometry: { type: 'Polygon', coordinates: [
      [[100, 100], [300, 100], [300, 300], [100, 300], [100, 100]].map(([x, y]) => position(x!, y!)),
    ] } },
    { type: 'Feature', id: '0', properties: { name: 'line' }, geometry: { type: 'LineString', coordinates: [position(350, 180), position(450, 180)] } },
    { type: 'Feature', id: 'far', properties: null, geometry: { type: 'LineString', coordinates: [position(500, 100), position(600, 100)] } },
  ] });
  editor.clearHistory(); editor.selectMany(['0', 0]);
  await expect.poll(() => map.queryRenderedFeatures({ layers: [sourceId()] }).length).toBeGreaterThanOrEqual(3);
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  if (map.getCanvas().isConnected) await commands.vertexPointer('up', 650, 400);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});

it.each([6, 17])('previews only the selected group at zoom %s, commits the exact release once and undoes/redoes as a unit', async (zoom) => {
  map.jumpTo({ zoom, bearing: 25, pitch: 30 }); await fixture();
  const before = editor.exportGeoJSON(); const center = map.getCenter().toArray();
  const start = position(200, 200); const end = position(240, 260);
  const upload = vi.spyOn(source(), 'setData');
  const draftId = Object.keys(map.getStyle().sources).find((id) => id.endsWith('-draft'))!;
  const preview = vi.spyOn(map.getSource<GeoJSONSource>(draftId)!, 'setData');
  const observed = vi.fn<(event: TransactionEvent) => void>(); const change = vi.fn(); const update = vi.fn();
  editor.onTransaction((event) => { event.changes.length = 0; }); editor.onTransaction(observed);
  editor.onChange(change); editor.onUpdate(update);
  await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('move', 230, 240);
  await expect.poll(() => container.querySelectorAll('[data-geo-translation-preview] path').length).toBe(2);
  expect(preview).not.toHaveBeenCalled();
  expect(editor.exportGeoJSON()).toEqual(before); expect(upload).not.toHaveBeenCalled();
  expect(marker(0)).toMatchObject({ selected: true, editing: true }); expect(marker('0')).toMatchObject({ editing: true });
  expect(marker('far')).not.toMatchObject({ editing: true });
  expect(change).not.toHaveBeenCalled(); expect(map.dragPan.isEnabled()).toBe(false);
  const paths = [...container.querySelectorAll('[data-geo-translation-preview] path')];
  expect(paths.map((path) => path.getAttribute('fill'))).toEqual(['none', '#df772e']);
  await commands.vertexPointer('up', 240, 260);
  expect(upload).toHaveBeenCalledOnce(); expect(observed).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled(); expect(observed.mock.calls[0]![0].changes).toHaveLength(2);
  expect(editor.getState()).toMatchObject({ selectedFeatureIds: ['0', 0], dataRevision: 2 });
  expect(map.getCenter().toArray()).toEqual(center); expect(map.dragPan.isEnabled()).toBe(true);
  expect(map.getCanvas().style.cursor).toBe(''); await expect.poll(() => marker(0)).not.toMatchObject({ editing: true });
  const after = editor.exportGeoJSON(); expect(after.features[2]).toEqual(before.features[2]);
  for (const index of [0, 1]) {
    const a = before.features[index]!.geometry; const b = after.features[index]!.geometry;
    if (a.type !== 'LineString' && a.type !== 'Polygon' || b.type !== 'LineString' && b.type !== 'Polygon') throw new Error('Expected simple fixtures');
    const original = a.type === 'Polygon' ? a.coordinates[0]! : a.coordinates;
    const translated = b.type === 'Polygon' ? b.coordinates[0]! : b.coordinates;
    for (let i = 0; i < original.length; i++) {
      expect(translated[i]![0]).toBeCloseTo(original[i]![0] + end[0] - start[0], 10);
      expect(translated[i]![1]).toBeCloseTo(original[i]![1] + end[1] - start[1], 10);
    }
  }
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(before);
  expect(editor.getState().canUndo).toBe(false); expect(editor.getState().selectedFeatureIds).toEqual(['0', 0]);
  editor.redo(); expect(editor.exportGeoJSON()).toEqual(after);
});

it.each(['Escape', 'blur', 'pointercancel', 'lostpointercapture', 'style', 'camera', 'cancel', 'destroy', 'select', 'draw', 'history'] as const)(
  'cancels translation on %s without history or stale release input', async (reason) => {
    await fixture(); const before = editor.exportGeoJSON();
    map.dragPan.disable(); map.getCanvas().style.cursor = 'help';
    let pointerId = -1;
    map.getCanvas().addEventListener('pointerdown', (event) => { pointerId = event.pointerId; }, { once: true });
    await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('move', 250, 250);
    await expect.poll(() => map.getCanvas().style.cursor).toBe('grabbing');
    if (reason === 'Escape') await userEvent.keyboard('{Escape}');
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'pointercancel' || reason === 'lostpointercapture') map.getCanvas().dispatchEvent(new PointerEvent(reason, { pointerId }));
    if (reason === 'style') {
      const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
      map.setStyle(style(), { diff: false }); await loaded;
      expect(marker(0)).toMatchObject({ selected: true });
    }
    if (reason === 'camera') map.jumpTo({ zoom: 14 });
    if (reason === 'cancel') editor.cancel();
    if (reason === 'destroy') editor.destroy();
    if (reason === 'select') editor.select('far');
    if (reason === 'draw') editor.draw('LineString');
    if (reason === 'history') editor.clearHistory();
    expect(map.dragPan.isEnabled()).toBe(false); expect(map.getCanvas().hasPointerCapture(pointerId)).toBe(false);
    if (reason !== 'draw') expect(map.getCanvas().style.cursor).toBe('help');
    await commands.vertexPointer('up', 250, 250);
    expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
    expect(editor.getDraft()).toEqual([]);
    if (!['destroy', 'select', 'draw'].includes(reason)) expect(editor.getState().selectedFeatureIds).toEqual(['0', 0]);
    if (reason !== 'destroy') expect(marker(0)).not.toMatchObject({ editing: true });
  },
);

it('preserves click selection, ignores jitter, supports line drags, and pans on unselected features', async () => {
  await fixture(); const before = editor.exportGeoJSON();
  await userEvent.click(map.getCanvas(), { position: { x: 200, y: 200 } });
  expect(editor.getState().selectedFeatureIds).toEqual([0]);
  await drag(200, 200, 202, 201); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  editor.select('0'); await drag(400, 180, 420, 210); expect(editor.exportGeoJSON()).not.toEqual(before);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before);
  await expect.poll(() => marker('0')).not.toMatchObject({ editing: true });
  const center = map.getCenter().toArray(); await drag(550, 100, 600, 150); map.stop();
  expect(map.getCenter().toArray()).not.toEqual(center); expect(editor.exportGeoJSON()).toEqual(before);
});

it('cancels an out-of-bounds group release and preserves redo', async () => {
  map.jumpTo({ center: [160, 0], zoom: 4 }); await fixture();
  // Offscreen selected member constrains the whole group.
  editor.importGeoJSON({ type: 'Feature', id: 'edge', properties: null, geometry: { type: 'LineString', coordinates: [[179.9, 1], [179.99, 2]] } });
  editor.selectMany([0, 'edge']); editor.translateSelection([-1, 0]); editor.undo();
  const before = editor.exportGeoJSON(); const revision = editor.getState().dataRevision;
  await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('move', 300, 200);
  await expect.poll(() => map.getCanvas().style.cursor).toBe('not-allowed');
  await commands.vertexPointer('up', 300, 200);
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState()).toMatchObject({ canRedo: true, dataRevision: revision });
  expect(marker(0)).not.toMatchObject({ editing: true }); expect(map.dragPan.isEnabled()).toBe(true);
});

it('cancels pending previews before API transactions and exposes translation on the line facade', async () => {
  await fixture(); const before = editor.exportGeoJSON();
  await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('move', 250, 250);
  editor.translateSelection([0.001, 0.001]); const after = editor.exportGeoJSON();
  await commands.vertexPointer('up', 250, 250); expect(editor.exportGeoJSON()).toEqual(after);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  editor.destroy(); const legacy = new LineEditor(map);
  legacy.startLine(); await userEvent.click(map.getCanvas(), { position: { x: 100, y: 100 } });
  await userEvent.click(map.getCanvas(), { position: { x: 200, y: 100 } });
  const line = legacy.finish()!; legacy.select(line.id);
  expect(legacy.translateSelection([0.01, 0])?.changes).toHaveLength(1);
  legacy.undo(); expect(legacy.getSelected()).toEqual(line); legacy.destroy();
});

it('a drag returning to its start is a no-op, and capture commits release outside the canvas', async () => {
  await fixture(); const before = editor.exportGeoJSON();
  const events = vi.fn(); editor.onTransaction(events);
  await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('move', 250, 250);
  await commands.vertexPointer('up', 200, 200);
  expect(editor.exportGeoJSON()).toEqual(before); expect(events).not.toHaveBeenCalled();
  expect(editor.getState()).toMatchObject({ selectedFeatureIds: ['0', 0], canUndo: false });
  await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('up', 750, 250);
  expect(events).toHaveBeenCalledOnce(); expect(editor.exportGeoJSON()).not.toEqual(before);
  expect(map.dragPan.isEnabled()).toBe(true); editor.undo(); expect(editor.exportGeoJSON()).toEqual(before);
});

it('keeps one flowing path per part while moving, with no preview source uploads or animation restarts', async () => {
  await fixture();
  const draftId = Object.keys(map.getStyle().sources).find((id) => id.endsWith('-draft'))!;
  const uploads = vi.spyOn(map.getSource<GeoJSONSource>(draftId)!, 'setData');
  await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('move', 250, 230);
  const paths = () => [...container.querySelectorAll<SVGPathElement>('[data-geo-translation-preview] path')];
  await expect.poll(() => paths().length).toBe(2);
  const polygon = paths()[1]!; const animation = polygon.getAnimations()[0]!;
  const initial = polygon.getAttribute('d'); const time = Number(animation.currentTime);
  await commands.vertexPointer('move', 380, 250);
  await expect.poll(() => polygon.getAttribute('d')).not.toBe(initial);
  expect(paths()[1]).toBe(polygon); expect(polygon.getAnimations()[0]).toBe(animation);
  await expect.poll(() => Number(animation.currentTime)).toBeGreaterThan(time);
  expect(polygon.getAttribute('stroke-dasharray')).toBe('1 8');
  expect(uploads).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  expect(paths()).toHaveLength(0); expect(animation.playState).toBe('idle');
});

it('keeps the exact release visible and the original hidden while committed source processing is delayed', async () => {
  await fixture(); const committed = source(); const upload = committed.setData.bind(committed);
  let resume: (() => void) | undefined;
  vi.spyOn(committed, 'setData').mockImplementationOnce((data) => new Promise<void>((resolve, reject) => {
    resume = () => { void upload(data).then(resolve, reject); };
  }));
  const duringCommit = vi.fn(() => marker(0)); editor.onTransaction(duringCommit);
  const before = editor.exportGeoJSON();
  await commands.vertexPointer('down', 200, 200);
  // No intermediate preview is required: pointerup must draw its own exact position.
  await commands.vertexPointer('up', 480, 200);
  expect(duringCommit).toHaveReturnedWith(expect.objectContaining({ editing: true }));
  expect(marker(0)).toMatchObject({ editing: true });
  const polygon = container.querySelectorAll<SVGPathElement>('[data-geo-translation-preview] path')[1]!;
  const target = editor.exportGeoJSON().features[0]!;
  if (target.geometry.type !== 'Polygon') throw new Error('Expected polygon');
  const first = map.project(target.geometry.coordinates[0]![0]!);
  expect(polygon.getAttribute('d')).toContain(`M${first.x},${first.y}`);
  expect(await committed.getData()).toMatchObject({ features: [{ geometry: before.features[0]!.geometry }, {}, {}] });
  map.triggerRepaint(); await new Promise<void>((resolve) => { map.once('render', () => { resolve(); }); });
  expect(marker(0)).toMatchObject({ editing: true }); expect(polygon.isConnected).toBe(true);
  expect(map.getPaintProperty(sourceId(), 'line-opacity-transition')).toEqual({ duration: 0 });
  resume!();
  await expect.poll(() => container.querySelector('[data-geo-translation-preview]')).toBeNull();
  expect(marker(0)).not.toMatchObject({ editing: true });
  expect(await committed.getData()).toMatchObject({ features: [{ geometry: target.geometry }, {}, {}] });
});

it.each(['undo', 'edit', 'style', 'destroy', 'remove'] as const)('does not let a pending drag transfer overwrite %s', async (action) => {
  await fixture(); const before = editor.exportGeoJSON(); const committed = source(); const upload = committed.setData.bind(committed);
  let finish: (() => void) | undefined;
  vi.spyOn(committed, 'setData').mockImplementationOnce(async (data) => {
    await upload(data);
    await new Promise<void>((resolve) => { finish = resolve; });
  });
  await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('up', 480, 200);
  await expect.poll(() => finish).toBeDefined();
  if (action === 'undo') editor.undo();
  if (action === 'edit') { editor.select(0); editor.editSelected(); }
  if (action === 'style') {
    const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  }
  if (action === 'destroy') editor.destroy();
  if (action === 'remove') map.remove();
  finish!();
  await expect.poll(() => container.querySelector('[data-geo-translation-preview]')).toBeNull();
  if (action === 'undo') expect(editor.exportGeoJSON()).toEqual(before);
  if (action === 'edit') {
    expect(editor.getState().mode).toBe('edit-polygon'); expect(marker(0)).toMatchObject({ editing: true });
  }
  if (action === 'style') expect(marker(0)).not.toMatchObject({ editing: true });
});

it('preserves holes and multipart paths and keeps dots stationary for reduced motion', async () => {
  await fixture();
  const native = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => query === '(prefers-reduced-motion: reduce)'
    ? { ...native(query), matches: true } : native(query));
  const ring = (x: number, y: number, size: number) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]
    .map(([x, y]) => position(x!, y!));
  editor.applyTransaction({ update: [{ type: 'Feature', id: 0, properties: null, geometry: { type: 'MultiPolygon',
    coordinates: [[ring(100, 100, 200), ring(150, 150, 50)], [ring(500, 300, 50)]] } }] });
  editor.select(0);
  await expect.poll(() => map.isSourceLoaded(sourceId())).toBe(true);
  await commands.vertexPointer('down', 120, 120); await commands.vertexPointer('move', 160, 140);
  const paths = () => [...container.querySelectorAll<SVGPathElement>('[data-geo-translation-preview] path')];
  await expect.poll(() => paths().length).toBe(2);
  expect(paths()[0]!.getAttribute('d')!.match(/M/g)).toHaveLength(2);
  expect(paths()[0]!.getAttribute('fill-rule')).toBe('evenodd');
  for (const path of paths()) expect(path.getAnimations()).toHaveLength(0);
  editor.cancel(); expect(paths()).toHaveLength(0);
});
