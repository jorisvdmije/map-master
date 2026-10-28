import { Map, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate } from '../../src/index.js';
import { SimplificationControls } from '../../examples/basic/simplification-controls.js';
import html from '../../examples/basic/index.html?raw';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
let root: HTMLElement; let controls: SimplificationControls; let slider: HTMLInputElement; let field: HTMLInputElement;
let valid: boolean;
const input = (value: string) => { slider.value = value; slider.dispatchEvent(new Event('input', {bubbles:true})); };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => { resolve(); }));
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  const style: StyleSpecification = {version:8,sources:{},layers:[{id:'bg',type:'background'}]};
  map = new Map({container,style,center:[4,52],zoom:13,fadeDuration:0});
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
  root = new DOMParser().parseFromString(html,'text/html').querySelector<HTMLElement>('#simplification-tools')!;
  document.body.append(root);
  slider = root.querySelector('#simplification-slider')!; field = root.querySelector('#simplification-tolerance')!;
  controls = new SimplificationControls(editor, root, value => { valid = value; });
  editor.onChange(() => { controls.update(); });
  editor.importGeoJSON({type:'Feature',id:'line',properties:null,geometry:{type:'LineString',coordinates:[[4,52],[4.001,52.00001],[4.002,52]]}});
  editor.select('line'); editor.clearHistory(); editor.simplifySelection();
});
afterEach(() => { controls.destroy(); vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); root.remove(); });

it('coalesces rapid input and flushes the exact final value on change without committing geometry', async () => {
  const before = editor.exportGeoJSON(); const setter = vi.spyOn(editor,'setSimplificationTolerance');
  input('1'); input('2'); input('5.123456789');
  expect(setter).not.toHaveBeenCalled(); expect(valid).toBe(false);
  slider.dispatchEvent(new Event('change', {bubbles:true}));
  expect(setter).toHaveBeenCalledExactlyOnceWith(5.123456789); expect(valid).toBe(true);
  await frame(); expect(setter).toHaveBeenCalledOnce(); expect(field.valueAsNumber).toBe(5.123456789);
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  input('1'); input('2'); await frame(); expect(setter).toHaveBeenCalledTimes(2);
  expect(editor.getState().simplificationTolerance).toBe(2);
});
it.each(['cancel','lock','api','destroy'] as const)('discards a pending slider value on %s', async action => {
  const before = editor.exportGeoJSON(); input('5');
  if (action === 'cancel') editor.cancel();
  if (action === 'lock') editor.setLockedFeatureIds(['line']);
  if (action === 'api') editor.setSimplificationTolerance(3);
  if (action === 'destroy') { controls.destroy(); editor.destroy(); }
  const state = editor.getState(); await frame(); slider.dispatchEvent(new Event('change'));
  expect(editor.getState()).toEqual(state); expect(editor.exportGeoJSON()).toEqual(before);
  if (action === 'api') { expect(slider.valueAsNumber).toBe(3); expect(field.valueAsNumber).toBe(3); }
});
it('flushes Enter to one saved change and handles Escape without a late slider update', async () => {
  const before = editor.exportGeoJSON(); slider.focus(); input('5'); await userEvent.keyboard('{Enter}');
  expect(editor.getState().mode).toBe('idle'); expect(editor.exportGeoJSON()).not.toEqual(before);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  editor.select('line'); editor.simplifySelection(); slider.focus(); input('5'); await userEvent.keyboard('{Escape}');
  await frame(); expect(editor.getState().mode).toBe('idle'); expect(editor.exportGeoJSON()).toEqual(before);
});
it('counts holes and multipart components without polygon closure copies and resets the range for a new selection', () => {
  editor.cancel();
  const ring = (x:number,y:number,s:number): Coordinate[] => [[x,y],[x+s,y],[x+s,y+s],[x,y+s],[x,y]];
  editor.importGeoJSON({type:'FeatureCollection',features:[
    {type:'Feature',id:'areas',properties:null,geometry:{type:'MultiPolygon',coordinates:[[ring(4,52,.01),ring(4.002,52.002,.002)],[ring(4.02,52,.01)]]}},
    {type:'Feature',id:'paths',properties:null,geometry:{type:'MultiLineString',coordinates:[[[4,52],[4.001,52.00001],[4.002,52]],[[4,52.01],[4.001,52.01]]] }},
  ]});
  editor.selectMany(['areas','paths']); editor.simplifySelection();
  expect(root.querySelector('#simplification-count')!.textContent).toBe('17 → 17 vertices');
  expect(root.querySelector('#simplification-reduction')!.textContent).toBe('0% fewer vertices');
  editor.setSimplificationTolerance(100000); expect(slider.max).toBe('100000'); expect(valid).toBe(false);
  editor.setSimplificationTolerance(0); expect(valid).toBe(true); expect(slider.max).toBe('100000');
  editor.cancel(); editor.select('line'); editor.simplifySelection(); expect(Number(slider.max)).toBeLessThan(100);
  expect(root.querySelector('#simplification-count')!.textContent).toBe('3 → 3 vertices');
});
