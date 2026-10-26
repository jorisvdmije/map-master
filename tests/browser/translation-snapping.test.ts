import { Map, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate, type SnapResult } from '../../src/index.js';
import { projectToEdge } from '../../src/core/boundary-anchor.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const position = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const guide = () => container.querySelector<HTMLElement>('[data-geo-translation-guide]');
const label = () => container.querySelector('[data-geo-translation-label]')?.textContent;
const coordinates = (id: number | string): Coordinate[] => {
  const g = editor.exportGeoJSON().features.find(f => f.id === id)!.geometry;
  return g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates[0]! : [];
};
async function fixture(): Promise<void> {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { name: 'polygon' }, geometry: { type: 'Polygon', coordinates: [
      [[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]].map(([x, y]) => position(x!, y!)),
    ] } },
    { type: 'Feature', id: '0', properties: null, geometry: { type: 'LineString', coordinates: [position(260, 280), position(350, 280)] } },
    { type: 'Feature', id: 'target', properties: null, geometry: { type: 'LineString', coordinates: [position(430, 170), position(570, 170)] } },
  ] });
  editor.selectMany(['0', 0]); editor.clearHistory();
  const layer = Object.keys(map.getStyle().sources).find(id => id.endsWith('-features'))!;
  await expect.poll(() => map.queryRenderedFeatures({ layers: [layer] }).length).toBeGreaterThanOrEqual(3);
}
// Put the moving source anchor near a target, retaining the initial pointer offset
// in degrees even under perspective. Real browser coordinates round to subpixels.
function pointerNear(target: Coordinate, source = coordinates(0)[0]!, start = position(110, 110)) {
  return map.project([start[0] + target[0] - source[0], start[1] + target[1] - source[1]]);
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true, distance: 18 } });
});
afterEach(async () => {
  await userEvent.keyboard('{/Alt}{/Shift}');
  if (map.getCanvas().isConnected) await commands.vertexPointer('up', 650, 400);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});

it.each([6, 17])('snaps the grabbed feature anchor at zoom %s with bearing/pitch and moves mixed typed IDs as one transaction', async zoom => {
  map.jumpTo({ zoom, bearing: 30, pitch: 40 }); await fixture();
  const before = editor.exportGeoJSON(); const source = coordinates(0)[0]!; const target = coordinates('target')[0]!;
  const near = map.project(target); const end = pointerNear(position(near.x - 5, near.y + 4));
  const transaction = vi.fn(); editor.onTransaction(transaction);
  const observed = vi.fn<(snap: SnapResult | null) => void>(); editor.onSnap(observed);
  await commands.vertexPointer('down', 110, 110); await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(() => editor.getSnap()?.featureId).toBe('target');
  expect(editor.getSnap()).toMatchObject({ kind: 'vertex', coordinate: target });
  expect(guide()?.dataset.snap).toBe('vertex'); expect(label()).toContain('Mercator m');
  expect(editor.exportGeoJSON()).toEqual(before); expect(transaction).not.toHaveBeenCalled();
  await commands.vertexPointer('up', end.x, end.y);
  expect(transaction).toHaveBeenCalledOnce(); expect(editor.getSnap()).toBeNull(); expect(guide()).toBeNull();
  expect(coordinates(0)[0]![0]).toBeCloseTo(target[0], 12); expect(coordinates(0)[0]![1]).toBeCloseTo(target[1], 12);
  const after = editor.exportGeoJSON();
  expect(after.features[2]).toEqual(before.features[2]);
  const originalLine = before.features[1]!.geometry; if (originalLine.type !== 'LineString') throw new Error('fixture');
  coordinates('0').forEach((p, i) => {
    expect(p[0]).toBeCloseTo(originalLine.coordinates[i]![0] + target[0] - source[0], 12);
    expect(p[1]).toBeCloseTo(originalLine.coordinates[i]![1] + target[1] - source[1], 12);
  });
  expect(observed.mock.calls.at(-1)).toEqual([null]);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  editor.redo(); expect(editor.exportGeoJSON()).toEqual(after);
});

it('snaps to a geographic edge at the exact release without an intermediate frame', async () => {
  map.jumpTo({ bearing: -25, pitch: 45 }); await fixture();
  editor.setSnapping({ vertices: false }); const edge = coordinates('target');
  const target: Coordinate = [(edge[0]![0] + edge[1]![0]) / 2, (edge[0]![1] + edge[1]![1]) / 2];
  const end = pointerNear(target);
  const seen: (SnapResult | null)[] = []; editor.onSnap(s => { seen.push(s); });
  await commands.vertexPointer('down', 110, 110); await commands.vertexPointer('up', end.x, end.y);
  expect(seen.some(s => s?.kind === 'edge' && s.featureId === 'target')).toBe(true);
  const moved = coordinates(0)[0]!;
  const projected = projectToEdge(moved, edge[0]!, edge[1]!).point;
  expect(moved[0]).toBeCloseTo(projected[0], 12); expect(moved[1]).toBeCloseTo(projected[1], 12);
});

it('excludes every selected feature and preserves a return-to-origin no-op', async () => {
  await fixture(); const before = editor.exportGeoJSON();
  await commands.vertexPointer('down', 110, 110); await commands.vertexPointer('move', 120, 110);
  await expect.poll(label).toContain('Mercator m'); expect(editor.getSnap()).toBeNull();
  const end = pointerNear(coordinates('0')[0]!);
  await commands.vertexPointer('move', end.x, end.y); expect(editor.getSnap()).toBeNull();
  await commands.vertexPointer('up', 110, 110);
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
});

it('refreshes a stationary drag on Alt and live snapping options and obeys disabled edge/vertex targets', async () => {
  await fixture(); const end = pointerNear(position(425, 174));
  await commands.vertexPointer('down', 110, 110); await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  await userEvent.keyboard('{Alt>}'); await expect.poll(() => editor.getSnap()).toBeNull();
  await userEvent.keyboard('{/Alt}'); await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  editor.setSnapping({ enabled: false }); await expect.poll(() => editor.getSnap()).toBeNull();
  editor.setSnapping({ enabled: true, vertices: false, edges: false });
  await expect.poll(() => guide()?.dataset.snap).toBe('');
  editor.setSnapping({ vertices: true }); await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  editor.setSnapping({ distance: 1 }); await expect.poll(() => editor.getSnap()).toBeNull();
  await commands.vertexPointer('up', end.x, end.y);
  const actual = coordinates(0)[0]!; expect(Math.hypot(map.project(actual).x - 425, map.project(actual).y - 174)).toBeLessThan(1);
});

it.each(['east-west', 'north-south'] as const)('locks %s with Shift under camera rotation and retains that axis until key release', async axis => {
  map.jumpTo({ bearing: 35, pitch: 35 }); await fixture();
  const original = coordinates(0)[0]!; const start = position(110, 110);
  const end = map.project([start[0] + (axis === 'east-west' ? 0.003 : 0.0002), start[1] + (axis === 'north-south' ? 0.003 : 0.0002)]);
  await commands.vertexPointer('down', 110, 110); await commands.vertexPointer('move', end.x, end.y);
  await userEvent.keyboard('{Shift>}'); await expect.poll(() => guide()?.dataset.axis).toBe(axis);
  expect(editor.getSnap()).toBeNull();
  // Cross the initial diagonal while Shift stays held: the acquired axis cannot flip.
  const changed = map.project([start[0] + 0.004, start[1] + 0.006]);
  await commands.vertexPointer('move', changed.x, changed.y);
  await expect.poll(() => guide()?.dataset.axis).toBe(axis);
  await commands.vertexPointer('up', changed.x, changed.y);
  const moved = coordinates(0)[0]!;
  expect(moved[axis === 'east-west' ? 1 : 0]).toBe(original[axis === 'east-west' ? 1 : 0]);
  expect(moved[axis === 'east-west' ? 0 : 1]).not.toBe(original[axis === 'east-west' ? 0 : 1]);
});

it('restores snapping when Shift is released without moving the pointer', async () => {
  await fixture(); const end = pointerNear(position(425, 174));
  await commands.vertexPointer('down', 110, 110); await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  await userEvent.keyboard('{Shift>}'); await expect.poll(() => editor.getSnap()).toBeNull();
  expect(guide()?.dataset.axis).toBe('east-west');
  await userEvent.keyboard('{/Shift}'); await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
});

it.each(['Escape', 'blur', 'pointercancel', 'lostpointercapture', 'style', 'camera', 'cancel', 'destroy', 'select', 'transaction', 'lock'] as const)(
  'clears snapped guides and pending input on %s', async reason => {
    await fixture(); const before = editor.exportGeoJSON(); const end = pointerNear(position(425, 174));
    map.dragPan.disable(); map.getCanvas().style.cursor = 'help';
    let pointerId = -1; map.getCanvas().addEventListener('pointerdown', e => { pointerId = e.pointerId; }, { once: true });
    await commands.vertexPointer('down', 110, 110); await commands.vertexPointer('move', end.x, end.y);
    await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
    if (reason === 'Escape') await userEvent.keyboard('{Escape}');
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'pointercancel' || reason === 'lostpointercapture') map.getCanvas().dispatchEvent(new PointerEvent(reason, { pointerId }));
    if (reason === 'style') { const loaded = new Promise<void>(r => { map.once('style.load', () => { r(); }); }); map.setStyle(style(), { diff: false }); await loaded; }
    if (reason === 'camera') map.jumpTo({ zoom: 14 });
    if (reason === 'cancel') editor.cancel();
    if (reason === 'destroy') editor.destroy();
    if (reason === 'select') editor.select('target');
    if (reason === 'transaction') editor.applyTransaction({ update: [before.features[2]!] });
    if (reason === 'lock') editor.setLockedFeatureIds([0]);
    expect(guide()).toBeNull(); expect(editor.getSnap()).toBeNull(); expect(map.dragPan.isEnabled()).toBe(false);
    expect(map.getCanvas().style.cursor).toBe('help');
    await commands.vertexPointer('up', end.x, end.y);
    expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  },
);

it('honours cancellation from a snap observer on exact release', async () => {
  await fixture(); const before = editor.exportGeoJSON(); const end = pointerNear(position(425, 174));
  editor.onSnap(s => { if (s) editor.cancel(); });
  await commands.vertexPointer('down', 110, 110); await commands.vertexPointer('up', end.x, end.y);
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  expect(editor.getSnap()).toBeNull(); expect(guide()).toBeNull();
});

it('allows locked stationary targets and uses Point anchors', async () => {
  await fixture(); editor.importGeoJSON({ type: 'Feature', id: 'point', properties: null, geometry: { type: 'Point', coordinates: position(320, 340) } });
  editor.select('point'); editor.setLockedFeatureIds(['target']); editor.clearHistory();
  const layer = map.getStyle().layers.find(layer => layer.id.endsWith('-markers'))!.id;
  await expect.poll(() => map.queryRenderedFeatures([320, 340], { layers: [layer] }).length).toBeGreaterThan(0);
  const target = coordinates('target')[0]!;
  await commands.vertexPointer('down', 320, 340); await commands.vertexPointer('up', 425, 174);
  expect(coordinates('point')[0]).toEqual(target); expect(editor.getState().canUndo).toBe(true);
});


it('marks invalid whole-group movement and cancels release while keeping redo', async () => {
  map.jumpTo({ center: [160, 0], zoom: 4 }); await fixture();
  editor.importGeoJSON({ type: 'Feature', id: 'bounds', properties: null, geometry: { type: 'Point', coordinates: [179.99, 0] } });
  editor.selectMany([0, 'bounds']); editor.translateSelection([-1, 0]); editor.undo();
  const before = editor.exportGeoJSON();
  await commands.vertexPointer('down', 110, 110); await commands.vertexPointer('move', 300, 110);
  await expect.poll(label).toContain('invalid'); expect(editor.getSnap()).toBeNull();
  await commands.vertexPointer('up', 300, 110);
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canRedo).toBe(true); expect(guide()).toBeNull();
});

it('supports Alt from pointer-down and keeps the snap guide in sync with live appearance', async () => {
  await fixture(); const end = pointerNear(position(425, 174));
  await userEvent.keyboard('{Alt>}');
  await commands.vertexPointer('down', 110, 110); await commands.vertexPointer('move', end.x, end.y);
  await expect.poll(label).toContain('Mercator m'); expect(editor.getSnap()).toBeNull();
  await userEvent.keyboard('{/Alt}'); await expect.poll(() => editor.getSnap()?.kind).toBe('vertex');
  editor.setAppearance({ snap: { color: '#ff0000', radius: 12 } });
  await expect.poll(() => container.querySelector('[data-geo-translation-anchor]')?.getAttribute('r')).toBe('12');
  expect(container.querySelector('[data-geo-translation-anchor]')?.getAttribute('fill')).toBe('#ff0000');
  await commands.vertexPointer('up', end.x, end.y);
  expect(coordinates(0)[0]).toEqual(coordinates('target')[0]);
});
