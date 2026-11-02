# Compatibility and limits

This page lists what Map Master is tested against and where its limits are, so
you can decide whether it fits your application before you promise support for a
browser, device or dataset.

## Requirements

| Requirement | Details |
| --- | --- |
| MapLibre GL JS | Optional peer `^6.15.0`, tested at 6.15.0. Install this renderer for the default or `/maplibre` entry point. |
| Mapbox GL JS | Optional peer `^3.34.1`, tested at 3.34.1. Install this renderer for `/mapbox`; see [setup and qualification](mapbox.md). Installing either renderer does not install the other. |
| Map projection | Flat Web Mercator, including zoom, bearing and pitch. Globe and terrain are not supported. |
| Coordinates | 2D WGS84 `[longitude, latitude]` in the canonical world copy. Geometry crossing the antimeridian and polar geometry are rejected. |
| Browser | A modern browser with WebGL and ES2022 support. |
| Secure context | HTTPS or `localhost`, because new feature IDs use `crypto.randomUUID()`. |
| Module format | ESM only, with TypeScript declarations. Works with any bundler that resolves package `exports`. |

## Tested environments

| Area | Status |
| --- | --- |
| Chromium (desktop) | Supported. The complete MapLibre library suite, playground/workspace and performance budgets run in CI on every change, using Playwright's Chromium. |
| Mapbox adapter (Chromium) | The same 15 adapter scenarios run on both renderers, covering geometry, gestures, responsive controls, zoom-dependent outline queries, style reload and lifecycle. Tokenless Mapbox `testMode` covers API/worker behavior, not visual output. Authenticated Mapbox rendering, hosted styles, production CSP, the complete Mapbox library suite and Mapbox performance budgets are not qualified. |
| Firefox and WebKit (desktop) | The example application's workflows pass in CI on Linux and macOS, using Playwright's Firefox and WebKit. The full library test suite and performance budgets run in Chromium only. Playwright's WebKit is not the shipping Safari application. |
| Mouse and keyboard | Supported for every tool. Keyboard shortcuts apply while the map canvas has focus. |
| Touch and pen | [Vertex editing](touch-pen-vertices.md) is tested with emulated touch and pen input in Chromium. Drawing, selection rectangles and transform handles are designed for a mouse. Physical tablets and styluses have not been qualified. |
| Accessibility | Vertices can be [edited with the keyboard](keyboard-vertices.md) and the examples use native controls. There is no complete screen-reader workflow for map geometry; provide accessible alternatives through the public API where your application needs them. |

## Performance profile

Every release is checked against a fixed workload in a real browser: an installed
copy of the package in an example application with **1,000 features**
(markers, lines, small polygons and one 100-corner polygon). The checks fail when
the 95th-percentile latency exceeds these budgets:

| Interaction | Budget (p95) |
| --- | ---: |
| Import the complete dataset from a file | 2,000 ms |
| Select a feature from the application's list | 150 ms |
| Select a feature through the API and render the selection | 100 ms |
| First vertex-drag preview after a camera change, including snapping index rebuild | 150 ms |
| Following vertex-drag previews | 100 ms |
| Commit an edit and render the result | 1,000 ms |

Repeatedly creating and destroying a map and editor must not retain more than
8 MiB of heap, 100 DOM nodes or 20 event listeners.

These numbers describe one workload, not a guarantee for every dataset. Costs
grow with the number of vertices: polygon validation is quadratic in the number
of corners of the edited ring, and overlay tools such as union, buffer and
difference run synchronously. Profile your own data if you edit thousands of
complex polygons, very large rings or deeply nested multipart geometry. The
[performance notes](performance.md) contain per-operation measurements.

## Data model limits

- Supported geometry types are Point, LineString, Polygon, MultiLineString and
  MultiPolygon. GeometryCollection, 3D coordinates and legacy `crs` members are
  rejected on import.
- Polygons must be valid: simple rings, holes strictly inside their exterior and
  no touching or overlapping parts. See the [polygon contract](geometry-editor.md#polygon-contract)
  and [multipart rules](multipart.md).
- Self-crossing lines are allowed.
- Feature IDs are strings or finite numbers; `7` and `"7"` are different IDs.
- Properties must be JSON values. They are copied, never interpreted.
