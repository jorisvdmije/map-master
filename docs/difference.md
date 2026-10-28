# Subtract selected polygons (difference)

Select the **target first**, then Shift+click one or more cutting polygons. Choose
**Subtract polygons**, inspect the orange remaining target area and choose **Apply
subtraction** (or Enter with map focus). The blue cutting polygons are kept.
Cancel or Escape leaves all originals untouched. The demo includes a downloadable
subtraction example with a target hole.

Selection order matters: `A − B` is different from `B − A`. The demo shows the first
selected ID before entry and identifies it as the target during review. If all
area is removed, the demo explicitly says confirmation will delete that target.

## Public API

```ts
editor.selectMany(['target', 'cutter-a', 'cutter-b']);
if (editor.differenceSelection()) {
  const preview = editor.getDifferencePreview(); // DifferencePreview | null
  if (preview) {
    // preview.geometry === null is a valid empty result: target deletion.
    // Otherwise geometry is a Polygon or MultiPolygon.
    const transaction = editor.finishDifference(); // TransactionEvent | null
    console.log(transaction);
  } else {
    console.log(editor.getState().differenceError);
    editor.cancel();
  }
}
```

`differenceSelection()` returns false for fewer than two selected features, any
selected line, or an already active difference. Another active tool causes an
error: finish or cancel it first. An eligible selection enters `difference-polygons`
mode even when calculation fails. Selection is frozen for the entire review.

`getDifferencePreview()` returns an independent cached snapshot:

| Result | Meaning |
| --- | --- |
| `null` | No active difference, or calculation/validation failed. |
| `{ geometry: null }` | Valid empty result; confirmation deletes only the target. |
| `{ geometry: Polygon \| MultiPolygon }` | Remaining target area; confirmation updates only the target. |

`canFinish` is true for both nonempty and empty valid results. `finishDifference()`
returns the complete committed transaction, or null for inactive/invalid review or
a no-op. A no-op **exits** review; an invalid preview stays active. `finish()` also
confirms: it returns the updated/unchanged target, or null for target deletion or
an inactive/invalid operation. Use `finishDifference()` and transaction/history
events for persistence; a null `finish()` return alone does not mean failure.

`differenceError` is null outside the tool and for valid results, including empty.
`difference-failed` means the overlay engine threw; `difference-invalid-result`
means its nonempty result violates the supported coordinate or topology policy.
Getters remain readable after destruction; commands and subscriptions throw.
LineEditor does not expose subtraction.

## Geometry and numerical contract

The operation computes the target minus the combined filled areas of all cutters.
Overlapping cutters remove their overlap only once. Polygon and MultiPolygon
inputs can create holes, open existing holes into the exterior, split the target
into separate parts, or remove it completely. Holes in cutting polygons leave
those areas of the target intact, potentially as islands.

Changed output uses closed CCW outer rings and clockwise holes. A changed one-part
result becomes Polygon; disconnected pieces become one MultiPolygon feature with
the target's ID. Simplification, ring starting positions and component order can
change. All nonempty results pass the same strict validator as import and union:
self-intersections and touching hole/component boundaries are rejected.

There is a deliberate no-op rule: disjoint cutters, shared edges, point contact,
and cutters inside existing holes preserve the target's **exact** geometry,
including redundant vertices, ring starting positions and a one-part MultiPolygon
representation. The engine's filled-area intersection detects this before
subtraction. No-op confirmation preserves revision, Undo and Redo history.

The existing [union numerical contract](union.md#geometry-and-numerical-contract)
also applies: planar longitude/latitude, floating-point intersections, no user
precision grid, reprojection, geodesic overlay or automatic repair. Dateline and
polar guarantees remain outside scope. Poorly conditioned inputs can fail rather
than be approximated. `polygon-clipping` 0.15.7 (MIT) supplies the intersection
check and difference calculation through `core/difference.ts`; shared
`core/polygon-overlay.ts` validates and normalizes nonempty output. No new runtime
dependency or engine-specific public type is introduced.

## Identity, events and Undo

- The first selected feature keeps its ID, properties (including null), and
  collection position unless completely removed. No ID is allocated.
- All cutting features and unrelated features retain exact geometry, properties,
  IDs and collection order. Properties such as stored area are not recalculated.
- A changed confirmation creates one update or deletion in one transaction,
  increments `dataRevision` once and uploads committed geometry once. It emits
  `onTransaction`, followed by `onChange`; no individual create/update/delete event.
- No-op confirmation emits only `onChange` to report leaving review. Preview,
  cancellation and failure create no data event or history entry.
- Undo/Redo emits `onHistory` with action `transaction` and restores exact stored
  shapes, properties and order. Selection is not part of history. Surviving selected
  IDs stay selected; a deleted target is removed from selection and Undo does not
  reselect it. Cancel keeps selection and a previously available Redo action.

Transaction validation completes before any mutation. A failure at confirmation
preserves data, history, selection and preview. Snapshots and event payloads are
isolated from the store and other listeners.

During review, data/selection/history commands and other tools are locked. Clicks
and Backspace do not add/remove vertices, drafts stay empty, and snapping is idle.
Map panning/zooming remain available. Style replacement rebuilds the preview. Only
a valid preview hides the committed target (even for an empty result); cutters
remain visible. Cancel/destroy/map removal discard the preview and restore owned
gesture settings when the map remains alive.

The calculation is synchronous and runs once at tool entry; state reads and
pointer/camera movement do not recalculate it. See the [difference benchmark](performance.md#polygon-difference)
for measurement methodology and limits before choosing application workload caps.
