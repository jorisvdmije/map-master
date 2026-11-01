# Pin shared vertices

Explicitly link coincident vertices of markers, lines and polygons, including
holes and multipart components. Dragging or nudging a linked vertex previews all
participants. Save commits the complete change as **one transaction and one Undo
step**. Committed GeoJSON remains unchanged until Save; Cancel discards the draft.

## Toolbar and keyboard

Select two or more features with Shift+click, then choose **Pin shared vertices**.
The command links every exactly coincident position in the selection. Select one
participant, choose **Edit vertices**, and move a linked corner. The other features
follow in the preview. **Unpin vertices** removes every complete group touching
the selection, including memberships in unselected participants. Pinning and
unpinning are themselves undoable transactions.

```ts
import { EditorToolbar, GeometryEditor } from '@jorisvdmije/map-master';

const editor = new GeometryEditor(map, {
  keyboardShortcuts: {
    pin: [{ key: 'p' }],
    unpin: [{ key: 'p', modifiers: ['Shift'] }],
  },
});
map.addControl(new EditorToolbar(editor, {
  tools: ['pin', 'unpin', 'edit', 'duplicate', 'delete', 'undo', 'redo'],
}));

// After importing your features:
editor.selectMany(['parcel-west', 'parcel-east', 'junction']);
editor.pinSharedVertices();
editor.select('junction');
editor.editSelected();
editor.moveVertex(0, [4.868, 52.358]);
const preview = editor.getPinnedPreview(); // All participating features, or null.
editor.finish(); // Emits onTransaction/onDataChange with every changed feature.
```

There are no default pin/unpin shortcuts. Both actions use the normal runtime
shortcut configuration and toolbar keyboard navigation. In vertex editing,
**Home**, **End**, **PageUp** and **PageDown** focus a vertex control; arrow keys
nudge it, **Enter** saves, and **Escape** rolls back a pending gesture or cancels
editing. An accessible toolbar notice explains a rejected linked preview.
Alt bypasses snapping and guides; explicit pins remain linked.

Dragging an entire selected feature, or calling `translateSelection(delta)`, also
moves its linked vertices in unselected features. The unselected features follow
only at their linked positions. Releasing the drag commits one transaction.

## Explicit addresses and tolerance

```ts
editor.pinVertices([
  { featureId: 'parcel-west', partIndex: 1, ringIndex: 1, index: 0 },
  { featureId: 'junction', index: 0 },
], { tolerance: 0.000001 });

const groups = editor.getPinnedVertices();
editor.unpinVertices([{ featureId: 'junction', index: 0 }]);
```

`partIndex`, `ringIndex` and `index` are zero-based. Omitted part/ring indices mean
zero. Points have one vertex at index 0. Line rings must be 0; polygon ring 0 is
the exterior, later rings are holes. Closing ring copies are excluded. Addresses
refer to the **current exported geometry**, after normalizing ring winding on
import. `getPinnedVertices()` reports current addresses and independent snapshots.

The default tolerance is **0**, requiring exact coordinate equality. An explicit
finite tolerance from 0 through 1 uses planar Euclidean longitude/latitude
**degrees**, without longitude wrapping. It is neither meters nor screen pixels.
Every participant must be within that radius of the first supplied vertex.
Pinning moves them to that first coordinate and validates the result before
committing. It never adds vertices to edges or guesses which nearby corner to use.
The toolbar always uses exact equality. Existing groups are merged, including
their unselected participants; all must satisfy the same tolerance and locks.

## GeoJSON persistence

Links use the reserved feature property `mapMasterPins`:

```json
{ "mapMasterPins": [{ "id": "shared-junction", "coordinate": [4.868, 52.358] }] }
```

All occurrences of that exact coordinate **within the feature** belong to the
pin, including repeated line positions and ring closure copies. A feature cannot
assign multiple groups to the same position. Group IDs are opaque nonempty
strings, at most 200 characters; generated IDs are preserved on export. IDs are
document-wide: reusing one joins the same group. Each membership must identify a
real vertex, and all imported participants of a group must agree exactly.
Malformed metadata or conflicting batches fail atomically.

Coordinate membership survives inserted vertices and ring winding changes.
Deleting a pinned vertex through editing is refused; unpin it first. Deleting a
whole feature removes its membership. A remaining singleton stays in GeoJSON and
can later join a reimported participant at the same coordinate. Undo restores
deleted features and their memberships exactly. Duplicates intentionally start
without pins, so moving a copy cannot move the original group.

## Locks, validation and other geometry tools

If any changed participant is locked or has invalid geometry, Save is disabled,
`getPinnedPreview()` returns null and `state.pinningError` explains the reason:
`pin-locked`, `pin-invalid-result` or `pin-conflict`. Correct the vertex or cancel;
no feature, data revision or history entry is partially committed. Newly locking
a linked participant cancels the active edit. History entries touching locked
features cannot replay until the host unlocks them.

`applyTransaction()` may update all geometry and pin coordinates together, or
explicitly remove memberships. It rejects a partial move that would separate
participants. Shape-changing tools other than vertex edits and translation do
not infer pin remapping. Unpin before using them; a stale or conflicting pin
causes rejection before any commit. Cross-feature polygon overlaps are allowed,
as elsewhere in the editor; pinning validates each complete feature and exact
group coincidence, rather than imposing a parcel-topology policy.

This explicit, persistent workflow is scoped separately from the two-polygon
[shared-boundary tool](shared-boundaries.md). Upstream reference:
[Geoman Pin Helper Mode](https://geoman.io/docs/maplibre/helper-modes/helper-pin),
checked 1 November 2026, documents synchronized movement of identical positions.
