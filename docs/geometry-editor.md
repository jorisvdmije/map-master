# GeometryEditor: lines and polygons

Status: experimental. Supports 2D LineString and single-outer-ring Polygon
features on a flat Mercator MapLibre GL JS 6.15 map. Desktop mouse and keyboard
input, selection, deletion, vertex editing, and GeoJSON import are tested in Chromium.
Holes, multipart features, and undo/redo are not implemented yet.

## One editor API

The application owns the MapLibre map: its container, worker, stylesheet,
basemap, camera, and lifecycle. GeometryEditor owns drawing interactions,
validation, feature storage, and its overlay sources/layers. Application toolbar
buttons call the editor; they do not create or update MapLibre geometry sources.

```ts
import { GeometryEditor } from '@geo/editor';

// `map` is an application-owned MapLibre map. Attach once its style is ready.
map.once('style.load', () => {
  const editor = new GeometryEditor(map);

  const unsubscribe = editor.onCreate((feature) => {
    console.log('Committed:', feature.id, feature.geometry.type);
    // The host application can persist this snapshot to its own backend.
  });

  editor.draw('Polygon');
  // Now click on the map. Enter commits; Escape cancels.
  // A line button calls editor.draw('LineString') when no draft is active.
  // Finish / Cancel / Export buttons call editor.finish(), editor.cancel(),
  // and editor.exportGeoJSON(), respectively.

  // On component teardown, unsubscribe() and editor.destroy().
  // Removing the map also destroys its attached editor automatically.
  void unsubscribe;
});
```

For host worker configuration and local package installation, see the
[integration setup](line-editor.md#integrate) and [working demo](../examples/basic/main.ts).
The package is private and unpublished; use `npm pack` for an installable archive.

| Member | Contract |
| --- | --- |
| `new GeometryEditor(map)` | Attach after `style.load` or `load`. One editor per map, including the LineEditor facade. |
| `draw('LineString' \| 'Polygon')` | Start a draft and focus the canvas. Repeating the active type preserves the draft. Changing type during drawing throws; finish or cancel first. |
| `finish()` | Commit a valid draft once, returning a `GeometryFeature`. An invalid/incomplete draft returns `null` and remains active. |
| `cancel()` | Discard only the draft. |
| `getState()` | Snapshot: `mode`, `vertexCount`, `featureCount`, `selectedFeatureId`, `selectedVertexIndex`, `dataRevision`, `canFinish`, `validationError`. |
| `select(id \| null)` | Select a committed feature by ID, or clear selection with `null`. Available only while idle. |
| `getSelected()` | Independent snapshot of the selected feature, or `null`. |
| `deleteSelected()` | Delete the selected committed feature and clear selection. Return its independent snapshot, or `null` with no selection. Available only while idle. |
| `exportGeoJSON()` | Independent `GeometryFeatureCollection` snapshot containing committed lines and polygons. |
| `importGeoJSON(input)` | Append a parsed Feature/FeatureCollection atomically; return an independent collection of imported features. Idle only. |
| `onImport(listener)` | One notification per nonempty imported batch. Returns an unsubscribe function. |
| `onUpdate(listener)` | One notification per changed saved edit. Returns an unsubscribe function. |
| `onCreate(listener)` | One event per committed feature, with an independent snapshot per listener. Returns an unsubscribe function. |
| `onDelete(listener)` | One event per committed deletion, with an independent snapshot of the removed feature per listener. Returns an unsubscribe function. |
| `onChange(listener)` | Editing-state notification after state changes. Read the initial state with `getState()`. Returns an unsubscribe function. |
| `destroy()` | Remove owned resources/listeners and restore drawing gesture settings. Idempotent. |

`GeometryFeature` is the union of `LineFeature` and `PolygonFeature`. Inspect
`feature.geometry.type` to narrow coordinates in TypeScript. `GeometryFeatureCollection`
is a GeoJSON FeatureCollection containing both shape types. New drawings receive a UUID and empty properties. Imported features preserve
string or numeric IDs and JSON properties (including null). Coordinates are
`[longitude, latitude]`. Properties can be imported but there is no property-editing API yet.

Modes are `idle`, `draw-line`, `draw-polygon`, `edit-line`, and `edit-polygon`. `validationError` is `null`
when idle or when the current draft is valid. Check `canFinish` to enable Finish;
an idle editor cannot finish even though it has no validation error.

Callbacks run synchronously. Exceptions are reported asynchronously without
interrupting a commit or other observers. MapLibre renders committed data
asynchronously; listen to the map's `error` event for rendering failures.
After destruction, exports remain readable and selection is cleared;
drawing, selecting, deleting, and subscribing throw.

## Selection

While idle, a plain left click selects one visible committed feature. Clicking
empty space clears selection. Lines and polygon outlines have a query box
extending 6 CSS pixels on each side of the pointer, independent of zoom. Outline
hits take priority over polygon interiors; among hits in the same layer, the
topmost rendered feature wins. There is no overlap cycling or multiselection yet.
Host layers and draft geometry are excluded from picking.

The selected outline turns blue and thicker; polygon fill also turns blue.
Escape clears selection when the canvas is focused. Modified clicks/shortcuts
and drag gestures do not change selection. No separate selection mode is needed.

```ts
// `editor` is an existing GeometryEditor instance, currently idle.
editor.onChange((state) => {
  console.log('Selection:', state.selectedFeatureId);
});
const first = editor.exportGeoJSON().features[0];
if (first) editor.select(first.id);
const selected = editor.getSelected(); // GeometryFeature | null
editor.select(null);
```

Selection emits `onChange` only when the selected ID changes. Selecting the same
ID again is a no-op. It does not emit `onCreate`, rewrite geometry, change IDs or
properties, or add selection metadata to exports. Use `onCreate`, `onUpdate`, `onDelete`, and `onImport` for committed changes; `onChange` also represents transient UI state.

An unknown ID throws `RangeError` and preserves the previous selection. Selecting
anything, including `null`, during drawing throws without changing the draft.
Starting a drawing clears selection; finish/cancel return to idle with nothing
selected. Programmatic selection does not move the camera or take keyboard focus,
and can select a stored offscreen feature. Click selection requires the feature
to have been rendered; MapLibre source updates are asynchronous.

Selection survives style replacement. Destroying the editor clears selection
without emitting callbacks; a new editor starts with empty data and no selection.

## Deletion

Call `deleteSelected()` or use the demo's **Delete** button after selecting a
line or polygon. Delete/Backspace also remove the selection while the map canvas
is focused. Modified, repeated, composing, or already-prevented key events are
ignored, as are shortcuts in inputs and other elements. With no selection, the
API returns `null` without notifications or rendering updates; keyboard events
are left untouched.

```ts
const unsubscribe = editor.onDelete((feature) => {
  console.log('Deleted:', feature.id, feature.geometry.type);
  // Persist the deletion using your application's own backend.
});

// Select through a map click, or editor.select(aKnownFeatureId), then:
const removed = editor.deleteSelected(); // GeometryFeature | null
// Call unsubscribe() when this observer is no longer needed.
```

The core removes exactly the selected feature and clears selection atomically.
Remaining IDs, coordinates, properties, and insertion order stay unchanged.
The controller clears the highlight, updates the committed source, calls
`onDelete`, then calls `onChange`. Inside a deletion callback, exports and
selection already reflect the deletion. Each observer and the return value own
independent snapshots. Observer exceptions follow the same asynchronous error
reporting policy as creation callbacks; they cannot roll back the deletion or
prevent later listeners from running. Repeating deletion after selection has
cleared is a no-op.

Deleting through the API during drawing throws without changing the draft or
stored features; Delete/Backspace during drawing are ignored. Escape continues
to cancel the draft. After destruction, deleting or subscribing throws. Destroy
and map removal are lifecycle cleanup and do not emit deletion events.

MapLibre updates asynchronously, so a deleted outline may remain visible briefly.
The controller ignores stale rendered IDs absent from the core; a click cannot
reselect a deleted feature. A style replacement restores only surviving data.

Deletion is immediate and in-memory. It does not contact a backend, ask for
confirmation, or offer undo yet. Applications can place their own confirmation
before calling `deleteSelected()` if their workflow needs it. A retained removed snapshot can be restored with `importGeoJSON(snapshot)`
while idle, if its ID has not been reused. Undo/history remains a later step.

## Vertex editing

Select a feature and call `editSelected()` to begin an independent editing draft.
It returns false with no selection or when already editing, and throws during drawing.
The selected ID stays selected after saving or cancelling. `getSelected()` and
`exportGeoJSON()` continue returning the saved version until a valid `finish()`.

```ts
editor.select(featureId);
editor.editSelected();
editor.moveVertex(0, [4.895, 52.373]);
editor.insertVertex(1, [4.896, 52.374]);
editor.removeVertex(1);
editor.finish(); // Or editor.cancel() to discard the entire edit.
```

`getDraft()` returns copied coordinates without a polygon's closing duplicate.
`selectVertex(index | null)` selects a draft corner. Indexes are zero-based;
`insertVertex(index, coordinate)` inserts before that index, with `vertexCount`
allowed for appending (the closing edge for polygons). Invalid indexes or
coordinates throw without changing the draft. Vertex commands require editing.
`removeVertex(index)` returns false at the minimum of two line points or three
polygon corners; otherwise it removes the corner and clears vertex selection.

Drag a large handle to move a corner, or click/drag a small midpoint to insert
one. Delete/Backspace removes the selected corner only while the map has focus.
Enter/Save commits; Escape/Cancel discards. Invalid intermediate shapes stay
visible but cannot be saved. Coincident consecutive line points and invalid
polygon topology are rejected. A saved polygon is closed and wound CCW.

`onUpdate(listener)` fires once for a changed saved geometry, with the same ID
and properties. It returns an unsubscribe function. Cancel and unchanged saves
emit no update; edits never emit creation or deletion events. `dataRevision`
increases only for committed data changes, so UI exports can avoid work during
pointer motion. `onChange` also reports transient draft and selection changes.

Dragging temporarily disables pan and restores its previous setting. Pointer
cancellation or window blur rolls back that gesture; Cancel discards the full
session. Style replacement preserves the edit and recreates overlays; destroy
cancels it and removes listeners/handles without emitting an update. Desktop
mouse input is supported; touch editing is deferred.

## GeoJSON import

```ts
import { GeoJSONImportError } from '@geo/editor';

try {
  const input: unknown = JSON.parse(fileText);
  const imported = editor.importGeoJSON(input);
  console.log('Added:', imported.features.length);
} catch (error) {
  if (error instanceof GeoJSONImportError) console.error(error.path, error.code);
  else throw error; // For example malformed JSON text or an active edit session.
}

const unsubscribe = editor.onImport((collection) => {
  // One committed batch; no onCreate/onUpdate/onDelete events for loading data.
  console.log(collection);
});
```

The method accepts a **parsed Feature or FeatureCollection** and appends it to
the current collection. JSON parsing, files, fetch, and backend storage belong
to the host application. It rejects raw geometry objects and JSON strings.
The demo offers a file picker (5 MB limit), readable errors, and fits the camera
to imported shapes. The library has no file-size limit and never moves the camera.

The entire batch is validated and copied before any stored feature changes.
An invalid last feature cannot leave earlier features partially imported.
Existing features, selection, draft, and revision stay intact on failure.
Import is available only while idle. It does not replace or merge features.

Supported data and identity policy:

- Two-dimensional LineString and Polygon with exactly one closed outer ring.
  Points, multipart geometries, geometry collections, null geometries, holes,
  and altitude coordinates are rejected explicitly.
- Finite longitude/latitude in world bounds. Lines need two points and no
  consecutive duplicates. Polygons use the same topology rules as drawing;
  clockwise rings are accepted and normalized to CCW, keeping the first corner.
  An unclosed imported ring is rejected instead of silently repaired.
- Explicit string and finite numeric IDs are preserved with their original type;
  `7` and `"7"` are distinct, as are `0` and `"0"`. Missing IDs get UUIDs; null IDs
  are invalid. Duplicates within a batch or against stored features reject the
  whole batch. Generated IDs cannot overwrite explicit or stored IDs.
- `properties` is required and may be a JSON object or null. Nested objects and
  arrays are deeply copied on import, export, selection, saves, and notifications.
  Non-JSON values, cycles, and properties nested more than 100 containers deep
  are rejected. Numeric values use JavaScript number precision.
- Coordinates follow [RFC 7946](https://www.rfc-editor.org/rfc/rfc7946.html#section-4).
  Legacy `crs` declarations are rejected; there is no reprojection. `bbox` and
  foreign members outside properties are ignored, not retained or regenerated.

A successful nonempty batch increments `dataRevision` once, uploads the committed
source once, emits `onImport` once, then `onChange`. Callbacks see the entire
committed batch. Each listener and the return value receive independent snapshots.
Observer failures follow the existing asynchronous reporting policy. Empty
collections are a no-op with no rendering, revision, or notifications.

`GeoJSONImportError` extends TypeError and exposes `code` and `path` (for example
`$.features[2].geometry.coordinates[0]`). Codes include `invalid-geojson`,
`unsupported-geometry`, `invalid-coordinate`, `invalid-properties`, `invalid-id`,
`duplicate-id`, `unclosed-ring`, `unsupported-crs`, and the topology validation
codes below. The first detected error aborts the batch. Lifecycle/mode errors
remain ordinary Error objects. Unsupported data is never silently skipped.

Export/import round trips preserve supported IDs, properties, coordinates, and
feature order after polygon winding normalization. Import only exists on
GeometryEditor; the earlier LineEditor remains a drawing compatibility facade.

**Experimental type change:** IDs previously had type `string`. Feature IDs and
`selectedFeatureId` now use exported `FeatureId` (`string | number`). Properties
now use exported `FeatureProperties` (a JSON object or null), with `JsonValue`
for nested values. Update consumer annotations and handle null properties.

## Polygon contract

- At least three distinct, non-collinear corners, with finite world-bounded
  coordinates. A valid outline may contain collinear intermediate vertices.
- One simple outer ring. Crossing edges, nonadjacent touches, repeated interior
  vertices, and overlapping/backtracking edges are rejected, including the
  closing edge. Self-crossing **lines** remain allowed.
- Export repeats the first position at the end and normalizes the exterior to
  counterclockwise winding, as specified by [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.6).
  Reversing winding keeps the user's first vertex.
- Checks use planar longitude/latitude segments. An edge with longitude change
  greater than 180 degrees is rejected. Dateline splitting, polar geometry,
  terrain/globe, and alternate projections are outside the supported scope.
- Invalid drafts remain visible but cannot be committed. Add more points while drawing, move/remove corners while editing, or cancel.

Errors are `too-few-vertices`, `zero-area`, `duplicate-vertex`,
`self-intersection`, and `antimeridian-crossing`. The first detected error is
reported; these are diagnostics, not a list of every defect.

Enter or Finish closes a polygon. A plain click within 8 CSS pixels of its first
corner also finishes it after at least three corners, provided it is valid.
The cursor preview is never included in a commit. Escape cancels. Shortcuts
apply only when the canvas has focus. Drag pan and scroll zoom remain enabled;
the previous cursor and double-click zoom setting are restored on exit.

## Compatibility and ownership

The existing `LineEditor` remains available as a small facade around the same
engine: `startLine()` forwards to `draw('LineString')`, with line-only return and
event types. New integrations should use `GeometryEditor` for both shape types.
There is no second implementation of drawing behind the facade.
The facade also supports `select(id | null)`, line-only `getSelected()` and
`deleteSelected()` return types, and line-only `onDelete` callbacks.

The editor does not extend MapLibre's prototype or attach custom methods to
`map`. Using `map.flyTo(...)` for the camera and `editor.draw(...)` for geometry
is intentional: each object has its own responsibility. Do not mutate editor
sources/layers directly, because the core is the authoritative feature store.
Style replacement automatically recreates the editor overlays and restores data.

## Implementation and performance

See the [code walkthrough](code-walkthrough.md). The core uses the small
[robust-predicates](https://github.com/mourner/robust-predicates) runtime dependency
(3.0.3, Unlicense) for numerically robust orientation tests, rather than an
arbitrary epsilon or naive floating-point determinant. Ring rules and the editor
workflow are our own implementation. MapLibre remains a host-supplied peer.

Polygon validation compares edge pairs: O(n²) for a draft with n corners, once
per added vertex. Incrementally drawing all n vertices therefore has O(n³)
total validation work. Validity is cached for state reads and finishing;
drawing pointer motion does not run topology checks. Editing validates changed
positions, coalesced to at most one move per animation frame; large rings can
therefore exceed an interactive frame budget. Preview work is O(n) per rendered
frame and coalesced with requestAnimationFrame. Draft and committed data have
separate sources; creation and deletion currently replace the entire committed
source. Deletion uses an indexed removal in the core, but the following export
and upload still scale with all remaining features and vertices.

Committed features are stored in insertion order in an ID-indexed Map. Selection
lookup does not scan the collection, and a selected snapshot copies only that
feature. Selection rendering uses MapLibre feature state rather than `setData`.
The renderer encodes each ID with `JSON.stringify` into a private `__geo_editor_id`
rendering property and uses `promoteId`. This preserves string IDs and keeps
numeric and string identities distinct in MapLibre feature state. A user property
with that name stays intact in the core/export; only the render copy is overwritten.
The encoding is never written into the core, public events, or exports. See MapLibre's
[query and feature-state API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/).

The repeatable [benchmarks](performance.md) characterize core validation and
selection, deletion/export, vertex movement, and import. Large-dataset rendering,
interaction latency, memory, touch input, and
other browser engines still require measurement before production-scale claims.
