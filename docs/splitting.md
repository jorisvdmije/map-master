# Split one polygon into two features

Milestone 11 adds an interactive Split Features tool for one selected polygon
with optional holes, provided the cut avoids them. This creates two independent features, not parts of one multipart
feature. Line splitting, cuts through holes and multipart splitting remain future work.

## Interaction

1. Select a polygon and choose **Split polygon**.
2. Click outside it, draw across its interior, and click outside on the other side.
   Two points form a straight cut; additional points can form a bent cut.
3. Once the placed cutting line is valid, the two proposed parts appear in orange
   and purple. The original is temporarily hidden; exports still contain it.
4. Choose **Apply split** or press Enter with map focus. Escape/Cancel restores
   the original. Backspace/Delete removes the last cutting-line point.

The preview is calculated from placed points, not the unclicked cursor. Hover
only extends the cutting-line guide; Enter never includes the cursor position.
The original stays visible when the cut is incomplete or invalid. Snapping and
Alt bypass work while placing cut points. Snapping a point onto the target boundary
produces a diagnostic under this first version's strict crossing policy: place
the endpoints outside or hold Alt to place freely. Panning/zooming stays available.

## Public API

```ts
// editor is an existing GeometryEditor with a selected Polygon.
if (editor.splitSelected()) {
  // User clicks can supply the cut, or the host can replace it programmatically:
  editor.setSplitLine([[4.88, 52.372], [4.91, 52.372]]);
  const preview = editor.getSplitPreview(); // SplitPreview | null
  const { canFinish, splitError } = editor.getState();
  if (canFinish) {
    const event = editor.finishSplit(); // TransactionEvent | null
    console.log(event);
  }
}
```

`splitSelected()` returns false without a selected polygon or when already
splitting, preserving the current cut. It throws if another drawing/edit is active.
It retains the selection and enters `split-polygon` mode. `getDraft()` then returns
the placed cutting-line coordinates. `setSplitLine()` validates coordinate structure
and bounds before replacing the cut; invalid input throws without changing it.
Geometrically unsuitable cuts are retained for correction, with `splitError`.
`removeSplitPoint()` returns whether a point was removed. Both setters require
an active split. There is no dragging of cutting-line vertices in this milestone.

`getSplitPreview()` returns independent `retained` and `created` Polygon geometries
without feature IDs. No ID is allocated during preview. `finishSplit()` returns
null unless a valid split is active. `finish()` also commits a valid split, returning
only the retained PolygonFeature to preserve its existing return type. Prefer
`finishSplit()` when the caller needs both changes. `cancel()` discards the cut.
Getters remain readable after destroy; commands and subscriptions throw.
The LineEditor compatibility facade does not expose the split tool.

While splitting, selection changes, import, transactions, history, deletion and
switching to other tools throw. `canUndo` and `canRedo` are false until the mode
ends. Normal `validationError` remains null; use the separate `splitError` field.
The new mode and field are additive changes to the experimental EditorState API.

## Supported geometry and numerical policy

The source is an already validated Polygon with a simple exterior and optional disjoint holes. The cutting line
must be simple and start/end strictly outside the polygon. It must have exactly
two **proper crossings through edge interiors**. Crossing at an existing polygon
vertex, placing a cutting-line vertex on the boundary, tangential contact, following
an edge, self-touching, backtracking, and cuts creating more than two pieces are
explicitly rejected. A simple bent cut can enter and exit the same polygon edge.

This deliberately restricted algorithm reuses the existing robust-predicates
orientation checks. It walks the two boundary arcs and joins each to the interior
cut path. It is not a general overlay/polygonization engine; a broader engine can
later replace this internal boundary without changing interactive confirmation.
No new runtime dependency was introduced. Both outputs pass the whole-polygon
topology validator. Exterior rings are closed, CCW, and use a canonical starting
vertex; preserved holes keep their closed clockwise rings and starting vertices.

Calculations use planar longitude/latitude segments, consistent with current
polygon validation. Intersection construction uses floating-point arithmetic;
nonfinite/degenerate results fail closed. The sum of output planar areas must
match the original within relative 1e-10; this is a conservation check, not a
physical-area accuracy claim or a snapping tolerance. Extremely small or poorly
conditioned cuts can be rejected instead of approximated silently.

The preview uses MapLibre's Mercator rendering of those coordinates. At large
extents a planar longitude/latitude segment can differ from a straight displayed
Mercator segment; this milestone does not promise screen-perfect cutting under
all projections. Dateline-crossing segments, polar geometry, terrain/globe and
alternative projections remain outside the editor's supported scope.

Diagnostics:

| splitError | Meaning |
| --- | --- |
| `split-too-few-points` | Place at least two cutting-line points. |
| `split-self-intersection` | The line crosses/touches itself, repeats points, or backtracks. |
| `split-antimeridian` | A cutting segment spans more than 180 degrees longitude. |
| `split-boundary-touch` | The cut touches a vertex/boundary or overlaps an edge. |
| `split-endpoints-inside` | An endpoint is inside the target polygon. |
| `split-crossing-count` | There are not exactly two proper boundary crossings. |
| `split-hole-crossing` | The cut crosses or touches a hole boundary. |
| `split-invalid-result` | Intersection construction, result topology or area conservation failed. |

## Identity, properties and atomic history

The part with larger **filled planar coordinate area** (exterior minus holes) retains the original ID and
collection position. Exactly equal areas use lexicographic comparison of the
canonical coordinate sequences. This is deterministic for identical calculated
coordinates; it is not a geodesic largest-area policy. The other part receives
a new UUID and appends to the collection. Selection stays on the retained ID.

Both parts receive independent copies of the original JSON properties, including
null. Business identifiers and stored area/length fields are not interpreted,
regenerated or recalculated. Applications must explicitly define those updates
for their domain; the split API currently provides no property-mapping callback.
Unrelated features and their order remain unchanged.

Confirmation prepares one update plus one create, validates them through the
transaction boundary, and commits once. Allocation/validation failure keeps the
original data, cut and preview intact. One successful split increments revision
once, uploads once, emits one `onTransaction` with both changes, then `onChange`.
It does not emit individual `onCreate`/`onUpdate` events. Undo/redo uses one
`onHistory` event with action `transaction` and restores exact coordinates, IDs,
properties and order. Subscribe to both streams for backend synchronization.
Cancel, invalid confirmation and preview do not change history or exports.

Style replacement reconstructs the preview. Finish/cancel restore the previous
cursor/double-click zoom setting; destruction/map removal discard the preview
and clean up handlers. See [performance](performance.md#polygon-splitting).

Holes are assigned to the result that strictly contains them, retaining their relative ring order and clockwise winding. Hole coordinates remain unchanged. A rejected cut preserves the original polygon and history.
