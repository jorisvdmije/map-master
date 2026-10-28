# Scale selected shapes

Select one shape, or several with Shift+click, and choose **Scale selection**.
The frame has eight mouse handles, all scaling around the chosen white pivot:

- Drag a **corner** to scale both axes proportionally, preserving the current aspect ratio.
- Drag the **left or right side** to change only the horizontal size.
- Drag the **top or bottom side** to change only the vertical size.
- Release to review. **Apply scale** or Enter saves the entire selection in one Undo step.
- Escape during dragging restores the factors at the start of that drag. Escape again cancels the session.

The frame and handles stay attached to the preview. The faint outline shows the
original geometry. Factor labels show horizontal × vertical percentages. Dragging
past the pivot keeps the last positive preview; it never reflects the geometry.
Camera gestures are suspended while dragging and restored on release. Blur,
capture loss, pointer cancellation and camera/style changes roll back only the
active drag. Enter during a drag is ignored.

Tab to a handle and use arrows to enlarge (Up/Right) or shrink (Down/Left) its
axis by a factor of 1.01; Shift uses 1.1. Enter applies, Escape cancels. Handles
have 28 CSS-pixel targets. Handles for collapsed dimensions, or within 10 screen
pixels of the pivot, are disabled. A side handle aligned with the pivot on its
scaling axis is also disabled; use the opposite side or numeric input. For very small or off-screen shapes, zoom/pan
or use the numeric inputs. Mouse dragging is supported; touch dragging is not.

**Scale factor** sets both axes to the same positive value: 1 keeps the original
size, 0.5 halves it, and 2 doubles it. **Horizontal scale factor** and **Vertical
scale factor** change each axis independently. The uniform field shows “Mixed axes”
when the factors differ. Half size / Double size multiply both current factors,
keeping their ratio. Invalid/incomplete input blocks Apply until corrected or
restored on blur. Shortcuts do not intercept text entry.

Drag **⊕** to move the pivot. The demo's **Fixed scale anchor** selector can fix
a corner of the original Mercator bounding box: drag the opposite handle to
resize around it. North/south/east/west refer to map axes even with bearing/pitch.
The anchor stays fixed until explicitly changed. Reflection remains unsupported.

## Moving the pivot

Drag **⊕** to choose a new geographic pivot, or Tab to it and use arrow keys for
1 screen-pixel steps (Shift: 10 pixels). **Home** restores the original bounds
centre. Keyboard nudges bypass snapping for precise placement. The pivot may lie
outside the selection; off-screen pivots can be recovered with the demo's centre
control or the API.

Moving the pivot retains the current factors and recomputes the preview from
the frozen originals. The preview can move as a result: this does not rebase or
reset the transformation. At the identity transformation, moving only the pivot
leaves geometry exactly unchanged and creates no Undo entry. A selected scale
corner is a corner of the original bounds, not a moving corner of the preview.

With snapping enabled, pivot dragging snaps to the nearest original selected
vertex or the original projected bounds centre within `snapping.distance` CSS
pixels. Original vertices include holes and multipart components. Vertices win
exact ties with the centre. `snapping.vertices: false` disables vertex targets;
the centre remains available. Edge snapping, unselected features and transformed
preview vertices are not pivot targets. **Alt** bypasses snapping; changing Alt
or snapping options refreshes an active drag without another pointer move. The
pivot label identifies the current target. These local pivot targets do not
emit the drawing/vertex `onSnap` event.

Release keeps the preview open. Enter/Apply commits the entire session in one
Undo step. Escape during a pivot drag restores its starting pivot and preview;
Escape again cancels the session. Enter during dragging is ignored. Blur, lost
capture, pointer cancellation and camera/style changes roll back only that drag.
Camera gestures and the cursor are restored. API pivot/factors changes stop
active input so a late release cannot replace the new value. Feature locks,
cancellation, destruction and map removal release the pivot handle and capture.

## Coordinate and factor policy

Scaling follows the horizontal (east/west) and vertical (north/south) axes of the
spherical Web Mercator plane, using x = λ and
y = asinh(tan(φ)) for longitude/latitude in radians. For pivot (cx, cy) and
factors fx and fy, x′ = cx + fx(x − cx), y′ = cy + fy(y − cy). The inverse uses λ = x
and φ = atan(sinh(y)). The default pivot is the centre of the combined projected
bounding box, calculated once on entry. An explicit longitude/latitude pivot
may lie outside the selection. Camera changes do not affect the result. The scale frame follows these map axes;
with bearing or pitch it is projected with the map, rather than redefining the
transformation along screen axes. With a north-up, unpitched map it is horizontal
and vertical.

The factor is absolute relative to frozen entry geometry. Repeated changes do
not compound transformations or drift. Both factors at 1 copy the originals exactly,
without a projection round trip. An unchanged axis retains its original coordinate exactly. The pivot itself remains exact. Every factor
must be finite and greater than zero; zero and negative values throw before
changing the preview. Very small positive factors may collapse vertices through
floating-point rounding; very large factors may overflow. These results cannot
be saved. There is no clamping, geometry repair, snapping or world wrapping.

Equal factors scale distances uniformly in the projected plane, not ground distances
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
  editor.setScalePivot([4.895, 52.372]); // Or omit the argument to reset the centre.
  editor.setScaleFactors(1.5, 0.75); // Width ×1.5, height ×0.75.
  // editor.setScaleFactor(1.5) sets both axes to 1.5.
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
- `setScaleFactors(horizontal: number, vertical: number): boolean` sets independent
  absolute factors with the same validation and return policy. Both arguments
  are validated before any state changes. Invalid geometry can be corrected by
  another factor update; it cannot be committed.
- `setScalePivot(pivot?: Coordinate): boolean` retains the current factors and
  recalculates the preview from the original selection. Omit the argument to
  restore the original projected bounds centre. Returns false when inactive or
  unchanged. Malformed coordinates throw TypeError; coordinates outside the
  supported world throw RangeError, even when inactive. Arguments and state
  snapshots are copied. A valid pivot producing invalid geometry remains active
  with a diagnostic; moving/resetting the pivot can recover it.
- `getScalePreview(): GeometryFeatureCollection | null` returns an independent
  snapshot in selection order, or null when inactive/invalid. Preview geometry
  matches the validated commit geometry. Reads do not recalculate the result.
- State exposes `scaleFactorX`, `scaleFactorY`, `scalePivot` (an independent
  coordinate snapshot) and `scaleError`; all are null outside scaling.
  `scaleFactor` is the common factor when both axes are equal, otherwise null. `canFinish` reports validity.
  `getDraft()` stays empty; scale handles are separate from vertex editing.
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
and tracing do not change scale factors; pivot snapping is described above.

Changed confirmation increments dataRevision once and emits one `onTransaction`
followed by `onChange`, without individual create/update/delete events. Undo/Redo
emits `onHistory` with action `transaction` and restores exact geometry, properties
and order. Public snapshots are independent. Cancel and unchanged confirmation
preserve Redo history and add no history entry.

Cancel, destruction and map removal discard the preview. The prior cursor and
double-click zoom settings are restored when the map remains alive. Factor changes
validate synchronously; rendering is scheduled per animation frame. Large complex
polygons can block the UI; see the [benchmark](performance.md#selection-scaling).
