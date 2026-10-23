import { Map, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const border = () => container.querySelector<SVGPathElement>('[data-geo-draft-border] [data-geo-border]');
const dots = () => (border()?.getAttribute('d') ?? '').split(' ').filter(Boolean).map((point) => {
  const [x, y] = point.slice(1, -2).split(',').map(Number);
  return [Math.round(x! * 1000) / 1000, Math.round(y! * 1000) / 1000];
});
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: false } });
});
afterEach(async () => {
  if (map.getCanvas().isConnected) await commands.vertexPointer('up', 650, 450);
  editor.destroy(); map.remove(); container.remove();
});

it('leaves placed-edge dots fixed while drawing, extending the next edge and crossing tile boundaries', async () => {
  editor.draw('Polygon'); await click(100, 100); await click(500, 100); await click(500, 300);
  await commands.vertexPointer('move', 200, 300);
  const top = () => dots().filter(([x, y]) => y === 100 && x! > 110 && x! < 490);
  await expect.poll(() => top().length).toBeGreaterThan(35);
  const before = top();
  for (const [x, y] of [[100, 250], [400, 400], [50, 450]]) {
    const path = border()!.getAttribute('d'); await commands.vertexPointer('move', x!, y!);
    await expect.poll(() => border()!.getAttribute('d')).not.toBe(path);
    expect(top()).toEqual(before);
  }
  await click(50, 450); await commands.vertexPointer('move', 150, 400);
  expect(top()).toEqual(before);
  expect(border()!.hasAttribute('stroke-dasharray')).toBe(false); expect(border()!.getAnimations()).toHaveLength(0);
  editor.cancel(); expect(border()).toBeNull();
});

it('keeps untouched sides fixed when a preceding side changes length during vertex editing', async () => {
  editor.importGeoJSON({ type: 'Feature', id: 'box', properties: {}, geometry: { type: 'Polygon', coordinates: [
    [[100, 100], [500, 100], [500, 350], [100, 350], [100, 100]].map(([x, y]) => coordinate(x!, y!)),
  ] } }); editor.select('box'); editor.editSelected();
  const opposite = () => dots().filter(([x, y]) => x === 500 && y! > 110 && y! < 340);
  await expect.poll(() => opposite().length).toBeGreaterThan(20);
  const expected = opposite(); const saved = editor.exportGeoJSON();
  await commands.vertexPointer('down', 100, 100); await commands.vertexPointer('move', 180, 160);
  await expect.poll(() => editor.getDraft().some(([x]) => Math.abs(x - coordinate(180, 160)[0]) < 1e-9)).toBe(true);
  expect(opposite()).toEqual(expected);
  await commands.vertexPointer('move', 60, 70);
  await expect.poll(() => editor.getDraft().some(([x]) => Math.abs(x - coordinate(60, 70)[0]) < 1e-9)).toBe(true);
  expect(opposite()).toEqual(expected);
  await commands.vertexPointer('up', 60, 70); editor.cancel();
  expect(editor.exportGeoJSON()).toEqual(saved); expect(border()).toBeNull();
});

it('rebuilds borders after style replacement and clears them on finish and destruction', async () => {
  editor.draw('Polygon'); await click(100, 100); await click(400, 100); await click(400, 350);
  await expect.poll(border).not.toBeNull();
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(border).not.toBeNull();
  const saved = editor.finish()!; expect(border()).toBeNull();
  editor.select(saved.id); editor.editSelected(); await expect.poll(border).not.toBeNull();
  editor.destroy(); expect(border()).toBeNull();
});
