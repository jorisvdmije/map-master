import { Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { GeometryEditor, type GeometryType, type ValidationError } from '@geo/editor';
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
const lineTool = element<HTMLButtonElement>('tool-line');
const polygonTool = element<HTMLButtonElement>('tool-polygon');
const finish = element<HTMLButtonElement>('finish');
const cancel = element<HTMLButtonElement>('cancel');
const download = element<HTMLButtonElement>('export');
const output = element<HTMLTextAreaElement>('output');
const status = element('status');
let editor: GeometryEditor | undefined;
let selected: GeometryType = 'LineString';
const validationMessages: Record<Exclude<ValidationError, 'too-few-vertices'>, string> = {
  'zero-area': 'These points form a straight line. Place a point off the line.',
  'self-intersection': 'Polygon edges cannot cross, touch, or overlap.',
  'duplicate-vertex': 'A corner is used more than once. Cancel to start again.',
  'antimeridian-crossing': 'Polygons across the date line are not supported yet.',
};

function selectTool(kind: GeometryType): void {
  selected = kind;
  lineTool.setAttribute('aria-pressed', String(kind === 'LineString'));
  polygonTool.setAttribute('aria-pressed', String(kind === 'Polygon'));
  element('start-label').textContent = kind === 'Polygon' ? 'Draw a polygon' : 'Draw a line';
  element('finish-instruction').textContent = kind === 'Polygon'
    ? 'Press Enter or click your first corner to close the polygon.' : 'Press Enter to save your line.';
}

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
  editor = new GeometryEditor(map);
  const activeEditor = editor;
  let exportedCount = -1;
  const update = (): void => {
    const state = activeEditor.getState();
    const drawing = state.mode !== 'idle';
    const polygon = selected === 'Polygon';
    const error = state.validationError;
    start.disabled = drawing;
    lineTool.disabled = drawing;
    polygonTool.disabled = drawing;
    finish.disabled = !state.canFinish;
    cancel.disabled = !drawing;
    download.disabled = state.featureCount === 0;
    element('feature-count').textContent = `${state.featureCount} ${state.featureCount === 1 ? 'feature' : 'features'}`;
    const invalid = error !== null && error !== 'too-few-vertices';
    status.classList.toggle('is-invalid', invalid);
    status.textContent = invalid ? validationMessages[error] : drawing
      ? `${state.vertexCount} ${state.vertexCount === 1 ? 'point' : 'points'} placed. ${state.canFinish ? 'Ready to finish.' : `Place at least ${polygon ? 'three corners' : 'two points'}.`}`
      : 'Ready when you are.';
    element('map-hint').textContent = drawing
      ? polygon ? 'Click to add corners · Click the first to close · Esc to cancel'
        : 'Click to add a point · Enter to finish · Esc to cancel'
      : 'Your next idea, on the map.';
    element('mode-dot').classList.toggle('drawing', drawing);
    if (exportedCount !== state.featureCount) {
      output.value = JSON.stringify(activeEditor.exportGeoJSON(), null, 2);
      exportedCount = state.featureCount;
    }
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

lineTool.addEventListener('click', () => { selectTool('LineString'); });
polygonTool.addEventListener('click', () => { selectTool('Polygon'); });
start.addEventListener('click', () => { editor?.draw(selected); });
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
