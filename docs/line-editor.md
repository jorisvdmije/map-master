# LineEditor: first drawing milestone

For new integrations, use [GeometryEditor](geometry-editor.md), which supports
both lines and polygons. LineEditor remains a line-only compatibility facade
around that same implementation; `startLine()` maps to `draw('LineString')`.

Status: experimental API. Supports 2D GeoJSON LineString features on a flat
Mercator MapLibre GL JS 6.15 map. The application provides the map, its CSS,
worker configuration, map services, and persistence.

## Integrate

The package is not published. Use the local demo or install an archive created
with `npm pack` into your application alongside a compatible `maplibre-gl`.

```ts
import { LineEditor } from '@geo/editor';

// `map` is a MapLibre map owned by your application.
map.once('style.load', () => {
  const editor = new LineEditor(map);

  editor.onCreate((feature) => {
    console.log(feature.id, feature.geometry.coordinates);
  });

  editor.startLine();
  // Click to add vertices. Enter/Finish commits; Escape/Cancel discards the draft.
  // Your own UI can call editor.finish(), editor.cancel(), and editor.startLine().
  // Read editor.exportGeoJSON() when the application needs a data snapshot.

  // On component teardown, call editor.destroy().
  // map.remove() also destroys its attached editor automatically.
});
```

For Vite, MapLibre 6 needs its separate worker URL configured by the host before
creating a map. The demo includes this setup:

```ts
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
```

Other bundlers must serve the MapLibre worker and configure its URL appropriately.
See the [MapLibre documentation](https://maplibre.org/maplibre-gl-js/docs/).

## Public API

| Member | Behavior |
| --- | --- |
| `new LineEditor(map)` | Attach after `style.load` or `load`. One editor per map; separate maps are independent. |
| `startLine()` | Activate drawing and focus the map canvas. Calling it again preserves the active draft. |
| `finish()` | Commit clicked positions and return a `LineFeature`; return `null` if there are fewer than two distinct positions. |
| `cancel()` | Discard only the current draft. Existing features remain intact. |
| `getState()` | Return a snapshot with `mode`, `vertexCount`, `featureCount`, `canFinish`, and `validationError`. |
| `exportGeoJSON()` | Return an independent `LineCollection` snapshot of committed features. |
| `onCreate(listener)` | Subscribe to committed feature creation; return an unsubscribe function. |
| `onChange(listener)` | Subscribe to editing-state changes; return an unsubscribe function. Read initial state with `getState()`. |
| `destroy()` | Cancel the draft, restore gestures/cursor, remove owned layers, sources and listeners. Safe to call repeatedly. |

`Coordinate`, `EditorState`, `LineFeature`, and `LineCollection` are exported
TypeScript types. Export coordinates use `[longitude, latitude]` decimal degrees.
Every committed line gets a UUID and empty properties. Mutating returned objects
does not change the editor, and each creation listener receives its own snapshot.

After destruction, data snapshots remain readable; drawing and subscribing throw
an error. A new editor starts with an empty collection. Export before destroying
if the host needs to retain data; import is not implemented yet.

Callbacks are synchronous. Observer exceptions are reported asynchronously so
they cannot interrupt the commit or prevent the other listeners from running.
`onCreate` means the data is committed; MapLibre renders it asynchronously. Listen
to the map's `error` event for worker or rendering errors.

## Interaction rules

- Plain left clicks add vertices. Consecutive identical positions are ignored.
- The line follows the mouse as a preview, but finishing includes clicked points only.
- Enter finishes and Escape cancels only when the map canvas has keyboard focus.
  Shortcuts do not intercept typing in other inputs or modified key combinations.
- Drag panning and scroll zoom remain available. Modified clicks do not add points.
- Double-click zoom is temporarily disabled. A double click does not finish a line
  or add a duplicate point; use Enter or Finish.
- Finishing, cancelling, or destroying restores the previous cursor and
  double-click zoom setting. The editor owns those two settings while drawing.
- Replacing the map style recreates the editor's layers and restores its data.

## Scope and performance

This milestone handles ordinary desktop line drawing. Touch, globe/terrain,
antimeridian-spanning lines, alternate projections, editing, and topology checks
are outside its validated scope. Self-crossing lines are allowed. Feature IDs
remain stable for the lifetime of stored features; the application owns saving.

Committed features and the draft use separate GeoJSON sources. Pointer movement
updates only the draft and is coalesced to one update per animation frame. The
browser tests verify that moving the pointer does not rewrite committed data.
Completing a line currently replaces the committed source; large-dataset
performance is not yet characterized.

The production demo includes the MapLibre renderer and worker, so its size is
larger than the editor package. Vite's large-chunk notice refers to that demo
bundle. Dataset benchmarks, latency budgets, and memory measurements remain
release work; there is no enterprise-scale performance claim yet.
