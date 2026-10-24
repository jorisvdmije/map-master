# Simplify selected geometry

Select one or more lines/polygons and choose **Simplify selection**. Enter a
nonnegative **Tolerance (Mercator meters)**. Zero preserves every vertex; a
larger tolerance removes small details. The demo reports the original and preview
vertex counts (excluding polygon closure copies). Try the detailed polygon/line
fixture with tolerance 5.

**Apply simplification** saves the complete selection; Cancel discards the preview.
With the map focused, Enter applies and Escape cancels. One Undo restores every
original coordinate. Invalid or incomplete numeric input disables Apply; leaving
the field restores the last accepted tolerance. Typing is not intercepted by map
shortcuts.

## Units and algorithm

Tolerance is a distance in spherical Web Mercator meters, using radius 6,378,137 m,
x = Rλ and y = R asinh(tan(φ)) for longitude/latitude in radians. These are
map-plane meters, not ground meters. The result is independent of camera zoom,
bearing and pitch. Geodesic distances, terrain and globe simplification are
outside this first version.

An iterative Douglas–Peucker algorithm retains line endpoints and subdivides at
the first farthest vertex whose distance to the finite replacement segment exceeds
the tolerance. Vertices at or below the threshold may be removed. For polygon
rings, the first corner and the first farthest corner from it anchor two arcs,
which are simplified separately. Rings stay closed. Ring starting order can affect
the result; this does not compute a globally minimal vertex set.

All retained coordinates are exact copies of source coordinates: there is no
inverse projection or coordinate rounding. Zero is an exact identity, including
collinear vertices. Every tolerance change starts from the frozen entry geometry;
reducing tolerance can restore details removed by a prior preview. IDs, properties,
geometry types, component/ring order and collection order remain stable. No new
IDs are allocated. Stored area/length properties are not recalculated.

The geometric distance test is in the projected plane and applies to discarded
source vertices against their replacement segment, subject to floating-point
roundoff. It is not an area-error, ground-distance or longitude/latitude-edge
error guarantee.

## Topology and supported input

Each candidate passes the same validation as a committed geometry. Collapsed
lines/rings, polygon self-intersections, hole-boundary crossings and invalid multipart
polygon relationships block the entire preview. Lines may self-intersect, as in
ordinary line import and editing. Holes and components are never silently
deleted, geometry is not repaired, and the tolerance is not automatically reduced.
An invalid result keeps the tool active; lower the tolerance or Cancel.

This is validated simplification of individual features, not shared-boundary
simplification. Neighbouring features can develop gaps or overlaps, even when both
are selected. Snapping, tracing and drawing-angle settings do not affect it.
Unselected features stay unchanged. Review parcel boundaries before saving.

Input must lie within longitude ±180° and latitude ±85.0511287798066°.
Dateline-jumping segments and selections spanning more than 180° longitude are
unsupported. Empty or unsupported selections do not enter the tool. Output
coordinates are a subset of input coordinates and still pass ordinary validation.

## Public API

```ts
editor.selectMany(['parcel', 'route']);
if (editor.simplifySelection()) {
  editor.setSimplificationTolerance(5); // Mercator meters, absolute from originals.
  const preview = editor.getSimplificationPreview();
  if (editor.getState().canFinish) {
    const transaction = editor.finishSimplification();
    console.log(preview, transaction);
  } else {
    console.log(editor.getState().simplificationError);
    editor.cancel();
  }
}
```

- `simplifySelection(): boolean` enters `simplify-features` mode at tolerance 0,
  supporting LineString, Polygon (with holes), MultiLineString and MultiPolygon.
  Empty/unsupported selections or an already active simplification return false.
  Another active tool throws.
- `setSimplificationTolerance(meters: number): boolean` returns true when an active
  tolerance changes. Inactive or identical values return false. Nonnumeric/nonfinite
  values throw TypeError; negative values throw RangeError, even when inactive.
  Malformed values leave the existing preview unchanged. A well-formed tolerance
  with invalid output becomes active with a diagnostic and no preview.
- `getSimplificationPreview(): GeometryFeatureCollection | null` returns an
  independent validated snapshot in selection order, or null when inactive/invalid.
  Reads do not recalculate the simplification.
- State exposes `simplificationTolerance` and `simplificationError`, both null
  outside the mode. The diagnostic `simplification-invalid-result` means the
  candidate failed ordinary geometry validation. `canFinish` reports validity;
  `getDraft()` stays empty and there are no editable vertex handles.
- `finishSimplification(): TransactionEvent | null` revalidates and atomically
  saves all changed features. Invalid/inactive calls return null; invalid review
  remains active. An unchanged confirmation exits and returns null without history.
- `finish()` uses the same path and returns the first selected result, including
  unchanged confirmation. `finishSimplification()` returns the complete change batch.

Consumers with exhaustive mode/state switches must handle the new mode and fields.
Getters remain readable after destruction; commands/subscriptions throw. The
LineEditor compatibility facade does not expose simplification.

## Rendering, history and lifecycle

Valid preview geometry hides the selected originals; an invalid result displays
originals. There is no pivot marker. Changing tolerance never uploads the committed
feature source. Camera changes and style replacement retain/reconstruct the same
preview. Selection, drawing, editing and competing data/history operations are
blocked until finish/cancel.

Changed confirmation increments dataRevision once and emits one `onTransaction`
followed by `onChange`. No individual create/update/delete events are emitted.
Undo/Redo emits `onHistory` with action `transaction`, restoring exact coordinates,
properties and order. Cancel and unchanged saves preserve Redo and add no history.
Preview, state and event snapshots are independent.

Cancel, destruction and map removal discard the preview. Existing gesture/cursor
settings are restored when the map remains alive. Tolerance changes validate
synchronously, with rendering scheduled per animation frame. Iterative processing
avoids recursion-depth failures, but worst-case algorithm and polygon validation
costs remain quadratic. See the [benchmark](performance.md#selection-simplification).
