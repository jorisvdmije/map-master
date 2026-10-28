import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { project, unproject } from '../../src/core/mercator-transform.js';
import { GeometryEditor, type Coordinate, type LineFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
type Kind = 'buffer' | 'offset';
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const radius = 6378137;
// Browser mouse coordinates have subpixel rounding; compare dragged distances within 0.5 mm.
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] });
const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const handle = () => container.querySelector<HTMLButtonElement>('[data-geo-distance-handle]')!;
const distance = (kind: Kind) => kind === 'buffer' ? editor.getState().bufferDistance : editor.getState().offsetDistance;
const preview = (kind: Kind) => kind === 'buffer' ? editor.getBufferPreview() : editor.getOffsetPreview();
const setDistance = (kind: Kind, value: number) => kind === 'buffer' ? editor.setBufferDistance(value) : editor.setOffsetDistance(value);
const begin = (kind: Kind) => {
  editor.selectMany(kind === 'buffer' ? ['east', 'west', 'parcel'] : ['east', 'west']);
  return kind === 'buffer' ? editor.bufferSelection() : editor.offsetSelection();
};
async function grip() {
  await expect.poll(handle).not.toBeNull();
  return { x: parseFloat(handle().style.left), y: parseFloat(handle().style.top) };
}
function pointer(start: { x: number; y: number }, kind: Kind, delta: number, tangent = 0) {
  const p = project(coordinate(start.x, start.y));
  return map.project(unproject([p[0] + (kind === 'buffer' ? delta : tangent) / radius, p[1] + (kind === 'buffer' ? tangent : delta) / radius]));
}
function rulerDistance() {
  const read = (name: string) => {
    const dot = container.querySelector(`[data-geo-distance-${name}]`)!;
    return project(coordinate(Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))));
  };
  const a = read('origin'); const b = read('end'); return Math.hypot(b[0] - a[0], b[1] - a[1]) * radius;
}
function stemLength() {
  const stem = container.querySelector('[data-geo-distance-stem]')!;
  return Math.hypot(Number(stem.getAttribute('x2')) - Number(stem.getAttribute('x1')), Number(stem.getAttribute('y2')) - Number(stem.getAttribute('y1')));
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true } });
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'east', properties: { direction: 'east' }, geometry: { type: 'LineString', coordinates: [coordinate(180, 280), coordinate(420, 280)] } },
    { type: 'Feature', id: 'west', properties: null, geometry: { type: 'LineString', coordinates: [coordinate(420, 400), coordinate(180, 400)] } },
    { type: 'Feature', id: 'parcel', properties: null, geometry: { type: 'Polygon', coordinates: [[coordinate(200, 100), coordinate(360, 100), coordinate(360, 200), coordinate(200, 200), coordinate(200, 100)]] } },
  ] }); editor.clearHistory();
});
afterEach(async () => {
  if (map.getCanvas().isConnected) await commands.vertexPointer('up', 650, 450);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});

it.each([
  { kind: 'buffer' as const, bearing: 0, pitch: 0 }, { kind: 'offset' as const, bearing: 0, pitch: 0 },
  { kind: 'buffer' as const, bearing: 35, pitch: 40 }, { kind: 'offset' as const, bearing: 35, pitch: 40 },
])('drags $kind at bearing $bearing/pitch $pitch with a true distance ruler and one explicit Undo', async ({ kind, bearing, pitch }) => {
  map.jumpTo({ bearing, pitch }); begin(kind);
  const before = editor.exportGeoJSON(); const transaction = vi.fn(); editor.onTransaction(transaction);
  const source = map.getSource<GeoJSONSource>(Object.keys(map.getStyle().sources).find(id => id.endsWith('-features'))!)!;
  const upload = vi.spyOn(source, 'setData'); const initial = distance(kind)!;
  const start = await grip(); const end = pointer(start, kind, 80, 100);
  const camera = { center: map.getCenter().toArray(), bearing: map.getBearing(), pitch: map.getPitch(), zoom: map.getZoom() };
  await commands.vertexPointer('down', start.x, start.y); expect(map.dragPan.isEnabled()).toBe(false);
  await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(() => distance(kind)).toBeCloseTo(initial + 80, 3);
  await expect.poll(rulerDistance).toBeCloseTo(initial + 80, 3);
  expect(stemLength()).toBeCloseTo(36, 5);
  expect(editor.exportGeoJSON()).toEqual(before); expect(upload).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe(kind === 'buffer' ? 'buffer-features' : 'offset-lines');
  await commands.vertexPointer('up', end.x, end.y); expect(map.dragPan.isEnabled()).toBe(true);
  expect(editor.getState().canUndo).toBe(false); expect(transaction).not.toHaveBeenCalled();
  expect({ center: map.getCenter().toArray(), bearing: map.getBearing(), pitch: map.getPitch(), zoom: map.getZoom() }).toEqual(camera);
  const expected = preview(kind)!; await userEvent.keyboard('{Enter}');
  expect(transaction).toHaveBeenCalledOnce(); expect(upload).toHaveBeenCalledOnce(); expect(handle()).toBeNull();
  for (const feature of expected.features) expect(editor.exportGeoJSON().features.find(f => f.id === feature.id)).toEqual(feature);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); editor.redo();
  for (const feature of expected.features) expect(editor.exportGeoJSON().features.find(f => f.id === feature.id)).toEqual(feature);
});
it('moves offset through zero and keeps each component’s own left/right direction', async () => {
  begin('offset'); const before = editor.exportGeoJSON(); const start = await grip();
  await commands.vertexPointer('down', start.x, start.y);
  for (const delta of [60, -60, 30]) {
    const end = pointer(start, 'offset', delta); await commands.vertexPointer('move', end.x, end.y);
    await expect.poll(() => distance('offset')).toBeCloseTo(delta, 3);
    await expect.poll(rulerDistance).toBeCloseTo(Math.abs(delta), 3); expect(stemLength()).toBeCloseTo(36, 5);
    const result = preview('offset')!.features as LineFeature[];
    const east = (before.features[0] as LineFeature).geometry.coordinates[0]!;
    const west = (before.features[1] as LineFeature).geometry.coordinates[0]!;
    expect((project(result[0]!.geometry.coordinates[0]!)[1] - project(east)[1]) * radius).toBeCloseTo(delta, 3);
    expect((project(result[1]!.geometry.coordinates[0]!)[1] - project(west)[1]) * radius).toBeCloseTo(-delta, 3);
  }
  const end = pointer(start, 'offset', -20); await commands.vertexPointer('up', end.x, end.y);
  expect(distance('offset')).toBeCloseTo(-20, 3);
  expect(container.querySelector('[data-geo-distance-label]')!.textContent).toContain('right');
});
it('keeps the last positive buffer distance when crossing the source and allows recovery', async () => {
  begin('buffer'); const start = await grip(); await commands.vertexPointer('down', start.x, start.y);
  const outside = pointer(start, 'buffer', 80); await commands.vertexPointer('move', outside.x, outside.y);
  await expect.poll(() => distance('buffer')).toBeCloseTo(90, 3);
  const inside = pointer(start, 'buffer', -60); await commands.vertexPointer('move', inside.x, inside.y);
  expect(distance('buffer')).toBeCloseTo(90, 3);
  const end = pointer(start, 'buffer', 40); await commands.vertexPointer('up', end.x, end.y);
  expect(distance('buffer')).toBeCloseTo(50, 3);
});
it.each((['buffer', 'offset'] as const).flatMap(kind => ['Escape', 'blur', 'pointercancel', 'capture', 'camera', 'style'].map(reason => ({ kind, reason }))))(
  'restores only the $kind drag on $reason, ignoring late release', async ({ kind, reason }) => {
    begin(kind); setDistance(kind, 20); const before = preview(kind); const start = await grip(); const end = pointer(start, kind, 80);
    map.scrollZoom.disable();
    await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', end.x, end.y);
    await expect.poll(() => distance(kind)).toBeCloseTo(100, 3);
    if (reason === 'Escape') await userEvent.keyboard('{Escape}');
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'pointercancel' || reason === 'capture') handle().dispatchEvent(new PointerEvent(reason === 'capture' ? 'lostpointercapture' : 'pointercancel', { pointerId: 1, bubbles: true }));
    if (reason === 'camera') map.jumpTo({ zoom: 15 });
    if (reason === 'style') {
      const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
    }
    expect(distance(kind)).toBe(20); expect(preview(kind)).toEqual(before);
    expect(map.dragPan.isEnabled()).toBe(true); expect(map.scrollZoom.isEnabled()).toBe(false);
    await commands.vertexPointer('up', end.x, end.y); expect(preview(kind)).toEqual(before);
    await userEvent.keyboard('{Escape}'); expect(editor.getState().mode).toBe('idle'); expect(handle()).toBeNull();
  },
);
it.each(['buffer', 'offset'] as const)('supports %s keyboard steps, numeric override and invalid-result recovery', async kind => {
  begin(kind); setDistance(kind, 20); await grip(); handle().focus();
  await userEvent.keyboard('{ArrowRight}{Shift>}{ArrowUp}{/Shift}'); expect(distance(kind)).toBe(31);
  await userEvent.keyboard('{ArrowLeft}'); expect(distance(kind)).toBe(30);
  const start = await grip(); const end = pointer(start, kind, 80);
  await commands.vertexPointer('down', start.x, start.y); setDistance(kind, 50);
  await commands.vertexPointer('up', end.x, end.y); expect(distance(kind)).toBe(50);
  setDistance(kind, 100000000); expect(editor.getState().canFinish).toBe(false); expect(preview(kind)).toBeNull();
  await expect.poll(() => container.querySelector('[data-geo-distance-ruler]')!.getAttribute('stroke')).toBe('#b91c1c');
  setDistance(kind, 10); await expect.poll(() => getComputedStyle(handle()).visibility).toBe('visible');
  await expect.poll(rulerDistance).toBeCloseTo(10, 3);
  handle().focus(); await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('idle'); expect(handle()).toBeNull();
});
it.each(['buffer', 'offset'] as const)('captures %s outside the canvas and cleans up during an active drag', async kind => {
  begin(kind); const start = await grip(); const end = pointer(start, kind, 2200);
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(() => distance(kind)).toBeCloseTo((kind === 'buffer' ? 10 : 0) + 2200, 3);
  editor.destroy(); expect(handle()).toBeNull(); expect(map.dragPan.isEnabled()).toBe(true);
  const committed = editor.exportGeoJSON(); await commands.vertexPointer('up', end.x, end.y); expect(editor.exportGeoJSON()).toEqual(committed);
});
it('keeps an unchanged click out of history and uses the reversed first line as offset reference', async () => {
  editor.select('west'); editor.offsetSelection(); const start = await grip();
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('up', start.x, start.y);
  expect(distance('offset')).toBe(0); editor.finishOffset(); expect(editor.getState().canUndo).toBe(false);
  editor.offsetSelection(); const next = await grip(); const end = pointer(next, 'offset', -60);
  await commands.vertexPointer('down', next.x, next.y); await commands.vertexPointer('up', end.x, end.y);
  expect(distance('offset')).toBeCloseTo(60, 3);
});
