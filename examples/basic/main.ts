import { Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { LineEditor } from '@geo/editor';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

// MapLibre 6 ships a separate worker; let Vite serve and bundle its URL.
setWorkerUrl(workerUrl);

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing demo element: ${id}`);
  return result as T;
}

const start = element<HTMLButtonElement>('start');
const finish = element<HTMLButtonElement>('finish');
const cancel = element<HTMLButtonElement>('cancel');
const download = element<HTMLButtonElement>('export');
const output = element<HTMLTextAreaElement>('output');
const status = element('status');
let editor: LineEditor | undefined;

const map = new Map({
  container: 'map',
  center: [4.895, 52.372],
  zoom: 13.3,
  maxZoom: 19,
  style: {
    version: 8,
    sources: {},
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e9eeea' } },
    ],
  },
});
map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
map.on('error', () => {
  status.textContent = 'A map resource could not load. You can still draw and export your geometry.';
});

map.on('load', () => {
  editor = new LineEditor(map);
  const activeEditor = editor;
  const update = (): void => {
    const state = activeEditor.getState();
    const drawing = state.mode === 'draw-line';
    start.disabled = drawing;
    finish.disabled = !state.canFinish;
    cancel.disabled = !drawing;
    download.disabled = state.featureCount === 0;
    element('feature-count').textContent = `${state.featureCount} ${state.featureCount === 1 ? 'line' : 'lines'}`;
    status.textContent = drawing
      ? `${state.vertexCount} ${state.vertexCount === 1 ? 'point' : 'points'} placed. ${state.canFinish ? 'Ready to finish.' : 'Place at least two points.'}`
      : 'Ready when you are.';
    element('map-hint').textContent = drawing
      ? 'Click to add a point · Enter to finish · Esc to cancel'
      : 'Your next idea, on the map.';
    element('mode-dot').classList.toggle('drawing', drawing);
    output.value = JSON.stringify(activeEditor.exportGeoJSON(), null, 2);
  };
  activeEditor.onChange(update);
  update();

  // Load optional street tiles after the editor is ready; a slow tile provider
  // must not block drawing. Insert the basemap below the editor's overlays.
  if (new URLSearchParams(location.search).get('basemap') === 'off') return;
  const firstOverlay = map.getStyle().layers.find((layer) => layer.id !== 'background')?.id;
  map.addSource('basemap', {
    type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256, maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap', paint: {
    'raster-saturation': -0.85, 'raster-opacity': 0.72,
  } }, firstOverlay);
});

start.addEventListener('click', () => { editor?.startLine(); });
finish.addEventListener('click', () => { editor?.finish(); });
cancel.addEventListener('click', () => { editor?.cancel(); });
download.addEventListener('click', () => {
  if (!editor) return;
  const blob = new Blob([JSON.stringify(editor.exportGeoJSON(), null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'drawing.geojson';
  link.click();
  setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
});

if (import.meta.hot) import.meta.hot.dispose(() => { editor?.destroy(); map.remove(); });
