# Scale selected shapes

Select one shape, or several with Shift+click, and choose **Scale selection**.
Enter a positive **Scale factor**: 1 keeps the original size, 0.5 halves it, and
2 doubles it. The Half size / Double size buttons multiply the current factor.
All selected lines and polygons scale together around the white pivot marker.
**Apply scale** saves the preview; Cancel discards it. With the map focused,
Enter applies and Escape cancels. One Undo restores the entire selection.

The demo restores the last preview factor when invalid or incomplete input loses
focus. Apply is disabled while that input is invalid. Map shortcuts do not
intercept typing in the field. Numeric controls and the API are available;
drag handles, interactive pivot movement, separate axis factors and reflection
are outside this first version.

## Coordinate and factor policy

Scaling is uniform in the spherical Web Mercator plane, using x = λ and
y = asinh(tan(φ)) for longitude/latitude in radians. For pivot (cx, cy) and
factor f, x′ = cx + f(x − cx), y′ = cy + f(y − cy). The inverse uses λ = x
and φ = atan(sinh(y)). The default pivot is the centre of the combined projected
bounding box, calculated once on entry. An explicit longitude/latitude pivot
may lie outside the selection. Camera changes do not affect the result.

The factor is absolute relative to frozen entry geometry. Repeated changes do
not compound transformations or drift. Factor 1 copies the originals exactly,
without a projection round trip. The pivot itself remains exact. Every factor
must be finite and greater than zero; zero and negative values throw before
changing the preview. Very small positive factors may collapse vertices through
floating-point rounding; very large factors may overflow. These results cannot
be saved. There is no clamping, geometry repair, snapping or world wrapping.

This scales distances uniformly in the projected plane, not ground distances
or geographic area. It transforms stored vertices without inserting intermediate
points. Straight-edge interpretations in longitude/latitude and Mercator can
differ; polygon topology is checked with the editor's ordinary planar validator.

Inputs, pivot and results must stay within longitude ±180° and latitude
±85.0511287798066°. Dateline-jumping segments and selections spanning more than
180° longitude are unsupported. Result selections must meet the same limits.
Terrain, globe, polar and geodesic scaling are outside this contract.

## Public API

```ts
editor.selectMany(['parcel', 'route']);
if (editor.scaleSelection()) { // Optional explicit pivot: [4.895, 52.372].
  editor.setScaleFactor(1.5);
  const preview = editor.getScalePreview();
  if (editor.getState().canFinish) {
    const transaction = editor.finishScale();
    console.log(preview, transaction);
  } else {
    console.log(editor.getState().scaleError);
    editor.cancel();
  }
}
```

- `scaleSelection(pivot?: Coordinate): boolean` enters `scale-features` mode at
  factor 1. Supports LineString, Polygon (including holes), MultiLineString and
  MultiPolygon. Empty/unsupported selections or an already active scale return
  false. Another active tool throws. Malformed or out-of-range explicit pivots
  throw before entry. Inputs are never mutated.
- `setScaleFactor(factor: number): boolean` returns true when an active factor
  changes; inactive or identical factors return false. Non-numeric/nonfinite
  factors throw TypeError; nonpositive factors throw RangeError, including when
  inactive. A valid factor with an invalid geometric result becomes the active
  factor, with a diagnostic and no preview. A subsequent factor can correct it.
- `getScalePreview(): GeometryFeatureCollection | null` returns an independent
  snapshot in selection order, or null when inactive/invalid. Preview geometry
  matches the validated commit geometry. Reads do not recalculate the result.
- State exposes `scaleFactor`, `scalePivot` (an independent coordinate snapshot)
  and `scaleError`; all are null outside scaling. `canFinish` reports validity.
  `getDraft()` stays empty; there are no vertex handles.
- `finishScale(): TransactionEvent | null` revalidates and commits the whole
  selection atomically. Inactive/invalid calls return null; invalid review stays
  active. Unchanged confirmation exits without a history entry and returns null.
- `finish()` uses the same path and returns the first selected result, including
  for unchanged confirmation. `finishScale()` returns the complete change batch.

| Diagnostic | Meaning |
| --- | --- |
| `scale-out-of-bounds` | Result leaves the supported Mercator world or exceeds the supported longitude span. |
| `scale-invalid-result` | Geometry fails validation, including numerical collapse or invalid polygon topology. |

Consumers with exhaustive mode/state switches must handle `scale-features` and
its fields. Getters remain readable after destruction; commands and subscriptions
throw. The LineEditor compatibility facade does not expose scaling.

## Rendering, transactions and lifecycle

Only selected geometry participates; unselected neighbours are not linked or
checked for overlap. Shared input coordinates receive exactly the same transform
when their features scale together. Vertex count, geometry type, component/ring
order, IDs, properties and collection positions stay stable. Polygon winding is
normalized by the ordinary validator. Stored area/length attributes are not
recalculated, and no IDs are allocated.

A valid preview hides selected originals and shows the scaled geometry and pivot.
An invalid result shows originals and pivot. Changing factors never uploads the
committed feature source. Style replacement reconstructs the preview; pan, zoom
and bearing keep the fixed geographic result. Selection, dragging, vertex editing
and competing data/history operations are blocked until finish/cancel. Snapping
and tracing settings do not affect scaling.

Changed confirmation increments dataRevision once and emits one `onTransaction`
followed by `onChange`, without individual create/update/delete events. Undo/Redo
emits `onHistory` with action `transaction` and restores exact geometry, properties
and order. Public snapshots are independent. Cancel and unchanged confirmation
preserve Redo history and add no history entry.

Cancel, destruction and map removal discard the preview. The prior cursor and
double-click zoom settings are restored when the map remains alive. Factor changes
validate synchronously; rendering is scheduled per animation frame. Large complex
polygons can block the UI; see the [benchmark](performance.md#selection-scaling).
