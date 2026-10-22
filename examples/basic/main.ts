import { Map, LngLatBounds, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { GeometryEditor, type GeometryType, type SplitError, type ValidationError } from '@geo/editor';
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
const undo = element<HTMLButtonElement>('undo');
const redo = element<HTMLButtonElement>('redo');
const snapping = element<HTMLInputElement>('snapping');
const download = element<HTMLButtonElement>('export');
const importFile = element<HTMLInputElement>('import-file');
const importStatus = element('import-status');
let importing = false;
const output = element<HTMLTextAreaElement>('output');
const status = element('status');
const selection = element('selection');
const deselect = element<HTMLButtonElement>('deselect');
const deleteSelected = element<HTMLButtonElement>('delete-selected');
const splitSelected = element<HTMLButtonElement>('split-selected');
const editSelected = element<HTMLButtonElement>('edit-selected');
const removeVertex = element<HTMLButtonElement>('remove-vertex');
let editor: GeometryEditor | undefined;
let selected: GeometryType = 'LineString';
const validationMessages: Record<Exclude<ValidationError, 'too-few-vertices'>, string> = {
  'zero-area': 'These points form a straight line. Place a point off the line.',
  'self-intersection': 'Polygon edges cannot cross, touch, or overlap.',
  'duplicate-vertex': 'A corner is used more than once. Cancel to start again.',
  'antimeridian-crossing': 'Polygons across the date line are not supported yet.',
};

const splitMessages: Record<SplitError, string> = {
  'split-too-few-points': 'Start outside the polygon, draw across it, and end outside. Add at least two points.',
  'split-self-intersection': 'The cutting line cannot cross, touch, or double back on itself. Backspace removes the last point.',
  'split-antimeridian': 'Cutting across the date line is not supported.',
  'split-boundary-touch': 'Cross the edges between corners. Do not place points on the boundary or follow an edge. Hold Alt to bypass snapping.',
  'split-endpoints-inside': 'Start and end the cutting line outside the polygon.',
  'split-crossing-count': 'The cutting line must cross the polygon boundary exactly twice.',
  'split-invalid-result': 'This cut could not produce two valid polygons. Adjust the line or cancel.',
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
  editor = new GeometryEditor(map, { snapping: { enabled: true } });
  const activeEditor = editor;
  let exportedRevision = -1;
  const update = (): void => {
    const state = activeEditor.getState();
    snapping.disabled = false;
    snapping.checked = activeEditor.getSnapping().enabled;
    updateSnapStatus();
    const drawing = state.mode !== 'idle';
    const editing = state.mode.startsWith('edit-');
    const splitting = state.mode === 'split-polygon';
    const polygon = selected === 'Polygon';
    const error = state.validationError;
    const selectedFeature = activeEditor.getSelected();
    const selectedCount = state.selectedFeatureIds.length;
    selection.hidden = selectedCount === 0;
    deselect.disabled = selectedCount === 0 || drawing;
    deleteSelected.disabled = selectedCount === 0 || drawing;
    deleteSelected.setAttribute('aria-label', selectedCount > 1 ? 'Delete selected shapes' : 'Delete selected shape');
    editSelected.disabled = selectedFeature === null || drawing;
    splitSelected.disabled = selectedFeature?.geometry.type !== 'Polygon' || drawing;
    element('editing-tools').hidden = !editing;
    element('finish-label').textContent = splitting ? 'Apply split' : editing ? 'Save' : 'Finish';
    element('drawing-instructions').hidden = editing || splitting;
    removeVertex.disabled = !editing || state.selectedVertexIndex === null
      || state.vertexCount <= (state.mode === 'edit-polygon' ? 3 : 2);
    element('vertex-status').textContent = state.selectedVertexIndex === null
      ? 'Click a corner to select it.' : `Corner ${state.selectedVertexIndex + 1} of ${state.vertexCount} selected.`;
    if (selectedFeature) {
      element('selection-type').textContent = selectedFeature.geometry.type === 'Polygon' ? 'Polygon' : 'Line';
      const count = editing ? state.vertexCount : selectedFeature.geometry.type === 'Polygon'
        ? (selectedFeature.geometry.coordinates[0]?.length ?? 1) - 1
        : selectedFeature.geometry.coordinates.length;
      element('selection-detail').textContent = `${count} ${selectedFeature.geometry.type === 'Polygon' ? 'corners' : 'points'}`;
    } else if (selectedCount > 1) {
      element('selection-type').textContent = `${selectedCount} shapes selected`;
      element('selection-detail').textContent = 'Shift+click to toggle a shape. Delete removes the whole selection.';
    }
    importFile.disabled = drawing || importing;
    start.disabled = drawing;
    lineTool.disabled = drawing;
    polygonTool.disabled = drawing;
    finish.disabled = !state.canFinish;
    cancel.disabled = !drawing;
    undo.disabled = !state.canUndo;
    redo.disabled = !state.canRedo;
    download.disabled = state.featureCount === 0;
    element('feature-count').textContent = `${state.featureCount} ${state.featureCount === 1 ? 'feature' : 'features'}`;
    const invalid = error !== null && error !== 'too-few-vertices';
    status.classList.toggle('is-invalid', invalid);
    status.textContent = invalid ? editing && error === 'duplicate-vertex'
      ? 'Two corners coincide. Move or remove a corner.' : validationMessages[error]
      : editing ? `${state.vertexCount} corners. Save to apply changes, or Cancel to restore the original.` : drawing
      ? `${state.vertexCount} ${state.vertexCount === 1 ? 'point' : 'points'} placed. ${state.canFinish ? 'Ready to finish.' : `Place at least ${polygon ? 'three corners' : 'two points'}.`}`
      : selectedCount > 1 ? `${selectedCount} shapes selected. Drag a selected shape to move the group. Undo restores the previous position.`
        : selectedFeature ? 'Drag to move this shape, or edit its corners. Escape cancels a drag.'
        : state.featureCount > 0 ? 'Click a shape to select it, or draw another.' : 'Ready when you are.';
    if (splitting) {
      status.classList.toggle('is-invalid', state.splitError !== null && state.splitError !== 'split-too-few-points');
      status.textContent = state.splitError ? splitMessages[state.splitError] : 'Two parts ready. Enter saves both shapes; Cancel keeps the original.';
    }
    element('map-hint').textContent = splitting ? 'Draw across the polygon · Backspace to correct · Enter to apply · Esc to cancel' : editing ? 'Drag corners · Click small points to add · Enter to save'
      : drawing
      ? polygon ? 'Click to add corners · Click the first to close · Esc to cancel'
        : 'Click to add a point · Enter to finish · Esc to cancel'
      : selectedCount > 0 ? 'Drag selection to move · Release to save · Esc to cancel · Shift+click to toggle'
        : state.featureCount > 0 ? 'Click to select · Shift+drag to select several shapes' : 'Your next idea, on the map.';
    element('mode-dot').classList.toggle('drawing', drawing);
    element('mode-dot').classList.toggle('selected', selectedCount > 0);
    if (exportedRevision !== state.dataRevision) {
      output.value = JSON.stringify(activeEditor.exportGeoJSON(), null, 2);
      exportedRevision = state.dataRevision;
    }
  };
  const updateSnapStatus = (): void => {
    const snap = activeEditor.getSnap();
    element('snap-status').textContent = snap
      ? snap.featureId === null ? 'Snapped to start · Click to close' : `Snapped to ${snap.kind}`
      : activeEditor.getSnapping().enabled
        ? activeEditor.getState().mode.startsWith('edit-') ? 'Drag a corner near another shape to snap. Hold Alt to move freely.'
          : 'Draw near an existing shape to snap.'
        : 'Snapping is off.';
  };
  activeEditor.onSnap(updateSnapStatus);
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

snapping.addEventListener('change', () => {
  editor?.setSnapping({ enabled: snapping.checked });
});
lineTool.addEventListener('click', () => { selectTool('LineString'); });
polygonTool.addEventListener('click', () => { selectTool('Polygon'); });
start.addEventListener('click', () => { editor?.draw(selected); });
finish.addEventListener('click', () => { editor?.finish(); });
cancel.addEventListener('click', () => { editor?.cancel(); });
undo.addEventListener('click', () => { if (editor?.undo()) map.getCanvas().focus({ preventScroll: true }); });
redo.addEventListener('click', () => { if (editor?.redo()) map.getCanvas().focus({ preventScroll: true }); });
deselect.addEventListener('click', () => { editor?.select(null); });
splitSelected.addEventListener('click', () => { editor?.splitSelected(); });
editSelected.addEventListener('click', () => { editor?.editSelected(); });
removeVertex.addEventListener('click', () => {
  const index = editor?.getState().selectedVertexIndex;
  if (index !== undefined && index !== null) editor?.removeVertex(index);
});
deleteSelected.addEventListener('click', () => {
  if (!editor) return;
  const deleted = editor.getState().selectedFeatureIds.length > 1 ? editor.deleteSelection() : editor.deleteSelected();
  if (!deleted) return;
  // The selected card is now hidden; keep keyboard focus on a useful control.
  start.focus({ preventScroll: true });
});
importFile.addEventListener('change', () => {
  const file = importFile.files?.[0];
  if (!file || !editor || importing) return;
  importing = true;
  importFile.disabled = true;
  importStatus.hidden = false;
  importStatus.classList.remove('is-invalid');
  importStatus.textContent = 'Reading GeoJSON…';
  void (async () => {
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a file smaller than 5 MB.');
      const input: unknown = JSON.parse(await file.text());
      const imported = editor.importGeoJSON(input);
      importStatus.textContent = `Imported ${imported.features.length} ${imported.features.length === 1 ? 'feature' : 'features'}.`;
      const bounds = new LngLatBounds();
      for (const feature of imported.features) {
        const points = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0]! : feature.geometry.coordinates;
        for (const point of points) bounds.extend(point);
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });
    } catch (error) {
      importStatus.classList.add('is-invalid');
      importStatus.textContent = error instanceof SyntaxError ? 'The file is not valid JSON.'
        : error instanceof Error ? error.message : 'Could not import this file.';
    } finally {
      importing = false;
      importFile.value = '';
      importFile.disabled = editor.getState().mode !== 'idle';
    }
  })();
});
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
