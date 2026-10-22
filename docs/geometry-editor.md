# GeometryEditor: lines and polygons

Status: experimental. Supports 2D LineString, Polygon (including holes), MultiLineString and MultiPolygon
features on a flat Mercator MapLibre GL JS 6.15 map. Desktop mouse and keyboard
input, selection, group translation/duplication, deletion, vertex editing, GeoJSON import, undo/redo, and drawing/editing snapping are tested in Chromium.
See the [multipart guide](multipart.md) for component editing and topology constraints.

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
| `new GeometryEditor(map, options?)` | Attach after `style.load` or `load`. One editor per map, including the LineEditor facade. `historyLimit` defaults to 100; `snapping.enabled` defaults to false. |
| `draw('LineString' \| 'Polygon')` | Start a draft and focus the canvas. Repeating the active type preserves the draft. Changing type during drawing throws; finish or cancel first. |
| `finish()` | Commit a valid draft once, returning a `GeometryFeature`. An invalid/incomplete draft returns `null` and remains active. |
| `cancel()` | Discard the draft or cancel an active selection rectangle or group drag. |
| `getState()` | Snapshot: `mode`, `vertexCount`, `featureCount`, `selectedFeatureId`, `selectedFeatureIds`, `selectedVertexIndex`, `activeRingIndex`, `activePartIndex`, `dataRevision`, `canFinish`, `canUndo`, `canRedo`, `validationError`, `splitError`, `unionError`. |
| `unionSelection()` | Preview union of at least two selected polygon features; false for insufficient/mixed selection or an already active union. |
| `getUnionPreview()` | Independent Polygon/MultiPolygon result geometry, or null. |
| `finishUnion()` | Commit the retained feature and deletions as one transaction; null for invalid/inactive union. |
| `splitSelected()` | Begin a cutting line on a selected simple Polygon; false with no Polygon, a multipart feature, or already splitting. |
| `setSplitLine(coordinates)` / `removeSplitPoint()` | Replace the cut or remove its last point while splitting. |
| `getSplitPreview()` | Independent retained/created Polygon geometries, or null. |
| `finishSplit()` | Commit both parts as one transaction, or return null for an invalid/inactive split. |
| `select(id \| null)` | Select a committed feature by ID, or clear selection with `null`. Available only while idle. |
| `getSelected()` | Independent snapshot only for exactly one selected feature; otherwise `null`. |
| `selectMany(ids)` | Replace the whole selection atomically, deduplicating typed IDs. |
| `toggleSelection(id)` | Add/remove one existing feature from the selection. |
| `getSelection()` | Independent snapshots of all selected features in acquisition order. |
| `editSelected(ringIndex = 0, partIndex = 0)` | Begin editing one component/ring of the selected feature; ring 0 is the exterior for polygons. |
| `drawHole(partIndex = 0)` | Start a cancellable hole in the chosen polygon component; Finish saves one edit. |
| `deleteHole(ringIndex, partIndex = 0)` | Delete an interior ring (index >= 1) as one transaction; idle only. |
| `duplicateSelection(delta?)` | Create and select copies with new IDs as one transaction; optional offset in degrees, default `[0, 0]`. Returns `TransactionEvent` or null. Idle only. |
| `translateSelection([deltaLng, deltaLat])` | Translate selected features in degrees as one transaction; returns `TransactionEvent` or null. Idle only. |
| `deleteSelection()` | Delete all selected features as one transaction; returns `TransactionEvent` or null. |
| `deleteSelected()` | Delete the selected committed feature and clear selection. Return its independent snapshot, or `null` with no selection. Throws for multiple selections; idle only. |
| `exportGeoJSON()` | Independent `GeometryFeatureCollection` snapshot containing committed lines and polygons. |
| `importGeoJSON(input)` | Append a parsed Feature/FeatureCollection atomically; return an independent collection of imported features. Idle only. |
| `applyTransaction({ create?, update?, delete? })` | Validate and commit a mixed batch atomically. Full features with explicit IDs; idle only. Return a TransactionEvent or null for no change. |
| `onTransaction(listener)` | One complete change batch per successful applyTransaction, confirmed split/union, deleteSelection, group translation, duplication or hole deletion. Returns an unsubscribe function. |
| `onImport(listener)` | One notification per nonempty imported batch. Returns an unsubscribe function. |
| `onUpdate(listener)` | One notification per changed saved edit. Returns an unsubscribe function. |
| `undo()` / `redo()` | Reverse/replay one committed action; return true if applied, false if unavailable. Idle only. |
| `clearHistory()` | Release undo/redo history without changing data or revision. Idle only. |
| `onHistory(listener)` | One atomic change event per successful undo/redo. Returns an unsubscribe function. |
| `onCreate(listener)` | One event per committed feature, with an independent snapshot per listener. Returns an unsubscribe function. |
| `onDelete(listener)` | One event per successful deleteSelected, with an independent snapshot of the removed feature per listener. Returns an unsubscribe function. |
| `onChange(listener)` | Editing-state notification after state changes. Read the initial state with `getState()`. Returns an unsubscribe function. |
| `getSnapping()` / `setSnapping(options)` | Read an isolated options snapshot or atomically merge partial snapping options. A changed configuration emits `onChange`, without changing data/history. |
| `getSnap()` | Independent `SnapResult` snapshot or `null` when no drawing/drag snap is active. |
| `onSnap(listener)` | Notify when the snap target/coordinate changes or is released (`null`). Returns an unsubscribe function. |
| `destroy()` | Remove owned resources/listeners and restore drawing gesture settings. Idempotent. |

`GeometryFeature` is the union of `LineFeature`, `PolygonFeature`, `MultiLineFeature`
and `MultiPolygonFeature`. Inspect
`feature.geometry.type` to narrow coordinates in TypeScript. `GeometryFeatureCollection`
is a GeoJSON FeatureCollection containing all four geometry types. New drawings receive a UUID and empty properties. Imported features preserve
string or numeric IDs and JSON properties (including null). Coordinates are
`[longitude, latitude]`. Properties can be imported but there is no property-editing API yet.

Modes are `idle`, `draw-line`, `draw-polygon`, `edit-line`, `edit-polygon`, `draw-hole`, `split-polygon`, and `union-polygons`. `validationError` is `null`
when idle or when the current draft is valid. Check `canFinish` to enable Finish;
an idle editor cannot finish even though it has no validation error.

Callbacks run synchronously. Exceptions are reported asynchronously without
interrupting a commit or other observers. MapLibre renders committed data
asynchronously; listen to the map's `error` event for rendering failures.
After destruction, exports remain readable and selection is cleared;
drawing, selecting, deleting, and subscribing throw.

## Polygon holes

A Polygon stores the exterior at `coordinates[0]` and holes at subsequent indices.
In the demo, select a polygon and choose **Draw a hole**. Place corners strictly
inside the filled area, then press Enter, Finish, or click the first corner.
Escape cancels. Use **Ring to edit** to choose the outer boundary or a hole before
**Edit vertices**; **Delete hole** removes the chosen interior ring.

```ts
editor.select(polygonId);
editor.drawHole(); // Subsequent map clicks define a new hole; finish()/cancel() apply.
// After finishing or cancelling:
editor.editSelected(1); // First hole. Default 0 edits the exterior.
editor.moveVertex(0, [4.89, 52.37]); // Index within the active ring.
editor.finish(); // Saves only when the entire polygon remains valid.
editor.deleteHole(1); // Immediate transaction; Undo restores the exact ring order.
```

`drawHole()` returns false without a sole polygon selection or if already drawing
a hole. These examples address component 0; see [multipart](multipart.md) for other components.
`editSelected(ringIndex)` rejects out-of-range/noninteger indices before
entering editing. For a line only index 0 is supported. Ring indices follow the
current coordinate array; they are not stable identities after ring deletion.
Only one ring is edited per session. `getDraft()`, `vertexCount`, and
`selectedVertexIndex` describe that ring; `activeRingIndex` identifies it while
editing a polygon or drawing a hole and is null otherwise. Hole drawing introduces
`mode: 'draw-hole'`; consumers with exhaustive mode switches should handle it.

All rings are validated together after clicks or vertex changes. A hole must be
strictly inside the exterior and may not touch, overlap or contain another hole.
Moving the outer boundary may invalidate an existing hole; Finish then returns
null and leaves the draft editable. Cancel restores the saved polygon. Untouched
rings, feature ID, JSON properties and feature order remain intact.

Finishing a hole or changed ring edit emits one `onUpdate`, then `onChange`, and
records one `edit` history entry. `deleteHole(index)` emits one `onTransaction`,
then `onChange`, and records one transaction. It returns null without a sole
polygon selection; index 0, missing indices and nonintegers throw RangeError.
All hole commands require idle mode except the matching Finish/Cancel session.
No-op ring saves and cancellations create no data/history entry. Successful
commands upload committed data once. Undo/Redo restore all rings exactly.

Import, export, translation, duplication, and history include every ring. Snapping
indexes hole corners and edges; polygon `SnapResult` values include `ringIndex`
as well as the ring-local `index`. Lines and first-corner closure targets omit it.
The entire target polygon is excluded from snapping while editing or adding a
hole. At equal feature/distance priority, the lower component index, then ring index,
breaks a tie before the vertex/edge index. Picking respects empty hole interiors while their outlines
remain selectable. Split preserves holes wholly on one side; a cut touching or
crossing a hole is rejected with `split-hole-crossing`.

## Duplicate selected shapes

```ts
editor.selectMany([7, '7']);
const duplicated = editor.duplicateSelection(); // Exact geometry copies, new IDs.
// Or supply a shared longitude/latitude offset in degrees:
// const duplicated = editor.duplicateSelection([0.001, -0.002]);
const copies = editor.getSelection(); // Only the new copies are selected.
editor.undo(); // Remove the entire copied group.
editor.redo(); // Restore those same copies and IDs.
```

`duplicateSelection(delta = [0, 0])` copies one or more selected committed features
in selection acquisition order. Copies append after existing features and receive
fresh string UUIDs, even when the originals have numeric IDs. Geometry type and
JSON properties (including null and nested values) are retained. Copies are
independent: editing or moving them cannot alter an original. No metadata is added
to exported properties. An empty selection returns null without a notification,
new IDs, data revision or history entry.

The whole batch is prepared and validated before any data changes. Generated IDs
are checked against both existing features and the other pending copies. ID
allocation failure, invalid offsets, bounds violations or invalid resulting
geometry reject the entire operation, preserving data, selection and Undo/Redo.
Offset validation follows the [translation contract](#move-selected-shapes).
Drawing, vertex editing and splitting must be finished or cancelled first.
Calling the API during a transient selection rectangle or group drag cancels that
gesture and duplicates the committed selection; its later pointer release is ignored.

A successful operation selects only the new copies before callbacks run, increments
`dataRevision` once and emits one `onTransaction`, then one `onChange`. Every change
has `before: null` and the complete copy in `after`. There are no per-feature
`onCreate` events. The committed map source is uploaded once. Both `GeometryEditor`
and the `LineEditor` facade expose the same method.

Undo removes the copied batch; Redo restores its exact geometry, properties, IDs
and order without generating new IDs. Selection remains transient UI state:
Undo prunes removed copies from selection and does not reselect originals. Redo
does not restore a previous selection. A subsequent move of the copies is its
own Undo action. With `historyLimit: 0`, duplication still works without history.

In the demo, select shapes and click **Duplicate**. The demo derives a small degree
offset from a point 24 CSS pixels right and down from the map center, making the
copies visible at different zoom levels. This is one shared geographic offset;
it does not guarantee a 24-pixel displacement at every vertex on a pitched map.
The new copies are selected and can be dragged immediately. Duplication saves
immediately; Undo removes the copies. The library default uses no offset and has
no clipboard or keyboard shortcut side effects.

## Move selected shapes

Select one or more shapes, then drag any selected shape with the primary mouse
button and no modifiers. After 4 CSS pixels the group appears as an orange dashed
preview. Release commits the complete group once; Escape cancels the gesture and
keeps the selection. A shorter gesture remains an ordinary click. Shift+drag still
adds to the selection. Drawing, editing vertices and splitting keep their own
input behavior. Group dragging supports desktop mouse input.

```ts
editor.selectMany([7, '7']);
const moved = editor.translateSelection([0.001, -0.002]);
// Same offset in longitude/latitude degrees for every vertex.
// IDs, properties, feature order and selection remain intact.
editor.undo(); // Restore the complete group in one action.
editor.redo();
```

The offset is **longitude/latitude degrees**, not meters or screen pixels. Dragging
uses the difference between the pointer's unprojected start and release positions.
Every preview is computed from the original coordinates, avoiding accumulated
rounding drift. Relative coordinate offsets and closed rings are preserved;
physical distances and projected screen dimensions can change with latitude.
Group movement does not snap; drawing and vertex snapping remain available.

Coordinates must remain within `[-180, 180]` longitude and `[-90, 90]` latitude.
Nothing wraps or clamps individual vertices. One out-of-bounds member rejects the
whole group, including offscreen selected features. During such a drag, the cursor
shows `not-allowed`, the original group is previewed, and release cancels. Final
transaction validation also rejects degenerate geometry caused by floating-point
rounding. The API throws `TypeError` for malformed/nonfinite offsets, `RangeError`
for bounds violations, and `GeoJSONImportError` for invalid resulting geometry.
Failures preserve data, selection, revision, undo and redo. A zero offset or empty
selection returns null without notifications or history.

A changed movement emits one `onTransaction`, followed by `onChange`; it does not
emit per-feature `onUpdate`. Undo/redo emits `onHistory` with action `transaction`.
Exports and data revision remain unchanged throughout the drag. The transient
pointer gesture leaves `getState().mode` at `idle`; it does not create an editable
vertex draft or require `finish()`. Hosts persist the transaction on release.

Blur, pointer cancellation, lost capture, camera movement, style replacement,
selection/data/history API changes, starting another tool, `cancel()` and teardown
cancel the active drag. The original cursor and drag-pan setting are restored.
Release after cancellation cannot select or draw accidentally. A selected group
outside a drag follows the normal Escape-to-deselect behavior.

The renderer hides the original selected shapes with feature state. Animation
frames upload only preview geometry for the moving group; the committed source
is uploaded once on success. See the [performance baseline](performance.md#group-translation).

## Selection

While idle, a plain left click replaces the selection with one visible committed
feature; clicking empty space clears it. Shift+click toggles one feature;
Shift+click on empty space preserves the selection. Shift+drag adds all rendered
editor shapes intersecting the selection rectangle. Every selected outline turns
blue and thicker; selected polygon fills also turn blue. Escape clears the whole
selection when the canvas is focused. No separate selection mode is needed.

For click picking, outlines have a query box extending 6 CSS pixels on each side
of the pointer, independent of zoom. Outline hits take priority over polygon
interiors; among hits in the same layer, the topmost rendered feature wins.
Overlapping objects are not cycled by repeated clicks. Host layers and drafts are
excluded. Ctrl/Meta/Alt-modified clicks are ignored; dragging a selected shape moves the selection; dragging elsewhere pans.

### Rectangle selection

Hold Shift and drag with the primary mouse button. A blue screen rectangle appears
after 4 CSS pixels of movement. Release the mouse to add the hits; selection does
not change while dragging. Releasing Shift before the mouse still completes the
rectangle. A shorter gesture is a Shift+click. Empty rectangles preserve selection.
The rectangle works in either direction and is clipped to the canvas when the
captured pointer leaves it. Only desktop mouse input is supported.

The test is **intersection with rendered geometry**, including visible strokes;
full containment is not required. Lines crossing the box are included even if
neither endpoint is inside. A polygon containing the rectangle is also included.
Duplicate hits from tiles, fill and outline layers become one selected ID. Existing
selection order is retained; newly hit IDs append in MapLibre query order. That
order is not a spatial sorting guarantee. Hit testing happens only on release.

During this idle gesture the editor temporarily takes over Shift+drag from
MapLibre box zoom and disables drag pan. Both settings are restored exactly.
Escape during a gesture cancels only the rectangle and preserves the prior
selection; release does not select anything afterwards. Blur, pointer cancellation,
lost capture, camera movement, style replacement, API selection/data changes,
starting another tool, `cancel()`, or destruction also abort the rectangle.
While drawing/editing/splitting, the editor does not start selection gestures.

### Public selection API

```ts
editor.selectMany([7, '7']); // Replace selection; typed IDs remain distinct.
editor.toggleSelection(7);  // Add/remove exactly this ID.
const features = editor.getSelection(); // Independent GeometryFeature[] snapshots.
const ids = editor.getState().selectedFeatureIds; // Independent FeatureId[].
editor.onChange((state) => console.log(state.selectedFeatureIds));
editor.select(aKnownId); // Replace the selection with exactly one feature.
editor.select(null);     // Clear everything; selectMany([]) does the same.
```

`selectMany()` accepts an array of existing IDs, deduplicated in first-occurrence
order. One unknown/invalid ID rejects the whole update with `RangeError`; a
non-array argument throws `TypeError`. `toggleSelection()` rejects unknown IDs.
The entire selection is validated before changing it. Selecting in any active
drawing, editing or split session throws, including requests to clear selection.

Selection emits one `onChange` only when IDs or their order change. Repeating the
same selection is a no-op. It never changes exports, data revision, properties or
history, and does not upload committed geometry. Highlighting updates only changed
feature states. Programmatic selection may include offscreen stored features and
does not move the camera or take keyboard focus. Mouse picking requires rendered
data: MapLibre source updates are asynchronous. Stale deleted IDs are ignored.

`selectedFeatureId` and `getSelected()` retain their single-feature types and
return **null for zero or multiple selected features**. `editSelected()` and
`splitSelected()` return false unless exactly one suitable feature is selected.
Use `selectedFeatureIds.length` to enable group controls, not `getSelected()`.

Selection survives style replacement and updates/imports. Transactions, deletion,
and history replay prune only IDs that no longer exist. Undo restores deleted
features, but does not restore selection: selection is transient UI state.
Starting a drawing clears it. Destroy clears it without callbacks. Getters remain
readable after destroy; commands and subscriptions throw. `LineEditor` exposes
these same selection methods and returns `LineFeature[]` from `getSelection()`.

### Delete the complete selection

```ts
editor.selectMany([firstId, secondId]);
const event = editor.deleteSelection(); // TransactionEvent | null
editor.onTransaction(({ changes }) => console.log(changes));
editor.undo(); // Restore all deleted features with their IDs/properties/order.
```

`deleteSelection()` deletes all selected features as one validated transaction,
including when only one is selected. It emits one `onTransaction`, then one
`onChange`, performs one source upload, and records one `transaction` history
action. It does not emit individual `onDelete` callbacks. Empty selection returns
null with no data change, notification or upload. Active tools reject deletion.
Listen to `onTransaction` for group deletion and `onHistory` for its undo/redo.

For compatibility, `deleteSelected()` remains the single-feature method with its
existing `GeometryFeature | null` result and `onDelete` event. With multiple
selected features it throws `RangeError` directing callers to `deleteSelection()`;
it never silently deletes an arbitrary member. The demo's Delete button and
focused Delete/Backspace use the single method for one selection, and the batch
method for multiple selections. LineEditor forwards `deleteSelection()` and
`onTransaction()` too. Group movement and duplication are later milestones.

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

Deletion is immediate and in-memory. It does not contact a backend or ask for
confirmation. Applications can place their own confirmation
before calling `deleteSelected()` if their workflow needs it. A retained removed snapshot can be restored with `importGeoJSON(snapshot)`
while idle, if its ID has not been reused. `undo()` restores the deletion directly
while that action remains in history.

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
polygon topology are rejected. Saved rings are closed; exteriors are CCW and holes CW.

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

- Two-dimensional LineString, Polygon, MultiLineString and MultiPolygon. Every polygon
  component has one closed exterior and optional closed interior rings. See [multipart validation](multipart.md#validation-and-history).
  Points, geometry collections, null geometries,
  and altitude coordinates are rejected explicitly.
- Finite longitude/latitude in world bounds. Lines need two points and no
  consecutive duplicates. Polygons use the same topology rules as drawing;
  either winding is accepted and normalized to CCW for the exterior and CW for holes, keeping each first corner.
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

## Polygon union

Select at least two Polygon/MultiPolygon features and call `unionSelection()` to
review their combined filled area. `finishUnion()` returns the complete transaction;
`finish()` returns the retained feature. Cancel/Escape leaves every original intact.
The first selected ID/properties survive; the other inputs are deleted. One Undo
restores all original geometry and order. Unsupported output topology is reported
through `unionError`. See the [union guide](union.md) for the complete contract.

While reviewing a union, commands changing selection, tools, data or history throw.
Consumers with exhaustive state switches must handle `union-polygons`.

## Splitting

A selected polygon can be split into two independent features with a cutting line,
colored preview, correction/cancel and one undo action. See the [split guide](splitting.md)
for the restricted crossing contract, diagnostics, identity, properties and events.
In split mode, `finish()` commits and returns the retained feature; `finishSplit()`
returns the complete transaction. Splits use `onTransaction`, not individual events.

## Atomic transactions

Use `applyTransaction` for a batch of creations, replacements, and deletions.
Every entry is validated before the store changes; the batch is one undo action
and one `onTransaction` notification. See the [transaction guide](transactions.md)
for input, ID, event, and failure contracts. Existing individual methods keep
their current events.

## Undo and redo

```ts
const editor = new GeometryEditor(map, { historyLimit: 100 });

editor.undo(); // boolean: whether an action was reversed
editor.redo(); // boolean: whether an action was replayed
const { canUndo, canRedo } = editor.getState();

editor.onHistory(({ direction, action, changes }) => {
  // Persist the batch in the order supplied. Each change is in the applied direction:
  // before=null creates a feature; after=null deletes it; both present update it.
  console.log(direction, action, changes);
});

// Optional: establish loaded data as the baseline rather than an undoable import.
editor.importGeoJSON(initialData);
editor.clearHistory();
```

Each committed drawing, changed saved edit, deletion, nonempty import, or effective explicit transaction is one
action. Any number of vertex gestures before Save form one edit action; an import
is one action for the whole batch. Undo/redo restores IDs (including number vs
string), nested properties, geometry, and original feature order. Redo reuses the
original IDs without calling the ID generator or revalidating stored geometry.

Selection is not a history action. The currently selected feature stays selected
if it exists after replay; otherwise selection is cleared. Undo does not restore
past selections. The camera is unchanged. Cancel, unchanged Save, empty imports,
failed validation, and no-op deletions neither record actions nor clear redo.
A new committed mutation after undo discards the redo branch.

`undo()`, `redo()`, and `clearHistory()` throw while drawing/editing or after
destroy. `canUndo` and `canRedo` are false during an active interaction, while the
underlying history is retained. Finish or cancel first. An unavailable undo/redo
while idle returns false without changing state, revision, rendering, or events.

With canvas focus, Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Shortcuts
in form fields or other elements are untouched. Repeats, composing events,
already-prevented events, Alt combinations, Ctrl+Meta combinations, unavailable
actions, and active drafts are ignored without preventing browser defaults.
The demo buttons call the same API and return focus to the map after success.

A successful undo/redo increments `dataRevision` once, refreshes selection and the
committed source once, emits one `onHistory` event, then `onChange`. Existing
`onCreate`, `onUpdate`, `onDelete`, and `onImport` events are not replayed: subscribe
to `onHistory` as well when synchronizing a backend. `HistoryEvent.action` names
the original action (`create`, `edit`, `delete`, `import`, or `transaction`); `direction` is
`undo` or `redo`. `changes` contains independent `before`/`after` feature snapshots
in the direction actually applied. For example, undoing a deletion has
`before: null` and `after: restoredFeature`. All changes have been applied before
callbacks run. Listener snapshots are isolated and observer errors follow the
existing asynchronous reporting policy.

`historyLimit` must be a nonnegative safe integer. The default is 100 retained
actions across undo and redo; 0 disables recording. Older actions are evicted
without changing current data. The bound is an **action count, not a byte limit**:
one large import or geometry can still retain substantial memory. Entries store
only changed feature versions, sharing internal immutable versions where possible;
there is no full-dataset snapshot per action. Restoring a middle deletion rebuilds
Map order without copying unrelated geometries. The renderer still uploads the
full collection after replay.

`clearHistory()` releases both stacks, emits `onChange` only if history existed,
and preserves data, revision, and selection. Style changes preserve history.
Destroy/map removal clears history without emitting history events. History is
local to one editor instance and is not included in GeoJSON or persisted across
reloads. LineEditor supports the same history methods, options, and events.

## Snapping while drawing

```ts
const editor = new GeometryEditor(map, {
  snapping: { enabled: true, distance: 18, vertices: true, edges: true },
});
editor.draw('Polygon'); // Also applies to drawing a LineString.
editor.setSnapping({ distance: 24 }); // Partial update; other options stay intact.
editor.setSnapping({ enabled: false });
const options = editor.getSnapping();
const unsubscribe = editor.onSnap((snap) => {
  // null on release; otherwise kind, featureId, index, coordinate, distance.
  console.log(snap);
});
```

Snapping is opt-in in the library and enabled by default in the demo. The
behavior takes inspiration from [Geoman's snapping helper](https://geoman.io/docs/maplibre/helper-modes/helper-snapping)
(pixel tolerance and vertex priority) and its [Alt bypass](https://geoman.io/docs/leaflet/options/snapping).
The implementation is independent; it does not depend on Geoman or copy Pro code.

- The default tolerance is **18 CSS pixels**, independent of device-pixel ratio
  and zoom. `distance` must be finite, greater than 0 and at most 100; boolean
  options require booleans. Invalid updates leave all previous options intact.
- The nearest vertex within tolerance wins, even if an edge is closer. Without
  an eligible vertex, the nearest point on an edge wins. `vertices` and `edges`
  can be disabled independently. An exact distance tie chooses the later feature
  in collection order, then the lower vertex/edge index within that feature.
- Candidates are all committed lines and polygons owned by this editor, including
  imported geometry and polygon closing edges. Host map layers and ordinary
  draft vertices/edges are excluded. During vertex editing, the entire edited
  feature is also excluded (including its saved geometry).
- Vertex snapping copies the exact stored coordinate. Edge snapping projects
  onto the displayed straight segment in screen space and inverse-projects the
  result; it is not geodesic or planar longitude/latitude interpolation.
  This follows the visual flat Mercator edge. Planar geometry validation remains
  a separate check, and snapping cannot make an invalid polygon committable.
- A purple indicator marks the acquired point. Preview and click resolution use
  the same calculation; clicks always resolve again, so they cannot commit a
  stale hover result. Holding **Alt** temporarily bypasses external snapping,
  including Alt+click; releasing Alt recalculates at the stationary pointer.
- After three polygon corners, its first corner takes priority as a close target.
  Its radius is `max(8, distance)` with vertex snapping enabled. Otherwise the
  existing 8-pixel click-to-close behavior remains, including while holding Alt.
  Closing validates the polygon and does not add an extra corner to the draft.

`SnapResult.kind` is `vertex` or `edge`; `featureId` preserves string/numeric
identity and is `null` only for the current polygon's closing corner. `index` is
the zero-based vertex index or edge start index (an open ring, without the repeated
closing coordinate). `coordinate` is longitude/latitude and `distance` is the
current CSS-pixel separation. `getSnap()` returns a copy. `onSnap` provides an
independent snapshot to each observer, including `null` when released. It emits
when the target identity or coordinate changes, not for distance-only changes
while staying on the same vertex. Pointer previews/events are coalesced per frame;
drawing clicks and drawing option changes resolve synchronously. Observer errors follow the same
asynchronous reporting policy as other editor events. Unsubscribing is supported.

Hovering never changes committed data, exports, revision, or history. A saved
snapped drawing is one normal create action and replays exact coordinates on
undo/redo. The target geometry is unchanged: snapping to an edge does not insert
a vertex into the target, link geometries, or trace its boundary. Snap state is
cleared on drawing pointer leave, window blur, finish, cancel, and destruction.
Style replacement restores drawing indicators; camera/data changes invalidate the cache.
LineEditor exposes the same snapping options, getters, setter, and event.

### Snapping during vertex editing

The same `snapping` options apply to mouse drags in `edit-line` and `edit-polygon`.
Drag a corner, or drag a midpoint to insert and position a new corner. Once moved,
the draft and purple indicator follow the resolved point on another committed
feature. An ordinary click still selects a corner or inserts the exact midpoint.
The complete edited feature is excluded, so neither its old saved coordinates nor
its current draft can attract the drag. Self-snapping is deferred.

Alt works from the start of a drag and can be pressed/released without moving
the pointer. Option changes and camera movement also refresh the stationary drag
on the next animation frame. Release resolves the final mouse position and Alt
state synchronously, then clears the indicator. Captured drags continue outside
the canvas until release or cancellation; ordinary editing hover does not snap.

`moveVertex()` and `insertVertex()` use the caller's exact coordinates and never
apply screen-dependent snapping. They stop any active mouse gesture first.
No public API additions are needed: use `getSnap()`, `onSnap()`, and `setSnapping()`
as for drawing. Snapping remains disabled by default in the library.

A snapped drag changes only the draft. Invalid intermediate geometry remains
visible and cannot be saved. Save emits one `onUpdate` and records one edit action
for the whole session; undo/redo restores the exact committed coordinates, ID and
properties. Targets are unchanged, including when acquiring an edge. Pointer
cancellation, lost capture, blur and style replacement roll back the active gesture
(including a newly inserted midpoint), clear the indicator, and restore panning.
Earlier completed gestures remain in the draft. Escape/Cancel discards the entire
session. Destroy discards the draft and removes the gesture and snap handlers.

This milestone supports the canonical world copy of a flat Mercator map, including
zoom, bearing, and pitch. Repeated world copies, dateline/polar geometry, globe,
terrain, touch, topology linking, and boundary tracing are outside this contract.

## Polygon contract

- At least three distinct, non-collinear corners, with finite world-bounded
  coordinates. A valid outline may contain collinear intermediate vertices.
- One simple outer ring with optional strictly contained, disjoint holes. Holes cannot touch any other ring or contain other holes. Crossing edges, nonadjacent touches, repeated interior
  vertices, and overlapping/backtracking edges are rejected, including the
  closing edge. Self-crossing **lines** remain allowed.
- Export repeats the first position at the end and normalizes the exterior to
  counterclockwise winding (holes clockwise), as specified by [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.6).
  Reversing winding keeps the user's first vertex.
- Checks use planar longitude/latitude segments. An edge with longitude change
  greater than 180 degrees is rejected. Dateline splitting, polar geometry,
  terrain/globe, and alternate projections are outside the supported scope.
- Invalid drafts remain visible but cannot be committed. Add more points while drawing, move/remove corners while editing, or cancel.

Errors are `too-few-vertices`, `zero-area`, `duplicate-vertex`,
`self-intersection`, `antimeridian-crossing`, `ring-intersection`, `hole-outside`,
`nested-holes`, `part-intersection`, and `part-overlap`. The first detected error is
reported; these are diagnostics, not a list of every defect.

Enter or Finish closes a polygon. A plain click within 8 CSS pixels of its first
corner also finishes it after at least three corners, provided it is valid.
Enabled vertex snapping extends that radius as described above.
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
selection, deletion/export, vertex movement, import, undo/export, and snapping index/query costs. Large-dataset rendering,
interaction latency, memory, touch input, and
other browser engines still require measurement before production-scale claims.
