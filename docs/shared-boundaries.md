# Edit a shared polygon boundary

Select two adjoining polygons with Shift+click, then choose **Edit shared boundary**.
Click or drag a small midpoint to insert a corner, drag an interior corner to move
it, and use **Remove vertex** or Delete/Backspace to remove a selected corner.
The grey endpoints stay fixed. Both polygon previews change together.
**Save both polygons** or Enter commits; Cancel/Escape discards the draft.
One Undo restores both originals. The demo's shared-boundary example supplies two
eligible parcels; download and import it to try this workflow.

## Supported geometry

This first version accepts exactly two Polygon features without holes. They must
share one complete, contiguous chain of edges, with exactly matching coordinates
and segmentation on both sides. Ring winding, ring start and selection order may
differ. Point-only contact, gaps, overlapping interiors, identical polygons,
disconnected shared chains, additional isolated contacts and differently segmented
shared edges are rejected. There is no tolerance, automatic noding or repair.
MultiPolygon features are ineligible, including ones containing only one part.

The two junctions at the ends of the chain cannot move or be removed. Interior
vertices may be added, moved or removed, including simplifying the chain to one
edge. The remaining outer boundaries stay fixed. Both results must pass polygon
validation and their filled areas must not overlap. Results have closed CCW rings;
the old ring start is retained when that coordinate survives the edit.

Only the two selected polygons participate. Other features are neither changed
nor checked for overlaps or shared topology. Saving establishes no persistent
topological link: later ordinary vertex edits can separate the polygons again.
Calculations use the existing planar 2D longitude/latitude policy, without geodesic,
dateline, globe or terrain guarantees.

## Public API

```ts
editor.selectMany(['west', 'east']);
if (editor.editSharedBoundary()) {
  // Coordinates for the demo fixture; index 1 lies between the fixed endpoints.
  editor.insertVertex(1, [4.891, 52.3725]);
  const preview = editor.getSharedBoundaryPreview();
  if (editor.getState().canFinish) {
    const transaction = editor.finishSharedBoundary();
    console.log(preview, transaction);
  } else {
    console.log(editor.getState().sharedBoundaryError);
    editor.cancel();
  }
}
```

- `editSharedBoundary(): boolean` enters `edit-shared-boundary` mode. It returns
  false without changing state for an ineligible selection or an already active
  shared edit. A competing active tool throws; finish or cancel it first.
- `getDraft()` returns the shared chain, including its fixed endpoints. It does
  not return either complete polygon. `vertexCount` and `selectedVertexIndex`
  address this chain. `selectedFeatureId`, `activePartIndex` and `activeRingIndex`
  are null; `selectedFeatureIds` retains the pair in selection order.
- `moveVertex`, `insertVertex`, `removeVertex` and `selectVertex` reuse the vertex
  editing API. Moving/removing an endpoint returns false; insertion before the
  first or after the last endpoint throws. Malformed coordinates and invalid
  indices throw without replacing the draft. Geometrically invalid edits remain
  correctable, with `canFinish: false` and a `sharedBoundaryError` diagnostic.
- `getSharedBoundaryPreview(): SharedBoundaryPreview | null` returns an independent
  FeatureCollection snapshot containing two complete Polygon features in selection
  order. It is null outside the tool or while the draft is invalid.
- `finishSharedBoundary(): TransactionEvent | null` revalidates and commits both
  updates atomically. Inactive/invalid calls return null; invalid drafts stay active.
  An unchanged draft exits without a transaction and also returns null.
- `finish()` confirms through the same path and returns the first selected result
  (or unchanged first feature for a no-op). Use `finishSharedBoundary()` when you
  need the complete batch. Cancel discards both previews.

`validationError` remains null in this mode; use `sharedBoundaryError`. That field
is null outside shared editing and for valid drafts. Consumers with exhaustive
state switches must handle the new mode and field. The LineEditor compatibility
facade does not expose these commands. Getters remain readable after destruction;
commands and subscriptions throw.

| Diagnostic | Meaning |
| --- | --- |
| `shared-boundary-invalid-result` | Invalid chain, changed junction or invalid resulting polygon. |
| `shared-boundary-overlap` | Individually valid result polygons would overlap. |
| `shared-boundary-calculation-failed` | The pair overlap calculation failed; nothing is committed. |

## Interaction, events and history

Normal snapping settings apply to dragged shared corners and inserted midpoints.
Both selected source features are excluded; other committed features remain snap
targets. Alt bypasses snapping. Programmatic vertex coordinates are used directly.
Pointer motion is coalesced per animation frame; release resolves the final point.
Pointer cancellation, lost capture or window blur rolls back the active gesture,
including removing a just-inserted midpoint, while keeping the editing tool open.

Valid previews hide both committed originals. Invalid drafts show the originals
and editable chain without a result fill. Camera/style changes rebuild the preview.
Finish, cancel, destruction and map removal clean up owned state and restore prior
gesture settings when the map remains alive.

Preview and cancellation do not mutate exported features or increment dataRevision.
Confirmation preserves both IDs, properties (including null), collection positions
and selection. It allocates no IDs and does not recalculate stored area attributes.
A changed confirmation increments dataRevision once and emits one `onTransaction`
containing both updates, followed by `onChange`. There are no individual `onUpdate`
events. Undo/Redo emits `onHistory` with action `transaction` and restores exact
geometry, properties and order. Snapshots and listener payloads are independent.
Cancel and unchanged confirmation preserve existing Redo history.

Competing data, selection and history commands are locked during the edit.
Validation is synchronous and potentially quadratic in polygon size, including
on drag frames. The [benchmark](performance.md#shared-boundary-editing) records
this limit; large boundaries do not yet have a smooth-interaction guarantee.
