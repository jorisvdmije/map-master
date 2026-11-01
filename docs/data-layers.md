# Multiple editable data layers

Organize one document into named editable, reference and hidden datasets. Data
layers have stable string IDs, a drawing target, bottom-to-top order, visibility,
editability, locks, selection and snapping settings, and their own base styles.
They are distinct from the MapLibre basemap layers named in `snapping.layers`.

```ts
import { DataLayerControl, EditorToolbar, GeometryEditor } from '@jorisvdmije/map-master';

const editor = new GeometryEditor(map, {
  dataLayers: {
    layers: [
      { id: 'reference', name: 'Reference', editable: false, selectable: false,
        style: { shape: { lineColor: '#64748b', fillColor: '#94a3b8', fillOpacity: 0.08 } } },
      { id: 'parcels', name: 'Parcels', style: { shape: { fillColor: '#15803d' } } },
      { id: 'notes', name: 'Notes', style: { marker: { color: '#ea580c' } } },
      { id: 'archive', name: 'Archive', visible: false },
    ],
    activeLayerId: 'parcels',
    selectionScope: 'all',
  },
  snapping: { enabled: true },
});
map.addControl(new EditorToolbar(editor));
map.addControl(new DataLayerControl(editor), 'top-right');

editor.importGeoJSON(parcelData, { dataLayerId: 'parcels' });
editor.importGeoJSON(referenceData, { dataLayerId: 'reference' });
editor.setActiveDataLayer('notes'); // New drawings and text/template placements.
```

## Configuration and management

The implicit **`default`** layer preserves existing single-dataset behavior. It
is inserted at the bottom when omitted, and cannot be removed. Without layer
configuration, existing GeoJSON is exported unchanged and drawings keep their
previous property shape. Feature IDs remain unique across the entire editor;
numeric `7` and string `"7"` are still different IDs.

| Layer setting | Default | Behavior |
| --- | --- | --- |
| `id` | Required | Nonempty valid Unicode string, at most 200 characters; cannot be renamed. |
| `name` | ID | Display text, rendered safely as text. |
| `visible` | `true` | Hidden data is absent from rendering, picking, selection, snapping and guides. |
| `editable` | `true` | False makes an existing dataset read-only. |
| `locked` | `false` | Blocks changes without changing visibility or editability. |
| `selectable` | `true` | False allows picking editable geometry underneath a reference layer. |
| `snapping` | `true` | Visible stored geometry may supply snapping, tracing and alignment references. |
| `style` | `{}` | Shape/marker base style, using the existing typed `FeatureStyle`. |

```ts
const definitions = editor.getDataLayers(); // Independent resolved snapshots.
editor.addDataLayer({ id: 'survey', name: 'Survey' });
editor.updateDataLayer('survey', { visible: true, locked: false });
editor.updateDataLayer('survey', { style: { shape: { fillColor: '#2563eb' } } });
editor.reorderDataLayers(['default', 'reference', 'parcels', 'notes', 'archive', 'survey']);
editor.removeDataLayer('survey'); // Only an empty, non-default layer can be removed.
```

`reorderDataLayers()` requires every current ID exactly once, **bottom to top**.
`setDataLayers(definitions)` atomically replaces the host configuration; it
refuses to omit a layer still referenced by stored features. A `style` patch
replaces that layer's style; omitted fields fall back to the global appearance.
Per-feature style callbacks override individual layer style fields, and the
existing global selected appearance still applies. Overlap stripes are computed
within each data layer, with the existing aggregate input budgets.

Native fill, line and marker groups follow layer order across geometry types.
Picking prioritizes the front data layer, then the existing marker/outline versus
interior preference within it. DOM text labels follow layer order among labels;
they retain their own text properties and remain above native map geometry.
Layer configuration, styles, visibility and reference eligibility survive a map
style reload. Destroying the editor removes all of its native layer resources.

## Active drawing target and selection

`setActiveDataLayer(id)` chooses a visible, editable, unlocked layer for new
drawings. `null` disables new drawing. Drawing tools are disabled when no writable
target exists. If the active layer is hidden, locked, made read-only or removed,
the editor chooses the first remaining writable layer, or null. A pending new
drawing is cancelled when its target becomes unavailable.

Changing the active target explicitly during a draft is refused; finish or
cancel first. An edit to an existing feature keeps its home layer regardless of
the active drawing target. Duplicates, split outputs and exploded parts also
keep their source layer. Merge/intersection/combine operations retain the first
selected feature's layer and properties; they can operate across writable layers.

`setDataLayerSelectionScope('all' | 'active')` controls click, box, lasso and
programmatic selection. `all` includes visible selectable layers; `active` adds
the requirement that membership matches the active layer. Changing visibility,
selectability or selection scope prunes ineligible selections. Programmatic
selection of an ineligible feature fails atomically. Read-only/locked features
may remain selectable for inspection, but editing tools stay disabled.

`getFeatureDataLayer(featureId)` reports membership, `canSelectFeature(id)`
reports selection eligibility, and `canDrawInDataLayer()` reports drawing
availability. `getFeature()` and unfiltered export can still read hidden data.

## Membership, exchange and history

Membership persists in the reserved GeoJSON property **`mapMasterLayer`**:

```json
{ "type": "Feature", "id": "parcel-7", "properties": { "mapMasterLayer": "parcels", "name": "West parcel" }, "geometry": { "type": "Point", "coordinates": [4.86, 52.35] } }
```

Missing membership means `default`. Explicit memberships require known layer
definitions and are preserved on import. An unassigned imported feature goes to
the active layer, or default when no target is active. Passing
`importGeoJSON(data, { dataLayerId })` deliberately overrides the complete batch's
membership. Geometry, feature IDs and other properties are preserved. Host
imports and explicit transaction creations may initially populate reference,
locked and hidden layers; updating/deleting existing data requires a visible,
editable, unlocked home layer.

```ts
const allData = editor.exportGeoJSON(); // Includes hidden/reference datasets.
const parcels = editor.exportGeoJSON({ dataLayerId: 'parcels' });
const visible = editor.exportGeoJSON({ visibleOnly: true });
const changed = editor.moveFeaturesToDataLayer(['parcel-7'], 'notes');
```

`moveFeaturesToDataLayer()` validates all IDs, source layers and the destination,
then changes memberships in one transaction and one Undo step. It preserves
geometry, IDs and unrelated properties. Updating `mapMasterLayer` through
`applyTransaction()` uses the same permissions and validation. An invalid mixed
batch changes no data, selection, history or data revision.

Hidden, locked and read-only participants also block linked-vertex changes;
there is no invisible partial edit. Changing a mutation target's layer policy
cancels its active edit. Changes to unrelated layers preserve placed draft edits;
pending captured gestures are stopped safely before configuration is applied.
Duplicating a feature locked by its own feature ID remains possible in a writable
home layer, but a read-only/hidden/locked **layer** cannot receive duplicates.

Undo/Redo restores the exact previous membership. Current layer permissions
apply to every involved layer before either history stack advances. A removed
empty layer may still be referenced by retained history; restore the same ID to
allow replay again. `getHistoryDataLayerIssues('undo' | 'redo')`, disabled toolbar
hints and `DataLayerError.issues` identify the feature, layer and blocking rule.
Geofencing and feature locks continue to apply independently.

Definitions, ordering, active target and selection scope are host configuration,
and do not add feature history or change `dataRevision`. Their revision is
`state.dataLayerRevision`, and `onChange` reports updates. Persist
`getDataLayers()`, `getActiveDataLayer()` and `state.dataLayerSelectionScope`
alongside GeoJSON, then configure definitions before importing a saved document.
Unknown layer IDs and malformed memberships are rejected rather than silently
creating or reassigning datasets.

## Optional layer control

`DataLayerControl` provides an expandable layer panel with native keyboard and
screen-reader controls for the active target, selection scope, visibility,
editability, locks, selection, snapping, color and order. The destination picker
and **Move selection** button change membership atomically. Configuration controls
do not enter geometry history. Omit this control when the host owns that UI.

```ts
const layers = new DataLayerControl(editor, {
  collapsed: false,
  labels: { title: 'Datalagen', active: 'Tekenen in', move: 'Selectie verplaatsen' },
});
map.addControl(layers);
layers.setCollapsed(true);
map.removeControl(layers); // Unsubscribes and removes its UI.
```

Use Tab, Space, Enter and native select navigation; focus is retained when a
setting rebuilds the panel. Names and labels are rendered as text. The control
retains no map event listeners or editable feature copies.

Upstream reference: [Geoman Data Layers](https://geoman.io/docs/maplibre/data-layers),
checked 1 November 2026. This step covers the comparison plan's named datasets;
the existing external basemap snapping API remains separate.
