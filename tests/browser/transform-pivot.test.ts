import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type PolygonFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
type Kind = 'rotation' | 'scale';
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor; let corner: Coordinate;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] });
const handle = () => container.querySelector<HTMLButtonElement>('[data-geo-pivot-handle]')!;
const pivot = (kind: Kind) => (kind === 'rotation' ? editor.getState().rotationPivot : editor.getState().scalePivot)!;
const setPivot = (kind: Kind, p?: Coordinate) => kind === 'rotation' ? editor.setRotationPivot(p) : editor.setScalePivot(p);
const preview = (kind: Kind) => kind === 'rotation' ? editor.getRotationPreview() : editor.getScalePreview();
const begin = (kind: Kind) => {
  if (kind === 'rotation') { editor.rotateSelection(); editor.setRotationAngle(30); }
  else { editor.scaleSelection(); editor.setScaleFactors(1.3, 0.8); }
};
async function grip() {
  await expect.poll(handle).not.toBeNull();
  return { x: parseFloat(handle().style.left), y: parseFloat(handle().style.top) };
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true } });
  const at = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray(); corner = at(200, 150);
  editor.importGeoJSON({ type: 'Feature', id: 'parcel', properties: null, geometry: { type: 'Polygon', coordinates: [[corner, at(450, 150), at(450, 350), at(200, 350), corner]] } });
  editor.select('parcel'); editor.clearHistory();
});
afterEach(async () => {
  if (map.getCanvas().isConnected) await commands.vertexPointer('up', 650, 450);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});
it.each((['rotation', 'scale'] as const).flatMap(kind => [false, true].map(tilted => ({ kind, tilted }))))(
  'moves the $kind pivot onto an original vertex, tilted=$tilted, and saves one Undo', async ({ kind, tilted }) => {
    if (tilted) map.jumpTo({ bearing: 35, pitch: 40 });
    begin(kind); const before = editor.exportGeoJSON(); const transaction = vi.fn(); editor.onTransaction(transaction);
    const source = map.getSource<GeoJSONSource>(Object.keys(map.getStyle().sources).find(id => id.endsWith('-features'))!)!;
    const upload = vi.spyOn(source, 'setData'); const start = await grip(); const end = map.project(corner);
    await commands.vertexPointer('down', start.x, start.y); expect(map.dragPan.isEnabled()).toBe(false);
    await commands.vertexPointer('move', end.x + 3, end.y + 2);
    await expect.poll(() => pivot(kind)).toEqual(corner); expect(handle().dataset.geoPivotSnap).toBe('vertex');
    expect((preview(kind)!.features[0] as PolygonFeature).geometry.coordinates[0]).toContainEqual(corner);
    expect(editor.exportGeoJSON()).toEqual(before); expect(upload).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}'); expect(transaction).not.toHaveBeenCalled();
    await commands.vertexPointer('up', end.x + 3, end.y + 2); expect(map.dragPan.isEnabled()).toBe(true);
    expect(pivot(kind)).toEqual(corner); expect(editor.getState().canUndo).toBe(false);
    const expected = preview(kind); await userEvent.keyboard('{Enter}'); expect(transaction).toHaveBeenCalledOnce();
    expect(editor.exportGeoJSON()).toEqual(expected); expect(handle()).toBeNull();
    editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
    editor.redo(); expect(editor.exportGeoJSON()).toEqual(expected);
  },
);
it.each((['rotation', 'scale'] as const).flatMap(kind => ['Escape', 'blur', 'pointercancel', 'capture', 'camera', 'style'].map(reason => ({ kind, reason }))))(
  'rolls back only the $kind pivot drag on $reason', async ({ kind, reason }) => {
    begin(kind); const initial = pivot(kind); const before = preview(kind); const start = await grip(); const end = map.project(corner);
    map.scrollZoom.disable(); await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', end.x, end.y);
    await expect.poll(() => pivot(kind)).toEqual(corner);
    if (reason === 'Escape') await userEvent.keyboard('{Escape}');
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'pointercancel' || reason === 'capture') handle().dispatchEvent(new PointerEvent(reason === 'capture' ? 'lostpointercapture' : 'pointercancel', { pointerId: 1, bubbles: true }));
    if (reason === 'camera') map.jumpTo({ zoom: 15 });
    if (reason === 'style') {
      const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
    }
    expect(pivot(kind)).toEqual(initial); expect(preview(kind)).toEqual(before);
    expect(map.dragPan.isEnabled()).toBe(true); expect(map.scrollZoom.isEnabled()).toBe(false);
    await commands.vertexPointer('up', end.x, end.y); expect(preview(kind)).toEqual(before);
    await userEvent.keyboard('{Escape}'); expect(editor.getState().mode).toBe('idle'); expect(handle()).toBeNull();
  },
);
it.each(['rotation', 'scale'] as const)('supports %s Alt bypass, live snap settings and original-centre snapping', async kind => {
  begin(kind); const center = pivot(kind); const start = await grip(); const end = map.project(corner);
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', end.x + 6, end.y);
  await expect.poll(() => pivot(kind)).toEqual(corner);
  await userEvent.keyboard('{Alt>}'); expect(pivot(kind)).not.toEqual(corner); expect(handle().dataset.geoPivotSnap).toBe('');
  await userEvent.keyboard('{/Alt}'); expect(pivot(kind)).toEqual(corner);
  editor.setSnapping({ vertices: false }); expect(pivot(kind)).not.toEqual(corner);
  await commands.vertexPointer('move', start.x + 5, start.y); await expect.poll(() => pivot(kind)).toEqual(center);
  expect(handle().dataset.geoPivotSnap).toBe('center');
  editor.setSnapping({ enabled: false }); expect(pivot(kind)).not.toEqual(center);
  await commands.vertexPointer('up', start.x + 5, start.y);
});
it.each(['rotation', 'scale'] as const)('supports %s keyboard positioning and reset, and protects API overrides from late release', async kind => {
  begin(kind); const center = pivot(kind); const start = await grip(); handle().focus();
  await userEvent.keyboard('{ArrowRight}{Shift>}{ArrowDown}{/Shift}');
  expect(map.project(pivot(kind)).x - start.x).toBeCloseTo(1, 4); expect(map.project(pivot(kind)).y - start.y).toBeCloseTo(10, 4);
  await userEvent.keyboard('{Home}'); expect(pivot(kind)).toEqual(center);
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', 100, 100);
  setPivot(kind, corner); await commands.vertexPointer('up', 150, 100); expect(pivot(kind)).toEqual(corner);
  const moved = await grip(); await commands.vertexPointer('down', moved.x, moved.y);
  if (kind === 'rotation') editor.setRotationAngle(60); else editor.setScaleFactors(2, 0.5);
  await commands.vertexPointer('up', 100, 100); expect(pivot(kind)).toEqual(corner);
  await grip(); handle().focus(); await userEvent.keyboard('{Escape}'); expect(editor.getState().mode).toBe('idle');
});
it('keeps a chosen scale corner fixed when dragging the opposite handle', async () => {
  editor.scaleSelection(); editor.setScalePivot(corner); await grip();
  const opposite = container.querySelector<HTMLButtonElement>('[data-geo-scale-handle="se"]')!;
  const x = parseFloat(opposite.style.left); const y = parseFloat(opposite.style.top); const fixed = map.project(corner);
  await commands.vertexPointer('down', x, y); await commands.vertexPointer('up', x + (x - fixed.x) * 0.5, y + (y - fixed.y) * 0.5);
  expect(editor.getState().scaleFactorX).toBeCloseTo(1.5, 5); expect(editor.getState().scaleFactorY).toBeCloseTo(1.5, 5);
  expect((editor.getScalePreview()!.features[0] as PolygonFeature).geometry.coordinates[0]).toContainEqual(corner);
  editor.setScalePivot(map.unproject([450, 100]).toArray());
  await expect.poll(() => container.querySelector<HTMLButtonElement>('[data-geo-scale-handle="e"]')!.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('[data-geo-scale-handle="w"]')!.disabled).toBe(false);
});
it.each(['rotation', 'scale'] as const)('cleans up a captured %s pivot drag outside the canvas on lock revocation and destruction', async kind => {
  begin(kind); const before = editor.exportGeoJSON(); const start = await grip();
  await commands.vertexPointer('down', start.x, start.y); await commands.vertexPointer('move', 750, 450);
  await expect.poll(() => map.project(pivot(kind)).x).toBeCloseTo(750, 3);
  editor.setLockedFeatureIds(['parcel']); expect(handle()).toBeNull(); expect(map.dragPan.isEnabled()).toBe(true);
  await commands.vertexPointer('up', 750, 450); expect(editor.exportGeoJSON()).toEqual(before);
  editor.setLockedFeatureIds([]); begin(kind); const next = await grip(); await commands.vertexPointer('down', next.x, next.y);
  editor.destroy(); expect(handle()).toBeNull(); expect(map.dragPan.isEnabled()).toBe(true);
});
