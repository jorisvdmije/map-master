import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GeometryEditor, type Coordinate } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const errors: string[] = [];
const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const polygonEdge: Coordinate[] = [];
let lineEdge: Coordinate;
const resolver = vi.fn(() => ({ shape: { lineWidth: 8 } }));
beforeEach(async () => {
  errors.length = 0; resolver.mockClear();
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  const style: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] };
  map = new Map({ container, style, center: [4.895, 52.372], zoom: 14, fadeDuration: 0, canvasContextAttributes: { preserveDrawingBuffer: true } });
  map.on('error', event => { errors.push(event.error.message); });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, {
    appearance: { polygonOutline: { scaleWithZoom: true, referenceZoom: 14 }, feature: { lineColor: '#000', fillOpacity: 0 }, selected: { lineColor: '#000', fillOpacity: 0 }, draft: { lineWidth: 8 } },
    styling: { feature: resolver, selected: { shape: { lineWidth: 12 } } },
  });
  polygonEdge.splice(0, polygonEdge.length, coordinate(230, 130)); lineEdge = coordinate(470, 350);
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'area', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[[[120, 130], [340, 130], [340, 250], [120, 250], [120, 130]].map(([x, y]) => coordinate(x!, y!))]] } },
    { type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [coordinate(410, 350), coordinate(530, 350)] } },
  ] });
  editor.clearHistory();
  const layer = map.getStyle().layers.find(layer => layer.id.endsWith('-features'))!.id;
  await expect.poll(() => map.queryRenderedFeatures(map.project(polygonEdge[0]!), { layers: [layer] }).length, { timeout: 5000 }).toBeGreaterThan(0);
});
afterEach(() => { editor.destroy(); map.remove(); container.remove(); expect(errors).toEqual([]); });

/** Count the actual dark WebGL pixels through a horizontal outline, in CSS pixels. */
async function strokePixels(coordinate: Coordinate): Promise<number> {
  await new Promise<void>(resolve => { map.once('render', () => { resolve(); }); map.triggerRepaint(); });
  const canvas = map.getCanvas(); const gl = canvas.getContext('webgl2')!;
  const point = map.project(coordinate); const ratio = canvas.width / canvas.clientWidth;
  const height = Math.floor(20 * ratio) + 1;
  const bytes = new Uint8Array(height * 4); let count = 0;
  gl.readPixels(Math.round(point.x * ratio), Math.round(canvas.height - (point.y + 10) * ratio), 1, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  for (let index = 0; index < bytes.length; index += 4) {
    if (bytes[index]! < 128 && bytes[index + 1]! < 128 && bytes[index + 2]! < 128) count++;
  }
  return count / ratio;
}
async function width(zoom: number, expected: number): Promise<void> {
  map.jumpTo({ zoom });
  await expect.poll(() => strokePixels(polygonEdge[0]!)).toBeGreaterThanOrEqual(expected - 1);
  await expect.poll(() => strokePixels(polygonEdge[0]!)).toBeLessThanOrEqual(expected + 1);
  await expect.poll(() => strokePixels(lineEdge)).toBeGreaterThanOrEqual(7);
  expect(await strokePixels(lineEdge)).toBeLessThanOrEqual(9);
}

it('renders proportional multipart outlines at fractional zoom and caps zooming in without uploads or resolver calls', async () => {
  await width(14, 8);
  const saved = editor.exportGeoJSON(); const state = editor.getState();
  const sourceId = Object.keys(map.getStyle().sources).find(id => id.endsWith('-features'))!;
  const uploads = vi.spyOn(map.getSource<GeoJSONSource>(sourceId)!, 'setData'); resolver.mockClear();
  await width(13, 4); await width(12, 2); await width(13.5, 8 * Math.SQRT1_2); await width(14, 8);
  editor.setAppearance({ polygonOutline: { referenceZoom: 16 } }); await width(14, 2);
  editor.setAppearance({ polygonOutline: { referenceZoom: 14 } }); await width(14, 8);
  // Keep the sampled edge in view while testing the cap above the reference zoom.
  map.jumpTo({ center: polygonEdge[0]!, zoom: 16 });
  await expect.poll(() => strokePixels(polygonEdge[0]!)).toBeGreaterThanOrEqual(7);
  expect(await strokePixels(polygonEdge[0]!)).toBeLessThanOrEqual(9);
  expect(uploads).not.toHaveBeenCalled(); expect(resolver).not.toHaveBeenCalled();
  expect(editor.exportGeoJSON()).toEqual(saved); expect(editor.getState()).toEqual(state);
});

it('scales selected and dotted editing outlines, supports live toggles and preserves the draft across style reload', async () => {
  editor.select('area'); await width(14, 12); await width(12, 3);
  editor.editSelected(); const draft = editor.getDraft();
  const border = () => container.querySelector('[data-geo-draft-border] [data-geo-border]');
  await expect.poll(() => border()?.getAttribute('stroke-width')).toBe('2');
  map.jumpTo({ zoom: 13.5 });
  await expect.poll(() => Number(border()?.getAttribute('stroke-width'))).toBeCloseTo(8 * Math.SQRT1_2, 8);
  editor.setAppearance({ polygonOutline: { scaleWithZoom: false } });
  await expect.poll(() => border()?.getAttribute('stroke-width')).toBe('8');
  editor.setAppearance({ polygonOutline: { scaleWithZoom: true, referenceZoom: 15.5 } });
  expect(border()?.getAttribute('stroke-width')).toBe('2');
  const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); });
  map.setStyle({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] }, { diff: false }); await loaded;
  await expect.poll(() => border()?.getAttribute('stroke-width')).toBe('2');
  expect(editor.getDraft()).toEqual(draft); expect(editor.getState().canUndo).toBe(false);
  editor.cancel(); editor.setAppearance({ polygonOutline: { scaleWithZoom: false } });
  // CSS-pixel widths are recovered immediately, including per-feature/selection styling.
  map.jumpTo({ zoom: 12 });
  await expect.poll(() => strokePixels(polygonEdge[0]!)).toBeGreaterThanOrEqual(11);
  editor.select('line'); editor.editSelected();
  editor.setAppearance({ polygonOutline: { scaleWithZoom: true } });
  await expect.poll(() => border()?.getAttribute('stroke-width')).toBe('8');
  map.jumpTo({ zoom: 13 });
  await expect.poll(() => border()?.getAttribute('stroke-width')).toBe('8');
});
