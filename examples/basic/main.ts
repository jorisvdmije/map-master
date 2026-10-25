import { Map, LngLatBounds, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { GeometryEditor, type DrawGeometryType, type GeometryFeature, type Coordinate, type ReshapeError, type SplitError, type ValidationError } from '@geo/editor';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { bindAppearanceControl } from '../workspace/appearance.js';

let removeAppearanceControl = () => {};

// MapLibre 6 ships a separate worker; let Vite serve and bundle its URL.
setWorkerUrl(workerUrl);

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing demo element: ${id}`);
  return result as T;
}

const start = element<HTMLButtonElement>('start');
const lineTool = element<HTMLButtonElement>('tool-line');
const markerTool = element<HTMLButtonElement>('tool-marker');
const polygonTool = element<HTMLButtonElement>('tool-polygon');
const finish = element<HTMLButtonElement>('finish');
const cancel = element<HTMLButtonElement>('cancel');
const undo = element<HTMLButtonElement>('undo');
const redo = element<HTMLButtonElement>('redo');
const drawingConstraints = element<HTMLInputElement>('drawing-constraints');
const angleStep = element<HTMLSelectElement>('angle-step');
const snapping = element<HTMLInputElement>('snapping');
const tracing = element<HTMLInputElement>('tracing');
const traceSide = element<HTMLButtonElement>('trace-side');
const download = element<HTMLButtonElement>('export');
const importFile = element<HTMLInputElement>('import-file');
const importStatus = element('import-status');
let importing = false;
const output = element<HTMLTextAreaElement>('output');
const status = element('status');
const selection = element('selection');
const deselect = element<HTMLButtonElement>('deselect');
const lockSelected = element<HTMLButtonElement>('lock-selected');
const deleteSelected = element<HTMLButtonElement>('delete-selected');
const duplicateSelected = element<HTMLButtonElement>('duplicate-selected');
const reshapeSelected = element<HTMLButtonElement>('reshape-selected');
const reshapeSide = element<HTMLButtonElement>('reshape-side');
const splitSelected = element<HTMLButtonElement>('split-selected');
const intersectionSelected = element<HTMLButtonElement>('intersection-selected');
const differenceSelected = element<HTMLButtonElement>('difference-selected');
const unionSelected = element<HTMLButtonElement>('union-selected');
const editSelected = element<HTMLButtonElement>('edit-selected');
const offsetSelected = element<HTMLButtonElement>('offset-selected');
const offsetDistance = element<HTMLInputElement>('offset-distance');
const bufferSelected = element<HTMLButtonElement>('buffer-selected');
const bufferDistance = element<HTMLInputElement>('buffer-distance');
const simplifySelected = element<HTMLButtonElement>('simplify-selected');
const simplificationTolerance = element<HTMLInputElement>('simplification-tolerance');
const scaleSelected = element<HTMLButtonElement>('scale-selected');
const scaleFactor = element<HTMLInputElement>('scale-factor');
const scaleHalf = element<HTMLButtonElement>('scale-half');
const scaleDouble = element<HTMLButtonElement>('scale-double');
const rotateSelected = element<HTMLButtonElement>('rotate-selected');
const rotationAngle = element<HTMLInputElement>('rotation-angle');
const rotateLeft = element<HTMLButtonElement>('rotate-left');
const rotateRight = element<HTMLButtonElement>('rotate-right');
const editSharedBoundary = element<HTMLButtonElement>('edit-shared-boundary');
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

const reshapeMessages: Record<ReshapeError, string> = {
  'reshape-too-few-points': 'Start on the selected boundary, draw a new route, then click the boundary again.',
  'reshape-endpoints-off-boundary': 'Continue the route and finish on the selected boundary. Backspace removes the last point.',
  'reshape-same-endpoint': 'Choose a different endpoint on the boundary. Backspace corrects the last point.',
  'reshape-self-intersection': 'The route cannot cross itself or double back. Use Backspace to correct it.',
  'reshape-boundary-touch': 'Only the first and last points may touch the old boundary. Use Backspace to correct the route.',
  'reshape-antimeridian': 'Routes crossing the date line are not supported.',
  'reshape-invalid-result': 'This route cannot form a valid polygon. Try the other boundary or correct the route.',
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
  markerTool.setAttribute('aria-pressed', String(kind === 'Point'));
  lineTool.setAttribute('aria-pressed', String(kind === 'LineString'));
  polygonTool.setAttribute('aria-pressed', String(kind === 'Polygon'));
  element('start-label').textContent = kind === 'Point' ? 'Place a marker' : kind === 'Polygon' ? 'Draw a polygon' : 'Draw a line';
  element('finish-instruction').textContent = kind === 'Point' ? 'Click once to place a marker. Escape cancels.' : kind === 'Polygon'
    ? 'Press Enter or click your first corner to close the polygon.' : 'Press Enter to save your line.';
}

// Presentation helper; the demo consumes only the public package API.
function partsOf(geometry: GeometryFeature['geometry']): Array<{ type: 'Point'; coordinates: Coordinate } | { type: 'LineString'; coordinates: Coordinate[] } | { type: 'Polygon'; coordinates: Coordinate[][] }> {
  switch (geometry.type) {
    case 'Point': case 'LineString': case 'Polygon': return [geometry];
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
  removeAppearanceControl = bindAppearanceControl(activeEditor, element<HTMLSelectElement>('appearance'));
  let exportedRevision = -1;
  partIndex.addEventListener('change', () => { update(); });
  let ringSelectionPart = 0;
  let ringSelectionId: string | number | null = null;
  const update = (): void => {
    const state = activeEditor.getState();
    drawingConstraints.disabled = false;
    drawingConstraints.checked = activeEditor.getDrawingConstraints().enabled;
    angleStep.disabled = !drawingConstraints.checked;
    angleStep.value = String(activeEditor.getDrawingConstraints().angleStep);
    snapping.disabled = false;
    snapping.checked = activeEditor.getSnapping().enabled;
    tracing.disabled = false; tracing.checked = activeEditor.getTracing().enabled;
    traceSide.hidden = !tracing.checked;
    traceSide.setAttribute('aria-pressed', String(activeEditor.getTracing().side === 'longer'));
    traceSide.textContent = activeEditor.getTracing().side === 'longer' ? 'Use shorter trace route' : 'Other trace route';
    element('trace-help').hidden = !tracing.checked;
    element('trace-help').textContent = !snapping.checked ? 'Enable snapping to trace existing boundaries.'
      : `Click two points on the same boundary to follow its corners (${activeEditor.getTracing().side} route). Alt draws freely. Backspace removes the last section.`;
    updateSnapStatus();
    const drawing = state.mode !== 'idle';
    const editing = state.mode.startsWith('edit-');
    const offsetting = state.mode === 'offset-lines';
    const buffering = state.mode === 'buffer-features';
    const simplifying = state.mode === 'simplify-features';
    const scaling = state.mode === 'scale-features';
    const rotating = state.mode === 'rotate-features';
    const shared = state.mode === 'edit-shared-boundary';
    const reshaping = state.mode === 'reshape-polygon';
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
    offsetSelected.disabled = selectedCount === 0 || drawing || activeEditor.getSelection().some(f => f.geometry.type !== 'LineString' && f.geometry.type !== 'MultiLineString');
    element('offset-tools').hidden = !offsetting;
    if (!offsetting) offsetDistance.setCustomValidity('');
    if (document.activeElement !== offsetDistance) offsetDistance.value = String(state.offsetDistance ?? 0);
    bufferSelected.disabled = selectedCount === 0 || drawing;
    element('buffer-tools').hidden = !buffering;
    if (!buffering) bufferDistance.setCustomValidity('');
    if (document.activeElement !== bufferDistance) bufferDistance.value = String(state.bufferDistance ?? 10);
    simplifySelected.disabled = selectedCount === 0 || drawing;
    element('simplification-tools').hidden = !simplifying;
    if (!simplifying) simplificationTolerance.setCustomValidity('');
    if (document.activeElement !== simplificationTolerance) simplificationTolerance.value = String(state.simplificationTolerance ?? 0);
    scaleSelected.disabled = selectedCount === 0 || drawing;
    element('scale-tools').hidden = !scaling;
    if (!scaling) scaleFactor.setCustomValidity('');
    if (document.activeElement !== scaleFactor) scaleFactor.value = String(state.scaleFactor ?? 1);
    rotateSelected.disabled = selectedCount === 0 || drawing;
    element('rotation-tools').hidden = !rotating;
    if (!rotating) rotationAngle.setCustomValidity('');
    if (document.activeElement !== rotationAngle) rotationAngle.value = String(state.rotationAngle ?? 0);
    editSelected.disabled = selectedFeature === null || drawing;
    editSharedBoundary.disabled = drawing || selectedCount !== 2 || activeEditor.getSelection().some((feature) => feature.geometry.type !== 'Polygon' || feature.geometry.coordinates.length !== 1);
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
    reshapeSelected.disabled = drawing || selectedFeature?.geometry.type !== 'Polygon' || selectedFeature.geometry.coordinates.length !== 1;
    reshapeSide.hidden = !reshaping;
    reshapeSide.disabled = !reshaping || state.vertexCount < 2;
    reshapeSide.setAttribute('aria-pressed', String(state.reshapeSide === 'longer'));
    splitSelected.disabled = selectedFeature?.geometry.type !== 'Polygon' || drawing;
    unionSelected.disabled = drawing || selectedCount < 2 || activeEditor.getSelection().some((feature) =>
      feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon');
    differenceSelected.disabled = unionSelected.disabled;
    intersectionSelected.disabled = unionSelected.disabled;
    const anyLocked = state.selectedFeatureIds.some((id) => activeEditor.isFeatureLocked(id));
    const allLocked = selectedCount > 0 && state.selectedFeatureIds.every((id) => activeEditor.isFeatureLocked(id));
    lockSelected.disabled = drawing || selectedCount === 0;
    lockSelected.textContent = allLocked ? 'Unlock selection' : 'Lock selection';
    element('lock-status').textContent = anyLocked
      ? 'Selection contains locked shapes. Selection, copying and snapping remain available. Locks reset on reload.'
      : 'Locks last until this page is reloaded.';
    if (state.selectedFeatureIds[0] !== undefined && activeEditor.isFeatureLocked(state.selectedFeatureIds[0])) differenceSelected.disabled = true;
    if (anyLocked) {
      for (const button of [deleteSelected, editSelected, drawHole, deleteHole, reshapeSelected, splitSelected,
        unionSelected, intersectionSelected, editSharedBoundary, offsetSelected, bufferSelected, simplifySelected, scaleSelected, rotateSelected]) button.disabled = true;
    }
    element('editing-tools').hidden = !editing;
    element('finish-label').textContent = offsetting ? 'Apply offset' : buffering ? 'Apply buffer' : simplifying ? 'Apply simplification' : scaling ? 'Apply scale' : rotating ? 'Apply rotation' : shared ? 'Save both polygons' : reshaping ? 'Apply reshape' : intersecting ? 'Apply intersection' : subtracting ? 'Apply subtraction' : merging ? 'Apply merge' : splitting ? 'Apply split' : editing ? 'Save' : 'Finish';
    element('drawing-instructions').hidden = offsetting || buffering || simplifying || scaling || rotating || editing || reshaping || splitting || merging || subtracting || intersecting || state.mode === 'draw-hole';
    removeVertex.disabled = !editing || state.selectedVertexIndex === null
      || state.vertexCount <= (state.mode === 'edit-polygon' ? 3 : 2)
      || shared && (state.selectedVertexIndex === 0 || state.selectedVertexIndex === state.vertexCount - 1);
    element('editing-help').textContent = shared
      ? 'Edit the common edge. Small points add a corner; large white points can be dragged. Grey endpoints stay fixed. Both polygons change together.'
      : 'Drag a large point to move a corner. Click a small point between corners to add one.';
    element('vertex-status').textContent = state.selectedVertexIndex === null
      ? 'Click a corner to select it.' : `Corner ${state.selectedVertexIndex + 1} of ${state.vertexCount} selected.`;
    if (selectedFeature) {
      element('selection-type').textContent = selectedFeature.geometry.type;
      const count = editing ? state.vertexCount : part?.type === 'Polygon'
        ? (part.coordinates[Number(ringIndex.value)]?.length ?? 1) - 1 : part?.type === 'Point' ? 1 : part?.coordinates.length ?? 0;
      const details = [`${count} ${ringCount > 0 ? 'corners' : 'points'}`];
      if (parts.length > 1) details.push(`part ${chosenPart + 1} of ${parts.length}`);
      if (ringCount > 1) details.push(`${ringCount - 1} ${ringCount === 2 ? 'hole' : 'holes'}`);
      if (editing && state.activeRingIndex !== null) details.push(state.activeRingIndex === 0 ? 'outer boundary' : `hole ${state.activeRingIndex}`);
      element('selection-detail').textContent = details.join(' · ');
    } else if (selectedCount > 1) {
      element('selection-type').textContent = `${selectedCount} shapes selected`;
      element('selection-detail').textContent = shared ? 'One shared boundary. Both polygons are saved and restored together.' : intersecting ? activeEditor.getIntersectionPreview()?.geometry === null
        ? 'No common area. All selected shapes are removed on apply.'
        : 'Intersection keeps the common area under the first selected ID; other inputs are removed.' : subtracting ? `Target: ${JSON.stringify(state.selectedFeatureIds[0])}. All other selected shapes are kept as cutters.` : merging ? 'Merge keeps the first selected shape’s ID and properties.'
        : `First selected: ${JSON.stringify(state.selectedFeatureIds[0])}. Subtract cuts this shape using the others.`;
    }
    importFile.disabled = drawing || importing;
    start.disabled = drawing;
    lineTool.disabled = drawing;
    polygonTool.disabled = drawing;
    markerTool.disabled = drawing;
    finish.disabled = !state.canFinish || offsetting && !offsetDistance.validity.valid || buffering && !bufferDistance.validity.valid || simplifying && !simplificationTolerance.validity.valid || scaling && !scaleFactor.validity.valid || rotating && !rotationAngle.validity.valid;
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
    if (state.mode === 'draw-point') status.textContent = 'Click once to place a marker. Escape cancels.';
    if (state.mode === 'edit-point') element('editing-help').textContent = 'Drag the point to move the marker, then Save. Cancel restores its position.';
    if (state.mode === 'draw-hole' && !invalid) status.textContent = `${state.vertexCount} corners. Draw inside the polygon; Enter saves the hole, Escape cancels.`;
    if (offsetting) {
      status.classList.toggle('is-invalid', state.offsetError !== null);
      status.textContent = state.offsetError === 'offset-out-of-bounds'
        ? 'The offset leaves the supported map area. Reduce the distance or Cancel.'
        : state.offsetError === 'offset-join-too-sharp' ? 'A corner is too sharp for this miter join. Set 0 or Cancel and edit the line.'
        : state.offsetError ? 'The offset crosses or reverses itself, or is too small to represent. Change the distance or Cancel.'
        : `Preview: ${state.offsetDistance} Mercator m (${(state.offsetDistance ?? 0) > 0 ? 'left' : (state.offsetDistance ?? 0) < 0 ? 'right' : 'original'}). Apply replaces the selected lines; Undo restores them.`;
    }
    if (buffering) {
      status.classList.toggle('is-invalid', state.bufferError !== null);
      status.textContent = state.bufferError === 'buffer-out-of-bounds'
        ? 'This buffer extends outside the supported Mercator map area. Reduce the distance or Cancel.'
        : state.bufferError ? 'The buffer could not produce valid geometry. Change the distance or Cancel.'
        : `Preview: ${state.bufferDistance} Mercator m. Apply replaces each selected shape with its buffer; Undo restores it.`;
    }
    if (simplifying) {
      const preview = activeEditor.getSimplificationPreview();
      const count = (features: GeometryFeature[]): number => features.reduce((sum, feature) => sum + partsOf(feature.geometry).reduce((total, part) =>
        total + (part.type === 'Polygon' ? part.coordinates.reduce((n, ring) => n + ring.length - 1, 0) : part.type === 'Point' ? 1 : part.coordinates.length), 0), 0);
      status.classList.toggle('is-invalid', state.simplificationError !== null);
      status.textContent = preview
        ? `${count(activeEditor.getSelection())} → ${count(preview.features)} vertices at ${state.simplificationTolerance} Mercator m. Apply saves the selection; Undo restores it.`
        : 'This tolerance creates invalid geometry. Reduce the tolerance or Cancel.';
    }
    if (scaling) {
      status.classList.toggle('is-invalid', state.scaleError !== null);
      status.textContent = state.scaleError === 'scale-out-of-bounds'
        ? 'This factor moves shapes outside the supported map area. Reduce the factor or Cancel.'
        : state.scaleError ? 'The scaled geometry is invalid. Change the factor or Cancel.'
        : `Preview: ${state.scaleFactor}× original size. Apply scale saves the whole selection; Undo restores it.`;
    }
    if (rotating) {
      status.classList.toggle('is-invalid', state.rotationError !== null);
      status.textContent = state.rotationError === 'rotation-out-of-bounds'
        ? 'This angle moves shapes outside the supported map area. Change the angle or Cancel.'
        : state.rotationError ? 'The rotated geometry is invalid. Change the angle or Cancel.'
        : `Preview: ${state.rotationAngle}° clockwise. Apply rotation saves the whole selection; Undo restores it.`;
    }
    if (shared) {
      status.classList.toggle('is-invalid', state.sharedBoundaryError !== null);
      status.textContent = state.sharedBoundaryError === 'shared-boundary-overlap' ? 'The polygons would overlap. Move the shared boundary back inside their outer outline.'
        : state.sharedBoundaryError ? 'Both polygons must remain valid. Correct the shared boundary or Cancel.'
        : 'Add or drag points on the common boundary. Endpoints stay fixed. Save applies both polygons; Undo restores both.';
    }
    if (reshaping) {
      status.classList.toggle('is-invalid', state.reshapeError !== null && state.reshapeError !== 'reshape-too-few-points' && state.reshapeError !== 'reshape-endpoints-off-boundary');
      status.textContent = state.reshapeError ? reshapeMessages[state.reshapeError]
        : `Replacing the ${state.reshapeSide} old boundary. Other boundary switches sides. Apply reshape saves; Cancel keeps the original.`;
    }
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
    element('map-hint').textContent = offsetting ? 'Positive left · Negative right · Enter applies · Esc cancels' : buffering ? 'Set a distance · Review the zone · Enter applies · Esc cancels' : simplifying ? 'Set a tolerance · Review remaining vertices · Enter applies · Esc cancels' : scaling ? 'Set a factor · White marker is the centre · Enter applies · Esc cancels' : rotating ? 'Set an angle · White marker is the centre · Enter applies · Esc cancels' : shared ? 'Edit the shared edge · Grey endpoints are fixed · Enter saves both · Esc cancels' : reshaping ? state.canFinish ? 'Review shape · Other boundary to switch · Enter to apply · Esc to cancel' : 'Start and end on the boundary · Backspace to correct · Esc to cancel' : intersecting ? 'Review common area · Enter to apply · Esc to cancel' : subtracting ? 'Review remaining area · Enter to apply · Esc to cancel' : merging ? 'Review merged area · Enter to apply · Esc to cancel' : splitting ? 'Draw across the polygon · Backspace to correct · Enter to apply · Esc to cancel' : editing ? 'Drag corners · Click small points to add · Enter to save'
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
      : activeEditor.getState().mode === 'reshape-polygon' ? 'Start and end attach to this boundary, even with snapping off.'
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

tracing.addEventListener('change', () => { editor?.setTracing({ enabled: tracing.checked }); });
traceSide.addEventListener('click', () => { editor?.setTracing({ side: editor.getTracing().side === 'shorter' ? 'longer' : 'shorter' }); });

drawingConstraints.addEventListener('change', () => { editor?.setDrawingConstraints({ enabled: drawingConstraints.checked }); });
angleStep.addEventListener('change', () => { editor?.setDrawingConstraints({ angleStep: Number(angleStep.value) as 45 | 90 }); });
snapping.addEventListener('change', () => {
  editor?.setSnapping({ enabled: snapping.checked });
});
markerTool.addEventListener('click', () => { selectTool('Point'); });
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
rotateSelected.addEventListener('click', () => {
  if (!editor) return;
  if (!editor.rotateSelection()) {
    status.classList.add('is-invalid');
    status.textContent = 'Select shapes within the Mercator map area, without date-line crossings or a span over 180°.';
  } else rotationAngle.focus();
});
rotationAngle.addEventListener('input', () => {
  const angle = rotationAngle.valueAsNumber;
  const valid = Number.isFinite(angle);
  rotationAngle.setCustomValidity(valid ? '' : 'Enter a finite angle.');
  if (valid) editor?.setRotationAngle(angle);
  finish.disabled = !valid || !editor?.getState().canFinish;
});
rotationAngle.addEventListener('blur', () => {
  // A cleared/incomplete number is only a text-entry draft. Restore the last preview angle on exit.
  rotationAngle.setCustomValidity('');
  rotationAngle.value = String(editor?.getState().rotationAngle ?? 0);
  finish.disabled = !editor?.getState().canFinish;
});
for (const [button, delta] of [[rotateLeft, -15], [rotateRight, 15]] as const) {
  button.addEventListener('click', () => {
    rotationAngle.setCustomValidity('');
    editor?.setRotationAngle((editor.getState().rotationAngle ?? 0) + delta);
  });
}
offsetSelected.addEventListener('click', () => {
  if (!editor) return;
  if (!editor.offsetSelection()) {
    status.classList.add('is-invalid');
    status.textContent = 'Select only simple open lines within the Mercator map area, without date-line crossings or a span over 180°.';
  } else offsetDistance.focus();
});
offsetDistance.addEventListener('input', () => {
  const distance = offsetDistance.valueAsNumber;
  const valid = Number.isFinite(distance);
  offsetDistance.setCustomValidity(valid ? '' : 'Enter a finite signed distance.');
  if (valid) editor?.setOffsetDistance(distance);
  finish.disabled = !valid || !editor?.getState().canFinish;
});
offsetDistance.addEventListener('blur', () => {
  // A cleared/incomplete number is only a text-entry draft. Restore the last preview distance on exit.
  offsetDistance.setCustomValidity('');
  offsetDistance.value = String(editor?.getState().offsetDistance ?? 0);
  finish.disabled = !editor?.getState().canFinish;
});
bufferSelected.addEventListener('click', () => {
  if (!editor) return;
  if (!editor.bufferSelection()) {
    status.classList.add('is-invalid');
    status.textContent = 'Select shapes within the Mercator map area, without date-line crossings or a span over 180°.';
  } else bufferDistance.focus();
});
bufferDistance.addEventListener('input', () => {
  const distance = bufferDistance.valueAsNumber;
  const valid = Number.isFinite(distance) && distance > 0;
  bufferDistance.setCustomValidity(valid ? '' : 'Enter a positive distance.');
  if (valid) editor?.setBufferDistance(distance);
  finish.disabled = !valid || !editor?.getState().canFinish;
});
bufferDistance.addEventListener('blur', () => {
  // A cleared/incomplete number is only a text-entry draft. Restore the last preview distance on exit.
  bufferDistance.setCustomValidity('');
  bufferDistance.value = String(editor?.getState().bufferDistance ?? 10);
  finish.disabled = !editor?.getState().canFinish;
});
simplifySelected.addEventListener('click', () => {
  if (!editor) return;
  if (!editor.simplifySelection()) {
    status.classList.add('is-invalid');
    status.textContent = 'Select shapes within the Mercator map area, without date-line crossings or a span over 180°.';
  } else simplificationTolerance.focus();
});
simplificationTolerance.addEventListener('input', () => {
  const tolerance = simplificationTolerance.valueAsNumber;
  const valid = Number.isFinite(tolerance) && tolerance >= 0;
  simplificationTolerance.setCustomValidity(valid ? '' : 'Enter a nonnegative tolerance.');
  if (valid) editor?.setSimplificationTolerance(tolerance);
  finish.disabled = !valid || !editor?.getState().canFinish;
});
simplificationTolerance.addEventListener('blur', () => {
  // A cleared/incomplete number is only a text-entry draft. Restore the last preview tolerance on exit.
  simplificationTolerance.setCustomValidity('');
  simplificationTolerance.value = String(editor?.getState().simplificationTolerance ?? 0);
  finish.disabled = !editor?.getState().canFinish;
});
scaleSelected.addEventListener('click', () => {
  if (!editor) return;
  if (!editor.scaleSelection()) {
    status.classList.add('is-invalid');
    status.textContent = 'Select shapes within the Mercator map area, without date-line crossings or a span over 180°.';
  } else scaleFactor.focus();
});
scaleFactor.addEventListener('input', () => {
  const factor = scaleFactor.valueAsNumber;
  const valid = Number.isFinite(factor) && factor > 0;
  scaleFactor.setCustomValidity(valid ? '' : 'Enter a factor greater than zero.');
  if (valid) editor?.setScaleFactor(factor);
  finish.disabled = !valid || !editor?.getState().canFinish;
});
scaleFactor.addEventListener('blur', () => {
  // A cleared/incomplete number is only a text-entry draft. Restore the last preview factor on exit.
  scaleFactor.setCustomValidity('');
  scaleFactor.value = String(editor?.getState().scaleFactor ?? 1);
  finish.disabled = !editor?.getState().canFinish;
});
for (const [button, multiplier] of [[scaleHalf, 0.5], [scaleDouble, 2]] as const) {
  button.addEventListener('click', () => {
    scaleFactor.setCustomValidity('');
    scaleFactor.value = String((editor?.getState().scaleFactor ?? 1) * multiplier);
    scaleFactor.dispatchEvent(new Event('input'));
  });
}
editSharedBoundary.addEventListener('click', () => {
  if (editor && !editor.editSharedBoundary()) {
    status.classList.add('is-invalid');
    status.textContent = 'Choose two polygons without holes sharing one complete, exactly matching boundary. Their boundary vertices must match.';
  }
});
reshapeSelected.addEventListener('click', () => { editor?.reshapeSelected(); });
reshapeSide.addEventListener('click', () => { editor?.setReshapeSide(editor.getState().reshapeSide === 'shorter' ? 'longer' : 'shorter'); });
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
ringIndex.addEventListener('change', () => { deleteHole.disabled = Number(ringIndex.value) < 1 || editor?.getState().mode !== 'idle' || editor.getState().selectedFeatureIds.some((id) => editor!.isFeatureLocked(id)); });
removeVertex.addEventListener('click', () => {
  const index = editor?.getState().selectedVertexIndex;
  if (index !== undefined && index !== null) editor?.removeVertex(index);
});
lockSelected.addEventListener('click', () => {
  if (!editor) return;
  const selected = editor.getState().selectedFeatureIds;
  const locks = editor.getLockedFeatureIds();
  const allLocked = selected.every((id) => editor!.isFeatureLocked(id));
  editor.setLockedFeatureIds(allLocked ? locks.filter((id) => !selected.includes(id)) : [...locks, ...selected]);
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
          const points = part.type === 'Polygon' ? part.coordinates[0]! : part.type === 'Point' ? [part.coordinates] : part.coordinates;
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

if (import.meta.hot) import.meta.hot.dispose(() => { removeAppearanceControl(); editor?.destroy(); map.remove(); });
