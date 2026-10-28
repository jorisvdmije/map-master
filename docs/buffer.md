# Buffer selected geometry

Select lines or polygons and choose **Buffer selection**. Drag **↔** or set **Buffer distance
(Mercator meters)** to a positive number; the initial distance is 10. **Apply
buffer** replaces each selected feature with its buffered Polygon or MultiPolygon.
IDs, JSON properties, selection and collection order remain stable. A line becomes
a polygon; its original path is restored by Undo. To retain a separate source,
duplicate the selection before buffering. Unselected features remain unchanged.

Cancel discards the preview. Enter applies and Escape cancels while the map has
focus. Text input retains ordinary keyboard behavior. Empty, zero, negative and
incomplete input disables Apply; leaving the field restores the accepted distance.
The [example fixture](../examples/basic/public/buffer.geojson) contains a parcel and
a route for trying the tool. Import it in the demo and select either or both.

## Dragging the distance

The **↔ distance handle** adjusts the same value as numeric input. A solid ruler
measures from the original geometry to the requested result; a faint outline
keeps the originals visible. The label shows **Mercator meters**, not ground
meters. A dashed 36 CSS-pixel extension connects the result marker to the
44-pixel handle, so tiny distances remain easy to grab. The extension is not part
of the measured distance. North/south movement in the Mercator plane does not
change distance; east/west movement adjusts it.

The reference is the eastmost original vertex across the selection, pointing
eastward. It stays fixed for the session and lies on the outer envelope, including
for multipart selections. All selected features receive the same buffer distance.

Release to review, then Apply/Enter to save the whole selection in one Undo step.
Escape during a drag restores its starting distance; Escape again cancels the
session. Enter during a drag is ignored. Captured mouse input continues outside
the canvas. Blur, capture loss, pointer cancellation and camera/style changes
roll back only the active drag. Camera gesture settings are restored afterwards.
Numeric/API distance changes stop an active drag, so a late release cannot
replace the new value.

Tab to the handle and use Up/Right to add 1 meter or Down/Left to subtract 1 meter.
Shift uses 10-meter steps. Enter applies and Escape cancels when the handle is
focused. Mouse dragging is supported; touch/pen dragging is not yet supported.

Buffer remains strictly positive. Moving past the source keeps the last positive
distance; it never silently switches to an inward buffer. Keyboard steps that
would reach zero or below leave the distance unchanged.

Invalid results use a red ruler/handle and cannot be applied. The guide represents
the requested distance, even when there is no valid preview. Adjust the distance
to recover. If the guide lies outside the viewport or cannot be projected, pan,
zoom or use numeric input. Snapping does not change the distance. Calculations
and the ruler use the same Mercator plane at every zoom, bearing and pitch.

## Units and geometry policy

Distance uses spherical Web Mercator meters with radius 6,378,137 m:
`x = Rλ`, `y = R asinh(tan(φ))`. These are map-plane distances, not ground or
geodesic distances. The calculation is independent of zoom, bearing and pitch.
Each source segment is straight between its projected endpoints. Output GeoJSON
connects inverse-projected vertices with ordinary longitude/latitude segments;
there is no continuous geodesic or geographic-edge error guarantee.

This first version supports positive outward buffers of LineString, Polygon,
MultiLineString and MultiPolygon. Corners and line ends approximate round joins
and caps. Polygon interiors are included; holes shrink and may disappear, and
parts may merge. One source feature yields one Polygon/MultiPolygon. Parts are
dissolved within each feature, but separately selected features are not dissolved
together. They may overlap. Properties such as cached area/length are not updated.

Input is restricted to longitude ±180° and latitude ±85.0511287798066°, with no
dateline-jumping segments or selections spanning more than 180° longitude. Empty
or unsupported selections return false before entering the mode. The entire
circular envelope must fit within the Mercator world square; a boundary-touching
input cannot buffer outward. No longitude wrapping or clipping at world limits
is performed. The first version excludes inward/negative buffers, zero-distance
repair, points, geodesic distances and configurable cap/join styles.

## Algorithm and precision

Each segment is swept with a fixed east/north-aligned regular inscribed 32-gon.
The convex hull of the 32-gon translated to both endpoints forms a capsule. The
existing [polygon-clipping union engine](https://github.com/mfogel/polygon-clipping#api)
unions capsules and, for polygons, the original filled interior and all boundary
capsules. This computes dilation by the polygonal disk, including shrinking holes.
Capsules are dissolved in groups of at most 32 before the final union, reducing
redundant interiors in the overlay. No new runtime dependency is introduced.

The disk lies between circles of radii `d × cos(π/32)` and `d`. Its maximum radial
deficit is about 0.482% of `d` (about 4.82 cm at 10 Mercator meters), before numeric
roundoff and inverse projection. This is a finite polygonal approximation; it is
not a precise circular arc. Local projected coordinates around each feature's
bounding-box centre reduce cancellation during overlay. Robust orientation
predicates build the convex hull. Extremely small distances may be unrepresentable
at the input scale and can produce an unchanged or rejected result.

Output must pass the ordinary strict polygon/multipart validator and transaction
normalization. Invalid topology, including unsupported point-touching components,
blocks the whole selection. A calculation failure never commits a partial result.
The tool does not repair geometry or silently reduce the distance.

## Public API

```ts
editor.selectMany(['route', 'parcel']);
if (editor.bufferSelection(10)) {
  editor.setBufferDistance(20); // Absolute distance from the frozen originals.
  const preview = editor.getBufferPreview();
  if (editor.getState().canFinish) {
    const transaction = editor.finishBuffer();
    console.log(preview, transaction);
  } else {
    console.log(editor.getState().bufferError);
    editor.cancel();
  }
}
```

- `bufferSelection(distance = 10): boolean` enters `buffer-features`, computes the
  first preview synchronously and returns true, including when that preview is
  invalid. Empty/unsupported selections or an already active buffer return false;
  another active tool throws. Distance is validated before these checks.
- `setBufferDistance(meters: number): boolean` recomputes from the entry originals.
  Inactive/identical valid values return false. Nonnumeric/nonfinite values throw
  TypeError; zero/negative values throw RangeError, even when inactive. These
  malformed values leave state unchanged. A valid positive value with invalid
  output becomes the current distance with a diagnostic and no preview.
- `getBufferPreview(): GeometryFeatureCollection | null` returns an independent,
  validated snapshot in selection order; null when inactive/invalid. Reads do not
  rerun the calculation or allocate IDs.
- State exposes `bufferDistance` and `bufferError`, both null outside the mode.
  `buffer-out-of-bounds` means the envelope exceeds the supported world;
  `buffer-failed` means the clipping engine failed; `buffer-invalid-result` means
  degenerate numeric output or failure of strict result validation. `canFinish`
  describes preview validity. `getDraft()` stays empty; there are no vertex handles.
- `finishBuffer(): TransactionEvent | null` revalidates and replaces all changed
  features as one transaction. Inactive/invalid calls return null; invalid review
  stays active. An unchanged confirmation exits without history and returns null.
- `finish()` takes the same commit path and returns the first preview feature,
  including unchanged confirmation. Use `finishBuffer()` for the complete batch.

Consumers with exhaustive state/mode switches must handle these additions. The
LineEditor compatibility facade does not expose buffering. Getters remain readable
after destruction; commands/subscriptions throw.

## Rendering, history and lifecycle

A valid preview hides selected originals and draws the buffers without a pivot
marker. Invalid results show originals. Distance changes do not upload committed
feature data. Camera changes and style replacement preserve/reconstruct the same
preview. Drawing, selection, editing and competing data/history commands are
blocked until finish/cancel. Snapping, tracing and drawing constraints do not
affect buffer calculations.

A changed confirmation increments dataRevision once and emits one `onTransaction`
followed by `onChange`. There are no individual create/update/delete events.
Undo/Redo reports `onHistory` with action `transaction` and restores exact types,
coordinates, properties and order. Cancel and unchanged confirmations preserve
Redo. State, preview, return values and event snapshots are independent.

Cancel, destruction and map removal discard the preview and release owned
resources. Existing cursor/gesture settings are restored when the map remains
alive. Calculations and validation run synchronously; rendering is scheduled per
animation frame. Large inputs can block the UI. See the
[benchmark and limitations](performance.md#selection-buffers).
