import { Map, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { GeometryEditor } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const errors: string[] = [];
const point = (x: number, y: number) => map.unproject([x, y]).toArray();
const hits = (x: number, y: number) => editor.queryFeatures({ x, y }).map(feature => feature.id);
beforeEach(async () => {
  errors.length = 0; container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0, canvasContextAttributes: { preserveDrawingBuffer: true } });
  map.on('error', event => errors.push(event.error.message));
  await new Promise<void>(resolve => { map.once('load', () => resolve()); });
  editor = new GeometryEditor(map, { styling: { feature: feature => ({ marker: { shape: feature.id === 7 ? 'pin' : 'circle', radius: 12, color: '#ff0000' } }) } });
});
afterEach(() => { editor.destroy(); map.remove(); container.remove(); expect(errors).toEqual([]); });

it('renders a pin above its exact coordinate, picks its head, preserves data/history and reloads owned images', async () => {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 7, properties: { name: 'Pin', nested: { safe: true } }, geometry: { type: 'Point', coordinates: point(260, 240) } },
    { type: 'Feature', id: '7', properties: { name: 'Circle' }, geometry: { type: 'Point', coordinates: point(430, 240) } },
  ] });
  editor.clearHistory(); const original = editor.exportGeoJSON();
  await expect.poll(() => hits(260, 210)).toContain(7);
  expect(hits(430, 240)).toContain('7'); expect(hits(430, 210)).not.toContain('7');
  const pixel = (x: number, y: number) => {
    const canvas = map.getCanvas(); const gl = canvas.getContext('webgl2')!; const bytes = new Uint8Array(4);
    gl.readPixels(Math.round(x * canvas.width / 700), Math.round((500 - y) * canvas.height / 500), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return [...bytes].slice(0, 3);
  };
  await expect.poll(() => pixel(268, 206)).toEqual([255, 0, 0]);
  editor.select(7); await expect.poll(() => pixel(268, 206)).toEqual([37, 99, 235]);
  expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getState().canUndo).toBe(false);
  editor.editSelected(); editor.moveVertex(0, point(320, 280)); editor.finish(); editor.undo();
  expect(editor.exportGeoJSON()).toEqual(original);
  editor.select(null);
  await new Promise<void>(resolve => { map.once('style.load', () => resolve()); map.setStyle(style()); });
  await expect.poll(() => hits(260, 210)).toContain(7);
  expect(map.listImages().some(id => id.endsWith('-pin'))).toBe(true);
  editor.setDataLayers([{ id: 'default', visible: false }]);
  await expect.poll(() => hits(260, 210)).toEqual([]);
  editor.setDataLayers([{ id: 'default', style: { marker: { shape: 'pin' } } }]);
  editor.setStyling({});
  await expect.poll(() => hits(430, 220)).toContain('7');
  editor.destroy(); expect(map.listImages()).toEqual([]); expect(Object.keys(map.getStyle().sources)).toEqual([]);
});
