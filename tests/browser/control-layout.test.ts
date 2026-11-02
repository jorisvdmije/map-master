import { Map, setWorkerUrl, type ControlPosition } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { DataLayerControl, EditorToolbar, GeometryEditor } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const settle = () => new Promise<void>(resolve => { queueMicrotask(resolve); });
const inside = (element: Element): void => {
  const box = element.getBoundingClientRect();
  const canvas = map.getCanvas().getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(canvas.left - 1);
  expect(box.top).toBeGreaterThanOrEqual(canvas.top - 1);
  expect(box.right).toBeLessThanOrEqual(canvas.right + 1);
  expect(box.bottom).toBeLessThanOrEqual(canvas.bottom + 1);
};
const point = (x: number, y: number) => map.unproject([x, y]).toArray();
const panel = () => container.querySelector<HTMLElement>('.mm-toolbar-actions')!;
const cancel = () => [...panel().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Cancel')!;

beforeEach(async () => {
  container = document.createElement('div');
  container.style.cssText = 'position:relative;width:320px;height:220px;transform-origin:top left;';
  document.body.append(container);
  map = new Map({ container, center: [4.895, 52.372], zoom: 15, fadeDuration: 0, style: { version: 8, sources: {}, layers: [] } });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
  editor.importGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'parcel', properties: {}, geometry: { type: 'Polygon', coordinates: [[point(80, 60), point(240, 60), point(240, 150), point(80, 150), point(80, 60)]] } }] });
  editor.clearHistory();
});
afterEach(() => { editor.destroy(); map.remove(); container.remove(); });

it.each(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const)('keeps all tools and actions usable in a short map at %s', async (corner: ControlPosition) => {
  map.addControl(new EditorToolbar(editor, { tools: EditorToolbar.allTools }), corner);
  await settle();
  const root = container.querySelector<HTMLElement>('.mm-toolbar')!;
  const column = root.querySelector<HTMLElement>('.mm-toolbar-tools')!;
  inside(root);
  expect(column.scrollHeight).toBeGreaterThan(column.clientHeight);
  root.querySelector<HTMLButtonElement>('[data-tool="point"]')!.focus();
  await userEvent.keyboard('{End}');
  const focused = document.activeElement as HTMLButtonElement;
  expect(root.contains(focused)).toBe(true);
  expect(column.scrollTop).toBeGreaterThan(0);
  inside(focused);

  editor.select('parcel'); editor.bufferSelection(10);
  inside(panel());
  const field = panel().querySelector<HTMLInputElement>('input')!;
  await userEvent.fill(field, '25');
  expect(editor.getState().bufferDistance).toBe(25);
  container.style.width = '220px'; container.style.height = '160px'; map.resize();
  inside(root); inside(panel());
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe('25');
  await userEvent.click(cancel());
  expect(editor.getState().mode).toBe('idle');
});

it('wraps template and text controls inside a transformed narrow host, without losing inputs on resize', async () => {
  container.style.width = '240px'; container.style.height = '180px'; container.style.transform = 'scale(.8)'; map.resize();
  map.addControl(new EditorToolbar(editor, { tools: ['template', 'text', 'polygon'] }), 'bottom-right');
  await settle();
  editor.drawTemplate();
  inside(panel());
  const size = panel().querySelector<HTMLInputElement>('[data-template="size"]')!;
  await userEvent.fill(size, '45');
  expect(size.value).toBe('45');
  await userEvent.click(cancel());
  editor.drawText({ text: 'A complete label' });
  inside(panel());
  const text = panel().querySelector<HTMLTextAreaElement>('textarea')!;
  text.focus();
  container.style.width = '200px'; container.style.height = '140px'; map.resize();
  inside(panel());
  expect(text.value).toBe('A complete label');
  expect(document.activeElement).toBe(text);
  await userEvent.click(cancel());
  expect(editor.getState().mode).toBe('idle');
});

it('bounds tooltips to the canvas instead of clipping them inside the scrolling tool list', async () => {
  map.addControl(new EditorToolbar(editor, { tools: ['polygon'], labels: { polygon: 'Draw a polygon with a translated descriptive label' } }), 'top-right');
  await settle();
  await userEvent.hover(container.querySelector<HTMLButtonElement>('[data-tool="polygon"]')!);
  const tooltip = container.querySelector<HTMLElement>('[role="tooltip"]')!;
  expect(tooltip.hidden).toBe(false); inside(tooltip);
  expect(tooltip.textContent).toContain('translated descriptive label');
});

it.each(['top-right', 'bottom-left'] as const)('scrolls all data-layer controls within a small canvas at %s', async (corner: ControlPosition) => {
  editor.setDataLayers(Array.from({ length: 15 }, (_, index) => ({ id: `layer-${index}`, name: `A descriptive dataset ${index}` })));
  const control = new DataLayerControl(editor, { collapsed: false });
  map.addControl(control, corner); await settle();
  const root = container.querySelector<HTMLElement>('.mm-data-layers')!;
  const list = container.querySelector<HTMLElement>('.mm-data-layers-panel')!;
  inside(root); inside(list);
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  const last = [...list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!;
  last.focus(); inside(last);
  expect(list.scrollTop).toBeGreaterThan(0);
  container.style.width = '220px'; container.style.height = '150px'; map.resize();
  inside(root); inside(list);
  control.setCollapsed(true); inside(root);
});
