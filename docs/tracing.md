# Trace existing boundaries while drawing

Enable **Snap to vertices & edges** and **Trace existing boundaries** in the demo.
Start a line or polygon, click an existing boundary, then move to another point
on the same boundary. The orange preview follows its intervening corners. Click
to insert the entire section. Mix traced sections with ordinary free drawing;
**Other trace route** chooses the other arc of a polygon ring before the next click.
Choose **Trace an existing boundary** under **Try an example**, then **Add example**
to load a stepped boundary for trying this out.

Backspace/Delete removes the last drawing step, including every corner inserted
by one trace click. Enter/Finish saves the whole draft; Escape/Cancel discards it.
Clicking the first polygon corner can trace the final section and close the polygon.
The existing polygon/hole validator still decides whether the result can be saved.
The preview shows a prospective route, not a guarantee that the whole draft is valid.

## Scope and route choice

Tracing works while drawing a LineString, Polygon or new hole. Source paths can
be a committed LineString, one MultiLineString component, a Polygon exterior or
hole, or one MultiPolygon component's ring. Each section stays on **one explicitly
identified source path**. It never switches features, rings or components at a
crossing. Clicking a different source draws an ordinary connecting segment and
establishes a new anchor there. Source features are never changed.

Open lines have one route, in either direction, even if their endpoints coincide.
Polygon rings have two arcs. `shorter` (default) and `longer` compare summed planar
longitude/latitude segment lengths, not metres or screen distance. For exact ties,
order endpoints lexicographically and compare the resulting coordinate sequences
lexicographically; the lesser sequence is `shorter`. This makes the tie independent
of ring start, winding and travel direction. Equal endpoints do not trace a full lap.
For source lines with repeated positions/self-crossings, attachment uses the first
matching vertex, otherwise the nearest matching segment in source order; there is
no graph routing or branch choice at intersections.

Endpoints can be existing vertices or interior edge positions. Intermediate
corners are copied exactly, without smoothing or simplification. The core allows
only construction roundoff (`64 * Number.EPSILON * max(1, abs(lng), abs(lat))`)
when attaching; it is not a geographic snapping radius. An already attached draft
endpoint is retained when reprojection differs only within this tolerance.

## Public API

```ts
const editor = new GeometryEditor(map, {
  snapping: { enabled: true },
  tracing: { enabled: true, side: 'shorter' },
});
editor.draw('LineString');
// Programmatic endpoints must lie on the specified source path.
editor.traceBoundary(
  { featureId: 'parcel', partIndex: 0, ringIndex: 0 },
  [4.890, 52.370],
  [4.891, 52.373],
  'shorter',
);
editor.removeLastDrawStep(); // Remove the complete appended section.
editor.cancel();
```

- `getTracing(): TracingOptions` returns an independent `{ enabled, side }` snapshot.
- `setTracing(partial)` validates options atomically, updates the next route preview
  and emits `onChange` only for a changed setting. Disabling clears the mouse anchor.
- `getTracePreview(): Coordinate[] | null` returns the prospective source route,
  including both endpoints, as an independent snapshot. It is null without a live
  pointer/anchor, with Alt held, with snapping/tracing disabled, or outside supported
  drawing modes. Reading it does not alter draft validity or committed data.
- `traceBoundary(target, from, to, side?)` appends one section to the draft. The default
  side is the current tracing setting. An empty draft begins at `from`; otherwise
  the draft must end at that attachment. Missing sources, invalid indices, off-source
  endpoints, equal endpoints, disconnected drafts and inactive modes return false
  without changing the draft. Malformed coordinates/side values throw when evaluated.
  Programmatic tracing does not require the tracing or snapping toggle to be enabled.
- `TraceTarget` contains `featureId` and optional `partIndex`/`ringIndex` (default 0).
  Numeric and string IDs remain distinct. A line accepts only ring index 0.
- `removeLastDrawStep()` returns whether it removed a step; it works for ordinary
  drawing clicks as well. It never modifies committed history.

All commands throw after destruction; snapshots remain readable. There is no new
editor mode or committed event type. The LineEditor compatibility facade does not
expose tracing commands; use GeometryEditor for new integrations.

## Mouse acquisition, rendering and lifecycle

The tracing toggle is opt-in. Mouse acquisition uses the existing snapping settings,
CSS-pixel radius, vertex priority, overlap ordering and camera/revision cache. Alt
bypasses snapping and tracing for the current pointer/click. Snapping and tracing
options can change live. A free click clears the source anchor. Backspace retains
that source when a preceding draft point remains, so the corrected route can be
chosen again; if the preceding point is off that source, reattach with another click.

For traced edge snaps, screen unprojection is projected onto the source's planar
longitude/latitude segment and the actual pixel distance is checked again. Long
oblique edges may visibly differ from the planar segment; candidates beyond the
acquisition radius are refused. Shared points are resolved by the existing snapping
order; there is no source picker. Hole drawing retains the existing exclusion of
the edited feature from mouse snapping.

Only clicks/programmatic appends validate the whole draft. Hover builds a route
preview and never commits corners or changes `canFinish`. Route calculation is
linear in source-path length; the last identical request is cached. Snapping uses
the existing spatial index. Source lookup by ID and multipart/ring addressing do
not scan the collection. Polygon validation on click remains potentially quadratic,
but runs once per traced section, not once per inserted corner. See the
[benchmark](performance.md#boundary-tracing).

Camera and style changes reconstruct the preview. Mouse leave/window blur clears
the prospective route. Finish, cancel, destroy and map removal clear the anchor
and preview cache. Gesture settings are restored using the existing drawing
lifecycle. No committed source upload occurs during tracing or cancellation.

## Persistence and Undo

Tracing changes only the drawing draft. Finish creates one new feature and emits
one `onCreate`, then `onChange`, with one `create` history action. Drawing a hole
keeps its existing update/event/history contract. Sources retain exact geometry,
IDs, properties and collection position. New features use normal drawing IDs and
properties; tracing does not copy source attributes or establish a persistent link.
Undo/Redo restores the entire saved drawing. Cancel leaves data, data revision and
an available Redo action unchanged.

This is planar 2D tracing, without shared-boundary editing, automatic topology
repair, dateline jumps, geodesic routing or globe/terrain guarantees. It does not
trace during vertex editing, reshape, split or overlay review.
