# Offset selected lines

Select one or more open lines and choose **Offset lines**. Enter a signed
**Offset distance (Mercator meters)**: positive moves left of each component's
direction, negative moves right. The initial distance is 0, which preserves every
source coordinate exactly. The direction is from the first point toward the last;
reversing a line reverses its left/right sides. This sign convention also appears
in the [GEOS offset-curve API](https://libgeos.org/doxygen/classgeos_1_1operation_1_1buffer_1_1OffsetCurve.html).

**Apply offset** replaces the selected lines, retaining their IDs, properties and
order. One Undo restores all originals. To keep separate source lines, duplicate
them before offsetting. Cancel/Escape discards the preview; Enter applies while
the map has focus. Map shortcuts do not intercept text input. Empty/incomplete
numeric input disables Apply; leaving the field restores the last accepted value.
The [example fixture](../examples/basic/public/offset.geojson) has eastbound and
westbound routes for trying both sides.

## Supported input and distance units

This first version supports LineString and MultiLineString containing **simple,
open paths**. Components may cross each other, but an individual path must not
self-cross, self-touch, backtrack or close. Polygon, MultiPolygon and mixed
line/polygon selections are rejected as a whole. Input checks run both in
longitude/latitude and in the projected plane. Consecutive points that become
indistinguishable in projection are unsupported. Multipart wrappers, component
order, path direction and vertex counts are preserved.

Distances use spherical Web Mercator with radius 6,378,137 m:
`x = Rλ`, `y = R asinh(tan(φ))`. They are map-plane meters, not ground or geodesic
distances, and are independent of camera zoom, pitch and bearing. A source segment
is treated as straight between its projected endpoints. Input must lie within
longitude ±180° and latitude ±85.0511287798066°, without dateline-jumping segments
or selections spanning more than 180° longitude. Output must remain in that world
square. No wrapping, boundary clipping or automatic distance adjustment occurs.

## Corners, endpoints and validity

Each segment is shifted along its left unit normal by the signed distance.
Adjacent shifted supporting lines meet at a **miter (verstek)** corner. With unit
directions `u` and `v` and left normals `n(u)` and `n(v)`, the corner displacement
is `d × (n(u) + n(v)) / (1 + u·v)`. Straight-through vertices are retained.
The miter length may not exceed `4 × |d|`; an excessive join blocks the preview.
This fixed limit applies on both sides, including very small nonzero distances.
It does not fall back to bevels or rounded corners. Set zero or edit the original
line when an angle itself exceeds the limit.

Endpoints move perpendicular to their first/last segment, without extension or
caps. The operation creates a line, not an area. Every resulting segment must
still run forward along its corresponding source segment. Collapsed/reversed
segments and any self-crossing/touching output component block the entire
selection. Result validation also checks the inverse-projected GeoJSON path and
passes through ordinary transaction validation. Invalid review remains active
so the distance can be corrected or cancelled.

This is a restricted, miter-joined parallel-segment construction. It does not
extract a general offset curve from a buffer boundary, split loops into multiple
paths, remove components or trim intersections. It guarantees perpendicular
distance to each corresponding supporting line in the projected plane, subject
to floating-point roundoff. Miter tips may be farther from the nearest source
vertex; there is no constant nearest-distance guarantee to the entire source
geometry. Separate components/features remain independent and can intersect.
Inverse-projected GeoJSON connects vertices with longitude/latitude segments;
the distance guarantee does not apply continuously to those edges or geodesics.

Zero is an exact identity, including collinear vertices. Nonzero values compute
fresh coordinates from the frozen originals. At extreme scales tiny changes may
round away or fail validation. Cached area/length properties are not recalculated.
Closed lines, polygon offsets, round/bevel joins, arbitrary miter limits and
automatic loop trimming remain outside this first version.

## Public API

```ts
editor.selectMany(['outbound', 'return']);
if (editor.offsetSelection()) {
  editor.setOffsetDistance(-10); // Right of each line's own direction.
  const preview = editor.getOffsetPreview();
  if (editor.getState().canFinish) {
    const transaction = editor.finishOffset();
    console.log(preview, transaction);
  } else {
    console.log(editor.getState().offsetError);
    editor.cancel();
  }
}
```

- `offsetSelection(): boolean` enters `offset-lines` at distance zero. Empty or
  unsupported selections and an already active offset return false; another
  active tool throws. Unsupported selections leave state unchanged.
- `setOffsetDistance(meters: number): boolean` accepts finite signed numbers,
  including zero and negative zero. Nonnumeric/nonfinite values throw TypeError
  even when inactive and leave the current state/preview unchanged. Inactive or
  identical finite values return false. A finite distance with invalid output is
  accepted as the current setting but yields a diagnostic and no preview.
- `getOffsetPreview(): GeometryFeatureCollection | null` returns an independent
  validated collection in selection order, or null when inactive/invalid. Reads
  do not rerun calculations or allocate IDs.
- State exposes `offsetDistance` and `offsetError`, both null outside the mode.
  `offset-out-of-bounds` means generated coordinates leave the supported world;
  `offset-join-too-sharp` means a corner exceeds the fixed miter limit;
  `offset-invalid-result` means a segment collapses/reverses, a path intersects
  itself, or numeric/transaction validation fails. `canFinish` reports validity.
  `getDraft()` stays empty and there are no editable vertex handles.
- `finishOffset(): TransactionEvent | null` revalidates and replaces all changed
  selected features as one transaction. Invalid/inactive calls return null;
  invalid review remains active. An unchanged save exits with no history.
- `finish()` follows the same path and returns the first preview feature, even
  for unchanged confirmation. Use `finishOffset()` for the complete batch.

Consumers with exhaustive state/mode switches must handle the new fields and
mode. The LineEditor compatibility facade does not expose offsetting. Getters
remain readable after destruction; commands/subscriptions throw.

## History, rendering and lifecycle

Valid previews hide selected originals and show their replacements without a
pivot marker. Invalid results show originals. Preview updates never upload the
committed feature source. Camera changes and style replacement preserve or
reconstruct the same preview. Selection, drawing, editing and competing data or
history operations are blocked until finish/cancel. Snapping, tracing and drawing
constraints do not affect offset calculations.

A changed save increments dataRevision once and emits one `onTransaction` followed
by `onChange`, with no individual create/update/delete events. Undo/Redo emits
`onHistory` with action `transaction` and restores exact coordinates, identities,
properties and order. Cancel and unchanged confirmations preserve Redo. Preview,
state, event and return-value snapshots are isolated.

Cancel, destruction and map removal discard the preview and release owned
resources. Existing cursor and gesture settings are restored when the map remains
alive. Calculation/validation is synchronous; rendering is scheduled per animation
frame. Segment bounding boxes reduce intersection tests, but worst-case validation
remains quadratic. See the [benchmark](performance.md#line-offsets).
