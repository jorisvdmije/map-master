import { Map, LngLatBounds, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { GeometryEditor, type DrawGeometryType, type GeometryFeature, type Coordinate, type SplitError, type ValidationError } from '@geo/editor';
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
const duplicateSelected = element<HTMLButtonElement>('duplicate-selected');
const splitSelected = element<HTMLButtonElement>('split-selected');
const intersectionSelected = element<HTMLButtonElement>('intersection-selected');
const differenceSelected = element<HTMLButtonElement>('difference-selected');
const unionSelected = element<HTMLButtonElement>('union-selected');
const editSelected = element<HTMLButtonElement>('edit-selected');
const drawHole = element<HTMLButtonElement>('draw-hole');
const deleteHole = element<HTMLButtonElement>('delete-hole');
const partIndex = element<HTMLSelectElement>('part-index');
const ringIndex = element<HTMLSelectElement>('ring-index');
const removeVertex = element<HTMLButtonElement>('remove-vertex');
let editor: GeometryEditor | undefined;
let selected: DrawGeometryType = 'LineString';
const validationMessages: Record<Exclude<ValidationError, 'too-few-vertices'>, string> = {
  'part-intersection': 'Polygon parts cannot touch, cross, or share boundaries.',
  'part-overlap': 'Polygon parts cannot overlap. Keep their filled areas separate.',
  'ring-intersection': 'Ring boundaries cannot touch, cross, or overlap.',
  'hole-outside': 'Keep the hole completely inside the outer boundary.',
  'nested-holes': 'Holes cannot contain other holes.',
  'zero-area': 'These points form a straight line. Place a point off the line.',
  'self-intersection': 'Polygon edges cannot cross, touch, or overlap.',
  'duplicate-vertex': 'A corner is used more than once. Cancel to start again.',
  'antimeridian-crossing': 'Polygons across the date line are not supported yet.',
};

const splitMessages: Record<SplitError, string> = {
  'split-hole-crossing': 'The cutting line must avoid holes and their boundaries.',
  'split-too-few-points': 'Start outside the polygon, draw across it, and end outside. Add at least two points.',
  'split-self-intersection': 'The cutting line cannot cross, touch, or double back on itself. Backspace removes the last point.',
  'split-antimeridian': 'Cutting across the date line is not supported.',
  'split-boundary-touch': 'Cross the edges between corners. Do not place points on the boundary or follow an edge. Hold Alt to bypass snapping.',
  'split-endpoints-inside': 'Start and end the cutting line outside the polygon.',
  'split-crossing-count': 'The cutting line must cross the polygon boundary exactly twice.',
  'split-invalid-result': 'This cut could not produce two valid polygons. Adjust the line or cancel.',
};

function selectTool(kind: DrawGeometryType): void {
  selected = kind;
  lineTool.setAttribute('aria-pressed', String(kind === 'LineString'));
  polygonTool.setAttribute('aria-pressed', String(kind === 'Polygon'));
  element('start-label').textContent = kind === 'Polygon' ? 'Draw a polygon' : 'Draw a line';
  element('finish-instruction').textContent = kind === 'Polygon'
    ? 'Press Enter or click your first corner to close the polygon.' : 'Press Enter to save your line.';
}

// Presentation helper; the demo consumes only the public package API.
function partsOf(geometry: GeometryFeature['geometry']): Array<{ type: 'LineString'; coordinates: Coordinate[] } | { type: 'Polygon'; coordinates: Coordinate[][] }> {
  switch (geometry.type) {
    case 'LineString': case 'Polygon': return [geometry];
    case 'MultiLineString': return geometry.coordinates.map((coordinates) => ({ type: 'LineString', coordinates }));
    case 'MultiPolygon': return geometry.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }));
  }
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
  partIndex.addEventListener('change', () => { update(); });
  let ringSelectionPart = 0;
  let ringSelectionId: string | number | null = null;
  const update = (): void => {
    const state = activeEditor.getState();
    snapping.disabled = false;
    snapping.checked = activeEditor.getSnapping().enabled;
    updateSnapStatus();
    const drawing = state.mode !== 'idle';
    const editing = state.mode.startsWith('edit-');
    const splitting = state.mode === 'split-polygon';
    const intersecting = state.mode === 'intersection-polygons';
    const subtracting = state.mode === 'difference-polygons';
    const merging = state.mode === 'union-polygons';
    const polygon = state.mode === 'draw-hole' || selected === 'Polygon';
    const error = state.validationError;
    const selectedFeature = activeEditor.getSelected();
    const selectedCount = state.selectedFeatureIds.length;
    selection.hidden = selectedCount === 0;
    deselect.disabled = selectedCount === 0 || drawing;
    deleteSelected.disabled = selectedCount === 0 || drawing;
    deleteSelected.setAttribute('aria-label', selectedCount > 1 ? 'Delete selected shapes' : 'Delete selected shape');
    duplicateSelected.disabled = selectedCount === 0 || drawing;
    duplicateSelected.setAttribute('aria-label', selectedCount > 1 ? 'Duplicate selected shapes' : 'Duplicate selected shape');
    editSelected.disabled = selectedFeature === null || drawing;
    const parts = selectedFeature ? partsOf(selectedFeature.geometry) : [];
    if (ringSelectionId !== state.selectedFeatureId || partIndex.options.length !== parts.length) {
      const previous = ringSelectionId === state.selectedFeatureId ? Number(partIndex.value) : 0;
      partIndex.replaceChildren(...parts.map((_, index) => new Option(`Part ${index + 1}`, String(index))));
      partIndex.value = String(Math.min(previous, Math.max(0, parts.length - 1)));
    }
    partIndex.disabled = drawing;
    element('part-control').hidden = parts.length < 2;
    const chosenPart = Number(partIndex.value);
    const part = parts[chosenPart];
    const ringCount = part?.type === 'Polygon' ? part.coordinates.length : 0;
    if (ringSelectionId !== state.selectedFeatureId || ringSelectionPart !== chosenPart || ringIndex.options.length !== ringCount) {
      const previous = ringSelectionId === state.selectedFeatureId && ringSelectionPart === chosenPart ? Number(ringIndex.value) : 0;
      ringIndex.replaceChildren(...Array.from({ length: ringCount }, (_, index) => new Option(index === 0 ? 'Outer boundary' : `Hole ${index}`, String(index))));
      ringIndex.value = String(Math.min(previous, Math.max(0, ringCount - 1)));
      ringSelectionId = state.selectedFeatureId;
      ringSelectionPart = chosenPart;
    }
    ringIndex.disabled = drawing;
    element('ring-control').hidden = ringCount < 2;
    drawHole.hidden = ringCount === 0;
    drawHole.disabled = ringCount === 0 || drawing;
    deleteHole.hidden = ringCount < 2;
    deleteHole.disabled = drawing || Number(ringIndex.value) < 1;
    splitSelected.disabled = selectedFeature?.geometry.type !== 'Polygon' || drawing;
    unionSelected.disabled = drawing || selectedCount < 2 || activeEditor.getSelection().some((feature) =>
      feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon');
    differenceSelected.disabled = unionSelected.disabled;
    intersectionSelected.disabled = unionSelected.disabled;
    element('editing-tools').hidden = !editing;
    element('finish-label').textContent = intersecting ? 'Apply intersection' : subtracting ? 'Apply subtraction' : merging ? 'Apply merge' : splitting ? 'Apply split' : editing ? 'Save' : 'Finish';
    element('drawing-instructions').hidden = editing || splitting || merging || subtracting || intersecting || state.mode === 'draw-hole';
    removeVertex.disabled = !editing || state.selectedVertexIndex === null
      || state.vertexCount <= (state.mode === 'edit-polygon' ? 3 : 2);
    element('vertex-status').textContent = state.selectedVertexIndex === null
      ? 'Click a corner to select it.' : `Corner ${state.selectedVertexIndex + 1} of ${state.vertexCount} selected.`;
    if (selectedFeature) {
      element('selection-type').textContent = selectedFeature.geometry.type;
      const count = editing ? state.vertexCount : part?.type === 'Polygon'
        ? (part.coordinates[Number(ringIndex.value)]?.length ?? 1) - 1 : part?.coordinates.length ?? 0;
      const details = [`${count} ${ringCount > 0 ? 'corners' : 'points'}`];
      if (parts.length > 1) details.push(`part ${chosenPart + 1} of ${parts.length}`);
      if (ringCount > 1) details.push(`${ringCount - 1} ${ringCount === 2 ? 'hole' : 'holes'}`);
      if (editing && state.activeRingIndex !== null) details.push(state.activeRingIndex === 0 ? 'outer boundary' : `hole ${state.activeRingIndex}`);
      element('selection-detail').textContent = details.join(' · ');
    } else if (selectedCount > 1) {
      element('selection-type').textContent = `${selectedCount} shapes selected`;
      element('selection-detail').textContent = intersecting ? activeEditor.getIntersectionPreview()?.geometry === null
        ? 'No common area. All selected shapes are removed on apply.'
        : 'Intersection keeps the common area under the first selected ID; other inputs are removed.' : subtracting ? `Target: ${JSON.stringify(state.selectedFeatureIds[0])}. All other selected shapes are kept as cutters.` : merging ? 'Merge keeps the first selected shape’s ID and properties.'
        : `First selected: ${JSON.stringify(state.selectedFeatureIds[0])}. Subtract cuts this shape using the others.`;
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
    if (state.mode === 'draw-hole' && !invalid) status.textContent = `${state.vertexCount} corners. Draw inside the polygon; Enter saves the hole, Escape cancels.`;
    if (splitting) {
      status.classList.toggle('is-invalid', state.splitError !== null && state.splitError !== 'split-too-few-points');
      status.textContent = state.splitError ? splitMessages[state.splitError] : 'Two parts ready. Enter saves both shapes; Cancel keeps the original.';
    }
    if (merging) {
      status.classList.toggle('is-invalid', state.unionError !== null);
      status.textContent = state.unionError === 'union-invalid-result'
        ? 'The merged boundary is unsupported (for example, parts touching at a single point). Cancel and adjust the polygons.'
        : state.unionError ? 'The merge could not be calculated. Cancel and adjust the polygons.'
        : 'Merged area ready. Apply merge or Enter saves; Cancel keeps the originals. Undo restores all shapes.';
    }
    if (intersecting) {
      status.classList.toggle('is-invalid', state.intersectionError !== null);
      const preview = activeEditor.getIntersectionPreview();
      status.textContent = state.intersectionError === 'intersection-invalid-result'
        ? 'The common boundary is unsupported (for example, touching parts). Cancel and adjust the polygons.'
        : state.intersectionError ? 'The intersection could not be calculated. Cancel and adjust the polygons.'
        : preview?.geometry === null ? 'No common area remains. Apply intersection deletes all selected shapes. Undo restores them.'
        : 'Common area is orange. Apply intersection replaces all selected shapes with this area. Cancel keeps the originals; Undo restores them.';
    }
    if (subtracting) {
      status.classList.toggle('is-invalid', state.differenceError !== null);
      const preview = activeEditor.getDifferencePreview();
      status.textContent = state.differenceError === 'difference-invalid-result'
        ? 'The remaining boundary is unsupported (for example, touching holes). Cancel and adjust the polygons.'
        : state.differenceError ? 'The subtraction could not be calculated. Cancel and adjust the polygons.'
        : preview?.geometry === null ? 'No target area remains. Apply subtraction deletes the target; cutting shapes are kept. Undo restores it.'
        : 'Remaining target area is orange; cutting shapes stay blue. Apply subtraction or Enter saves; Cancel keeps the original.';
    }
    element('map-hint').textContent = intersecting ? 'Review common area · Enter to apply · Esc to cancel' : subtracting ? 'Review remaining area · Enter to apply · Esc to cancel' : merging ? 'Review merged area · Enter to apply · Esc to cancel' : splitting ? 'Draw across the polygon · Backspace to correct · Enter to apply · Esc to cancel' : editing ? 'Drag corners · Click small points to add · Enter to save'
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
duplicateSelected.addEventListener('click', () => {
  if (!editor) return;
  // Offset relative to the map center so copies are visible at every zoom.
  // The library accepts geographic offsets; this placement choice belongs to the UI.
  const center = map.project(map.getCenter());
  const origin = map.unproject(center);
  const target = map.unproject([center.x + 24, center.y + 24]);
  try {
    const event = editor.duplicateSelection([target.lng - origin.lng, target.lat - origin.lat]);
    if (!event) return;
    status.textContent = `Created ${event.changes.length} ${event.changes.length === 1 ? 'copy' : 'copies'}. Drag the selection to position it; Undo removes the copies.`;
    map.getCanvas().focus({ preventScroll: true });
  } catch (error) {
    status.classList.add('is-invalid');
    status.textContent = error instanceof Error ? error.message : 'Could not duplicate this selection.';
  }
});
splitSelected.addEventListener('click', () => { editor?.splitSelected(); });
unionSelected.addEventListener('click', () => { editor?.unionSelection(); });
intersectionSelected.addEventListener('click', () => { editor?.intersectionSelection(); });
differenceSelected.addEventListener('click', () => { editor?.differenceSelection(); });
editSelected.addEventListener('click', () => { editor?.editSelected(Number(ringIndex.value) || 0, Number(partIndex.value) || 0); });
drawHole.addEventListener('click', () => { editor?.drawHole(Number(partIndex.value) || 0); });
deleteHole.addEventListener('click', () => {
  try { editor?.deleteHole(Number(ringIndex.value), Number(partIndex.value) || 0); }
  catch (error) {
    status.classList.add('is-invalid');
    status.textContent = error instanceof Error ? error.message : 'Could not delete this hole.';
  }
});
ringIndex.addEventListener('change', () => { deleteHole.disabled = Number(ringIndex.value) < 1 || editor?.getState().mode !== 'idle'; });
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
        for (const part of partsOf(feature.geometry)) {
          const points = part.type === 'Polygon' ? part.coordinates[0]! : part.coordinates;
          for (const point of points) bounds.extend(point);
        }
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
