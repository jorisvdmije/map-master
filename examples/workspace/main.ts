import { Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { GeoJSONImportError, GeometryEditor } from '@jorisvdmije/map-master';
import type { EditorState, GeometryFeature, GeometryFeatureCollection, ValidationError } from '@jorisvdmije/map-master';
import { WorkspaceStore } from './storage.js';
import { bindAppearanceControl } from './appearance.js';
import './style.css';

// Let the consumer's bundler locate the separate MapLibre 6 worker in dev and production.
setWorkerUrl(workerUrl);

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing application element: ${selector}`);
  return found;
}

const buttons = Object.fromEntries([
  'save', 'polygon', 'line', 'marker', 'undo', 'redo', 'edit', 'delete', 'export', 'finish', 'cancel', 'rename', 'lock',
].map((id) => [id, element<HTMLButtonElement>(`#${id}`)])) as Record<string, HTMLButtonElement>;
const nameInput = element<HTMLInputElement>('#name');
const importInput = element<HTMLInputElement>('#import');
const snapping = element<HTMLInputElement>('#snapping');
const notice = element('#notice');
const list = element('#features');
const empty: GeometryFeatureCollection = { type: 'FeatureCollection', features: [] };
let data = empty;
let serialized = JSON.stringify(empty);
let saved = serialized;
let revision = -1;
let selectionKey = '';
let editor: GeometryEditor | undefined;
let store: WorkspaceStore | undefined;
let importing = false;
let storageFailed = false;
let nameChanged = false;
let disposed = false;
let unsubscribe: (() => void) | undefined;

function message(text = ''): void { notice.textContent = text; notice.hidden = !text; }
function errorText(error: unknown): string {
  if (error instanceof GeoJSONImportError) return `Could not import: ${error.message}`;
  if (error instanceof SyntaxError) return 'The file is not valid JSON.';
  return error instanceof Error ? error.message : 'The operation failed. Your current work is still available.';
}
function title(feature: GeometryFeature): string {
  return typeof feature.properties?.name === 'string' && feature.properties.name.trim()
    ? feature.properties.name : feature.geometry.type === 'Point' ? 'Untitled marker' : feature.geometry.type.includes('Polygon') ? 'Untitled area' : 'Untitled route';
}
function download(text: string, filename: string, type = 'application/geo+json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
}
function fit(features: GeometryFeatureCollection): void {
  const positions = features.features.flatMap((feature) => {
    switch (feature.geometry.type) {
      case 'Point': return [feature.geometry.coordinates];
      case 'LineString': return feature.geometry.coordinates;
      case 'Polygon': case 'MultiLineString': return feature.geometry.coordinates.flat();
      case 'MultiPolygon': return feature.geometry.coordinates.flat(2);
    }
  });
  if (!positions.length) return;
  let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity;
  for (const [lng, lat] of positions) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  map.fitBounds([[west, south], [east, north]], { padding: 110, maxZoom: 16, duration: 0 });
}

const validation: Record<ValidationError, string> = {
  'too-few-vertices': 'Add more points to finish this shape.',
  'duplicate-vertex': 'Two corners share a position. Move or remove the duplicate.',
  'zero-area': 'The boundary must enclose an area.',
  'self-intersection': 'Edges cannot cross. Move a corner or undo the last point.',
  'antimeridian-crossing': 'Crossing the international date line is not supported.',
  'ring-intersection': 'Boundary rings cannot touch or cross.',
  'hole-outside': 'A hole must stay inside its area.',
  'nested-holes': 'Holes cannot contain other holes.',
  'part-intersection': 'Parts cannot cross or touch along an edge.',
  'part-overlap': 'Polygon parts cannot overlap.',
};

function render(state: EditorState): void {
  if (!editor) return;
  const changed = revision !== state.dataRevision;
  if (changed) {
    revision = state.dataRevision;
    data = editor.exportGeoJSON();
    serialized = JSON.stringify(data);
  }
  const idle = state.mode === 'idle' && !importing;
  const selected = editor.getSelection();
  const key = JSON.stringify(state.selectedFeatureIds);
  if (changed || key !== selectionKey) {
    nameInput.value = selected.length === 1 && typeof selected[0]?.properties?.name === 'string' ? selected[0].properties.name : '';
    nameChanged = false;
  }
  selectionKey = key;
  const single = selected.length === 1 ? selected[0] : undefined;
  const simple = single?.geometry.type === 'Point' || single?.geometry.type === 'LineString' || single?.geometry.type === 'Polygon';
  element('#selection').hidden = !single;
  const locked = single !== undefined && editor.isFeatureLocked(single.id);
  buttons.lock!.disabled = !idle || !single;
  buttons.lock!.textContent = locked ? 'Unlock feature' : 'Lock for this session';
  buttons.lock!.setAttribute('aria-pressed', String(locked));
  nameInput.disabled = !idle || locked;
  buttons.rename!.disabled = !idle || !nameChanged || locked;
  buttons.edit!.disabled = !idle || !simple || locked;
  buttons.delete!.disabled = !idle || !single || locked;
  element('#edit-scope').textContent = locked ? 'Locked until unlocked or this page is reloaded. You can still select this shape and snap to its edges.' : single?.geometry.type === 'Point' ? 'Drag the selected marker to move it, or edit its position.' : simple
    ? 'Drag the selected shape to move it. Vertex editing changes its outer boundary.'
    : 'Multipart geometry is preserved. Use the full editor demo to edit individual parts.';
  buttons.polygon!.disabled = !idle;
  buttons.line!.disabled = !idle;
  buttons.marker!.disabled = !idle;
  buttons.undo!.disabled = !idle || !state.canUndo;
  buttons.redo!.disabled = !idle || !state.canRedo;
  buttons.save!.disabled = !idle || nameChanged || !store?.canSave || serialized === saved && !storageFailed;
  buttons.export!.disabled = !idle;
  importInput.disabled = !idle;
  snapping.disabled = importing;
  buttons.finish!.hidden = state.mode === 'idle';
  buttons.cancel!.hidden = state.mode === 'idle';
  buttons.finish!.disabled = !state.canFinish || importing;
  buttons.cancel!.disabled = state.mode === 'idle' || importing;
  buttons.finish!.textContent = state.mode.startsWith('edit-') ? 'Apply changes' : 'Finish';
  element('#count').textContent = String(state.featureCount);
  element('#empty').hidden = state.featureCount !== 0;
  element('#save-state').textContent = !store?.canSave || storageFailed ? 'Local save unavailable'
    : nameChanged ? 'Name not applied' : state.mode !== 'idle' ? 'Draft in progress'
    : serialized === saved ? 'All changes saved locally' : 'Unsaved changes';
  element('#instruction').textContent = importing ? 'Importing file…'
    : state.mode === 'draw-point' ? 'Click once to place a marker. Escape cancels.'
    : state.mode === 'edit-point' ? 'Drag the point to move the marker, then apply changes. Escape cancels.'
    : state.validationError ? validation[state.validationError]
    : state.mode.startsWith('draw-') ? 'Click to add points. Enter finishes; Escape cancels; Backspace removes the last point.'
    : state.mode.startsWith('edit-') ? 'Drag corners or click a midpoint to add one. Apply changes when ready.'
    : 'Select a shape to edit it, or add an area, route or marker.';
  const locksKey = JSON.stringify(editor.getLockedFeatureIds());
  // Rebuild on committed data/selection/policy changes only; never on pointer previews.
  if (changed || list.dataset.selection !== key || list.dataset.idle !== String(idle) || list.dataset.locks !== locksKey) {
    list.replaceChildren(...data.features.map((feature) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = title(feature);
      button.setAttribute('aria-pressed', String(state.selectedFeatureIds.includes(feature.id)));
      button.disabled = !idle;
      const kind = document.createElement('small');
      kind.textContent = feature.geometry.type === 'Point' ? 'Marker' : feature.geometry.type === 'Polygon' ? 'Area'
        : feature.geometry.type === 'LineString' ? 'Route'
        : feature.geometry.type === 'MultiPolygon' ? 'Area with multiple parts' : 'Route with multiple parts';
      if (editor?.isFeatureLocked(feature.id)) kind.textContent += ' · Locked';
      button.append(kind);
      button.addEventListener('click', () => { editor?.select(feature.id); });
      item.append(button); return item;
    }));
    list.dataset.selection = key;
    list.dataset.idle = String(idle);
    list.dataset.locks = locksKey;
  }
}

function run(action: (current: GeometryEditor) => void): void {
  if (!editor || importing) return;
  message();
  try { action(editor); } catch (error) { message(errorText(error)); }
  render(editor.getState());
}

buttons.polygon!.onclick = () => { run((current) => { current.draw('Polygon'); }); };
buttons.marker!.onclick = () => { run((current) => { current.draw('Point'); }); };
buttons.line!.onclick = () => { run((current) => { current.draw('LineString'); }); };
buttons.finish!.onclick = () => { run((current) => { current.finish(); }); };
buttons.cancel!.onclick = () => { run((current) => { current.cancel(); }); };
buttons.undo!.onclick = () => { run((current) => { current.undo(); }); };
buttons.redo!.onclick = () => { run((current) => { current.redo(); }); };
buttons.lock!.onclick = () => { run((current) => {
  const feature = current.getSelected();
  if (!feature) return;
  const ids = current.getLockedFeatureIds();
  current.setLockedFeatureIds(current.isFeatureLocked(feature.id) ? ids.filter((id) => id !== feature.id) : [...ids, feature.id]);
}); };
buttons.edit!.onclick = () => { run((current) => { current.editSelected(); }); };
buttons.delete!.onclick = () => { run((current) => { current.deleteSelection(); }); };
snapping.onchange = () => { run((current) => { current.setSnapping({ enabled: snapping.checked }); }); };
nameInput.oninput = () => { nameChanged = true; if (editor) render(editor.getState()); };
element('#name-form').onsubmit = (event) => {
  event.preventDefault();
  run((current) => {
    const feature = current.getSelected();
    if (!feature || current.getState().mode !== 'idle') return;
    current.applyTransaction({ update: [{ ...feature, properties: { ...feature.properties, name: nameInput.value.trim() } }] });
    nameChanged = false;
  });
};
buttons.export!.onclick = () => { run((current) => { download(JSON.stringify(current.exportGeoJSON(), null, 2), 'areas-and-routes.geojson'); }); };
buttons.save!.onclick = () => {
  run((current) => {
    try {
      if (!store) throw new Error('Browser storage is unavailable. Export GeoJSON to keep your work.');
      store.save(current.exportGeoJSON());
      saved = serialized; storageFailed = false;
    } catch (error) {
      storageFailed = true;
      message(`Could not save. ${errorText(error)} Export GeoJSON to keep a backup.`);
    }
  });
};

importInput.onchange = () => { void importFile(); };
async function importFile(): Promise<void> {
  const file = importInput.files?.[0];
  if (!file || !editor || importing || editor.getState().mode !== 'idle') return;
  importing = true; message(); render(editor.getState());
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Choose a GeoJSON file smaller than 5 MB.');
    const input: unknown = JSON.parse(await file.text());
    if (disposed) return;
    // The public API validates the entire import before changing any feature.
    const imported = editor.importGeoJSON(input);
    fit(imported);
    message(`Imported ${imported.features.length} features. Save the workspace to keep them in this browser.`);
  } catch (error) { if (!disposed) message(errorText(error)); }
  finally {
    importing = false; importInput.value = '';
    if (!disposed) render(editor.getState());
  }
}

element('#download-recovery').onclick = () => {
  if (store?.recovery !== null && store?.recovery !== undefined) download(store.recovery, 'workspace-recovery.json', 'application/json');
};
element('#discard-recovery').onclick = () => {
  if (!window.confirm('Discard the unreadable saved copy? Download it first if you need a backup.')) return;
  run(() => {
    store?.discard();
    saved = JSON.stringify(empty); storageFailed = false;
    element('#recovery').hidden = true;
  });
};

// Map setup, tiles and persistence belong to the application, not the library.
const basemap = new URLSearchParams(location.search).get('basemap') !== 'off';
const map = new Map({
  container: 'map', center: [4.895, 52.37], zoom: 13, attributionControl: {},
  style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e7ece1' } }] },
});
map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
map.on('error', () => { message('A map resource could not load. Your geometry remains available; try reloading or exporting your work.'); });
map.once('load', () => {
  try {
    editor = new GeometryEditor(map, { snapping: { enabled: true }, historyLimit: 100 });
    const stopRendering = editor.onChange(render);
    const stopAppearance = bindAppearanceControl(editor, element<HTMLSelectElement>('#appearance'));
    unsubscribe = () => { stopRendering(); stopAppearance(); };
    try {
      store = new WorkspaceStore(window.localStorage);
      const restored = store.read();
      if (restored) editor.importGeoJSON(restored.data);
      store.accept();
      editor.clearHistory();
      data = editor.exportGeoJSON(); serialized = JSON.stringify(data); saved = serialized;
      fit(data);
    } catch (error) {
      message(`Could not restore the saved workspace. ${errorText(error)} The saved copy has not been overwritten.`);
      element('#recovery').hidden = store?.recovery === null || store?.recovery === undefined;
    }
    render(editor.getState());
    if (basemap) {
      map.addSource('basemap', { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
      const firstOverlay = map.getStyle().layers.find((layer) => layer.id !== 'background')?.id;
      map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap' }, firstOverlay);
    }
  } catch (error) { message(`Could not open the editor. ${errorText(error)}`); }
});

window.addEventListener('beforeunload', (event) => {
  if (serialized !== saved || nameChanged || editor && editor.getState().mode !== 'idle' || importing) {
    event.preventDefault(); event.returnValue = '';
  }
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  disposed = true; unsubscribe?.(); editor?.destroy(); map.remove();
});
