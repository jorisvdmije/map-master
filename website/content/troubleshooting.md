# Troubleshooting

Start with the symptom below. The [complete quickstart](quickstart.md) provides a working MapLibre setup; the [Mapbox guide](../../docs/mapbox.md) covers the other renderer.

## The map is blank or has no height

- Give the map container an explicit height. Check its computed size in your browser; an empty container can have a height of zero.
- Import the CSS for your renderer: `maplibre-gl/dist/maplibre-gl.css` or `mapbox-gl/dist/mapbox-gl.css`.
- For MapLibre 6, configure the worker URL **before** creating the map. The [quickstart](quickstart.md#3-attach-the-editor) includes the Vite worker import. Mapbox uses its own worker setup; do not copy MapLibre's worker configuration into it.
- Check the browser console and Network panel for failed style, tile or worker requests. WebGL must be available.

## The map loads but the editor buttons are missing

Create one `GeometryEditor` per map after its `load` event, then add an `EditorToolbar` with `map.addControl()`. Creating the editor alone does not add buttons. Use the import that matches your renderer: the default entry point or `/maplibre` for MapLibre, and `/mapbox` for Mapbox.

See the [toolbar setup](../../docs/toolbar.md) and [framework integrations](../../docs/frameworks.md) for complete examples.

## Finish, Apply or an editing tool is disabled

- Finish or cancel the active operation before starting another one.
- Select the geometry the tool expects. For example, Merge needs at least two polygons, and Split needs one supported polygon.
- A draft needs enough distinct points: two for a line and three corners for a polygon. Crossing polygon edges or invalid holes must be corrected before saving.
- Check [feature locks](../../docs/feature-locks.md), [data-layer permissions](../../docs/data-layers.md) and [pinned vertices](../../docs/vertex-pinning.md) if a selection cannot be changed.
- With [geofencing](../../docs/geofencing.md) enabled, a forbidden preview remains visible but cannot be committed. Correct it or cancel.

The [interactive examples](examples.md) start with data suitable for each tool.

## GeoJSON import fails or a shape appears in the wrong place

Coordinates must be 2D WGS84 **`[longitude, latitude]`**, not `[latitude, longitude]` or projected meter coordinates. Supported types are Point, LineString, Polygon, MultiLineString and MultiPolygon. GeometryCollection and 3D coordinates are not supported.

Check for duplicate feature IDs, self-intersecting polygons, holes outside their exterior and unsupported polar or date-line geometry. A failed import leaves the existing document unchanged. See [import and export](geojson.md), [multipart geometry](../../docs/multipart.md) and [compatibility and limits](../../docs/compatibility.md).

## Keyboard shortcuts do not respond

Focus the map canvas first. Text inputs keep their normal typing behavior. Your application can also remap or disable editor shortcuts, so check the current bindings rather than assuming a default key.

See [keyboard shortcuts](../../docs/keyboard-shortcuts.md) and [keyboard vertex editing](../../docs/keyboard-vertices.md).

## Drawings disappear after a reload

The editor keeps geometry in memory. Save committed changes through `onDataChange` and restore them with `importGeoJSON`; `exportGeoJSON` excludes unfinished drafts. The documentation examples reset when you reload, while the standalone area workspace has its own browser storage.

The [saving and loading guide](../../docs/persistence.md) shows how to connect storage and restore data without keeping import operations in the user's undo history.

## A framework renders duplicate maps or controls

Initialize the map only in the browser, keep one editor per map, and call `map.remove()` when the component unmounts. Removing the map also destroys its editor. In React development, Strict Mode mounts effects twice; cleanup must remove the first map before the second is created.

The [React, Vue, Svelte and Angular examples](../../docs/frameworks.md) show the lifecycle patterns.

## The Mapbox example shows setup instructions

Configure `VITE_MAPBOX_ACCESS_TOKEN` with your Mapbox public access token in your local environment, then restart the development server. Check your token configuration and network connection if a hosted style cannot load. The MapLibre playground runs without a token.

See [Mapbox setup and tested differences](../../docs/mapbox.md). Map Master's MIT license does not replace Mapbox's own service terms.
