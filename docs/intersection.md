# Keep the common area (intersection)

Select at least two Polygon/MultiPolygon features and choose **Intersect polygons**.
The orange preview shows the filled area shared by **every** selected feature.
**Apply intersection** or Enter with map focus replaces the inputs with that area.
Cancel or Escape preserves the originals. The demo includes a downloadable
three-polygon example; select all three with Shift+click.

The first selected feature retains its ID, properties and collection position.
Other selected features are deleted on confirmation. If there is no common area,
the preview explicitly warns that confirmation deletes **all selected features**.
One Undo restores every original. This follows union's replacement policy;
[difference](difference.md) instead preserves its cutting features.

## Public API

```ts
editor.selectMany(['west', 'east', 'south']);
if (editor.intersectionSelection()) {
  const preview = editor.getIntersectionPreview(); // IntersectionPreview | null
  if (preview) {
    // geometry === null is valid empty output, not a failed calculation.
    const transaction = editor.finishIntersection(); // TransactionEvent | null
    console.log(transaction);
  } else {
    console.log(editor.getState().intersectionError);
    editor.cancel();
  }
}
```

`intersectionSelection()` returns false for fewer than two features, any selected
line, or an already active intersection. Another active tool causes an error;
finish or cancel it first. No selected feature is silently ignored. Eligible
selections enter `intersection-polygons` mode even if calculation fails.

`getIntersectionPreview()` returns an independent cached snapshot:

| Result | Meaning |
| --- | --- |
| `null` | Inactive operation or failed calculation/validation. |
| `{ geometry: null }` | Valid empty intersection; confirmation deletes all inputs. |
| `{ geometry: Polygon \| MultiPolygon }` | Common filled area; confirmation replaces the inputs. |

`canFinish` is true for valid empty and nonempty results. `finishIntersection()`
returns the complete transaction, or null for inactive/invalid review. Invalid
review stays active. Successful confirmation always changes data, because at least
one selected feature is deleted, even for identical or contained inputs.
`finish()` also confirms, returning the retained feature or null for valid empty
output. Use transaction/history events for persistence: a null `finish()` return
alone does not indicate failure. Getters remain readable after destruction;
commands and subscriptions throw. LineEditor does not expose intersection.

| `intersectionError` | Meaning |
| --- | --- |
| `null` | Inactive operation or valid result, including empty. |
| `intersection-failed` | The overlay engine threw during calculation. |
| `intersection-invalid-result` | Nonempty output violates coordinate or topology policy. |

## Geometry and numerical contract

Intersection computes `A ∩ B ∩ C …`, not `A ∩ (B ∪ C …)`. Each MultiPolygon is one
operand: its components are alternative filled areas, not separate constraints.
Holes remove area from their operand. The result may contain holes or disconnected
components. Disjoint inputs, shared edges, point contact and overlap wholly inside
a hole yield empty output when there is no common filled area. Lines and points
are never created as intersection results.

Nonempty output uses closed CCW exterior rings and clockwise holes. A single
component becomes Polygon, multiple components become one MultiPolygon feature.
Ring starting positions, component order and redundant collinear vertices may
change, including for identical inputs. There is no exact-representation no-op
rule. All final nonempty results pass the same strict topology validation as import,
union and difference. Touching component/hole boundaries are rejected. Only the
final result is validated: a later input can remove an unsupported contact in an
intermediate result.

The [union numerical contract](union.md#geometry-and-numerical-contract) applies:
planar longitude/latitude, floating-point intersections, no user precision grid,
reprojection, geodesic overlay or automatic repair. Poorly conditioned inputs can
fail rather than be approximated. Mathematically selection order does not change
the common area, but floating-point construction may produce rounding differences;
selection order always determines the retained identity/properties.

`core/intersection.ts` uses the existing `polygon-clipping` 0.15.7 (MIT) dependency
and shared `core/polygon-overlay.ts` normalization. It intersects operands in
selection order, two at a time, and stops once the result is empty. This avoids
spreading an unbounded selection into function arguments. It runs synchronously
once at entry; getters, pointer movement and camera changes never recalculate it.
See the [benchmark](performance.md#polygon-intersection) for workload limits.

## Identity, events, Undo and lifecycle

- No new ID is allocated. The first selected feature keeps its properties, including
  null, for nonempty output. Stored area attributes are not recalculated.
- Unrelated features retain their exact coordinates, IDs, properties and order.
- Confirmation prepares one transaction containing an optional retained-feature
  update and all deletions. Unchanged retained geometry is omitted from the batch.
  Validation completes before mutation; failure leaves preview, data, selection
  and history intact.
- Success increments `dataRevision` once, uploads committed geometry once, and
  emits one `onTransaction` followed by `onChange`. It emits no individual create,
  update or delete events. Returned/listener snapshots are isolated.
- Undo/Redo emits `onHistory` with action `transaction` and restores exact shapes,
  properties and collection order. Selection is UI state outside history: the
  retained ID stays selected; removed IDs are not reselected by Undo.
- Preview, failure and cancellation create no data event or history entry. Cancel
  preserves selection and an available Redo action.

During review, data/selection/history commands and other tools are locked.
Drafts stay empty, clicks/Backspace cannot edit vertices, and snapping stays idle.
Pan and zoom remain available. A valid preview hides every input, even for empty
output; calculation failure leaves originals visible. Style replacement rebuilds
the preview. Cancel, destroy and map removal clean up the overlay and restore owned
map gesture settings when the map is alive.

Consumers with exhaustive mode switches must add `intersection-polygons` and
account for the new `intersectionError` state field.
