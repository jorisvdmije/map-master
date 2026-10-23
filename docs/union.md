# Merge selected polygons (union)

Select at least two Polygon or MultiPolygon features and choose **Merge polygons**.
The orange preview shows their combined filled area. **Apply merge** or Enter
with map focus commits it; **Cancel** or Escape restores the originals. The demo
includes a downloadable overlapping-polygon example with a hole. Use Shift+click
to select both inputs.

## Public API

```ts
editor.selectMany(['west', 'east']); // Acquisition order determines the retained ID.
if (editor.unionSelection()) {
  const preview = editor.getUnionPreview(); // UnionPreview | null
  const { canFinish, unionError } = editor.getState();
  if (canFinish) {
    const transaction = editor.finishUnion(); // TransactionEvent | null
    console.log(transaction);
  } else {
    console.log(unionError);
    editor.cancel();
  }
}
```

`unionSelection()` returns false for fewer than two selected features, a selection
containing a line, or an already active union. It never silently ignores a selected
feature. Another active tool causes an error; finish or cancel it first. An eligible
selection enters `union-polygons` mode even if calculation fails: inspect
`unionError`, cancel, adjust the inputs and retry.

The cached `getUnionPreview()` is an independent Polygon/MultiPolygon geometry
snapshot without an ID. Reading state or moving the pointer never recalculates the
overlay. `finishUnion()` returns null unless a valid union preview is active.
`finish()` also confirms and returns the retained feature. Prefer `finishUnion()`
when synchronizing every change. Getters remain readable after destruction;
commands and subscriptions throw. LineEditor does not expose polygon union.

During review, selection, import, history, deletion and other editing tools are
locked. `canUndo`/`canRedo` are false, `getDraft()` is empty and clicks do not add
vertices. `validationError` and `splitError` stay null. Map panning and zooming
remain available; style replacement reconstructs the preview. Only a valid preview
hides the input features. Failure leaves their committed shapes visible. Cancel,
destroy and map removal discard the preview; gesture settings and cursor are
restored when the map remains alive.

## Geometry and numerical contract

- Overlapping polygons and polygons sharing an edge can dissolve into one Polygon.
- Disconnected filled areas produce one MultiPolygon feature. A one-part result
  is a Polygon, including when an input was a MultiPolygon.
- Holes survive wherever no input fills them. Union can partly or completely fill
  a hole, create new holes, or retain an island strictly inside a hole.
- Output uses closed CCW exterior rings and clockwise holes. Redundant collinear
  vertices may disappear and ring starting positions/component order may change.
- Every result passes the same strict topology validator used by import and edits.
  Boundaries of separate parts or holes may not touch. A union with only a point
  of contact is rejected, even though broader GeoJSON implementations may accept it.

Calculations use planar longitude/latitude segments and floating-point intersection
coordinates, consistent with the current editor. There is no user-defined precision
grid, geodesic overlay, snapping, reprojection or automatic repair. Very small or
poorly conditioned geometry may fail instead of being approximated by this adapter.
The engine itself performs its documented floating-point rounding; robust predicates
do not make constructed intersections exact. Dateline-crossing edges, polar
geometry and globe/terrain projection guarantees remain outside the supported scope.
The simplified output can introduce an edge longer than 180 degrees even if the
inputs contain only shorter edges; that result is rejected too.

| `unionError` | Meaning |
| --- | --- |
| `null` | A valid preview, or no active union. |
| `union-failed` | The overlay engine could not calculate the result. |
| `union-invalid-result` | Empty output, nonfinite/out-of-range positions, or topology outside the supported subset. |

The internal `core/union.ts` adapter uses
[`polygon-clipping` 0.15.7](https://github.com/mfogel/polygon-clipping/tree/v0.15.7)
(MIT) for polygon overlay. Its transitive dependencies are `splaytree` (MIT) and
`robust-predicates` (Unlicense, also used directly for validation). Versions resolve
through the lockfile. No engine-specific types or configuration enter the public API.

## Identity, properties, events and Undo

The **first selected feature** retains its ID, properties (including null), and
position relative to surviving features. All other selected features are deleted.
Unrelated features remain unchanged. No ID is allocated. Properties are not merged:
domain identifiers, names and precomputed area values come from the retained feature
and are not recalculated. Applications must choose selection order and property
updates appropriate to their domain.

Confirmation prepares one update plus deletions through the existing transaction
boundary. An unchanged retained feature is omitted from the change list; identical
or contained inputs still create one history action for their deletions. Final
validation failure preserves the original data, selection, history and preview.

One successful confirmation increments `dataRevision` once, uploads committed
geometry once and emits one `onTransaction`, followed by `onChange`. It emits no
individual `onCreate`, `onUpdate` or `onDelete` events. The remaining selected ID is
the retained feature. Preview, failure and cancellation emit no data-change event.
Returned snapshots and listener payloads are independent from stored data.

Undo/Redo emits `onHistory` with action `transaction` and restores exact coordinates,
IDs, properties and collection order for the whole batch. Selection is UI state and
is not recorded in history: Undo restores the removed features without selecting
them again. Cancel preserves a previously available Redo action. Consumers must
subscribe to both transaction and history events for persistence.

The calculation is synchronous and result validation can be quadratic. See the
[fixed-dataset benchmark](performance.md#polygon-union) before choosing selection
size limits. [Difference](difference.md) is available as a separate operation; intersection remains planned.
