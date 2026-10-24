# Rotate selected shapes

Select one shape, or several with Shift+click, and choose **Rotate selection**.
Enter an angle in degrees or use the −15° / +15° buttons. Positive angles turn
clockwise around the white pivot marker. **Apply rotation** saves the whole
selection; Cancel discards it. With the map focused, Enter applies and Escape
cancels. One Undo restores the complete selection. The demo's adjoining-parcels
or multipart fixture can be imported to try this workflow.

This first version uses numeric controls and a public API. Dragging a rotation
handle or moving the pivot interactively is not implemented. The demo restores
the last preview angle when an incomplete/cleared angle input loses focus; while
that input is incomplete, Apply is disabled. Map shortcuts do not intercept typing
in the input field.

## Coordinate and angle policy

All selected features rotate together in the spherical Web Mercator plane. The
default pivot is the centre of their combined **projected bounding box**, not a
centroid or average of vertices. It is calculated once on tool entry and remains
fixed as angles and map camera settings change. The API can instead supply a
longitude/latitude pivot; it need not lie inside the selection.

For longitude λ and latitude φ in radians, the calculation uses x = λ and
y = asinh(tan(φ)), with north-positive y. A positive angle θ transforms a point
relative to the pivot by x′ = x cos θ + y sin θ, y′ = −x sin θ + y cos θ.
The inverse uses λ = x and φ = atan(sinh(y)). The sphere radius cancels, so no
measurement-unit conversion is needed. Positive angles appear clockwise on a
north-up Mercator map; map bearing/pitch does not change the geographic result.

Each angle is an absolute rotation from the frozen entry geometry. Repeated angle
changes do not accumulate numerical drift. Finite angles normalize to (−180, 180];
−180 becomes 180 and complete turns become exact zero. Zero copies the originals
without a projection round trip. Quarter-turn trigonometric coefficients are exact;
other floating-point construction and projection roundoff remain possible.

This is a transformation of stored vertices, without inserting intermediate points.
It preserves distances/angles in the projected plane, not ground distances, areas
or geodesic bearings. Long segments can have different straight-edge interpretations
in longitude/latitude and Mercator; always review the result. Polygon rings, holes
and multipart results still pass the editor's planar topology validation. Floating
point collapse or invalid topology blocks confirmation. No geometry repair,
clamping, wrapping or snapping is applied.

Inputs, pivot and results must remain within longitude ±180° and latitude
±85.0511287798066° (atan(sinh(π))). Dateline-jumping line segments and selections
spanning more than 180° longitude are unsupported. Result selections must meet the
same limits. Globe, terrain, geodesic and polar rotations are outside this contract.

## Public API

```ts
editor.selectMany(['parcel', 'route']);
if (editor.rotateSelection()) { // Optional explicit pivot: [4.895, 52.372].
  editor.setRotationAngle(30);  // Absolute clockwise angle, not another 30° per call.
  const preview = editor.getRotationPreview();
  if (editor.getState().canFinish) {
    const transaction = editor.finishRotation();
    console.log(preview, transaction);
  } else {
    console.log(editor.getState().rotationError);
    editor.cancel();
  }
}
```

- `rotateSelection(pivot?: Coordinate): boolean` starts `rotate-features` mode with
  angle zero. All supported line/polygon types, including holes and multipart
  wrappers, may participate. Empty/unsupported selections and an already active
  rotation return false. Another active tool throws. A malformed or out-of-range
  explicit pivot throws before entry; input coordinates are never mutated.
- `setRotationAngle(degrees): boolean` returns true when an active angle changes.
  No active rotation or an equivalent angle returns false. Non-numeric/nonfinite
  angles throw without changing the current preview. A well-formed angle whose
  result is invalid remains the active angle, with a diagnostic and no preview;
  a subsequent angle can correct it.
- `getRotationPreview(): GeometryFeatureCollection | null` returns an independent
  snapshot of selected output features in selection order, or null for an invalid
  result/inactive tool. Preview geometry is normalized through the same validation
  as commit. Reading it does not recalculate the rotation.
- State exposes `rotationAngle`, `rotationPivot` (an independent coordinate snapshot)
  and `rotationError`; all are null outside the mode. `canFinish` reports whether
  the entire result can commit. `getDraft()` stays empty; there are no vertex handles.
- `finishRotation(): TransactionEvent | null` revalidates the complete result and
  commits it atomically. Inactive/invalid calls return null; invalid review stays
  active. Unchanged confirmation exits and returns null without recording history.
- `finish()` uses the same path and returns the first selected result, including
  for an unchanged save. `finishRotation()` returns the complete change batch.

| Diagnostic | Meaning |
| --- | --- |
| `rotation-out-of-bounds` | Output leaves the supported Mercator world or exceeds the supported longitude span. |
| `rotation-invalid-result` | Result fails the normal geometry validator, including numerical collapse or invalid polygon topology. |

Consumers with exhaustive mode/state switches must handle `rotate-features` and
its state fields. Getters remain readable after destruction; commands and
subscriptions throw. The LineEditor compatibility facade does not expose rotation.

## Rendering, transactions and lifecycle

Only selected features participate. Unselected features remain unchanged and are
not checked for overlap or automatically linked. Exact shared input coordinates
receive the same transformation when their features rotate together. Vertex count,
geometry type, component/ring order, IDs, properties and collection positions remain
stable; polygon winding is normalized by the ordinary validator. Attribute values
such as stored area are not recalculated. No IDs are allocated.

A valid preview hides the selected originals and displays rotated geometry plus a
pivot marker. An invalid result shows the originals and marker. No committed-source
upload occurs while changing angles. Map panning, zoom and style replacement keep
the fixed pivot/geometry and reconstruct the preview. Feature dragging, selection,
vertex editing and competing data/history operations are blocked until finish/cancel.
Snapping and tracing settings have no effect on rotation.

A changed confirmation increments dataRevision once and emits one `onTransaction`
followed by `onChange`; no individual create/update/delete events. Undo/Redo emits
`onHistory` with action `transaction` and restores exact geometry, properties and
order. All public preview/state/event snapshots are independent. Cancellation and
unchanged confirmation preserve available Redo history and add no history entry.

Cancel, destruction and map removal discard the rotation. The prior cursor and
double-click zoom settings are restored when the map remains alive. Angle changes
validate synchronously and rendering is scheduled per animation frame. Large complex
polygons can still block the UI; see the [benchmark](performance.md#selection-rotation).
