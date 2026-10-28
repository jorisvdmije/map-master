import { LngLatBounds, type Map } from 'maplibre-gl';
import type { GeometryEditor, GeometryFeatureCollection } from '@jorisvdmije/map-master';

const fixtures = import.meta.glob<string>('./public/*.geojson', { query: '?raw', import: 'default', eager: true });
const examples = [
  ['union', 'Merge overlapping polygons', 'Two polygons are selected. Choose Merge polygons, review the result, then Apply merge.'],
  ['difference', 'Subtract a polygon', 'The west target is selected first. Choose Subtract polygons; the other polygon is kept as a cutter.'],
  ['intersection', 'Find a common area', 'Three polygons are selected. Choose Intersect polygons to preview their common area.'],
  ['shared-boundary', 'Edit adjoining parcels', 'Choose Edit shared boundary. Move or add a corner, then Save both polygons.'],
  ['reshape', 'Reshape a boundary', 'Choose Reshape polygon. Draw a route from one boundary point to another, then review and apply.'],
  ['multipart', 'Edit multipart geometry', 'Click one shape, then choose Part to edit and Edit vertices.'],
  ['trace', 'Trace an existing boundary', 'Enable Trace existing boundaries and snapping. Start a line and click two points on one outline.'],
  ['buffer', 'Create a buffer', 'Choose Buffer selection. Adjust the distance in Mercator meters, then apply or cancel.'],
  ['offset', 'Offset lines', 'Choose Offset lines. Positive distance moves left of the line direction; negative moves right.'],
  ['simplification', 'Simplify geometry', 'Choose Simplify selection. Compare the original and preview before applying.'],
] as const;

export function bindExampleControls(editor: GeometryEditor, map: Map): () => void {
  const select = document.getElementById('example') as HTMLSelectElement;
  const button = document.getElementById('load-example') as HTMLButtonElement;
  const help = document.getElementById('example-help')!;
  const status = document.getElementById('example-status')!;
  select.replaceChildren(...examples.map(([id, name]) => new Option(name, id)));
  const describe = () => { help.textContent = `${examples.find(([id]) => id === select.value)![2]} Examples add shapes; your existing work stays. Undo removes the added batch.`; };
  const update = () => { button.disabled = editor.getState().mode !== 'idle'; select.disabled = button.disabled; };
  const add = () => {
    if (editor.getState().mode !== 'idle') return;
    try {
      const fixture = JSON.parse(fixtures[`./public/${select.value}.geojson`]!) as GeometryFeatureCollection;
      // Fresh IDs make repeated examples additive; library import remains atomic.
      const imported = editor.importGeoJSON({ ...fixture, features: fixture.features.map(feature => ({ type: feature.type, properties: feature.properties, geometry: feature.geometry })) });
      editor.selectMany(imported.features.map(feature => feature.id));
      const bounds = new LngLatBounds();
      const extend = (coordinates: unknown): void => {
        if (!Array.isArray(coordinates)) return;
        if (typeof coordinates[0] === 'number') bounds.extend(coordinates as [number, number]);
        else coordinates.forEach(extend);
      };
      imported.features.forEach(feature => { extend(feature.geometry.coordinates); });
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: Math.min(60, map.getCanvas().clientWidth / 8, map.getCanvas().clientHeight / 8), maxZoom: 16, duration: 0 });
      status.classList.remove('is-invalid');
      status.textContent = `Added ${imported.features.length} example shapes. ${examples.find(([id]) => id === select.value)![2]}`;
      const operationStatus = document.getElementById('status')!;
      operationStatus.classList.remove('is-invalid'); operationStatus.textContent = status.textContent;
      document.getElementById('selection')!.scrollIntoView({ block: 'start' });
      document.querySelector<HTMLButtonElement>('#selection button:not(:disabled):not([hidden])')?.focus({ preventScroll: true });
    } catch (error) {
      status.classList.add('is-invalid');
      status.textContent = error instanceof Error ? error.message : 'Could not load this example.';
    }
  };
  select.addEventListener('change', describe); button.addEventListener('click', add);
  const unsubscribe = editor.onChange(update); describe(); update();
  return () => { unsubscribe(); select.removeEventListener('change', describe); button.removeEventListener('click', add); };
}
