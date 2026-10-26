import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, type Coordinate } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const position = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const rectangle = () => container.querySelector('[data-geo-selection-box]');
const indexAt = (x: number, y: number) => editor.getDraft().findIndex(p => {
  const point = map.project(p); return Math.hypot(point.x - x, point.y - y) < 1;
});
function setup() {
  editor.importGeoJSON({ type: 'Feature', id: 'polygon', properties: null, geometry: { type: 'Polygon', coordinates: [
    [[100,100],[300,100],[300,300],[100,300],[100,100]].map(([x,y]) => position(x!,y!)),
  ] } });
  editor.clearHistory(); editor.select('polygon'); editor.editSelected();
}
async function box(start = [70,70], end = [330,130]) {
  await userEvent.keyboard('{Shift>}');
  await commands.vertexPointer('down', start[0]!, start[1]!);
  await commands.vertexPointer('up', end[0]!, end[1]!);
  await userEvent.keyboard('{/Shift}');
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895,52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  await userEvent.keyboard('{/Shift}'); await commands.vertexPointer('up',650,400);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});

it.each([6,17])('adds only enclosed corners at zoom %s with bearing/pitch and keeps data/history unchanged', async zoom => {
  map.jumpTo({zoom, bearing:30, pitch:40}); setup();
  const draft = editor.getDraft(); const saved = editor.exportGeoJSON();
  const bottom = indexAt(100,300); editor.selectVertices([bottom]);
  const sourceId = Object.keys(map.getStyle().sources).find(id => id.endsWith('-features'))!;
  const upload = vi.spyOn(map.getSource<GeoJSONSource>(sourceId)!, 'setData');
  const changed = vi.fn(); editor.onChange(changed);
  await userEvent.keyboard('{Shift>}'); await commands.vertexPointer('down',70,70);
  await commands.vertexPointer('move',330,130);
  expect(rectangle()).not.toBeNull(); expect(editor.getState().selectedVertexIndices).toEqual([bottom]);
  expect(map.dragPan.isEnabled()).toBe(false); expect(map.boxZoom.isEnabled()).toBe(false);
  await userEvent.keyboard('{/Shift}'); // Finishing the captured gesture does not require holding Shift.
  await commands.vertexPointer('up',330,130);
  const selected = [bottom, ...draft.map((_,i) => i).filter(i => [indexAt(100,100),indexAt(300,100)].includes(i))];
  expect(editor.getState().selectedVertexIndices).toEqual(selected);
  expect(changed).toHaveBeenCalledOnce(); expect(rectangle()).toBeNull();
  expect(map.dragPan.isEnabled()).toBe(true); expect(map.boxZoom.isEnabled()).toBe(true);
  expect(editor.getDraft()).toEqual(draft); expect(editor.exportGeoJSON()).toEqual(saved);
  expect(upload).not.toHaveBeenCalled(); expect(editor.getState().canUndo).toBe(false);
  await box([330,130],[70,70]); // Reversed box deduplicates existing selection.
  expect(editor.getState().selectedVertexIndices).toEqual(selected); expect(changed).toHaveBeenCalledOnce();
});

it('keeps corner toggling, ignores midpoint-only/empty boxes and supports dragging the resulting group with one Undo', async () => {
  setup(); const saved = editor.exportGeoJSON();
  await userEvent.keyboard('{Shift>}'); await userEvent.click(map.getCanvas(), {position:{x:100,y:100}}); await userEvent.keyboard('{/Shift}');
  const left = indexAt(100,100); const right = indexAt(300,100);
  expect(editor.getState().selectedVertexIndices).toEqual([left]);
  await box([190,90],[210,110]); expect(editor.getState().vertexCount).toBe(4);
  await box([500,350],[600,400]); expect(editor.getState().selectedVertexIndices).toEqual([left]);
  await box(); expect(new Set(editor.getState().selectedVertexIndices)).toEqual(new Set([left,right]));
  await commands.vertexPointer('down',100,100); await commands.vertexPointer('up',120,80);
  expect(editor.exportGeoJSON()).toEqual(saved); editor.finish(); expect(editor.exportGeoJSON()).not.toEqual(saved);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(saved); expect(editor.getState().canUndo).toBe(false);
});

it.each(['Escape','blur','pointercancel','lostpointercapture','camera','style'] as const)('cancels the rectangle on %s, retaining earlier edits and corner selection', async reason => {
  setup(); editor.moveVertex(indexAt(100,300), position(90,310)); editor.selectVertices([indexAt(300,300)]);
  const draft = editor.getDraft(); const selected = editor.getState().selectedVertexIndices;
  map.dragPan.disable(); map.boxZoom.disable(); let pointerId = -1;
  map.getCanvas().addEventListener('pointerdown', e => { pointerId = e.pointerId; }, {once:true});
  await userEvent.keyboard('{Shift>}'); await commands.vertexPointer('down',70,70); await commands.vertexPointer('move',330,130);
  expect(rectangle()).not.toBeNull(); await userEvent.keyboard('{/Shift}');
  if (reason === 'Escape') await userEvent.keyboard('{Escape}');
  if (reason === 'blur') window.dispatchEvent(new Event('blur'));
  if (reason === 'pointercancel' || reason === 'lostpointercapture') map.getCanvas().dispatchEvent(new PointerEvent(reason, {pointerId}));
  if (reason === 'camera') map.jumpTo({zoom:14});
  if (reason === 'style') {
    const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); });
    map.setStyle(style(), {diff:false}); await loaded;
  }
  expect(rectangle()).toBeNull(); await commands.vertexPointer('up',330,330);
  expect(editor.getDraft()).toEqual(draft); expect(editor.getState().selectedVertexIndices).toEqual(selected);
  expect(editor.getState().mode).toBe('edit-polygon'); expect(editor.getState().canUndo).toBe(false);
  expect(map.dragPan.isEnabled()).toBe(false); expect(map.boxZoom.isEnabled()).toBe(false);
});

it.each(['selection','insert','remove','move','finish','cancel','lock','destroy'] as const)('stops rectangle selection before %s so late release cannot overwrite new state', async action => {
  setup(); editor.selectVertex(indexAt(100,300));
  await userEvent.keyboard('{Shift>}'); await commands.vertexPointer('down',70,70); await commands.vertexPointer('move',330,130);
  await userEvent.keyboard('{/Shift}');
  if (action === 'selection') editor.selectVertices([indexAt(300,300)]);
  if (action === 'insert') editor.insertVertex(1, position(350,200));
  if (action === 'remove') editor.removeSelectedVertices();
  if (action === 'move') editor.moveVertices([{index:0, coordinate:position(80,80)}]);
  if (action === 'finish') editor.finish();
  if (action === 'cancel') editor.cancel();
  if (action === 'lock') editor.setLockedFeatureIds(['polygon']);
  if (action === 'destroy') editor.destroy();
  const state = editor.getState(); const draft = editor.getDraft();
  expect(rectangle()).toBeNull(); expect(map.dragPan.isEnabled()).toBe(true); expect(map.boxZoom.isEnabled()).toBe(true);
  await commands.vertexPointer('up',330,130);
  expect(editor.getState()).toEqual(state); expect(editor.getDraft()).toEqual(draft);
});

it('ignores Enter during the box, clips it to the canvas, and cancels the session only on a second Escape', async () => {
  setup(); const saved = editor.exportGeoJSON();
  await userEvent.keyboard('{Shift>}'); await commands.vertexPointer('down',50,50); await commands.vertexPointer('move',760,490);
  expect(rectangle()?.getAttribute('style')).toContain('width: 650px');
  await userEvent.keyboard('{/Shift}{Enter}'); expect(editor.getState().mode).toBe('edit-polygon');
  await userEvent.keyboard('{Escape}'); expect(rectangle()).toBeNull(); expect(editor.getState().mode).toBe('edit-polygon');
  await commands.vertexPointer('up',650,400); expect(editor.getState().selectedVertexIndices).toEqual([]);
  await userEvent.keyboard('{Escape}'); expect(editor.getState().mode).toBe('idle'); expect(editor.exportGeoJSON()).toEqual(saved);
});

it('selects only the active hole in a multipart feature and can delete the selected corners atomically', async () => {
  const ring = (x:number,y:number,size:number) => [[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]].map(([a,b]) => position(a!,b!));
  editor.importGeoJSON({type:'Feature',id:'multi',properties:null,geometry:{type:'MultiPolygon',coordinates:[
    [ring(50,50,300), [[100,100],[200,100],[250,200],[200,250],[100,250],[100,100]].map(([x,y]) => position(x!,y!))],
    [ring(450,50,150)],
  ]}});
  editor.clearHistory(); editor.select('multi'); const saved = editor.exportGeoJSON(); editor.editSelected(1,0);
  await box([70,70],[220,130]); expect(editor.getState().selectedVertexIndices).toHaveLength(2);
  await userEvent.keyboard('{Delete}'); expect(editor.getDraft()).toHaveLength(3); expect(editor.getState().canFinish).toBe(true);
  editor.finish(); editor.undo(); expect(editor.exportGeoJSON()).toEqual(saved);
});

it('excludes the fixed shared-boundary junctions even when the box contains the whole chain', async () => {
  const polygon = (id:string, points:number[][]) => ({type:'Feature' as const,id,properties:null,geometry:{type:'Polygon' as const,coordinates:[points.map(([x,y]) => position(x!,y!))]}});
  editor.importGeoJSON({type:'FeatureCollection',features:[
    polygon('a',[[100,100],[300,100],[300,200],[300,300],[100,300],[100,100]]),
    polygon('b',[[300,100],[500,100],[500,300],[300,300],[300,200],[300,100]]),
  ]});
  editor.selectMany(['a','b']); expect(editor.editSharedBoundary()).toBe(true);
  await box([70,70],[530,330]); expect(editor.getState().selectedVertexIndices).toEqual([1]);
  const draft = editor.getDraft(); editor.translateSelectedVertices([0.0001,0]);
  expect(editor.getDraft()[0]).toEqual(draft[0]); expect(editor.getDraft().at(-1)).toEqual(draft.at(-1));
});

it.each(['Point','MultiLineString'] as const)('scopes a box to the active %s draft without adding midpoint or other component indices', async type => {
  editor.importGeoJSON({type:'Feature',id:'draft',properties:null,geometry:type === 'Point'
    ? {type,coordinates:position(100,100)}
    : {type,coordinates:[[position(100,100),position(300,100)],[position(100,300),position(300,300)]]},
  });
  editor.select('draft'); editor.editSelected(); const draft = editor.getDraft();
  await box([70,70],[330,330]);
  expect(editor.getState().selectedVertexIndices).toEqual(draft.map((_,index) => index));
  expect(editor.getDraft()).toEqual(draft);
});
