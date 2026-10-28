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
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const source = (suffix: string) => map.getSource<GeoJSONSource>(Object.keys(map.getStyle().sources).find(id => id.endsWith(suffix))!)!;
function setup(polygon = true) {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: { nested: { label: 'editable' } }, geometry: polygon ? { type: 'Polygon', coordinates: [
      [[100, 100], [300, 100], [300, 300], [100, 300], [100, 100]].map(([x,y]) => position(x!,y!)),
    ] } : { type: 'LineString', coordinates: [[100,100],[300,100],[400,200],[500,300],[600,350]].map(([x,y]) => position(x!,y!)) } },
    { type: 'Feature', id: '0', properties: null, geometry: { type: 'LineString', coordinates: [position(450,150),position(600,150)] } },
  ] });
  editor.clearHistory(); editor.select(0); editor.editSelected(); return editor.getDraft();
}
const indexAt = (x: number, y: number) => editor.getDraft().findIndex(p => { const s=map.project(p); return Math.hypot(s.x-x,s.y-y)<1; });
async function selectTop() {
  await click(100,100); await userEvent.keyboard('{Shift>}'); await click(300,100); await userEvent.keyboard('{/Shift}');
}
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText='width:700px;height:450px;position:relative;'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895,52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  await userEvent.keyboard('{/Shift}{/Alt}'); await commands.vertexPointer('up',650,400);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});
it.each([6,17])('selects/highlights multiple vertices and drags them at zoom %s with bearing/pitch; Save and Undo are atomic', async zoom => {
  map.jumpTo({ zoom,bearing:25,pitch:35 }); const draft=setup(); const before=editor.exportGeoJSON();
  const left=indexAt(100,100); const right=indexAt(300,100); await selectTop();
  expect(editor.getState().selectedVertexIndices).toEqual([left,right]);
  await expect.poll(async () => {
    const data=await source('-draft').getData(); if (typeof data==='string' || data.type!=='FeatureCollection') return [];
    return data.features.filter(f=>f.properties?.kind==='vertex' && f.properties.active).length;
  }).toBe(2);
  const upload=vi.spyOn(source('-features'),'setData'); const update=vi.fn(); editor.onUpdate(update);
  await commands.vertexPointer('down',100,100); await commands.vertexPointer('move',130,130);
  await expect.poll(()=>editor.getDraft()).not.toEqual(draft);
  expect(editor.exportGeoJSON()).toEqual(before); expect(upload).not.toHaveBeenCalled();
  await commands.vertexPointer('up',150,160);
  const end=position(150,160); const origin=position(100,100); const afterDraft=editor.getDraft();
  for (let i=0;i<draft.length;i++) {
    if (![left,right].includes(i)) expect(afterDraft[i]).toEqual(draft[i]);
    else { expect(afterDraft[i]![0]).toBeCloseTo(draft[i]![0]+end[0]-origin[0],10); expect(afterDraft[i]![1]).toBeCloseTo(draft[i]![1]+end[1]-origin[1],10); }
  }
  expect(map.dragPan.isEnabled()).toBe(true); expect(update).not.toHaveBeenCalled(); editor.finish();
  expect(update).toHaveBeenCalledOnce(); expect(upload).toHaveBeenCalledOnce(); const after=editor.exportGeoJSON();
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  editor.redo(); expect(editor.exportGeoJSON()).toEqual(after);
});
it('toggles with Shift and replaces a multi-selection on an unselected vertex; empty space clears it', async () => {
  setup(); await selectTop(); await userEvent.keyboard('{Shift>}'); await click(100,100); await userEvent.keyboard('{/Shift}');
  expect(editor.getState().selectedVertexIndices).toEqual([indexAt(300,100)]);
  await selectTop(); await click(300,300); expect(editor.getState().selectedVertexIndices).toEqual([indexAt(300,300)]);
  await click(650,400); expect(editor.getState().selectedVertexIndices).toEqual([]);
});
it.each(['top','closing'] as const)('moves the %s edge without inserting vertices or moving other corners', async which => {
  const draft=setup(); const original=editor.exportGeoJSON();
  const first=which==='top'?{x:150,y:100}:{x:100,y:250}; const end={x:first.x-20,y:first.y-30};
  const selected=which==='top'?[indexAt(100,100),indexAt(300,100)]:[indexAt(100,100),indexAt(100,300)];
  await commands.vertexPointer('down',first.x,first.y); expect(new Set(editor.getState().selectedVertexIndices)).toEqual(new Set(selected));
  await commands.vertexPointer('up',end.x,end.y); const next=editor.getDraft(); expect(next).toHaveLength(4);
  const a=position(first.x,first.y); const b=position(end.x,end.y);
  draft.forEach((p,i)=> {
    if (!selected.includes(i)) expect(next[i]).toEqual(p);
    else { expect(next[i]![0]).toBeCloseTo(p[0]+b[0]-a[0],10); expect(next[i]![1]).toBeCloseTo(p[1]+b[1]-a[1],10); }
  });
  expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getState().canFinish).toBe(true);
});
it('preserves midpoint insertion and resets a stale multi-selection', async () => {
  setup(); await selectTop(); await click(200,100);
  expect(editor.getState().vertexCount).toBe(5); expect(editor.getState().selectedVertexIndices).toHaveLength(1);
  const point=editor.getDraft()[editor.getState().selectedVertexIndex!]!;
  expect(point[0]).toBeCloseTo(position(200,100)[0],12); expect(point[1]).toBeCloseTo(position(200,100)[1],12);
});
it('snaps the dragged anchor, translates every selected corner identically, and bypasses snapping with Alt', async () => {
  const draft=setup(); editor.setSnapping({enabled:true}); await selectTop();
  const left=indexAt(100,100); const right=indexAt(300,100);
  await commands.vertexPointer('down',100,100); await commands.vertexPointer('move',445,155);
  await expect.poll(()=>editor.getSnap()?.featureId).toBe('0'); const snapped=editor.getDraft(); const target=position(450,150);
  expect(snapped[left]![0]).toBeCloseTo(target[0],12); expect(snapped[left]![1]).toBeCloseTo(target[1],12);
  expect(snapped[right]![0]-snapped[left]![0]).toBeCloseTo(draft[right]![0]-draft[left]![0],12);
  await userEvent.keyboard('{Alt>}'); await expect.poll(()=>editor.getSnap()).toBeNull();
  expect(editor.getDraft()).not.toEqual(snapped); await userEvent.keyboard('{/Alt}'); await expect.poll(()=>editor.getSnap()?.kind).toBe('vertex');
  editor.setSnapping({enabled:false}); await expect.poll(()=>editor.getSnap()).toBeNull();
  await commands.vertexPointer('up',445,155); expect(editor.getDraft()[left]![0]).toBeCloseTo(position(445,155)[0],10);
});
it.each(['Escape','blur','pointercancel','lostpointercapture','style','camera'] as const)('rolls back only the active group gesture on %s, retaining prior draft edits and selection', async reason => {
  setup(); editor.moveVertex(indexAt(100,300),position(90,310)); await selectTop();
  const draft=editor.getDraft(); const selected=editor.getState().selectedVertexIndices; const before=editor.exportGeoJSON();
  map.dragPan.disable(); map.getCanvas().style.cursor='help'; let pointerId=-1;
  map.getCanvas().addEventListener('pointerdown',e=>{pointerId=e.pointerId;},{once:true});
  await commands.vertexPointer('down',100,100); await commands.vertexPointer('move',140,140);
  await expect.poll(()=>editor.getDraft()).not.toEqual(draft);
  if(reason==='Escape') await userEvent.keyboard('{Escape}');
  if(reason==='blur') window.dispatchEvent(new Event('blur'));
  if(reason==='pointercancel'||reason==='lostpointercapture') map.getCanvas().dispatchEvent(new PointerEvent(reason,{pointerId}));
  if(reason==='style') { const loaded=new Promise<void>(r=>{map.once('style.load',()=>{r();});}); map.setStyle(style(),{diff:false}); await loaded; }
  if(reason==='camera') map.jumpTo({zoom:14});
  expect(editor.getDraft()).toEqual(draft); expect(editor.getState().selectedVertexIndices).toEqual(selected);
  expect(editor.getState().mode).toBe('edit-polygon'); expect(editor.getSnap()).toBeNull();
  expect(map.dragPan.isEnabled()).toBe(false); expect(map.getCanvas().style.cursor).toBe('help');
  await commands.vertexPointer('up',180,160); expect(editor.getDraft()).toEqual(draft); expect(editor.exportGeoJSON()).toEqual(before);
});
it('ignores Enter during dragging; Escape again discards the entire session', async () => {
  const draft=setup(); await selectTop(); const before=editor.exportGeoJSON();
  await commands.vertexPointer('down',100,100); await commands.vertexPointer('move',120,120);
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('edit-polygon'); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Escape}'); expect(editor.getDraft()).toEqual(draft);
  await userEvent.keyboard('{Escape}'); expect(editor.getState().mode).toBe('idle'); expect(editor.getState().canUndo).toBe(false);
});
it('deletes a selection atomically with Delete, refuses a too-small result, and saves one edit', async () => {
  setup(false); const before=editor.exportGeoJSON(); editor.selectVertices([1,3]);
  map.getCanvas().focus(); await userEvent.keyboard('{Delete}'); expect(editor.getDraft()).toHaveLength(3); expect(editor.getState().selectedVertexIndices).toEqual([]);
  editor.selectVertices([0,1]); await userEvent.keyboard('{Delete}'); expect(editor.getDraft()).toHaveLength(3);
  editor.finish(); editor.undo(); expect(editor.exportGeoJSON()).toEqual(before);
});
it('keeps invalid topology visible and repairable without committing it', async () => {
  setup(); await selectTop(); const before=editor.exportGeoJSON();
  await commands.vertexPointer('down',100,100); await commands.vertexPointer('up',100,300);
  expect(editor.getState().canFinish).toBe(false); expect(editor.finish()).toBeNull(); expect(editor.exportGeoJSON()).toEqual(before);
  editor.translateSelectedVertices([0,0.001]); expect(editor.getState().canFinish).toBe(true);
});
it('preserves a return-to-start no-op and cancels safely from a snap callback', async () => {
  const draft=setup(); await selectTop();
  await commands.vertexPointer('down',100,100); await commands.vertexPointer('move',140,140); await commands.vertexPointer('up',100,100);
  expect(editor.getDraft()).toEqual(draft); editor.finish(); expect(editor.getState().canUndo).toBe(false);
  editor.editSelected(); editor.selectVertices([0,1]); editor.setSnapping({enabled:true});
  editor.onSnap(s=>{if(s)editor.cancel();}); const start=map.project(editor.getDraft()[0]!);
  await commands.vertexPointer('down',start.x,start.y); await commands.vertexPointer('up',445,155);
  expect(editor.getState().mode).toBe('idle'); expect(editor.getSnap()).toBeNull(); expect(editor.getState().canUndo).toBe(false);
});
it('rolls back a group crossing the dateline instead of wrapping it', async () => {
  map.jumpTo({center:[179,0],zoom:5});
  editor.importGeoJSON({type:'Feature',id:'edge',properties:null,geometry:{type:'LineString',coordinates:[[179,0],[179.9,0],[179.5,1]]}});
  editor.select('edge');editor.editSelected();editor.selectVertices([0,1]);const draft=editor.getDraft();
  const start=map.project(draft[0]!);const end=map.project([181,0]);
  await commands.vertexPointer('down',start.x,start.y);await commands.vertexPointer('move',end.x,end.y);
  await expect.poll(()=>map.getCanvas().style.cursor).toBe('not-allowed');
  await commands.vertexPointer('up',end.x,end.y);expect(editor.getDraft()).toEqual(draft);
});


it.each(['api','lock','destroy'] as const)('prevents late pointer release from overriding %s during a group drag', async reason => {
  setup(); await selectTop(); const before=editor.exportGeoJSON();
  await commands.vertexPointer('down',100,100); await commands.vertexPointer('move',140,140);
  await expect.poll(()=>map.getCanvas().style.cursor).toBe('move');
  if(reason==='api') editor.moveVertices([{index:0,coordinate:position(80,80)},{index:1,coordinate:position(320,80)}]);
  if(reason==='lock') editor.setLockedFeatureIds([0]);
  if(reason==='destroy') editor.destroy();
  const draft=editor.getDraft();
  await commands.vertexPointer('up',200,200);
  expect(editor.getDraft()).toEqual(draft); expect(editor.exportGeoJSON()).toEqual(before); expect(map.dragPan.isEnabled()).toBe(true);
  if(reason==='api') expect(editor.getState().selectedVertexIndices).toEqual([0,1]);
  else expect(editor.getState().selectedVertexIndices).toEqual([]);
});
