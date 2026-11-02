# Mapbox GL JS adapter

Map Master works with Mapbox GL JS through the
`@jorisvdmije/map-master/mapbox` entry point. It exposes the same `GeometryEditor`,
`EditorToolbar`, `DataLayerControl`, errors and public types as the default
MapLibre entry point. Both use one editing engine; GeoJSON, validation, snapping,
data layers, geofencing, keyboard commands and Undo/Redo have the same semantics.

## Install and initialize

```sh
npm install @jorisvdmije/map-master mapbox-gl@^3.34.1
```

Install the renderer your application uses. Both renderer peers are optional so
a Mapbox application does not also install MapLibre. The editor imports neither
renderer at runtime. Existing default imports and the explicit `/maplibre` alias
continue to work for MapLibre applications.

Use a Mapbox public access token from your application's configuration. The
application owns its token, basemap, CSS and worker. See Mapbox's
[installation guide](https://docs.mapbox.com/mapbox-gl-js/guides/get-started/).

```ts
import mapboxgl from 'mapbox-gl';
import {
  GeometryEditor, EditorToolbar, DataLayerControl,
} from '@jorisvdmije/map-master/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const map = new mapboxgl.Map({
  container: 'map',
  accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
  style: 'mapbox://styles/mapbox/streets-v12',
  projection: 'mercator',
  center: [4.895, 52.372],
  zoom: 14,
});

map.once('load', () => {
  const editor = new GeometryEditor(map, {
    snapping: { enabled: true },
    dataLayers: {
      layers: [{ id: 'parcels', name: 'Parcels' }, { id: 'notes', name: 'Notes' }],
      activeLayerId: 'parcels',
    },
  });
  map.addControl(new EditorToolbar(editor), 'top-left');
  map.addControl(new DataLayerControl(editor), 'top-right');
  editor.onDataChange(() => {
    // Save editor.exportGeoJSON() through your application's persistence API.
  });
});
```

Give the container a height, for example
`<div id="map" style="height: 500px"></div>`. The editor attaches once the style
is initialized. `map.setStyle()` recreates its sources and layers while retaining
the document, selection and current draft. `editor.destroy()` removes only the
editor's resources; remove controls with `map.removeControl(control)`. Removing
the map also destroys its editor. Use one editor per map.

The [complete example](../examples/basic/mapbox.ts) also exposes GeoJSON and a
style-reload button. In this checkout, configure `VITE_MAPBOX_ACCESS_TOKEN` in
your environment, run `npm run dev`, then open
[the local Mapbox example](http://127.0.0.1:5173/mapbox.html). Without that
configuration the page shows setup instructions and does not create a map.

## Worker and bundler setup

The standard `mapbox-gl` build supplies its own blob worker. Import its CSS once;
do not call MapLibre's `setWorkerUrl()` for a Mapbox map. The default worker
requires your application's CSP to allow blob workers. For a strict CSP use the
matching Mapbox CSP main bundle and separately served worker, as described in
[Mapbox's security guide](https://docs.mapbox.com/mapbox-gl-js/guides/security-and-testing/#strict-csp-environments).
With Vite, the configuration is:

```ts
import mapboxgl from 'mapbox-gl/dist/mapbox-gl-csp.js';
import workerUrl from 'mapbox-gl/dist/mapbox-gl-csp-worker.js?url';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.workerUrl = workerUrl; // Set before creating any map.
```

Mapbox's CSP subpath may need a local TypeScript declaration, depending on the
version's package typings:

```ts
// mapbox-csp.d.ts
declare module 'mapbox-gl/dist/mapbox-gl-csp.js' {
  import mapboxgl from 'mapbox-gl';
  export default mapboxgl;
}
```

Serve the worker on your own origin and allow that origin in `worker-src`.
Configure Mapbox service URLs in `connect-src` according to its guide. The editor
does not change your CSP or worker configuration. Mapbox also offers an ESM
build; follow its [bundler guide](https://docs.mapbox.com/mapbox-gl-js/guides/bundler/)
for namespace imports and passing the token through `Map` options. That build
is not part of the browser qualification below.

## Tested versions and differences

| Area | Qualification |
| --- | --- |
| MapLibre GL JS | 6.15.0; the full library suite, installed workspace and performance budgets run in Chromium. |
| Mapbox GL JS | 3.34.1; the shared adapter scenarios run in Chromium against its full JavaScript API and default worker in tokenless `testMode`. Visual output is not qualified by those scenarios. |
| Equivalent scenarios | Toolbar/keyboard drawing, invalid drafts, cancellation, typed IDs, multipart geometry, holes, locks, snapping, vertex and whole-feature dragging, worker handoff, lasso, data layers, labels, geofences, style replacement and teardown during a gesture. |
| Source updates | MapLibre returns a promise from `GeoJSONSource.setData()`; Mapbox returns the source. The editor handles both and keeps a released drag preview until the source and rendered tiles are ready. |
| Camera roll | MapLibre exposes `getRoll()`; Mapbox does not. Lasso camera-change detection treats absent roll as zero. |
| Host teardown | Mapbox releases style/container resources before `remove`. Cleanup retains registered DOM targets and avoids querying a released style. |

Mapbox browser tests use its documented `testMode` with an in-memory background
style. They cover interactions, data queries, workers and layer lifecycle without
a token, hosted tiles or Mapbox services. Test mode does not produce visual
output, so these checks do not verify polygon colors or border pixels. Visual
rendering requires a valid application-owned Mapbox token and separate tests. See [Mapbox's automated testing documentation](https://docs.mapbox.com/mapbox-gl-js/guides/security-and-testing/#automated-tests).
The configured-token example builds and type-checks; hosted-map authentication,
billing, service availability and production CSP deployment require your own
integration checks. The MIT license covers Map Master; Mapbox GL JS and its
services retain their own terms.

Editing is qualified for flat Web Mercator and canonical 2D WGS84 coordinates.
Globe, terrain, 3D geometry, imported Mapbox Standard style slots, Mapbox ESM/CSP
builds, Firefox/WebKit and physical touch devices are not qualified by the shared
Mapbox suite. No Mapbox-specific performance budget is claimed. See
[compatibility and limits](compatibility.md) for geometry and input constraints,
and the [API reference](geometry-editor.md) for the common methods.
