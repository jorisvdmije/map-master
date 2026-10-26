# Reshape one polygon boundary

Select one Polygon **without holes**, then choose **Reshape polygon**. Click the
old boundary, draw a new route inside or outside the polygon, and click the old
boundary again. The orange preview shows the resulting polygon. **Other boundary**
switches which old boundary section is replaced. **Apply reshape** or Enter saves;
Cancel or Escape restores the original. Backspace/Delete removes the last route
point, including reopening a completed preview. One Undo restores the whole edit.
The demo provides a downloadable single-ring example.

## Boundary choice and supported geometry

The endpoints divide the old boundary into two arcs. By default the **shorter old
arc** is replaced; `longer` selects the other. Length means summed Euclidean segment
length in longitude/latitude coordinate units, not metres or geodesic distance.
Always inspect the preview. In equal-length cases the tie is deterministic: orient
the original ring CCW, order endpoints lexicographically by longitude then latitude,
and treat the forward arc from the first to the second as `shorter`. Reversing the
route, ring winding or ring start leaves the choice unchanged.

The new route must be simple, with two distinct endpoints on the boundary. Those
endpoints may be existing corners or lie within edges, including on the same edge.
Only the two endpoints may touch the old boundary. Self-crossings, backtracking,
intermediate boundary crossings/touches and following an old edge are rejected.
A route can enlarge or reduce the area, but cannot create holes, multiple parts,
empty output or a self-intersecting polygon. Result rings are closed and CCW.

This first version accepts exactly one single-ring Polygon. Lines, multi-selection,
polygons with holes and MultiPolygon features (even one-part ones) are ineligible.
Use the separate [shared-boundary](shared-boundaries.md) and [tracing](tracing.md) tools
for their supported workflows. Multipart reshape remains planned.

## Boundary and problem markers

Hollow green rings mark known contacts with the selected outer boundary. For a
split whose endpoints lie outside, these are the calculated crossings, not the
endpoints of the cutting line. A valid preview also keeps a faint original
outline visible. Split results use the two draft fill colors; reshape uses the
primary draft fill. The demo shows a contact count and legend beside its status.

Red dots and dashed red segments identify the first detected problem: a
self-crossing/backtrack, forbidden boundary contact, misplaced endpoint, or a
split through a hole. Extra boundary contacts are marked together. Correcting the
path replaces these markers; Apply stays disabled while the result is invalid.
These diagnostics use placed points only. Hover still previews the next segment
without changing validation or committing it.

`editor.getCutFeedback()` returns an independent `CutFeedback` snapshot:

```ts
const feedback = editor.getCutFeedback();
// null outside split/reshape; otherwise:
// { contacts: Coordinate[], problemPoints: Coordinate[],
//   problemSegments: Coordinate[][] }
```

Read it from `onChange` alongside `splitError` or `reshapeError`. Contacts may be
partial when validation stops early; they are not a second validity test. A cut
missing the polygon entirely or a numerical/topology failure may have no reliable
problem location. Such failures keep their explanatory status text without
inventing a marker. Empty problem arrays do not imply that Apply is available.
Markers do not change snapping, saved GeoJSON or history. They follow the map
camera, survive style replacement, and clear on cancel, apply, lock revocation
or destruction. Diagnostic red/green colors are currently fixed; result fills
and the original contour use the existing appearance settings.

## Public API

```ts
editor.select('garden');
if (editor.reshapeSelected()) {
  // First/last coordinates must already lie on the selected outer boundary.
  editor.setReshapePath([
    [4.888, 52.370], [4.890, 52.3715], [4.892, 52.370],
  ]);
  editor.setReshapeSide('shorter'); // Or 'longer'; default resets on each entry.
  const preview = editor.getReshapePreview(); // ReshapePreview | null
  if (editor.getState().canFinish) {
    const transaction = editor.finishReshape(); // TransactionEvent | null
    console.log(transaction);
  } else {
    console.log(editor.getState().reshapeError);
    editor.removeReshapePoint(); // Same correction as Backspace.
    editor.cancel();
  }
}
```

`reshapeSelected()` returns false for ineligible selection or an already active
reshape. Another active tool causes an error; finish or cancel it first. Entry
preserves selection and starts an empty route in `reshape-polygon` mode.
`setReshapePath()` replaces the entire route. It validates array structure and
finite, in-range 2D positions before changing state; malformed input throws without
losing the old draft. A well-formed but geometrically invalid path remains visible
with a diagnostic and cannot be committed. `setReshapeSide()` accepts only `shorter`
or `longer`; it recalculates the preview without changing stored data.

`getDraft()` returns the clicked/programmatic route, not the result boundary.
`getReshapePreview()` returns an independent cached Polygon geometry or null for
incomplete/invalid/inactive reshape. `reshapeError` and `reshapeSide` are null
outside this tool. `validationError` and `splitError` stay null during reshape.
Getters remain readable after destruction; commands/subscriptions throw.
LineEditor does not expose reshape.

`finishReshape()` commits one update through the transaction boundary and returns
its complete event. Inactive/invalid review returns null; invalid review stays
active. `finish()` also confirms and returns the resulting feature. An unchanged
prepared update exits without a data event, revision increment or history action;
`finishReshape()` then returns null and `finish()` returns the unchanged feature.

## Mouse attachment and preview

An attachment indicator acquires only the selected polygon's corners/edges within
18 CSS pixels, with corner priority. Attachment stays enabled regardless of general
snapping settings or Alt; it is required to connect the route. A first click away
from the target boundary is ignored. Away from that boundary, intermediate points
use normal snapping settings; Alt bypasses that optional snapping.

Projected edge snapping is mapped back to the core's planar longitude/latitude
segment and its actual screen distance is checked again. Camera changes rebuild
the target-only index. For long oblique edges, the displayed Mercator segment and
planar segment can differ; a point beyond the attachment radius is refused.
The API does not apply this pixel radius: it accepts only boundary endpoints,
allowing up to `64 * Number.EPSILON * max(1, abs(lng), abs(lat))` coordinate units
for construction roundoff. Such endpoints are projected onto the boundary; this
is not a user-defined precision or repair tolerance.

Only clicked points affect validity. Pointer motion shows a rubber band while
constructing the route. Once valid, the preview freezes and further map clicks
are ignored until Backspace/Delete reopens the route. The side button and API
can still change it. A valid preview hides the committed original; incomplete or
invalid routes leave it visible. Preview borders use the existing explicit dots.
Pan/zoom remain available and style replacement reconstructs the preview.

## Identity, transactions, Undo and lifecycle

ID, properties (including null), selection and collection position are preserved.
No ID is allocated, no other feature is changed, and stored area attributes are
not recalculated. Confirmation revalidates the result before any mutation. Failure
preserves original data, history and preview.

A changed confirmation increments `dataRevision` once, uploads committed data once,
and emits one `onTransaction` followed by `onChange`; no individual create/update/
delete event. Undo/Redo emits `onHistory` with action `transaction` and restores
exact coordinates, properties and order. Public snapshots and listener payloads
are independent. Preview and cancellation create no data-change event/history;
cancellation preserves an available Redo action.

Data, selection, history and competing tool commands are locked during review.
Cancel, destroy and map removal discard the route and release owned resources.
Cursor and double-click zoom settings are restored when the map remains alive.
Consumers with exhaustive state switches must handle `reshape-polygon`,
`reshapeError` and `reshapeSide`.

| `reshapeError` | Meaning |
| --- | --- |
| `reshape-too-few-points` | Fewer than two route points. |
| `reshape-endpoints-off-boundary` | First or last point does not attach to the boundary. |
| `reshape-same-endpoint` | Both attachments coincide. |
| `reshape-self-intersection` | Route crosses/touches itself, repeats points or doubles back. |
| `reshape-boundary-touch` | Route touches, crosses or overlaps the old boundary away from allowed attachments. |
| `reshape-antimeridian` | A route segment spans more than 180° longitude. |
| `reshape-invalid-result` | Nonfinite/out-of-range construction or invalid final ring. |

The calculation uses robust orientation predicates and floating-point coordinates
under the editor's existing planar geometry policy. There is no geodesic reshape,
reprojection, automatic repair or guarantee for dateline/polar/globe/terrain use.
Validation runs on path edits or side changes, never on pointer motion/state reads.
It is synchronous and may be quadratic; see the [benchmark](performance.md#polygon-reshape).
