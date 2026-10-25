import { Map, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { GeometryEditor, type Coordinate } from '@geo/editor';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
let map: Map | undefined;
let editor: GeometryEditor | undefined;
let armed = false;
let sampleTimer: number | undefined;
let pending: Promise<{ ms: number; updated: boolean }> | undefined;
let resolveSample: ((sample: { ms: number; updated: boolean }) => void) | undefined;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const twoFrames = async () => { await frame(); await frame(); };
async function settled(): Promise<void> {
  const current = map!;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { current.off('idle', idle); reject(new Error('Map did not become idle.')); }, 10000);
    const idle = () => { clearTimeout(timeout); resolve(); };
    current.once('idle', idle); current.triggerRepaint();
  });
  await twoFrames();
}
const pointerSample = () => {
  if (!armed) return;
  armed = false;
  const started = performance.now();
  const before = editor!.getDraft()[0]!;
  const inspect = () => {
    const current = editor!.getDraft()[0]!;
    const changed = current[0] !== before[0] || current[1] !== before[1];
    const point = map!.project(current);
    const layers = map!.getStyle().layers.filter(layer => layer.id.endsWith('-vertices')).map(layer => layer.id);
    const rendered = changed && map!.queryRenderedFeatures(point, { layers }).some(feature => {
      if (feature.geometry.type !== 'Point' || !feature.properties.active) return false;
      const hit = map!.project(feature.geometry.coordinates as Coordinate);
      return Math.hypot(hit.x - point.x, hit.y - point.y) < 1;
    });
    if (!rendered && performance.now() - started < 5000) { requestAnimationFrame(inspect); return; }
    // Observe a painted handle at the new position, then allow the next animation frame.
    requestAnimationFrame(() => {
      resolveSample?.({ ms: performance.now() - started, updated: rendered });
      resolveSample = undefined;
    });
  };
  requestAnimationFrame(inspect);
};
const fixture = {
  async mount() {
    if (map || editor) throw new Error('Unmount before remounting.');
    map = new Map({ container: 'map', center: [4.89, 52.37], zoom: 13.4, fadeDuration: 0,
      style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] } });
    map.on('error', event => { throw event.error; });
    await new Promise<void>(resolve => map!.once('load', () => resolve()));
    // Capture before the editor's pointer listener; measure entirely in the browser clock.
    map.getCanvas().addEventListener('pointermove', pointerSample, true);
    editor = new GeometryEditor(map, { snapping: { enabled: true }, historyLimit: 100 });
    await settled();
  },
  environment() {
    const gl = map!.getCanvas().getContext('webgl2');
    if (!gl) throw new Error('No WebGL2 context.');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio,
      webgl: String(gl.getParameter(gl.VERSION)),
      graphicsRenderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) };
  },
  async load(data: unknown) { editor!.importGeoJSON(data); editor!.clearHistory(); await settled(); return editor!.getState().featureCount; },
  async selection(id: number) {
    const started = performance.now(); editor!.select(id); await settled();
    if (editor!.getSelected()?.id !== id) throw new Error('Selection was not applied.');
    return performance.now() - started;
  },
  async prepareDrag(cold: boolean, index: number) {
    editor!.cancel();
    if (cold) { map!.jumpTo({ bearing: index % 2 ? 0.1 : 0 }); await settled(); }
    editor!.select(999); editor!.editSelected(); await settled();
    const point = map!.project(editor!.getDraft()[0]!);
    return { x: point.x, y: point.y };
  },
  arm() {
    armed = true;
    pending = new Promise(resolve => {
      resolveSample = sample => { clearTimeout(sampleTimer); sampleTimer = undefined; resolve(sample); };
      sampleTimer = window.setTimeout(() => {
        armed = false; resolveSample?.({ ms: 6000, updated: false }); resolveSample = undefined;
      }, 6000);
    });
  },
  sample() { if (!pending) throw new Error('Arm before sampling.'); return pending; },
  async commit() {
    const started = performance.now(); editor!.finish(); await settled();
    if (editor!.getState().mode !== 'idle') throw new Error('Commit did not finish.');
    const ms = performance.now() - started; editor!.undo(); await settled(); return ms;
  },
  async exercise() {
    editor!.select(999); editor!.editSelected();
    const point = editor!.getDraft()[0]!; editor!.moveVertex(0, [point[0] + 0.00001, point[1]]); editor!.finish();
    editor!.undo(); editor!.redo(); editor!.selectMany([0, 1, 2]); editor!.translateSelection([0.00001, 0]);
    editor!.setAppearance({ marker: { radius: 9 } });
    editor!.onSnap(() => {}); editor!.onChange(() => {});
    editor!.draw('LineString');
    map!.fire('mousemove', { point: { x: 450, y: 300 }, originalEvent: new MouseEvent('mousemove'), lngLat: map!.unproject([450, 300]) });
    await twoFrames();
  },
  async unmount() {
    map!.getCanvas().removeEventListener('pointermove', pointerSample, true);
    editor!.destroy(); editor = undefined;
    if (Object.keys(map!.getStyle().sources).length !== 0 || map!.getStyle().layers.length !== 1) throw new Error('Editor leaked map resources.');
    if (document.querySelector('[data-geo-draft-border], [data-geo-translation-preview]')) throw new Error('Editor leaked preview nodes.');
    clearTimeout(sampleTimer); sampleTimer = undefined;
    map!.remove(); map = undefined; pending = undefined; resolveSample = undefined; armed = false;
    await twoFrames();
    if (document.querySelector('#map')!.children.length !== 0) throw new Error('Map leaked DOM children.');
  },
  async assertPicked() {
    const position: Coordinate = [4.905, 52.372]; const point = map!.project(position);
    map!.fire('click', { point, lngLat: map!.unproject(point), originalEvent: new MouseEvent('click', { button: 0 }) });
    if (editor!.getSelected()?.id !== 999) throw new Error('Installed geometry did not render/pick.');
  },
};
declare global { interface Window { budgetFixture: typeof fixture } }
window.budgetFixture = fixture;
