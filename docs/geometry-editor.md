# GeometryEditor: lines and polygons

Status: experimental. Supports 2D LineString and single-outer-ring Polygon
features on a flat Mercator MapLibre GL JS 6.15 map. Desktop mouse and keyboard
input is tested in Chromium. Holes, multipart features, import, selection,
deletion, and vertex editing are not implemented yet.

## One editor API

The application owns the MapLibre map: its container, worker, stylesheet,
basemap, camera, and lifecycle. GeometryEditor owns drawing interactions,
validation, feature storage, and its overlay sources/layers. Application toolbar
buttons call the editor; they do not create or update MapLibre geometry sources.

```ts
import { GeometryEditor } from '@geo/editor';

// `map` is an application-owned MapLibre map. Attach once its style is ready.
map.once('style.load', () => {
  const editor = new GeometryEditor(map);

  const unsubscribe = editor.onCreate((feature) => {
    console.log('Committed:', feature.id, feature.geometry.type);
    // The host application can persist this snapshot to its own backend.
  });

  editor.draw('Polygon');
  // Now click on the map. Enter commits; Escape cancels.
  // A line button calls editor.draw('LineString') when no draft is active.
  // Finish / Cancel / Export buttons call editor.finish(), editor.cancel(),
  // and editor.exportGeoJSON(), respectively.

  // On component teardown, unsubscribe() and editor.destroy().
  // Removing the map also destroys its attached editor automatically.
  void unsubscribe;
});
```

For host worker configuration and local package installation, see the
[integration setup](line-editor.md#integrate) and [working demo](../examples/basic/main.ts).
The package is private and unpublished; use `npm pack` for an installable archive.

| Member | Contract |
| --- | --- |
| `new GeometryEditor(map)` | Attach after `style.load` or `load`. One editor per map, including the LineEditor facade. |
| `draw('LineString' \| 'Polygon')` | Start a draft and focus the canvas. Repeating the active type preserves the draft. Changing type during drawing throws; finish or cancel first. |
| `finish()` | Commit a valid draft once, returning a `GeometryFeature`. An invalid/incomplete draft returns `null` and remains active. |
| `cancel()` | Discard only the draft. |
| `getState()` | Snapshot: `mode`, `vertexCount`, `featureCount`, `canFinish`, `validationError`. |
| `exportGeoJSON()` | Independent `GeometryFeatureCollection` snapshot containing committed lines and polygons. |
| `onCreate(listener)` | One event per committed feature, with an independent snapshot per listener. Returns an unsubscribe function. |
| `onChange(listener)` | Editing-state notification after state changes. Read the initial state with `getState()`. Returns an unsubscribe function. |
| `destroy()` | Remove owned resources/listeners and restore drawing gesture settings. Idempotent. |

`GeometryFeature` is the union of `LineFeature` and `PolygonFeature`. Inspect
`feature.geometry.type` to narrow coordinates in TypeScript. `GeometryFeatureCollection`
is a GeoJSON FeatureCollection containing both shape types. Each feature has a UUID,
empty properties, and `[longitude, latitude]` coordinates. Imports and editable
properties will be introduced with explicit policies in later milestones.

Modes are `idle`, `draw-line`, and `draw-polygon`. `validationError` is `null`
when idle or when the current draft is valid. Check `canFinish` to enable Finish;
an idle editor cannot finish even though it has no validation error.

Callbacks run synchronously. Exceptions are reported asynchronously without
interrupting a commit or other observers. MapLibre renders committed data
asynchronously; listen to the map's `error` event for rendering failures.
After destruction, snapshots remain readable; drawing/subscribing throw.

## Polygon contract

- At least three distinct, non-collinear corners, with finite world-bounded
  coordinates. A valid outline may contain collinear intermediate vertices.
- One simple outer ring. Crossing edges, nonadjacent touches, repeated interior
  vertices, and overlapping/backtracking edges are rejected, including the
  closing edge. Self-crossing **lines** remain allowed.
- Export repeats the first position at the end and normalizes the exterior to
  counterclockwise winding, as specified by [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.6).
  Reversing winding keeps the user's first vertex.
- Checks use planar longitude/latitude segments. An edge with longitude change
  greater than 180 degrees is rejected. Dateline splitting, polar geometry,
  terrain/globe, and alternate projections are outside the supported scope.
- Invalid drafts remain visible but cannot be committed. Add more points where
  appropriate, or cancel and redraw. Moving/removing draft vertices comes later.

Errors are `too-few-vertices`, `zero-area`, `duplicate-vertex`,
`self-intersection`, and `antimeridian-crossing`. The first detected error is
reported; these are diagnostics, not a list of every defect.

Enter or Finish closes a polygon. A plain click within 8 CSS pixels of its first
corner also finishes it after at least three corners, provided it is valid.
The cursor preview is never included in a commit. Escape cancels. Shortcuts
apply only when the canvas has focus. Drag pan and scroll zoom remain enabled;
the previous cursor and double-click zoom setting are restored on exit.

## Compatibility and ownership

The existing `LineEditor` remains available as a small facade around the same
engine: `startLine()` forwards to `draw('LineString')`, with line-only return and
event types. New integrations should use `GeometryEditor` for both shape types.
There is no second implementation of drawing behind the facade.

The editor does not extend MapLibre's prototype or attach custom methods to
`map`. Using `map.flyTo(...)` for the camera and `editor.draw(...)` for geometry
is intentional: each object has its own responsibility. Do not mutate editor
sources/layers directly, because the core is the authoritative feature store.
Style replacement automatically recreates the editor overlays and restores data.

## Implementation and performance

See the [code walkthrough](code-walkthrough.md). The core uses the small
[robust-predicates](https://github.com/mourner/robust-predicates) runtime dependency
(3.0.3, Unlicense) for numerically robust orientation tests, rather than an
arbitrary epsilon or naive floating-point determinant. Ring rules and the editor
workflow are our own implementation. MapLibre remains a host-supplied peer.

Polygon validation compares edge pairs: O(n²) for a draft with n corners, once
per added vertex. Incrementally drawing all n vertices therefore has O(n³)
total validation work. Validity is cached for state reads and finishing;
pointer motion does not run topology checks. Preview work is O(n) per rendered
frame and coalesced with requestAnimationFrame. Draft and committed data have
separate sources; a commit currently replaces the entire committed source.

The repeatable [validation benchmark](performance.md) characterizes only the core
algorithm. Large-dataset rendering, interaction latency, memory, touch input, and
other browser engines still require measurement before production-scale claims.
